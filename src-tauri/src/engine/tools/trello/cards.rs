// trello/cards.rs — Card management
//
// Tools: trello_get_cards, trello_get_card, trello_create_card, trello_update_card,
//        trello_move_card, trello_delete_card, trello_add_comment, trello_add_label,
//        trello_remove_label, trello_add_attachment

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
                name: "trello_get_cards".into(),
                description: "Get all cards in a Trello list. Returns card names, IDs, descriptions, and due dates.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "list_id": { "type": "string", "description": "List ID to get cards from" }
                    },
                    "required": ["list_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_get_card".into(),
                description: "Get full details of a specific Trello card including description, labels, checklists, and comments.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID" }
                    },
                    "required": ["card_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_create_card".into(),
                description: "Create a new card in a Trello list.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "list_id": { "type": "string", "description": "List ID to create the card in" },
                        "name": { "type": "string", "description": "Card title" },
                        "desc": { "type": "string", "description": "Card description (Markdown supported)" },
                        "due": { "type": "string", "description": "Due date (ISO 8601, e.g. 2026-03-01T12:00:00Z)" },
                        "pos": { "type": "string", "description": "Position: top, bottom, or a number" },
                        "label_ids": { "type": "string", "description": "Comma-separated label IDs to apply" },
                        "member_ids": { "type": "string", "description": "Comma-separated member IDs to assign" }
                    },
                    "required": ["list_id", "name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_update_card".into(),
                description: "Update a Trello card's name, description, due date, or completion status.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID" },
                        "name": { "type": "string", "description": "New card title" },
                        "desc": { "type": "string", "description": "New description" },
                        "due": { "type": "string", "description": "New due date (ISO 8601) or null to remove" },
                        "due_complete": { "type": "boolean", "description": "true to mark due date as complete" },
                        "closed": { "type": "boolean", "description": "true to archive the card" }
                    },
                    "required": ["card_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_move_card".into(),
                description: "Move a Trello card to a different list (and optionally a different board).".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID to move" },
                        "list_id": { "type": "string", "description": "Destination list ID" },
                        "board_id": { "type": "string", "description": "Destination board ID (only if moving across boards)" },
                        "pos": { "type": "string", "description": "Position in destination list: top, bottom, or a number" }
                    },
                    "required": ["card_id", "list_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_delete_card".into(),
                description: "Permanently delete a Trello card.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID to delete" }
                    },
                    "required": ["card_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_add_comment".into(),
                description: "Add a comment to a Trello card.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID" },
                        "text": { "type": "string", "description": "Comment text" }
                    },
                    "required": ["card_id", "text"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_add_label".into(),
                description: "Add a label to a Trello card.".into(),
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
                description: "Remove a label from a Trello card.".into(),
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
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_add_attachment".into(),
                description: "Add a URL attachment to a Trello card.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID" },
                        "url": { "type": "string", "description": "URL to attach" },
                        "name": { "type": "string", "description": "Attachment display name" }
                    },
                    "required": ["card_id", "url"]
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
        "trello_get_cards"      => Some(exec_get_cards(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_get_card"       => Some(exec_get_card(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_create_card"    => Some(exec_create(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_update_card"    => Some(exec_update(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_move_card"      => Some(exec_move(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_delete_card"    => Some(exec_delete(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_add_comment"    => Some(exec_comment(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_add_label"      => Some(exec_add_label(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_remove_label"   => Some(exec_remove_label(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_add_attachment" => Some(exec_attachment(args, app_handle).await.map_err(|e| e.to_string())),
        _ => None,
    }
}

// ── get cards in list ──────────────────────────────────────────────────

async fn exec_get_cards(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let list_id = args["list_id"].as_str().ok_or("Missing 'list_id'")?;
    let url = api_url(&format!("/lists/{}/cards?fields=name,id,desc,due,dueComplete,labels,pos,closed,shortUrl", list_id), app_handle)?;
    let http = client();
    let data = trello_request(&http, reqwest::Method::GET, &url, None).await?;
    let cards: Vec<Value> = serde_json::from_value(data).unwrap_or_default();

    if cards.is_empty() {
        return Ok("No cards in this list.".into());
    }

    let mut lines = vec![format!("**Cards in list {}** ({} found)\n", list_id, cards.len())];
    for c in &cards {
        let name = c["name"].as_str().unwrap_or("?");
        let id = c["id"].as_str().unwrap_or("?");
        let due = c["due"].as_str().map(|d| format!(" due:{}", &d[..10.min(d.len())])).unwrap_or_default();
        let done = if c["dueComplete"].as_bool().unwrap_or(false) { " ✓" } else { "" };
        let labels: Vec<&str> = c["labels"].as_array()
            .map(|a| a.iter().filter_map(|l| l["name"].as_str()).collect())
            .unwrap_or_default();
        let label_str = if labels.is_empty() { String::new() } else { format!(" [{}]", labels.join(", ")) };
        lines.push(format!("• **{}**{}{}{} — id: `{}`", name, due, done, label_str, id));
    }
    Ok(lines.join("\n"))
}

// ── get single card ────────────────────────────────────────────────────

async fn exec_get_card(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let url = api_url(&format!("/cards/{}?fields=all&checklists=all&actions_type=commentCard&actions_limit=10", card_id), app_handle)?;
    let http = client();
    let data = trello_request(&http, reqwest::Method::GET, &url, None).await?;

    let name = data["name"].as_str().unwrap_or("?");
    let desc = data["desc"].as_str().unwrap_or("");
    let due = data["due"].as_str().unwrap_or("none");
    let done = data["dueComplete"].as_bool().unwrap_or(false);
    let url_str = data["shortUrl"].as_str().unwrap_or("");

    let mut parts = vec![
        format!("**{}**", name),
        format!("ID: `{}`", card_id),
        format!("URL: {}", url_str),
        format!("Due: {}{}", due, if done { " ✓" } else { "" }),
    ];

    if !desc.is_empty() {
        parts.push(format!("\n{}", desc));
    }

    // Labels
    if let Some(labels) = data["labels"].as_array() {
        if !labels.is_empty() {
            let label_list: Vec<String> = labels.iter().map(|l| {
                let n = l["name"].as_str().unwrap_or("?");
                let c = l["color"].as_str().unwrap_or("");
                format!("{} ({})", n, c)
            }).collect();
            parts.push(format!("\nLabels: {}", label_list.join(", ")));
        }
    }

    // Checklists
    if let Some(checklists) = data["checklists"].as_array() {
        for cl in checklists {
            let cl_name = cl["name"].as_str().unwrap_or("Checklist");
            let items: Vec<String> = cl["checkItems"].as_array()
                .map(|items| items.iter().map(|item| {
                    let item_name = item["name"].as_str().unwrap_or("?");
                    let state = item["state"].as_str().unwrap_or("incomplete");
                    let check = if state == "complete" { "☑" } else { "☐" };
                    format!("  {} {}", check, item_name)
                }).collect())
                .unwrap_or_default();
            parts.push(format!("\n**Checklist: {}**\n{}", cl_name, items.join("\n")));
        }
    }

    Ok(parts.join("\n"))
}

// ── create card ────────────────────────────────────────────────────────

async fn exec_create(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let list_id = args["list_id"].as_str().ok_or("Missing 'list_id'")?;
    let name = args["name"].as_str().ok_or("Missing 'name'")?;
    let url = api_url("/cards", app_handle)?;
    let http = client();

    let mut body = json!({ "idList": list_id, "name": name });
    if let Some(desc) = args["desc"].as_str() { body["desc"] = json!(desc); }
    if let Some(due) = args["due"].as_str() { body["due"] = json!(due); }
    if let Some(pos) = args["pos"].as_str() { body["pos"] = json!(pos); }
    if let Some(labels) = args["label_ids"].as_str() { body["idLabels"] = json!(labels); }
    if let Some(members) = args["member_ids"].as_str() { body["idMembers"] = json!(members); }

    let data = trello_request(&http, reqwest::Method::POST, &url, Some(&body)).await?;
    let id = data["id"].as_str().unwrap_or("?");
    let card_url = data["shortUrl"].as_str().unwrap_or("");
    info!("[trello] Created card '{}' in list {} id={}", name, list_id, id);
    Ok(format!("Created card **{}** — id: `{}` — {}", name, id, card_url))
}

// ── update card ────────────────────────────────────────────────────────

async fn exec_update(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let url = api_url(&format!("/cards/{}", card_id), app_handle)?;
    let http = client();

    let mut body = json!({});
    if let Some(name) = args["name"].as_str() { body["name"] = json!(name); }
    if let Some(desc) = args["desc"].as_str() { body["desc"] = json!(desc); }
    if let Some(due) = args["due"].as_str() { body["due"] = json!(due); }
    if let Some(dc) = args["due_complete"].as_bool() { body["dueComplete"] = json!(dc); }
    if let Some(closed) = args["closed"].as_bool() { body["closed"] = json!(closed); }

    let data = trello_request(&http, reqwest::Method::PUT, &url, Some(&body)).await?;
    let name = data["name"].as_str().unwrap_or("?");
    info!("[trello] Updated card '{}' id={}", name, card_id);
    Ok(format!("Updated card **{}** (id: `{}`)", name, card_id))
}

// ── move card ──────────────────────────────────────────────────────────

async fn exec_move(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let list_id = args["list_id"].as_str().ok_or("Missing 'list_id'")?;
    let url = api_url(&format!("/cards/{}", card_id), app_handle)?;
    let http = client();

    let mut body = json!({ "idList": list_id });
    if let Some(board_id) = args["board_id"].as_str() { body["idBoard"] = json!(board_id); }
    if let Some(pos) = args["pos"].as_str() { body["pos"] = json!(pos); }

    let data = trello_request(&http, reqwest::Method::PUT, &url, Some(&body)).await?;
    let name = data["name"].as_str().unwrap_or("?");
    info!("[trello] Moved card '{}' to list {}", name, list_id);
    Ok(format!("Moved card **{}** to list `{}`", name, list_id))
}

// ── delete card ────────────────────────────────────────────────────────

async fn exec_delete(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let url = api_url(&format!("/cards/{}", card_id), app_handle)?;
    let http = client();
    trello_request(&http, reqwest::Method::DELETE, &url, None).await?;
    info!("[trello] Deleted card id={}", card_id);
    Ok(format!("Deleted card `{}`", card_id))
}

// ── add comment ────────────────────────────────────────────────────────

async fn exec_comment(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let text = args["text"].as_str().ok_or("Missing 'text'")?;
    let url = api_url(&format!("/cards/{}/actions/comments", card_id), app_handle)?;
    let http = client();
    let body = json!({ "text": text });
    trello_request(&http, reqwest::Method::POST, &url, Some(&body)).await?;
    info!("[trello] Added comment to card {}", card_id);
    Ok(format!("Added comment to card `{}`", card_id))
}

// ── add label to card ──────────────────────────────────────────────────

async fn exec_add_label(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let label_id = args["label_id"].as_str().ok_or("Missing 'label_id'")?;
    let url = api_url(&format!("/cards/{}/idLabels", card_id), app_handle)?;
    let http = client();
    let body = json!({ "value": label_id });
    trello_request(&http, reqwest::Method::POST, &url, Some(&body)).await?;
    info!("[trello] Added label {} to card {}", label_id, card_id);
    Ok(format!("Added label `{}` to card `{}`", label_id, card_id))
}

// ── remove label from card ─────────────────────────────────────────────

async fn exec_remove_label(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let label_id = args["label_id"].as_str().ok_or("Missing 'label_id'")?;
    let url = api_url(&format!("/cards/{}/idLabels/{}", card_id, label_id), app_handle)?;
    let http = client();
    trello_request(&http, reqwest::Method::DELETE, &url, None).await?;
    info!("[trello] Removed label {} from card {}", label_id, card_id);
    Ok(format!("Removed label `{}` from card `{}`", label_id, card_id))
}

// ── add attachment ─────────────────────────────────────────────────────

async fn exec_attachment(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let attach_url = args["url"].as_str().ok_or("Missing 'url'")?;
    let url = api_url(&format!("/cards/{}/attachments", card_id), app_handle)?;
    let http = client();

    let mut body = json!({ "url": attach_url });
    if let Some(name) = args["name"].as_str() { body["name"] = json!(name); }

    trello_request(&http, reqwest::Method::POST, &url, Some(&body)).await?;
    info!("[trello] Added attachment to card {}", card_id);
    Ok(format!("Added attachment to card `{}`", card_id))
}
