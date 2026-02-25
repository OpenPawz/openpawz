// trello/boards.rs — Board management
//
// Tools: trello_list_boards, trello_create_board, trello_get_board, trello_update_board, trello_delete_board

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
                name: "trello_list_boards".into(),
                description: "List all Trello boards for the authenticated user. Returns board names, IDs, URLs, and status.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "filter": { "type": "string", "description": "Filter: open (default), closed, all", "enum": ["open", "closed", "all"] }
                    }
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_create_board".into(),
                description: "Create a new Trello board. Returns the new board's ID and URL.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Board name" },
                        "desc": { "type": "string", "description": "Board description" },
                        "default_lists": { "type": "boolean", "description": "Create default lists (To Do, Doing, Done). Default: false" },
                        "organization_id": { "type": "string", "description": "Workspace/organization ID (optional)" }
                    },
                    "required": ["name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "trello_get_board".into(),
                description: "Get detailed info about a specific Trello board including lists and label counts.".into(),
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
                        "name": { "type": "string", "description": "New name" },
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
        "trello_list_boards" => Some(exec_list(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_create_board" => Some(
            exec_create(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "trello_get_board" => Some(exec_get(args, app_handle).await.map_err(|e| e.to_string())),
        "trello_update_board" => Some(
            exec_update(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "trello_delete_board" => Some(
            exec_delete(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        _ => None,
    }
}

// ── list boards ────────────────────────────────────────────────────────

async fn exec_list(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let filter = args["filter"].as_str().unwrap_or("open");

    let url = auth_url(
        &format!(
            "/members/me/boards?filter={}&fields=name,id,url,shortUrl,closed,desc,dateLastActivity",
            filter
        ),
        &key,
        &token,
    );
    let data = trello_request(reqwest::Method::GET, &url, None).await?;
    let boards: Vec<Value> = serde_json::from_value(data).unwrap_or_default();

    if boards.is_empty() {
        return Ok("No boards found.".into());
    }

    let mut lines = vec![format!("**Your Trello Boards** ({} found)\n", boards.len())];
    for b in &boards {
        let name = b["name"].as_str().unwrap_or("?");
        let id = b["id"].as_str().unwrap_or("?");
        let url = b["shortUrl"].as_str().or(b["url"].as_str()).unwrap_or("");
        let status = if b["closed"].as_bool().unwrap_or(false) {
            " [archived]"
        } else {
            ""
        };
        lines.push(format!("• **{}**{} — ID: `{}` — {}", name, status, id, url));
    }

    Ok(lines.join("\n"))
}

// ── create board ───────────────────────────────────────────────────────

async fn exec_create(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let name = args["name"].as_str().ok_or("Missing 'name'")?;

    let mut body = json!({
        "name": name,
        "defaultLists": args["default_lists"].as_bool().unwrap_or(false),
    });
    if let Some(desc) = args["desc"].as_str() {
        body["desc"] = json!(desc);
    }
    if let Some(org) = args["organization_id"].as_str() {
        body["idOrganization"] = json!(org);
    }

    let url = auth_url("/boards", &key, &token);
    let data = trello_request(reqwest::Method::POST, &url, Some(&body)).await?;

    let board_id = data["id"].as_str().unwrap_or("?");
    let board_url = data["shortUrl"]
        .as_str()
        .or(data["url"].as_str())
        .unwrap_or("?");
    info!("[trello] Created board: {} ({})", name, board_id);

    Ok(format!(
        "Created board **{}**\nID: `{}`\nURL: {}",
        name, board_id, board_url
    ))
}

// ── get board details ──────────────────────────────────────────────────

async fn exec_get(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;

    let url = auth_url(
        &format!("/boards/{}?fields=name,desc,url,shortUrl,closed,dateLastActivity,idOrganization&lists=open&labels=all", board_id),
        &key, &token,
    );
    let data = trello_request(reqwest::Method::GET, &url, None).await?;

    let name = data["name"].as_str().unwrap_or("?");
    let desc = data["desc"].as_str().unwrap_or("");
    let board_url = data["shortUrl"]
        .as_str()
        .or(data["url"].as_str())
        .unwrap_or("?");

    let mut lines = vec![
        format!("**Board: {}**", name),
        format!("ID: `{}`", board_id),
        format!("URL: {}", board_url),
    ];
    if !desc.is_empty() {
        lines.push(format!("Description: {}", desc));
    }

    if let Some(lists) = data["lists"].as_array() {
        lines.push(format!("\n**Lists** ({})", lists.len()));
        for l in lists {
            let ln = l["name"].as_str().unwrap_or("?");
            let lid = l["id"].as_str().unwrap_or("?");
            lines.push(format!("  • {} — `{}`", ln, lid));
        }
    }

    if let Some(labels) = data["labels"].as_array() {
        let active: Vec<&Value> = labels
            .iter()
            .filter(|l| l["name"].as_str().map(|n| !n.is_empty()).unwrap_or(false))
            .collect();
        if !active.is_empty() {
            lines.push(format!("\n**Labels** ({})", active.len()));
            for l in &active {
                let ln = l["name"].as_str().unwrap_or("?");
                let color = l["color"].as_str().unwrap_or("none");
                lines.push(format!(
                    "  • {} ({}) — `{}`",
                    ln,
                    color,
                    l["id"].as_str().unwrap_or("?")
                ));
            }
        }
    }

    Ok(lines.join("\n"))
}

// ── update board ───────────────────────────────────────────────────────

async fn exec_update(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;

    let mut body = json!({});
    if let Some(name) = args["name"].as_str() {
        body["name"] = json!(name);
    }
    if let Some(desc) = args["desc"].as_str() {
        body["desc"] = json!(desc);
    }
    if let Some(closed) = args["closed"].as_bool() {
        body["closed"] = json!(closed);
    }

    let url = auth_url(&format!("/boards/{}", board_id), &key, &token);
    trello_request(reqwest::Method::PUT, &url, Some(&body)).await?;

    let action = if args["closed"].as_bool() == Some(true) {
        "archived"
    } else if args["closed"].as_bool() == Some(false) {
        "unarchived"
    } else {
        "updated"
    };

    Ok(format!("Board `{}` {}.", board_id, action))
}

// ── delete board ───────────────────────────────────────────────────────

async fn exec_delete(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (key, token) = get_credentials(app_handle)?;
    let board_id = args["board_id"].as_str().ok_or("Missing 'board_id'")?;

    let url = auth_url(&format!("/boards/{}", board_id), &key, &token);
    trello_request(reqwest::Method::DELETE, &url, None).await?;

    info!("[trello] Deleted board: {}", board_id);
    Ok(format!("Board `{}` permanently deleted.", board_id))
}
