// trello/checklists.rs — Checklist management
//
// Tools: trello_create_checklist, trello_add_checklist_item, trello_toggle_checklist_item,
//        trello_delete_checklist, trello_get_board_labels, trello_create_label, trello_delete_label

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
                name: "trello_create_checklist".into(),
                description: "Create a new checklist on a Trello card.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID to add checklist to" },
                        "name": { "type": "string", "description": "Checklist name" }
                    },
                    "required": ["card_id", "name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_add_checklist_item".into(),
                description: "Add an item to a Trello checklist.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "checklist_id": { "type": "string", "description": "Checklist ID" },
                        "name": { "type": "string", "description": "Item name/text" },
                        "checked": { "type": "boolean", "description": "Start as checked (default false)" }
                    },
                    "required": ["checklist_id", "name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_toggle_checklist_item".into(),
                description: "Mark a checklist item as complete or incomplete.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID that contains the checklist" },
                        "item_id": { "type": "string", "description": "Checklist item ID" },
                        "complete": { "type": "boolean", "description": "true=complete, false=incomplete" }
                    },
                    "required": ["card_id", "item_id", "complete"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_delete_checklist".into(),
                description: "Delete a checklist from a Trello card.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "checklist_id": { "type": "string", "description": "Checklist ID to delete" }
                    },
                    "required": ["checklist_id"]
                }),
            },
        },
        // ── Labels (board-level, used across cards) ────────────────────
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_get_board_labels".into(),
                description: "Get all labels on a Trello board. Returns label names, colors, and IDs.".into(),
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
                name: "trello_create_label".into(),
                description: "Create a new label on a Trello board. Colors: green, yellow, orange, red, purple, blue, sky, lime, pink, black, or null for no color.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "board_id": { "type": "string", "description": "Board ID" },
                        "name": { "type": "string", "description": "Label name" },
                        "color": { "type": "string", "description": "Color: green,yellow,orange,red,purple,blue,sky,lime,pink,black,null" }
                    },
                    "required": ["board_id", "name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_delete_label".into(),
                description: "Delete a label from a Trello board.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "label_id": { "type": "string", "description": "Label ID to delete" }
                    },
                    "required": ["label_id"]
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
        "trello_create_checklist"      => Some(exec_create_checklist(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_add_checklist_item"    => Some(exec_add_item(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_toggle_checklist_item" => Some(exec_toggle_item(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_delete_checklist"      => Some(exec_delete_checklist(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_get_board_labels"      => Some(exec_get_labels(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_create_label"          => Some(exec_create_label(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_delete_label"          => Some(exec_delete_label(args, app_handle).await.map_err(|e| e.to_string())),
        _ => None,
    }
}

// ── create checklist ───────────────────────────────────────────────────

async fn exec_create_checklist(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let name = args["name"].as_str().ok_or("Missing 'name'")?;
    let url = api_url("/checklists", app_handle)?;
    let http = client();
    let body = json!({ "idCard": card_id, "name": name });

    let data = trello_request(&http, reqwest::Method::POST, &url, Some(&body)).await?;
    let id = data["id"].as_str().unwrap_or("?");
    info!("[trello] Created checklist '{}' on card {} id={}", name, card_id, id);
    Ok(format!("Created checklist **{}** — id: `{}`", name, id))
}

// ── add checklist item ─────────────────────────────────────────────────

async fn exec_add_item(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let checklist_id = args["checklist_id"].as_str().ok_or("Missing 'checklist_id'")?;
    let name = args["name"].as_str().ok_or("Missing 'name'")?;
    let url = api_url(&format!("/checklists/{}/checkItems", checklist_id), app_handle)?;
    let http = client();

    let mut body = json!({ "name": name });
    if let Some(checked) = args["checked"].as_bool() {
        body["checked"] = json!(checked);
    }

    let data = trello_request(&http, reqwest::Method::POST, &url, Some(&body)).await?;
    let id = data["id"].as_str().unwrap_or("?");
    info!("[trello] Added item '{}' to checklist {}", name, checklist_id);
    Ok(format!("Added item **{}** — id: `{}`", name, id))
}

// ── toggle checklist item ──────────────────────────────────────────────

async fn exec_toggle_item(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let item_id = args["item_id"].as_str().ok_or("Missing 'item_id'")?;
    let complete = args["complete"].as_bool().ok_or("Missing 'complete'")?;
    let state = if complete { "complete" } else { "incomplete" };
    let url = api_url(&format!("/cards/{}/checkItem/{}", card_id, item_id), app_handle)?;
    let http = client();
    let body = json!({ "state": state });

    trello_request(&http, reqwest::Method::PUT, &url, Some(&body)).await?;
    info!("[trello] Toggled item {} to {} on card {}", item_id, state, card_id);
    Ok(format!("Marked checklist item `{}` as {}", item_id, state))
}

// ── delete checklist ───────────────────────────────────────────────────

async fn exec_delete_checklist(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let checklist_id = args["checklist_id"].as_str().ok_or("Missing 'checklist_id'")?;
    let url = api_url(&format!("/checklists/{}", checklist_id), app_handle)?;
    let http = client();
    trello_request(&http, reqwest::Method::DELETE, &url, None).await?;
    info!("[trello] Deleted checklist id={}", checklist_id);
    Ok(format!("Deleted checklist `{}`", checklist_id))
}

// ── get board labels ───────────────────────────────────────────────────

async fn exec_get_labels(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;
    let url = api_url(&format!("/boards/{}/labels", board_id), app_handle)?;
    let http = client();
    let data = trello_request(&http, reqwest::Method::GET, &url, None).await?;
    let labels: Vec<Value> = serde_json::from_value(data).unwrap_or_default();

    if labels.is_empty() {
        return Ok("No labels on this board.".into());
    }

    let mut lines = vec![format!("**Labels on board {}** ({} found)\n", board_id, labels.len())];
    for l in &labels {
        let name = l["name"].as_str().unwrap_or("(unnamed)");
        let color = l["color"].as_str().unwrap_or("none");
        let id = l["id"].as_str().unwrap_or("?");
        lines.push(format!("• {} ({}) — id: `{}`", name, color, id));
    }
    Ok(lines.join("\n"))
}

// ── create label ───────────────────────────────────────────────────────

async fn exec_create_label(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;
    let name = args["name"].as_str().ok_or("Missing 'name'")?;
    let url = api_url("/labels", app_handle)?;
    let http = client();

    let mut body = json!({ "name": name, "idBoard": board_id });
    if let Some(color) = args["color"].as_str() {
        body["color"] = json!(color);
    }

    let data = trello_request(&http, reqwest::Method::POST, &url, Some(&body)).await?;
    let id = data["id"].as_str().unwrap_or("?");
    info!("[trello] Created label '{}' on board {} id={}", name, board_id, id);
    Ok(format!("Created label **{}** — id: `{}`", name, id))
}

// ── delete label ───────────────────────────────────────────────────────

async fn exec_delete_label(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let label_id = args["label_id"].as_str().ok_or("Missing 'label_id'")?;
    let url = api_url(&format!("/labels/{}", label_id), app_handle)?;
    let http = client();
    trello_request(&http, reqwest::Method::DELETE, &url, None).await?;
    info!("[trello] Deleted label id={}", label_id);
    Ok(format!("Deleted label `{}`", label_id))
}
