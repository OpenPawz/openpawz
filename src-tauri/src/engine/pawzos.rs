// PawzOS Engine Bridge
//
// A thin callable layer that the unix socket server uses to dispatch
// queries into the agent loop without needing Tauri's command scaffolding.
//
// Called by: engine/unix_socket.rs
// Does NOT depend on tauri::State or tauri::command — uses AppHandle directly.

use log::{error, info};
use tauri::Manager;
use uuid::Uuid;

use crate::atoms::types::{Message, MessageContent, Role};
use crate::commands::state::{normalize_model_name, resolve_provider_for_model, EngineState};
use crate::engine::agent_loop;
use crate::engine::chat as chat_org;
use crate::engine::providers::AnyProvider;
use crate::engine::types::StoredMessage;

/// Dispatch a user message to the agent loop.
/// Returns the run_id — use it to filter SSE events on the caller side.
///
/// This is the same core logic as `engine_chat_send` but callable from
/// non-command Rust code (e.g. the Unix socket bridge).
pub async fn dispatch(
    app: &tauri::AppHandle,
    message: String,
    session_id: Option<String>,
) -> Result<String, String> {
    let state = app.state::<EngineState>();
    let run_id = Uuid::new_v4().to_string().replace('-', "");

    // ── Resolve or create session ──────────────────────────────────────────
    let session_id = match session_id {
        Some(id) if !id.is_empty() => {
            if state.store.get_session(&id).map_err(|e| e.to_string())?.is_none() {
                let model = {
                    let cfg = state.config.lock();
                    cfg.default_model.clone().unwrap_or_else(|| "claude-opus-4-5".to_string())
                };
                state.store.create_session(&id, &model, None, None).map_err(|e| e.to_string())?;
            }
            id
        }
        _ => {
            let new_id = format!("pawzos-{}", Uuid::new_v4());
            let model = {
                let cfg = state.config.lock();
                cfg.default_model.clone().unwrap_or_else(|| "claude-opus-4-5".to_string())
            };
            state.store.create_session(&new_id, &model, None, None).map_err(|e| e.to_string())?;
            new_id
        }
    };

    // ── Resolve model and provider ─────────────────────────────────────────
    let (provider_config, model) = {
        let cfg = state.config.lock();
        let model = normalize_model_name(
            &cfg.default_model.clone().unwrap_or_else(|| "claude-opus-4-5".to_string())
        ).to_string();
        let provider = resolve_provider_for_model(&model, &cfg.providers)
            .or_else(|| cfg.default_provider.as_ref()
                .and_then(|dp| cfg.providers.iter().find(|p| p.id == *dp).cloned()))
            .or_else(|| cfg.providers.first().cloned());
        match provider {
            Some(p) => (p, model),
            None    => return Err("No AI provider configured in OpenPawz.".into()),
        }
    };

    // ── Store user message ─────────────────────────────────────────────────
    let user_msg = StoredMessage {
        id:              Uuid::new_v4().to_string(),
        session_id:      session_id.clone(),
        role:            "user".into(),
        content:         message.clone(),
        tool_calls_json: None,
        tool_call_id:    None,
        name:            None,
        created_at:      chrono::Utc::now().to_rfc3339(),
    };
    state.store.add_message(&user_msg).map_err(|e| e.to_string())?;

    // ── Load conversation history ──────────────────────────────────────────
    let messages: Vec<Message> = state.store
        .get_messages(&session_id, 200)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|m| {
            let role = match m.role.as_str() {
                "system"    => Role::System,
                "assistant" => Role::Assistant,
                "tool"      => Role::Tool,
                _           => Role::User,
            };
            Message {
                role,
                content:           MessageContent::Text(m.content),
                tool_calls:        None,
                tool_call_id:      m.tool_call_id,
                name:              m.name,
                reasoning_content: None,
            }
        })
        .collect();

    // ── Build tools ────────────────────────────────────────────────────────
    let loaded_tools = state.loaded_tools.lock().clone();
    let mut tools = chat_org::build_chat_tools(
        &state.store, true, None, app, &loaded_tools,
    );

    // ── Get system prompt ──────────────────────────────────────────────────
    let system_prompt = {
        let cfg = state.config.lock();
        cfg.default_system_prompt.clone()
            .unwrap_or_else(|| "You are PawzOS, an AI-native operating system. Be concise and helpful.".to_string())
    };

    // ── Spawn agent loop ───────────────────────────────────────────────────
    let run_id_clone  = run_id.clone();
    let session_clone = session_id.clone();
    let app_clone     = app.clone();
    let provider      = AnyProvider::from_config(&provider_config);

    let pending_approvals = state.pending_approvals.clone();
    let daily_tokens      = state.daily_tokens.clone();
    let daily_budget      = {
        let cfg = state.config.lock();
        cfg.daily_budget_usd
    };

    tokio::spawn(async move {
        let mut msgs = messages;
        // Prepend system message
        msgs.insert(0, Message {
            role:              Role::System,
            content:           MessageContent::Text(system_prompt),
            tool_calls:        None,
            tool_call_id:      None,
            name:              None,
            reasoning_content: None,
        });

        if let Err(e) = agent_loop::run_agent_turn(
            &app_clone,
            &provider,
            &model,
            &mut msgs,
            &mut tools,
            &session_clone,
            &run_id_clone,
            12,          // max_rounds
            None,        // temperature
            &pending_approvals,
            120,         // tool_timeout_secs
            "default",   // agent_id
            daily_budget,
            Some(&daily_tokens),
            None,        // thinking_level
            true,        // auto_approve_all
            &[],         // user_approved_tools
            None,        // yield_signal
        ).await {
            error!("[pawzos-bridge] agent loop error: {e}");
        }
    });

    info!("[pawzos-bridge] dispatched run_id={run_id} session={session_id}");
    Ok(run_id)
}
