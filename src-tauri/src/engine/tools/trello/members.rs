// trello/members.rs — Member management
//
// Tools: trello_get_members

use crate::atoms::types::*;
use crate::atoms::error::EngineResult;
use super::{get_credentials, auth_url, trello_request};
use serde_json::{json, Value};

pub fn definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_get_members".into(),
                description: "List all members of a Trello board with their usernames and IDs.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "board_id": { "type": "string", "description": "Board ID" }
                    },
                    "required": ["board_id"]
                }),
            },
        },
    ]
}

pub async fn execute(
    name: &str,
    args: &Value,
    app_handle: &tauri::AppHandle,
) -> Option<Result<String, String>> {
    match name {
        "trello_get_members" => Some(exec_get(args, app_handle).await.map_err(|e| e.to_string())),
        _ => None,
    }
}

// ── get members ────────────────────────────────────────────────────────

async fn exec_get(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;

    let url = auth_url(
        &format!("/boards/{}/members?fields=id,username,fullName,memberType", board_id),
        &key, &token,
    );
    let data = trello_request(reqwest::Method::GET, &url, None).await?;
    let members: Vec<Value> = serde_json::from_value(data).unwrap_or_default();

    if members.is_empty() {
        return Ok(format!("No members on board `{}`.", board_id));
    }

    let mut lines = vec![format!("**Board Members** ({} found)\n", members.len())];
    for m in &members {
        let username = m["username"].as_str().unwrap_or("?");
        let full_name = m["fullName"].as_str().unwrap_or("");
        let id = m["id"].as_str().unwrap_or("?");
        let name_part = if full_name.is_empty() { String::new() } else { format!(" ({})", full_name) };
        lines.push(format!("• @{}{} — `{}`", username, name_part, id));
    }

    Ok(lines.join("\n"))
}
