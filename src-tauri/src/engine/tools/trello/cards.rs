// trello/cards.rs — Card management
//
// Tools: trello_get_cards, trello_create_card, trello_get_card, trello_update_card,
//        trello_delete_card, trello_move_card, trello_add_comment, trello_search

use super::{auth_url, get_credentials, trello_request};
use crate::atoms::error::EngineResult;
use crate::atoms::types::*;
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
                name: "trello_create_card".into(),
                description: "Create a new card in a Trello list.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "list_id": { "type": "string", "description": "List ID to create the card in" },
                        "name": { "type": "string", "description": "Card title" },
                        "desc": { "type": "string", "description": "Card description (supports Markdown)" },
                        "due": { "type": "string", "description": "Due date (ISO 8601, e.g. 2026-03-01)" },
                        "pos": { "type": "string", "description": "Position: top, bottom, or number" },
                        "label_ids": { "type": "array", "items": { "type": "string" }, "description": "Label IDs to assign" },
                        "member_ids": { "type": "array", "items": { "type": "string" }, "description": "Member IDs to assign" }
                    },
                    "required": ["list_id", "name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_get_card".into(),
                description: "Get detailed info about a specific Trello card including checklists, comments, and attachments.".into(),
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
                name: "trello_update_card".into(),
                description: "Update a Trello card's name, description, due date, or completion status.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID" },
                        "name": { "type": "string", "description": "New title" },
                        "desc": { "type": "string", "description": "New description" },
                        "due": { "type": "string", "description": "New due date (ISO 8601) or null to remove" },
                        "due_complete": { "type": "boolean", "description": "Mark due date as complete" },
                        "closed": { "type": "boolean", "description": "true to archive, false to unarchive" }
                    },
                    "required": ["card_id"]
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
                name: "trello_move_card".into(),
                description: "Move a Trello card to a different list (and optionally a different board).".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "card_id": { "type": "string", "description": "Card ID to move" },
                        "list_id": { "type": "string", "description": "Target list ID" },
                        "board_id": { "type": "string", "description": "Target board ID (only if moving across boards)" },
                        "pos": { "type": "string", "description": "Position in target list: top, bottom, or number" }
                    },
                    "required": ["card_id", "list_id"]
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
                        "text": { "type": "string", "description": "Comment text (supports Markdown)" }
                    },
                    "required": ["card_id", "text"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_search".into(),
                description: "Search across Trello boards, cards, and members. Returns matching items.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Search query" },
                        "board_ids": { "type": "array", "items": { "type": "string" }, "description": "Limit search to these board IDs" },
                        "model_types": { "type": "string", "description": "Comma-separated: cards, boards, organizations. Default: cards,boards" }
                    },
                    "required": ["query"]
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
        "trello_get_cards" => Some(
            exec_get_cards(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "trello_create_card" => Some(
            exec_create(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "trello_get_card" => Some(
            exec_get_card(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "trello_update_card" => Some(
            exec_update(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "trello_delete_card" => Some(
            exec_delete(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "trello_move_card" => Some(exec_move(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_add_comment" => Some(
            exec_comment(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "trello_search" => Some(
            exec_search(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        _ => None,
    }
}

// ── get cards ──────────────────────────────────────────────────────────

async fn exec_get_cards(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let list_id = args["list_id"].as_str().ok_or("Missing 'list_id'")?;

    let url = auth_url(
        &format!("/lists/{}/cards?fields=name,id,desc,due,dueComplete,closed,labels,idMembers,shortUrl,pos", list_id),
        &key, &token,
    );
    let data = trello_request(reqwest::Method::GET, &url, None).await?;
    let cards: Vec<Value> = serde_json::from_value(data).unwrap_or_default();

    if cards.is_empty() {
        return Ok(format!("No cards in list `{}`.", list_id));
    }

    let mut lines = vec![format!("**Cards** ({} found)\n", cards.len())];
    for c in &cards {
        let name = c["name"].as_str().unwrap_or("?");
        let id = c["id"].as_str().unwrap_or("?");
        let due = c["due"]
            .as_str()
            .map(|d| format!(" — due: {}", &d[..10.min(d.len())]))
            .unwrap_or_default();
        let done = if c["dueComplete"].as_bool().unwrap_or(false) {
            " ✓"
        } else {
            ""
        };
        let labels: Vec<&str> = c["labels"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|l| l["name"].as_str()).collect())
            .unwrap_or_default();
        let label_str = if labels.is_empty() {
            String::new()
        } else {
            format!(" [{}]", labels.join(", "))
        };
        lines.push(format!(
            "• **{}**{}{}{} — `{}`",
            name, due, done, label_str, id
        ));
    }

    Ok(lines.join("\n"))
}

// ── create card ────────────────────────────────────────────────────────

async fn exec_create(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let list_id = args["list_id"].as_str().ok_or("Missing 'list_id'")?;
    let name = args["name"].as_str().ok_or("Missing 'name'")?;

    let mut body = json!({
        "idList": list_id,
        "name": name,
    });
    if let Some(desc) = args["desc"].as_str() {
        body["desc"] = json!(desc);
    }
    if let Some(due) = args["due"].as_str() {
        body["due"] = json!(due);
    }
    if let Some(pos) = args["pos"].as_str() {
        body["pos"] = json!(pos);
    }
    if let Some(labels) = args["label_ids"].as_array() {
        let ids: Vec<&str> = labels.iter().filter_map(|v| v.as_str()).collect();
        body["idLabels"] = json!(ids.join(","));
    }
    if let Some(members) = args["member_ids"].as_array() {
        let ids: Vec<&str> = members.iter().filter_map(|v| v.as_str()).collect();
        body["idMembers"] = json!(ids.join(","));
    }

    let url = auth_url("/cards", &key, &token);
    let data = trello_request(reqwest::Method::POST, &url, Some(&body)).await?;

    let card_id = data["id"].as_str().unwrap_or("?");
    let card_url = data["shortUrl"]
        .as_str()
        .or(data["url"].as_str())
        .unwrap_or("?");
    info!("[trello] Created card: {} ({})", name, card_id);

    Ok(format!(
        "Created card **{}**\nID: `{}`\nURL: {}",
        name, card_id, card_url
    ))
}

// ── get card details ───────────────────────────────────────────────────

async fn exec_get_card(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;

    let url = auth_url(
        &format!("/cards/{}?fields=all&checklists=all&actions=commentCard&actions_limit=10&attachments=true&members=true", card_id),
        &key, &token,
    );
    let data = trello_request(reqwest::Method::GET, &url, None).await?;

    let name = data["name"].as_str().unwrap_or("?");
    let desc = data["desc"].as_str().unwrap_or("");
    let card_url = data["shortUrl"]
        .as_str()
        .or(data["url"].as_str())
        .unwrap_or("?");

    let mut lines = vec![
        format!("**Card: {}**", name),
        format!("ID: `{}` — {}", card_id, card_url),
    ];
    if !desc.is_empty() {
        lines.push(format!("Description: {}", &desc[..desc.len().min(500)]));
    }
    if let Some(due) = data["due"].as_str() {
        let done = if data["dueComplete"].as_bool().unwrap_or(false) {
            " ✓"
        } else {
            ""
        };
        lines.push(format!("Due: {}{}", &due[..10.min(due.len())], done));
    }

    // Checklists
    if let Some(checklists) = data["checklists"].as_array() {
        for cl in checklists {
            let cl_name = cl["name"].as_str().unwrap_or("?");
            let cl_id = cl["id"].as_str().unwrap_or("?");
            lines.push(format!("\n**Checklist: {}** (`{}`)", cl_name, cl_id));
            if let Some(items) = cl["checkItems"].as_array() {
                for item in items {
                    let item_name = item["name"].as_str().unwrap_or("?");
                    let checked = item["state"].as_str() == Some("complete");
                    let mark = if checked { "☑" } else { "☐" };
                    let item_id = item["id"].as_str().unwrap_or("?");
                    lines.push(format!("  {} {} (`{}`)", mark, item_name, item_id));
                }
            }
        }
    }

    // Comments
    if let Some(actions) = data["actions"].as_array() {
        if !actions.is_empty() {
            lines.push(format!("\n**Comments** ({})", actions.len()));
            for a in actions {
                let author = a["memberCreator"]["username"].as_str().unwrap_or("?");
                let text = a["data"]["text"].as_str().unwrap_or("");
                lines.push(format!("  @{}: {}", author, &text[..text.len().min(200)]));
            }
        }
    }

    // Attachments
    if let Some(attachments) = data["attachments"].as_array() {
        if !attachments.is_empty() {
            lines.push(format!("\n**Attachments** ({})", attachments.len()));
            for att in attachments {
                let att_name = att["name"].as_str().unwrap_or("?");
                let att_url = att["url"].as_str().unwrap_or("?");
                lines.push(format!("  • {} — {}", att_name, att_url));
            }
        }
    }

    Ok(lines.join("\n"))
}

// ── update card ────────────────────────────────────────────────────────

async fn exec_update(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;

    let mut body = json!({});
    if let Some(name) = args["name"].as_str() {
        body["name"] = json!(name);
    }
    if let Some(desc) = args["desc"].as_str() {
        body["desc"] = json!(desc);
    }
    if let Some(due) = args["due"].as_str() {
        body["due"] = json!(due);
    }
    if let Some(dc) = args["due_complete"].as_bool() {
        body["dueComplete"] = json!(dc);
    }
    if let Some(closed) = args["closed"].as_bool() {
        body["closed"] = json!(closed);
    }

    let url = auth_url(&format!("/cards/{}", card_id), &key, &token);
    trello_request(reqwest::Method::PUT, &url, Some(&body)).await?;

    Ok(format!("Card `{}` updated.", card_id))
}

// ── delete card ────────────────────────────────────────────────────────

async fn exec_delete(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;

    let url = auth_url(&format!("/cards/{}", card_id), &key, &token);
    trello_request(reqwest::Method::DELETE, &url, None).await?;

    info!("[trello] Deleted card: {}", card_id);
    Ok(format!("Card `{}` deleted.", card_id))
}

// ── move card ──────────────────────────────────────────────────────────

async fn exec_move(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let list_id = args["list_id"].as_str().ok_or("Missing 'list_id'")?;

    let mut body = json!({ "idList": list_id });
    if let Some(board_id) = args["board_id"].as_str() {
        body["idBoard"] = json!(board_id);
    }
    if let Some(pos) = args["pos"].as_str() {
        body["pos"] = json!(pos);
    }

    let url = auth_url(&format!("/cards/{}", card_id), &key, &token);
    trello_request(reqwest::Method::PUT, &url, Some(&body)).await?;

    info!("[trello] Moved card {} to list {}", card_id, list_id);
    Ok(format!("Card `{}` moved to list `{}`.", card_id, list_id))
}

// ── add comment ────────────────────────────────────────────────────────

async fn exec_comment(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let card_id = args["card_id"].as_str().ok_or("Missing 'card_id'")?;
    let text = args["text"].as_str().ok_or("Missing 'text'")?;

    let body = json!({ "text": text });
    let url = auth_url(
        &format!("/cards/{}/actions/comments", card_id),
        &key,
        &token,
    );
    trello_request(reqwest::Method::POST, &url, Some(&body)).await?;

    Ok(format!("Comment added to card `{}`.", card_id))
}

// ── search ─────────────────────────────────────────────────────────────

async fn exec_search(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let query = args["query"].as_str().ok_or("Missing 'query'")?;
    let model_types = args["model_types"].as_str().unwrap_or("cards,boards");

    let encoded_query = query
        .replace(' ', "%20")
        .replace('&', "%26")
        .replace('#', "%23")
        .replace('?', "%3F");
    let mut path = format!("/search?query={}&modelTypes={}", encoded_query, model_types);

    if let Some(board_ids) = args["board_ids"].as_array() {
        let ids: Vec<&str> = board_ids.iter().filter_map(|v| v.as_str()).collect();
        if !ids.is_empty() {
            path.push_str(&format!("&idBoards={}", ids.join(",")));
        }
    }

    let url = auth_url(&path, &key, &token);
    let data = trello_request(reqwest::Method::GET, &url, None).await?;

    let mut lines = vec!["**Search Results**\n".to_string()];

    if let Some(boards) = data["boards"].as_array() {
        if !boards.is_empty() {
            lines.push(format!("**Boards** ({})", boards.len()));
            for b in boards {
                let name = b["name"].as_str().unwrap_or("?");
                let id = b["id"].as_str().unwrap_or("?");
                lines.push(format!("  • {} — `{}`", name, id));
            }
        }
    }

    if let Some(cards) = data["cards"].as_array() {
        if !cards.is_empty() {
            lines.push(format!("\n**Cards** ({})", cards.len()));
            for c in cards {
                let name = c["name"].as_str().unwrap_or("?");
                let id = c["id"].as_str().unwrap_or("?");
                let board_name = c["board"]["name"].as_str().unwrap_or("");
                lines.push(format!("  • {} ({}) — `{}`", name, board_name, id));
            }
        }
    }

    if lines.len() == 1 {
        lines.push("No results found.".into());
    }

    Ok(lines.join("\n"))
}
