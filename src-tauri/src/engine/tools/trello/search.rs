// trello/search.rs — Search & member queries
//
// Tools: trello_search, trello_get_board_members

use crate::atoms::types::*;
use crate::atoms::error::EngineResult;
use super::{api_url, client, trello_request};
use serde_json::{json, Value};

pub fn definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_search".into(),
                description: "Search across Trello boards, cards, and members. Returns matching results with IDs.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Search query text" },
                        "board_ids": { "type": "string", "description": "Comma-separated board IDs to restrict search (optional)" },
                        "model_types": { "type": "string", "description": "What to search: cards, boards, organizations (comma-separated, default: cards,boards)" }
                    },
                    "required": ["query"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_get_board_members".into(),
                description: "Get all members of a Trello board. Returns usernames, full names, and IDs.".into(),
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
        "trello_search"            => Some(exec_search(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_get_board_members" => Some(exec_members(args, app_handle).await.map_err(|e| e.to_string())),
        _ => None,
    }
}

// ── search ─────────────────────────────────────────────────────────────

async fn exec_search(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let query = args["query"].as_str().ok_or("Missing 'query'")?;
    let model_types = args["model_types"].as_str().unwrap_or("cards,boards");

    let mut path = format!("/search?query={}&modelTypes={}", urlencoding(query), model_types);
    if let Some(board_ids) = args["board_ids"].as_str() {
        path.push_str(&format!("&idBoards={}", board_ids));
    }

    let url = api_url(&path, app_handle)?;
    let http = client();
    let data = trello_request(&http, reqwest::Method::GET, &url, None).await?;

    let mut lines = vec![format!("**Search results for \"{}\"**\n", query)];

    // Boards
    if let Some(boards) = data["boards"].as_array() {
        if !boards.is_empty() {
            lines.push(format!("**Boards** ({}):", boards.len()));
            for b in boards.iter().take(10) {
                let name = b["name"].as_str().unwrap_or("?");
                let id = b["id"].as_str().unwrap_or("?");
                lines.push(format!("  • **{}** — id: `{}`", name, id));
            }
        }
    }

    // Cards
    if let Some(cards) = data["cards"].as_array() {
        if !cards.is_empty() {
            lines.push(format!("\n**Cards** ({}):", cards.len()));
            for c in cards.iter().take(20) {
                let name = c["name"].as_str().unwrap_or("?");
                let id = c["id"].as_str().unwrap_or("?");
                let board_name = c["board"]["name"].as_str().unwrap_or("?");
                let list_name = c["list"]["name"].as_str().unwrap_or("?");
                lines.push(format!("  • **{}** in {}/{} — id: `{}`", name, board_name, list_name, id));
            }
        }
    }

    if lines.len() == 1 {
        lines.push("No results found.".into());
    }

    Ok(lines.join("\n"))
}

// ── board members ──────────────────────────────────────────────────────

async fn exec_members(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;
    let url = api_url(&format!("/boards/{}/members", board_id), app_handle)?;
    let http = client();
    let data = trello_request(&http, reqwest::Method::GET, &url, None).await?;
    let members: Vec<Value> = serde_json::from_value(data).unwrap_or_default();

    if members.is_empty() {
        return Ok("No members found.".into());
    }

    let mut lines = vec![format!("**Board members** ({} found)\n", members.len())];
    for m in &members {
        let username = m["username"].as_str().unwrap_or("?");
        let full_name = m["fullName"].as_str().unwrap_or("");
        let id = m["id"].as_str().unwrap_or("?");
        lines.push(format!("• **{}** ({}) — id: `{}`", username, full_name, id));
    }
    Ok(lines.join("\n"))
}

// ── URL encoding helper ───────────────────────────────────────────────

fn urlencoding(s: &str) -> String {
    s.chars().map(|c| {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "%20".to_string(),
            _ => format!("%{:02X}", c as u32),
        }
    }).collect()
}
