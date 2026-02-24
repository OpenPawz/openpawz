// trello/checklists.rs — Checklist management
//
// Tools: trello_create_checklist, trello_add_checklist_item, trello_toggle_checklist_item,
//        trello_delete_checklist

use crate::atoms::types::*;
use crate::atoms::error::EngineResult;
use super::{get_credentials, auth_url, trello_request};
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
                        "card_id": { "type": "string", "description": "Card ID to add the checklist to" },
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
                description: "Add an item to a Trello checklist. Can add multiple items at once.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "checklist_id": { "type": "string", "description": "Checklist ID" },
                        "name": { "type": "string", "description": "Item name (single item)" },
                        "names": { "type": "array", "items": { "type": "string" }, "description": "Multiple item names (batch add). Provide EITHER 'name' or 'names'." },
                        "checked": { "type": "boolean", "description": "Start as checked. Default: false" }
                    },
                    "required": ["checklist_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_toggle_checklist_item".into(),
                description: "Toggle a checklist item between complete and incomplete.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID that contains the checklist" },
                        "item_id": { "type": "string", "description": "Checklist item ID" },
                        "state": { "type": "string", "description": "complete or incomplete", "enum": ["complete", "incomplete"] }
                    },
                    "required": ["card_id", "item_id", "state"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_delete_checklist".into(),
                description: "Delete a checklist from a card.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "checklist_id": { "type": "string", "description": "Checklist ID to delete" }
                    },
                    "required": ["checklist_id"]
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
        "trello_create_checklist"      => Some(exec_create(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_add_checklist_item"    => Some(exec_add_item(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_toggle_checklist_item" => Some(exec_toggle(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_delete_checklist"      => Some(exec_delete(args, app_handle).await.map_err(|e| e.to_string())),
        _ => None,
    }
}

// ── create checklist ───────────────────────────────────────────────────

async fn exec_create(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let name = args["name"].as_str().ok_or("Missing 'name'")?;

    let body = json!({ "idCard": card_id, "name": name });
    let url = auth_url("/checklists", &key, &token);
    let data = trello_request(reqwest::Method::POST, &url, Some(&body)).await?;

    let cl_id = data["id"].as_str().unwrap_or("?");
    info!("[trello] Created checklist: {} on card {}", name, card_id);

    Ok(format!("Created checklist **{}** — `{}`", name, cl_id))
}

// ── add checklist item(s) ──────────────────────────────────────────────

async fn exec_add_item(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let checklist_id = args["checklist_id"].as_str().ok_or("Missing 'checklist_id'")?;
    let checked = if args["checked"].as_bool().unwrap_or(false) { "true" } else { "false" };

    // Support both single 'name' and batch 'names'
    let names: Vec<String> = if let Some(arr) = args["names"].as_array() {
        arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
    } else if let Some(name) = args["name"].as_str() {
        vec![name.to_string()]
    } else {
        return Err("Provide 'name' (string) or 'names' (array) for checklist items.".into());
    };

    if names.is_empty() {
        return Err("No item names provided.".into());
    }

    let mut added = 0;
    for name in &names {
        let body = json!({ "name": name, "checked": checked });
        let url = auth_url(&format!("/checklists/{}/checkItems", checklist_id), &key, &token);
        trello_request(reqwest::Method::POST, &url, Some(&body)).await?;
        added += 1;
    }

    info!("[trello] Added {} items to checklist {}", added, checklist_id);
    Ok(format!("Added {} item(s) to checklist `{}`.", added, checklist_id))
}

// ── toggle checklist item ──────────────────────────────────────────────

async fn exec_toggle(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let item_id = args["item_id"].as_str().ok_or("Missing 'item_id'")?;
    let state = args["state"].as_str().ok_or("Missing 'state' (complete or incomplete)")?;

    let body = json!({ "state": state });
    let url = auth_url(&format!("/cards/{}/checkItem/{}", card_id, item_id), &key, &token);
    trello_request(reqwest::Method::PUT, &url, Some(&body)).await?;

    Ok(format!("Checklist item `{}` marked as {}.", item_id, state))
}

// ── delete checklist ───────────────────────────────────────────────────

async fn exec_delete(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let checklist_id = args["checklist_id"].as_str().ok_or("Missing 'checklist_id'")?;

    let url = auth_url(&format!("/checklists/{}", checklist_id), &key, &token);
    trello_request(reqwest::Method::DELETE, &url, None).await?;

    Ok(format!("Checklist `{}` deleted.", checklist_id))
}
