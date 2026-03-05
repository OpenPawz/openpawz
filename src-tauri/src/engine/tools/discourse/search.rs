// discourse/search.rs — Full-text search + tag management
//
// Tools:
//   discourse_search         — full-text search across topics, posts, users
//   discourse_list_tags       — list all tags
//   discourse_tag_topic       — add tags to a topic
//   discourse_create_tag      — create a new tag
//   discourse_list_tag_groups — list tag groups

use super::{authorized_client, discourse_request, get_credentials};
use crate::atoms::error::EngineResult;
use crate::atoms::types::*;
use log::info;
use serde_json::{json, Value};

pub fn definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_search".into(),
                description: "Search the forum. Supports full-text search with filters for category, user, tags, date ranges, topic status, and sort order. Uses Discourse's advanced search syntax.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "q": { "type": "string", "description": "Search query. Supports Discourse search syntax like 'in:title', '#category', '@user', 'tags:foo', 'before:2024-01-01', 'after:2023-06-01', 'status:open', 'order:latest'." },
                        "page": { "type": "integer", "description": "Page number (1-based). Default: 1." }
                    },
                    "required": ["q"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_list_tags".into(),
                description: "List all tags on the forum with their topic counts.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {}
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_tag_topic".into(),
                description: "Set tags on a topic. This replaces all existing tags. To add a tag, include existing tags plus the new one.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "Topic ID." },
                        "tags": { "type": "array", "items": { "type": "string" }, "description": "Array of tag names to set on the topic." }
                    },
                    "required": ["topic_id", "tags"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_create_tag".into(),
                description: "Create a new tag. If tagging is restricted to staff, requires admin API key.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Tag name (lowercase, no spaces, use hyphens)." },
                        "description": { "type": "string", "description": "Tag description." }
                    },
                    "required": ["name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_list_tag_groups".into(),
                description: "List tag groups (collections of related tags).".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {}
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
        "discourse_search" => Some(
            exec_search(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_list_tags" => Some(
            exec_list_tags(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_tag_topic" => Some(
            exec_tag_topic(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_create_tag" => Some(
            exec_create_tag(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_list_tag_groups" => Some(
            exec_list_tag_groups(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        _ => None,
    }
}

// ── full-text search ───────────────────────────────────────────────────

async fn exec_search(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let q = args["q"].as_str().ok_or("q (query) is required")?;
    let page = args["page"].as_i64().unwrap_or(1);

    let url = format!(
        "{}/search.json?q={}&page={}",
        base_url,
        urlencoding::encode(q),
        page
    );
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let topics = data["topics"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[]);
    let posts = data["posts"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[]);
    let users = data["users"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    let mut lines = Vec::new();
    lines.push(format!(
        "**Search results** for \"{}\" (page {})\n",
        q, page
    ));

    if !topics.is_empty() {
        lines.push(format!("**Topics** ({})", topics.len()));
        for t in topics.iter().take(15) {
            let id = t["id"].as_i64().unwrap_or(0);
            let title = t["title"].as_str().unwrap_or("?");
            let posts_count = t["posts_count"].as_i64().unwrap_or(0);
            let views = t["views"].as_i64().unwrap_or(0);
            let created = t["created_at"].as_str().unwrap_or("?");
            let closed = t["closed"].as_bool().unwrap_or(false);
            let tags: Vec<&str> = t["tags"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
                .unwrap_or_default();

            let status = if closed { " 🔒" } else { "" };
            let tag_str = if tags.is_empty() {
                String::new()
            } else {
                format!(" [{}]", tags.join(", "))
            };

            lines.push(format!(
                "  • #{} **{}**{}{} · {} posts · {} views · {}",
                id, title, status, tag_str, posts_count, views, created
            ));
        }
        lines.push(String::new());
    }

    if !posts.is_empty() {
        lines.push(format!("**Posts** ({})", posts.len()));
        for p in posts.iter().take(10) {
            let id = p["id"].as_i64().unwrap_or(0);
            let topic_id = p["topic_id"].as_i64().unwrap_or(0);
            let uname = p["username"].as_str().unwrap_or("?");
            let blurb = p["blurb"].as_str().unwrap_or("");
            let created = p["created_at"].as_str().unwrap_or("?");
            let likes = p["like_count"].as_i64().unwrap_or(0);

            lines.push(format!(
                "  • post:{} in topic:{} by @{} (♥ {}) · {}\n    {}",
                id, topic_id, uname, likes, created, blurb
            ));
        }
        lines.push(String::new());
    }

    if !users.is_empty() {
        lines.push(format!("**Users** ({})", users.len()));
        for u in users.iter().take(5) {
            let uname = u["username"].as_str().unwrap_or("?");
            let name = u["name"].as_str().unwrap_or("?");
            lines.push(format!("  • @{} ({})", uname, name));
        }
    }

    if topics.is_empty() && posts.is_empty() && users.is_empty() {
        lines.push("No results found.".into());
    }

    Ok(lines.join("\n"))
}

// ── list tags ──────────────────────────────────────────────────────────

async fn exec_list_tags(_args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let url = format!("{}/tags.json", base_url);
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let tags = data["tags"].as_array().map(|a| a.as_slice()).unwrap_or(&[]);

    let mut lines = Vec::new();
    lines.push(format!("**{} tags**\n", tags.len()));

    for t in tags {
        let name = t["name"].as_str().unwrap_or("?");
        let count = t["count"].as_i64().unwrap_or(0);
        let pm_count = t["pm_count"].as_i64().unwrap_or(0);
        let staff = t["staff"].as_bool().unwrap_or(false);

        let suffix = if staff { " (staff-only)" } else { "" };
        let pm_str = if pm_count > 0 {
            format!(", {} PMs", pm_count)
        } else {
            String::new()
        };

        lines.push(format!(
            "• **{}** — {} topics{}{}",
            name, count, pm_str, suffix
        ));
    }

    Ok(lines.join("\n"))
}

// ── tag a topic ────────────────────────────────────────────────────────

async fn exec_tag_topic(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let topic_id = args["topic_id"].as_i64().ok_or("topic_id is required")?;
    let tags: Vec<&str> = args["tags"]
        .as_array()
        .ok_or("tags array is required")?
        .iter()
        .filter_map(|v| v.as_str())
        .collect();

    let body = json!({ "tags": tags });
    let url = format!("{}/t/-/{}.json", base_url, topic_id);
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    info!("[discourse] Tagged topic {} with {:?}", topic_id, tags);
    Ok(format!(
        "Topic {} tagged with: {}",
        topic_id,
        tags.join(", ")
    ))
}

// ── create tag ─────────────────────────────────────────────────────────

async fn exec_create_tag(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let name = args["name"].as_str().ok_or("name is required")?;

    let mut body = json!({ "name": name });
    if let Some(desc) = args["description"].as_str() {
        body["description"] = json!(desc);
    }

    let url = format!("{}/tags.json", base_url);
    let result = discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    let tag_name = result["tag"]["name"].as_str().unwrap_or(name);

    info!("[discourse] Created tag: {}", tag_name);
    Ok(format!("Tag '{}' created.", tag_name))
}

// ── list tag groups ────────────────────────────────────────────────────

async fn exec_list_tag_groups(
    _args: &Value,
    app_handle: &tauri::AppHandle,
) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let url = format!("{}/tag_groups.json", base_url);
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let groups = data["tag_groups"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    let mut lines = Vec::new();
    lines.push(format!("**{} tag groups**\n", groups.len()));

    for g in groups {
        let id = g["id"].as_i64().unwrap_or(0);
        let name = g["name"].as_str().unwrap_or("?");
        let tags: Vec<&str> = g["tag_names"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();

        lines.push(format!(
            "• **{}** (id: {}) — tags: {}",
            name,
            id,
            if tags.is_empty() {
                "(none)".to_string()
            } else {
                tags.join(", ")
            },
        ));
    }

    Ok(lines.join("\n"))
}
