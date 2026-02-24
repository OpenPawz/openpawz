// trello/labels.rs — Label management
//
// Tools: trello_get_labels, trello_create_label, trello_update_label, trello_delete_label,
//        trello_add_label, trello_remove_label

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
                name: "trello_get_labels".into(),
                description: "Get all labels on a Trello board.".into(),
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
                description: "Create a new label on a Trello board.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "board_id": { "type": "string", "description": "Board ID" },
                        "name": { "type": "string", "description": "Label name" },
                        "color": { "type": "string", "description": "Color: green, yellow, orange, red, purple, blue, sky, lime, pink, black, or null for no color", "enum": ["green", "yellow", "orange", "red", "purple", "blue", "sky", "lime", "pink", "black", "null"] }
                    },
                    "required": ["board_id", "name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_update_label".into(),
                description: "Update a Trello label's name or color.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "label_id": { "type": "string", "description": "Label ID" },
                        "name": { "type": "string", "description": "New name" },
                        "color": { "type": "string", "description": "New color" }
                    },
                    "required": ["label_id"]
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
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_add_label".into(),
                description: "Add an existing label to a card.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID" },
                        "label_id": { "type": "string", "description": "Label ID to add" }
                    },
                    "required": ["card_id", "label_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_remove_label".into(),
                description: "Remove a label from a card.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID" },
                        "label_id": { "type": "string", "description": "Label ID to remove" }
                    },
                    "required": ["card_id", "label_id"]
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
        "trello_get_labels"    => Some(exec_get(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_create_label"  => Some(exec_create(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_update_label"  => Some(exec_update(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_delete_label"  => Some(exec_delete(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_add_label"     => Some(exec_add(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_remove_label"  => Some(exec_remove(args, app_handle).await.map_err(|e| e.to_string())),
        _ => None,
    }
}

// ── get labels ─────────────────────────────────────────────────────────

async fn exec_get(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;

    let url = auth_url(&format!("/boards/{}/labels", board_id), &key, &token);
    let data = trello_request(reqwest::Method::GET, &url, None).await?;
    let labels: Vec<Value> = serde_json::from_value(data).unwrap_or_default();

    if labels.is_empty() {
        return Ok(format!("No labels on board `{}`.", board_id));
    }

    let mut lines = vec![format!("**Labels** ({} found)\n", labels.len())];
    for l in &labels {
        let name = l["name"].as_str().unwrap_or("(unnamed)");
        let color = l["color"].as_str().unwrap_or("none");
        let id = l["id"].as_str().unwrap_or("?");
        lines.push(format!("• {} ({}) — `{}`", name, color, id));
    }

    Ok(lines.join("\n"))
}

// ── create label ───────────────────────────────────────────────────────

async fn exec_create(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;
    let name = args["name"].as_str().ok_or("Missing 'name'")?;

    let mut body = json!({ "name": name, "idBoard": board_id });
    if let Some(color) = args["color"].as_str() {
        if color != "null" {
            body["color"] = json!(color);
        }
    }

    let url = auth_url("/labels", &key, &token);
    let data = trello_request(reqwest::Method::POST, &url, Some(&body)).await?;

    let label_id = data["id"].as_str().unwrap_or("?");
    info!("[trello] Created label: {} ({})", name, label_id);

    Ok(format!("Created label **{}** — `{}`", name, label_id))
}

// ── update label ───────────────────────────────────────────────────────

async fn exec_update(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let label_id = args["label_id"].as_str().ok_or("Missing 'label_id'")?;

    let mut body = json!({});
    if let Some(name) = args["name"].as_str() { body["name"] = json!(name); }
    if let Some(color) = args["color"].as_str() { body["color"] = json!(color); }

    let url = auth_url(&format!("/labels/{}", label_id), &key, &token);
    trello_request(reqwest::Method::PUT, &url, Some(&body)).await?;

    Ok(format!("Label `{}` updated.", label_id))
}

// ── delete label ───────────────────────────────────────────────────────

async fn exec_delete(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let label_id = args["label_id"].as_str().ok_or("Missing 'label_id'")?;

    let url = auth_url(&format!("/labels/{}", label_id), &key, &token);
    trello_request(reqwest::Method::DELETE, &url, None).await?;

    Ok(format!("Label `{}` deleted.", label_id))
}

// ── add label to card ──────────────────────────────────────────────────

async fn exec_add(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let label_id = args["label_id"].as_str().ok_or("Missing 'label_id'")?;

    let body = json!({ "value": label_id });
    let url = auth_url(&format!("/cards/{}/idLabels", card_id), &key, &token);
    trello_request(reqwest::Method::POST, &url, Some(&body)).await?;

    Ok(format!("Label `{}` added to card `{}`.", label_id, card_id))
}

// ── remove label from card ─────────────────────────────────────────────

async fn exec_remove(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let label_id = args["label_id"].as_str().ok_or("Missing 'label_id'")?;

    let url = auth_url(&format!("/cards/{}/idLabels/{}", card_id, label_id), &key, &token);
    trello_request(reqwest::Method::DELETE, &url, None).await?;

    Ok(format!("Label `{}` removed from card `{}`.", label_id, card_id))
}
