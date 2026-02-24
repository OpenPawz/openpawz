// trello/boards.rs — Board management
//
// Tools: trello_list_boards, trello_create_board, trello_get_board, trello_update_board, trello_delete_board

use crate::atoms::types::*;
use crate::atoms::error::EngineResult;
use super::{api_url, client, trello_request};
use log::info;
use serde_json::{json, Value};

pub fn definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_list_boards".into(),
                description: "List all Trello boards for the authenticated user. Returns board names, IDs, and URLs.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "filter": { "type": "string", "description": "Filter: open (default), closed, all" }
                    }
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_create_board".into(),
                description: "Create a new Trello board. Returns the new board ID and URL.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Board name" },
                        "desc": { "type": "string", "description": "Board description" },
                        "default_lists": { "type": "boolean", "description": "Create default lists (To Do, Doing, Done). Default true." },
                        "organization_id": { "type": "string", "description": "Workspace/organization ID to create the board in" }
                    },
                    "required": ["name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_get_board".into(),
                description: "Get details of a specific Trello board by ID, including name, description, URL, and preferences.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "board_id": { "type": "string", "description": "Board ID" }
                    },
                    "required": ["board_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_update_board".into(),
                description: "Update a Trello board's name, description, or archive status.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "board_id": { "type": "string", "description": "Board ID" },
                        "name": { "type": "string", "description": "New board name" },
                        "desc": { "type": "string", "description": "New description" },
                        "closed": { "type": "boolean", "description": "true to archive, false to unarchive" }
                    },
                    "required": ["board_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_delete_board".into(),
                description: "Permanently delete a Trello board. This cannot be undone.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "board_id": { "type": "string", "description": "Board ID to delete" }
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
        "trello_list_boards"  => Some(exec_list(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_create_board" => Some(exec_create(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_get_board"    => Some(exec_get(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_update_board" => Some(exec_update(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_delete_board" => Some(exec_delete(args, app_handle).await.map_err(|e| e.to_string())),
        _ => None,
    }
}

// ── list boards ────────────────────────────────────────────────────────

async fn exec_list(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let filter = args["filter"].as_str().unwrap_or("open");
    let url = api_url(&format!("/members/me/boards?filter={}&fields=name,id,url,shortUrl,closed,desc", filter), app_handle)?;
    let http = client();
    let data = trello_request(&http, reqwest::Method::GET, &url, None).await?;
    let boards: Vec<Value> = serde_json::from_value(data).unwrap_or_default();

    if boards.is_empty() {
        return Ok("No boards found.".into());
    }

    let mut lines = vec![format!("**Trello Boards** ({} found)\n", boards.len())];
    for b in &boards {
        let name = b["name"].as_str().unwrap_or("?");
        let id = b["id"].as_str().unwrap_or("?");
        let url = b["shortUrl"].as_str().or(b["url"].as_str()).unwrap_or("");
        let closed = if b["closed"].as_bool().unwrap_or(false) { " [archived]" } else { "" };
        lines.push(format!("• **{}**{} — id: `{}` — {}", name, closed, id, url));
    }
    Ok(lines.join("\n"))
}

// ── create board ───────────────────────────────────────────────────────

async fn exec_create(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let name = args["name"].as_str().ok_or("Missing 'name'")?;
    let url = api_url("/boards", app_handle)?;
    let http = client();

    let mut body = json!({ "name": name });
    if let Some(desc) = args["desc"].as_str() {
        body["desc"] = json!(desc);
    }
    if let Some(dl) = args["default_lists"].as_bool() {
        body["defaultLists"] = json!(dl);
    }
    if let Some(org) = args["organization_id"].as_str() {
        body["idOrganization"] = json!(org);
    }

    let data = trello_request(&http, reqwest::Method::POST, &url, Some(&body)).await?;
    let id = data["id"].as_str().unwrap_or("?");
    let board_url = data["url"].as_str().unwrap_or("");
    info!("[trello] Created board '{}' id={}", name, id);
    Ok(format!("Created board **{}** — id: `{}` — {}", name, id, board_url))
}

// ── get board ──────────────────────────────────────────────────────────

async fn exec_get(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;
    let url = api_url(&format!("/boards/{}?fields=all", board_id), app_handle)?;
    let http = client();
    let data = trello_request(&http, reqwest::Method::GET, &url, None).await?;

    let name = data["name"].as_str().unwrap_or("?");
    let desc = data["desc"].as_str().unwrap_or("");
    let board_url = data["url"].as_str().unwrap_or("");
    let closed = data["closed"].as_bool().unwrap_or(false);

    Ok(format!(
        "**{}**{}\n{}\nID: `{}`\nURL: {}\nMembers: {}",
        name,
        if closed { " [archived]" } else { "" },
        if desc.is_empty() { "(no description)" } else { desc },
        board_id,
        board_url,
        data["memberships"].as_array().map(|a| a.len()).unwrap_or(0)
    ))
}

// ── update board ───────────────────────────────────────────────────────

async fn exec_update(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;
    let url = api_url(&format!("/boards/{}", board_id), app_handle)?;
    let http = client();

    let mut body = json!({});
    if let Some(name) = args["name"].as_str() { body["name"] = json!(name); }
    if let Some(desc) = args["desc"].as_str() { body["desc"] = json!(desc); }
    if let Some(closed) = args["closed"].as_bool() { body["closed"] = json!(closed); }

    let data = trello_request(&http, reqwest::Method::PUT, &url, Some(&body)).await?;
    let name = data["name"].as_str().unwrap_or("?");
    info!("[trello] Updated board '{}' id={}", name, board_id);
    Ok(format!("Updated board **{}** (id: `{}`)", name, board_id))
}

// ── delete board ───────────────────────────────────────────────────────

async fn exec_delete(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;
    let url = api_url(&format!("/boards/{}", board_id), app_handle)?;
    let http = client();
    trello_request(&http, reqwest::Method::DELETE, &url, None).await?;
    info!("[trello] Deleted board id={}", board_id);
    Ok(format!("Deleted board `{}`", board_id))
}
