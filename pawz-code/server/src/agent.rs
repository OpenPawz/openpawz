// pawz-code — agent.rs
// The agent loop: call LLM, execute tools, loop, emit SSE events throughout.
// Designed to run in a spawned tokio task so the SSE handler can stream live.

use crate::memory;
use crate::provider;
use crate::state::AppState;
use crate::tools;
use crate::types::*;
use std::sync::Arc;
use std::time::Instant;

/// Build the system prompt injecting memory context and workspace info.
fn build_system_prompt(state: &AppState) -> String {
    let memories = memory::all_memories_context(state);
    let workspace = state
        .config
        .workspace_root
        .as_deref()
        .map(|w| format!("\nWorkspace root: {}\n", w))
        .unwrap_or_default();

    let memory_section = if memories.is_empty() {
        String::new()
    } else {
        format!(
            "\n## Long-term memory (your notes from previous sessions)\n{}\n",
            memories
        )
    };

    format!(
        "You are Pawz CODE — a highly capable developer AI agent.\n\
         You have full access to the user's codebase and development tools.\n\
         You can read and write files, run shell commands, grep code, and fetch URLs.\n\
         You have persistent memory across sessions via the remember/recall tools.\
         {workspace}\
         {memory_section}\n\
         ## Tool use guidelines\n\
         - Always explore before changing: read_file / list_directory / grep first.\n\
         - Use exec for git operations, builds, tests, package managers.\n\
         - Use remember proactively to store architecture decisions, conventions, key facts.\n\
         - Use recall at the start of complex tasks to surface relevant context.\n\
         - Prefer small, targeted edits. Show what changed and why.\n\
         - If a command might be destructive, explain what it does before running.\n\
         \n\
         You are working on the code that built you. Think carefully, move precisely."
    )
}

/// Run a complete agent turn for a single chat request.
/// Publishes EngineEvent JSON strings to `state.sse_tx` which the SSE handler broadcasts.
pub async fn run(state: Arc<AppState>, req: ChatRequest, session_id: String, run_id: String) {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_default();

    let system = build_system_prompt(&state);

    // Load conversation history
    let mut history = match memory::load_history(&state, &session_id) {
        Ok(h) => h,
        Err(e) => {
            fire_error(&state, &session_id, &run_id, &format!("Failed to load history: {}", e));
            return;
        }
    };

    // Build the user message, injecting VS Code workspace context if provided
    let user_text = if let Some(ctx) = &req.context {
        format!("{}\n\n---\n{}", req.message, ctx)
    } else {
        req.message.clone()
    };

    let user_msg = Message::user(&user_text);
    history.push(user_msg.clone());
    if let Err(e) = memory::save_message(&state, &session_id, &user_msg) {
        log::warn!("[agent] Failed to save user message: {}", e);
    }

    let tool_defs = tools::all_tools();
    let max_rounds = state.config.max_rounds;
    let mut round = 0u32;
    let mut total_tool_calls = 0usize;
    let mut final_text = String::new();
    let mut total_usage: Option<TokenUsage> = None;
    let mut actual_model = state.config.model.clone();

    // ── Agent loop ────────────────────────────────────────────────────────────
    loop {
        if round >= max_rounds {
            fire_error(
                &state,
                &session_id,
                &run_id,
                &format!("Max rounds ({}) reached — stopping.", max_rounds),
            );
            break;
        }
        round += 1;

        // Clone state for the delta closure (Arc is cheap)
        let state_c = state.clone();
        let sid = session_id.clone();
        let rid = run_id.clone();

        let result = provider::call_streaming(
            &state.config,
            &client,
            &system,
            &history,
            &tool_defs,
            move |delta_text| {
                let ev = EngineEvent::Delta {
                    session_id: sid.clone(),
                    run_id: rid.clone(),
                    text: delta_text.to_string(),
                };
                state_c.fire(event_to_json(&ev));
            },
        )
        .await;

        let llm = match result {
            Ok(r) => r,
            Err(e) => {
                fire_error(&state, &session_id, &run_id, &e.to_string());
                return;
            }
        };

        if let Some(u) = llm.usage {
            total_usage = Some(u);
        }
        // Use the model name returned by the API if available
        if let Some(m) = llm.model.clone() {
            actual_model = m;
        }
        if !llm.text.is_empty() {
            final_text = llm.text.clone();
        }

        // If no tool calls, we're done
        if llm.tool_calls.is_empty() {
            break;
        }

        // Save the assistant message (text + tool_use blocks)
        let mut assistant_blocks = Vec::new();
        if !llm.text.is_empty() {
            assistant_blocks.push(ContentBlock::Text { text: llm.text.clone() });
        }
        for tc in &llm.tool_calls {
            let input: serde_json::Value = serde_json::from_str(&tc.function.arguments)
                .unwrap_or(serde_json::Value::Null);
            assistant_blocks.push(ContentBlock::ToolUse {
                id: tc.id.clone(),
                name: tc.function.name.clone(),
                input,
            });
        }
        let assistant_msg = Message {
            role: "assistant".into(),
            blocks: assistant_blocks,
        };
        history.push(assistant_msg.clone());
        if let Err(e) = memory::save_message(&state, &session_id, &assistant_msg) {
            log::warn!("[agent] Failed to save assistant message: {}", e);
        }

        // Execute each tool call, collect results
        let mut tool_result_blocks = Vec::new();
        for tc in &llm.tool_calls {
            total_tool_calls += 1;

            let args: serde_json::Value = serde_json::from_str(&tc.function.arguments)
                .unwrap_or(serde_json::Value::Null);

            // Fire ToolRequest event
            state.fire(event_to_json(&EngineEvent::ToolRequest {
                session_id: session_id.clone(),
                run_id: run_id.clone(),
                tool_call: tc.clone(),
                tool_tier: Some("safe".into()),
                round_number: Some(round),
            }));
            // Auto-approve (all tools are pre-approved in the coding agent)
            state.fire(event_to_json(&EngineEvent::ToolAutoApproved {
                session_id: session_id.clone(),
                run_id: run_id.clone(),
                tool_name: tc.function.name.clone(),
                tool_call_id: tc.id.clone(),
            }));

            let start = Instant::now();
            let exec_result = tools::execute(&tc.function.name, &args, &state).await;

            let duration_ms = start.elapsed().as_millis() as u64;

            let (output, success) = match exec_result {
                Some(Ok(out)) => (out, true),
                Some(Err(e)) => (format!("Error: {}", e), false),
                None => (format!("Unknown tool: {}", tc.function.name), false),
            };

            // Fire ToolResult event
            state.fire(event_to_json(&EngineEvent::ToolResult {
                session_id: session_id.clone(),
                run_id: run_id.clone(),
                tool_call_id: tc.id.clone(),
                output: output.clone(),
                success,
                duration_ms: Some(duration_ms),
            }));

            tool_result_blocks.push(ContentBlock::ToolResult {
                tool_use_id: tc.id.clone(),
                content: output,
                is_error: !success,
            });
        }

        // Append tool results as a user message
        let tool_result_msg = Message {
            role: "user".into(),
            blocks: tool_result_blocks,
        };
        history.push(tool_result_msg.clone());
        if let Err(e) = memory::save_message(&state, &session_id, &tool_result_msg) {
            log::warn!("[agent] Failed to save tool result message: {}", e);
        }
    }

    // Save final assistant response if not yet saved
    if !final_text.is_empty() && !history.last().map_or(false, |m| m.role == "assistant") {
        let final_msg = Message::assistant(&final_text);
        if let Err(e) = memory::save_message(&state, &session_id, &final_msg) {
            log::warn!("[agent] Failed to save final message: {}", e);
        }
    }

    // Fire Complete
    state.fire(event_to_json(&EngineEvent::Complete {
        session_id: session_id.clone(),
        run_id: run_id.clone(),
        text: final_text,
        tool_calls_count: total_tool_calls,
        usage: total_usage,
        model: Some(actual_model),
        total_rounds: Some(round),
        max_rounds: Some(max_rounds),
    }));
}

fn fire_error(state: &AppState, session_id: &str, run_id: &str, message: &str) {
    log::error!("[agent] {}", message);
    state.fire(event_to_json(&EngineEvent::Error {
        session_id: session_id.into(),
        run_id: run_id.into(),
        message: message.into(),
    }));
}
