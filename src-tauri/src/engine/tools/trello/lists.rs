// trello/lists.rs — List management
//
// Tools: trello_get_lists, trello_create_list, trello_update_list, trello_archive_list

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
                name: "trello_get_lists".into(),
                description: "Get all lists on a Trello board. Returns list names, IDs, and positions.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "board_id": { "type": "string", "description": "Board ID" },
                        "filter": { "type": "string", "description": "Filter: open (default), closed, all" }
                    },
                    "required": ["board_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_create_list".into(),
                description: "Create a new list on a Trello board.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "board_id": { "type": "string", "description": "Board ID to create the list on" },
                        "name": { "type": "string", "description": "List name" },
                        "pos": { "type": "string", "description": "Position: top, bottom, or a positive number" }
                    },
                    "required": ["board_id", "name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_update_list".into(),
                description: "Update a Trello list's name or position.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "list_id": { "type": "string", "description": "List ID" },
                        "name": { "type": "string", "description": "New list name" },
                        "pos": { "type": "string", "description": "New position: top, bottom, or a number" }
                    },
                    "required": ["list_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_archive_list".into(),
                description: "Archive or unarchive a Trello list.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "list_id": { "type": "string", "description": "List ID" },
                        "archive": { "type": "boolean", "description": "true to archive, false to unarchive. Default true." }
                    },
                    "required": ["list_id"]
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
        "trello_get_lists"    => Some(exec_get(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_create_list"  => Some(exec_create(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_update_list"  => Some(exec_update(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_archive_list" => Some(exec_archive(args, app_handle).await.map_err(|e| e.to_string())),
        _ => None,
    }
}

// ── get lists ──────────────────────────────────────────────────────────

async fn exec_get(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;
    let filter = args["filter"].as_str().unwrap_or("open");
    let url = api_url(&format!("/boards/{}/lists?filter={}&fields=name,id,pos,closed", board_id, filter), app_handle)?;
    let http = client();
    let data = trello_request(&http, reqwest::Method::GET, &url, None).await?;
    let lists: Vec<Value> = serde_json::from_value(data).unwrap_or_default();

    if lists.is_empty() {
        return Ok("No lists found on this board.".into());
    }

    let mut lines = vec![format!("**Lists on board {}** ({} found)\n", board_id, lists.len())];
    for l in &lists {
        let name = l["name"].as_str().unwrap_or("?");
        let id = l["id"].as_str().unwrap_or("?");
        let closed = if l["closed"].as_bool().unwrap_or(false) { " [archived]" } else { "" };
        lines.push(format!("• **{}**{} — id: `{}`", name, closed, id));
    }
    Ok(lines.join("\n"))
}

// ── create list ────────────────────────────────────────────────────────

async fn exec_create(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;
    let name = args["name"].as_str().ok_or("Missing 'name'")?;
    let url = api_url("/lists", app_handle)?;
    let http = client();

    let mut body = json!({ "name": name, "idBoard": board_id });
    if let Some(pos) = args["pos"].as_str() {
        body["pos"] = json!(pos);
    }

    let data = trello_request(&http, reqwest::Method::POST, &url, Some(&body)).await?;
    let id = data["id"].as_str().unwrap_or("?");
    info!("[trello] Created list '{}' on board {} id={}", name, board_id, id);
    Ok(format!("Created list **{}** — id: `{}`", name, id))
}

// ── update list ────────────────────────────────────────────────────────

async fn exec_update(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let list_id = args["list_id"].as_str().ok_or("Missing 'list_id'")?;
    let url = api_url(&format!("/lists/{}", list_id), app_handle)?;
    let http = client();

    let mut body = json!({});
    if let Some(name) = args["name"].as_str() { body["name"] = json!(name); }
    if let Some(pos) = args["pos"].as_str() { body["pos"] = json!(pos); }

    let data = trello_request(&http, reqwest::Method::PUT, &url, Some(&body)).await?;
    let name = data["name"].as_str().unwrap_or("?");
    info!("[trello] Updated list '{}' id={}", name, list_id);
    Ok(format!("Updated list **{}** (id: `{}`)", name, list_id))
}

// ── archive/unarchive list ─────────────────────────────────────────────

async fn exec_archive(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let list_id = args["list_id"].as_str().ok_or("Missing 'list_id'")?;
    let archive = args["archive"].as_bool().unwrap_or(true);
    let url = api_url(&format!("/lists/{}/closed", list_id), app_handle)?;
    let http = client();
    let body = json!({ "value": archive });
    trello_request(&http, reqwest::Method::PUT, &url, Some(&body)).await?;

    let action = if archive { "Archived" } else { "Unarchived" };
    info!("[trello] {} list id={}", action, list_id);
    Ok(format!("{} list `{}`", action, list_id))
}
