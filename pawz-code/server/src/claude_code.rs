// pawz-code — claude_code.rs
// Provider that routes through the `claude` CLI subprocess instead of a direct
// API key. Requires Claude Code to be installed and authenticated.
//
// Invocation:
//   claude --output-format stream-json --print [prompt]
//
// The stream-json format emits newline-delimited JSON objects. We parse each
// line and extract text from assistant messages, streaming deltas back through
// the same `on_delta` callback used by the Anthropic/OpenAI providers.
//
// Tool calls: the `claude` CLI runs its own internal tool loop. We do not
// inject our tool_defs — Claude handles tools transparently. The agent loop
// in agent.rs sees no tool_calls in the returned LlmResult, so it treats
// the response as a final answer after one round. The reduction pipeline still
// runs before the prompt reaches the subprocess.

use crate::config::Config;
use crate::types::{LlmResult, Message, ToolDef, TokenUsage};
use anyhow::{bail, Context, Result};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use std::process::Stdio;

/// Call the `claude` CLI subprocess with the given prompt, streaming text
/// tokens back through `on_delta`. Returns the complete LlmResult.
pub async fn call_claude_code(
    config: &Config,
    system: &str,
    messages: &[Message],
    _tools: &[ToolDef], // Claude manages its own tools internally
    on_delta: impl Fn(&str) + Send + Sync,
) -> Result<LlmResult> {
    let binary = config
        .claude_binary_path
        .as_deref()
        .unwrap_or("claude");

    // Build a single prompt string that encodes the system context and the
    // conversation history. Claude CLI receives this via stdin.
    let prompt = build_prompt(system, messages);

    let mut cmd = Command::new(binary);
    cmd.arg("--output-format")
        .arg("stream-json")
        .arg("--print"); // non-interactive; reads prompt from stdin

    // Optional: pass explicit model name if it looks like a real Claude ID.
    // Skip if the model field is set to the sentinel "claude_code".
    if !config.model.is_empty()
        && config.model != "claude_code"
        && config.model.starts_with("claude")
    {
        cmd.arg("--model").arg(&config.model);
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .with_context(|| format!("failed to spawn claude binary: {binary}"))?;

    // Write the prompt to stdin then close it so claude knows input is done.
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .context("failed to write prompt to claude stdin")?;
        // stdin is dropped here, closing the pipe
    }

    let stdout = child.stdout.take().expect("stdout not captured");
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    let mut full_text = String::new();
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut actual_model: Option<String> = None;

    while let Some(line) = lines.next_line().await? {
        let line = line.trim().to_owned();
        if line.is_empty() {
            continue;
        }

        let ev: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue, // tolerate non-JSON lines (e.g. log output)
        };

        match ev["type"].as_str().unwrap_or("") {
            // Initialisation — capture the model name claude selected
            "system" => {
                if let Some(m) = ev["model"].as_str() {
                    actual_model = Some(m.to_string());
                }
            }

            // An assistant turn — may contain text and/or tool_use blocks.
            // For our purposes we only need to surface the text; the tool loop
            // is handled inside the claude subprocess.
            "assistant" => {
                let content = match ev["message"]["content"].as_array() {
                    Some(c) => c,
                    None => continue,
                };

                // Capture model from this message if we don't have it yet
                if actual_model.is_none() {
                    if let Some(m) = ev["message"]["model"].as_str() {
                        actual_model = Some(m.to_string());
                    }
                }

                // Capture usage from the assistant message
                if let Some(usage) = ev["message"]["usage"].as_object() {
                    input_tokens += usage
                        .get("input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    output_tokens += usage
                        .get("output_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                }

                for block in content {
                    if block["type"].as_str() == Some("text") {
                        if let Some(text) = block["text"].as_str() {
                            if !text.is_empty() {
                                // Stream each assistant text block as a delta.
                                // claude stream-json doesn't give us sub-word
                                // increments, so we split on whitespace for a
                                // smoother UX where possible.
                                stream_text_as_deltas(text, &on_delta);
                                full_text.push_str(text);
                            }
                        }
                    }
                }
            }

            // Final result — consolidate usage and handle error sub-types.
            "result" => {
                let subtype = ev["subtype"].as_str().unwrap_or("success");
                if subtype == "error" || ev["is_error"].as_bool().unwrap_or(false) {
                    let msg = ev["error"]
                        .as_str()
                        .or_else(|| ev["result"].as_str())
                        .unwrap_or("claude CLI returned an error");
                    bail!("claude CLI error: {}", msg);
                }

                // Prefer the aggregated usage from the result if available
                if let Some(u) = ev["usage"].as_object() {
                    if let Some(inp) = u.get("input_tokens").and_then(|v| v.as_u64()) {
                        input_tokens = inp; // use aggregate, not sum
                    }
                    if let Some(out) = u.get("output_tokens").and_then(|v| v.as_u64()) {
                        output_tokens = out;
                    }
                }

                // If we somehow have no text yet (e.g. very short response),
                // fall back to the result field.
                if full_text.is_empty() {
                    if let Some(result) = ev["result"].as_str() {
                        if !result.is_empty() {
                            stream_text_as_deltas(result, &on_delta);
                            full_text = result.to_string();
                        }
                    }
                }
            }

            _ => {} // ignore user/tool messages and unknown types
        }
    }

    // Wait for the subprocess to finish
    let status = child.wait().await?;
    if !status.success() {
        // Collect stderr for a better error message
        bail!(
            "claude CLI exited with non-zero status: {}",
            status.code().unwrap_or(-1)
        );
    }

    let usage = if input_tokens > 0 || output_tokens > 0 {
        Some(TokenUsage {
            input_tokens,
            output_tokens,
            total_tokens: input_tokens + output_tokens,
        })
    } else {
        None
    };

    Ok(LlmResult {
        text: full_text,
        tool_calls: vec![], // Claude's own tool loop is transparent to us
        usage,
        model: actual_model.or_else(|| Some(config.model.clone())),
        stop_reason: "end_turn".into(),
    })
}

// ── Prompt builder ───────────────────────────────────────────────────────────

/// Build a plain-text prompt string from the system context and message history.
/// Uses XML-ish wrapping for the system section (consistent with how Claude
/// models expect system context when it's embedded in user prompts).
fn build_prompt(system: &str, messages: &[Message]) -> String {
    let mut out = String::with_capacity(4096);

    // System section
    if !system.is_empty() {
        out.push_str("<system_context>\n");
        out.push_str(system);
        out.push_str("\n</system_context>\n\n");
    }

    // Conversation history — collapse each message to its text content
    for msg in messages {
        let text = extract_text_content(msg);
        if text.is_empty() {
            continue;
        }
        match msg.role.as_str() {
            "user" => {
                out.push_str("Human: ");
                out.push_str(&text);
                out.push('\n');
            }
            "assistant" => {
                out.push_str("Assistant: ");
                out.push_str(&text);
                out.push('\n');
            }
            _ => {
                out.push_str(&text);
                out.push('\n');
            }
        }
    }

    out
}

fn extract_text_content(msg: &Message) -> String {
    msg.blocks
        .iter()
        .filter_map(|b| match b {
            crate::types::ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// ── Streaming helper ─────────────────────────────────────────────────────────

/// Emit a block of text as small delta chunks. Since the claude CLI gives us
/// complete text blocks rather than sub-token increments, we split on
/// sentences/words so the UI feels more responsive.
fn stream_text_as_deltas(text: &str, on_delta: &impl Fn(&str)) {
    // Emit word-by-word so the SSE stream feels streaming. For very short
    // texts just emit the whole thing.
    if text.len() < 80 {
        on_delta(text);
        return;
    }

    let mut start = 0;
    let mut last_space = 0;
    let chunk_target = 40; // ~40 chars per chunk

    for (i, ch) in text.char_indices() {
        if ch.is_whitespace() {
            last_space = i + ch.len_utf8();
        }
        if i - start >= chunk_target && last_space > start {
            on_delta(&text[start..last_space]);
            start = last_space;
        }
    }
    if start < text.len() {
        on_delta(&text[start..]);
    }
}