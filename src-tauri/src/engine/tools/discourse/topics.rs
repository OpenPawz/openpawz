// discourse/topics.rs — Topic management
//
// Tools:
//   discourse_list_topics    — list latest/top/new topics (optionally by category)
//   discourse_get_topic      — read a topic with its posts
//   discourse_create_topic   — create a new topic in a category
//   discourse_update_topic   — edit topic title, category, or tags
//   discourse_close_topic    — close (lock) a topic
//   discourse_open_topic     — re-open a closed topic
//   discourse_pin_topic      — pin a topic globally or in its category
//   discourse_unpin_topic    — unpin a topic
//   discourse_archive_topic  — archive a topic
//   discourse_delete_topic   — delete a topic
//   discourse_invite_to_topic — invite a user to a private topic
//   discourse_set_topic_timer — schedule auto-close, auto-delete, etc.

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
                name: "discourse_list_topics".into(),
                description: "List topics from a Discourse forum. Can filter by category, sort order (latest/top/new/unread), and page. Returns topic titles, IDs, authors, reply counts, and dates.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "category_slug": { "type": "string", "description": "Category slug to filter by (e.g. 'support', 'announcements'). Omit for all categories." },
                        "category_id": { "type": "integer", "description": "Category ID to filter by. Alternative to category_slug." },
                        "order": { "type": "string", "enum": ["latest", "top", "new", "unread"], "description": "Sort order. Default: latest." },
                        "page": { "type": "integer", "description": "Page number (0-based). Default: 0." },
                        "per_page": { "type": "integer", "description": "Number of topics per page (max 30, default 20)." }
                    }
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_get_topic".into(),
                description: "Read a Discourse topic by ID. Returns the topic title, all posts (with author, content, likes, date), and metadata. Use this to read forum threads.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "The topic ID to read." },
                        "post_number": { "type": "integer", "description": "Start reading from this post number (for long threads). Default: 1." }
                    },
                    "required": ["topic_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_create_topic".into(),
                description: "Create a new topic on the Discourse forum. Specify a title, body (supports Markdown), and category. Returns the new topic ID and URL.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "description": "Topic title (min 15 chars by default)." },
                        "raw": { "type": "string", "description": "Topic body in Markdown." },
                        "category": { "type": "integer", "description": "Category ID to post in." },
                        "tags": { "type": "array", "items": { "type": "string" }, "description": "Tags to apply to the topic." },
                        "created_at": { "type": "string", "description": "ISO 8601 timestamp to backdate the post (admin only)." }
                    },
                    "required": ["title", "raw", "category"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_update_topic".into(),
                description: "Edit a topic's title, category, or tags. Does not edit the post body — use discourse_edit_post for that.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "The topic ID to update." },
                        "title": { "type": "string", "description": "New title." },
                        "category_id": { "type": "integer", "description": "Move to this category." },
                        "tags": { "type": "array", "items": { "type": "string" }, "description": "Replace tags." }
                    },
                    "required": ["topic_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_close_topic".into(),
                description: "Close (lock) a topic so no new replies can be posted.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "The topic ID to close." }
                    },
                    "required": ["topic_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_open_topic".into(),
                description: "Re-open a closed topic to allow new replies.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "The topic ID to re-open." }
                    },
                    "required": ["topic_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_pin_topic".into(),
                description: "Pin a topic. Pinned topics appear at the top of the topic list.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "The topic ID to pin." },
                        "globally": { "type": "boolean", "description": "If true, pin globally (all categories). If false, pin only in its category. Default: false." },
                        "until": { "type": "string", "description": "ISO 8601 date to auto-unpin. Omit for permanent pin." }
                    },
                    "required": ["topic_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_unpin_topic".into(),
                description: "Unpin a pinned topic.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "The topic ID to unpin." }
                    },
                    "required": ["topic_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_archive_topic".into(),
                description: "Archive a topic. Archived topics are hidden from the default topic list but still accessible via direct link.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "The topic ID to archive." }
                    },
                    "required": ["topic_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_delete_topic".into(),
                description: "Delete a topic. Requires admin/moderator permissions.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "The topic ID to delete." }
                    },
                    "required": ["topic_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_invite_to_topic".into(),
                description: "Invite a user to a topic (especially useful for private/PM topics).".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "The topic ID." },
                        "username": { "type": "string", "description": "Username to invite." },
                        "email": { "type": "string", "description": "Email to invite (alternative to username, for external invites)." }
                    },
                    "required": ["topic_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_set_topic_timer".into(),
                description: "Set a timer on a topic — auto-close, auto-delete, auto-bump, publish to category, etc.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "The topic ID." },
                        "time": { "type": "string", "description": "When the timer fires — ISO 8601 datetime or relative like '24' (hours from now). Empty string to clear." },
                        "status_type": { "type": "string", "enum": ["close", "open", "delete", "bump", "publish_to_category", "reminder"], "description": "Timer action. Default: close." },
                        "based_on_last_post": { "type": "boolean", "description": "If true, timer resets on each new reply (for auto-close). Default: false." },
                        "category_id": { "type": "integer", "description": "Target category (only for publish_to_category)." }
                    },
                    "required": ["topic_id", "time"]
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
        "discourse_list_topics" => {
            Some(exec_list(args, app_handle).await.map_err(|e| e.to_string()))
        }
        "discourse_get_topic" => Some(exec_get(args, app_handle).await.map_err(|e| e.to_string())),
        "discourse_create_topic" => Some(
            exec_create(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_update_topic" => Some(
            exec_update(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_close_topic" => Some(
            exec_status(args, app_handle, "closed", true)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_open_topic" => Some(
            exec_status(args, app_handle, "closed", false)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_pin_topic" => Some(
            exec_pin(args, app_handle, true)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_unpin_topic" => Some(
            exec_pin(args, app_handle, false)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_archive_topic" => Some(
            exec_status(args, app_handle, "archived", true)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_delete_topic" => Some(
            exec_delete(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_invite_to_topic" => Some(
            exec_invite(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_set_topic_timer" => Some(
            exec_timer(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        _ => None,
    }
}

// ── list topics ────────────────────────────────────────────────────────

async fn exec_list(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let order = args["order"].as_str().unwrap_or("latest");
    let page = args["page"].as_i64().unwrap_or(0);

    let url = if let Some(slug) = args["category_slug"].as_str() {
        format!("{}/c/{}/{}.json?page={}", base_url, slug, order, page)
    } else if let Some(cat_id) = args["category_id"].as_i64() {
        format!("{}/c/{}/{}.json?page={}", base_url, cat_id, order, page)
    } else {
        format!("{}/{}.json?page={}", base_url, order, page)
    };

    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let topics = data["topic_list"]["topics"]
        .as_array()
        .map(|arr| arr.as_slice())
        .unwrap_or(&[]);

    let per_page = args["per_page"].as_u64().unwrap_or(20).min(30) as usize;
    let topics = &topics[..topics.len().min(per_page)];

    let mut lines = Vec::new();
    lines.push(format!("**{} topics** (page {})\n", topics.len(), page));

    for t in topics {
        let id = t["id"].as_i64().unwrap_or(0);
        let title = t["title"].as_str().unwrap_or("?");
        let replies = t["posts_count"].as_i64().unwrap_or(1) - 1;
        let views = t["views"].as_i64().unwrap_or(0);
        let pinned = t["pinned"].as_bool().unwrap_or(false);
        let closed = t["closed"].as_bool().unwrap_or(false);
        let created = t["created_at"].as_str().unwrap_or("?");
        let last_posted = t["last_posted_at"].as_str().unwrap_or("?");

        let mut flags = Vec::new();
        if pinned {
            flags.push("📌");
        }
        if closed {
            flags.push("🔒");
        }
        let flag_str = if flags.is_empty() {
            String::new()
        } else {
            format!(" {}", flags.join(""))
        };

        lines.push(format!(
            "• **{}** (id: {}){}\n  {} replies · {} views · created {} · last reply {}",
            title, id, flag_str, replies, views, created, last_posted
        ));
    }

    Ok(lines.join("\n"))
}

// ── get topic ──────────────────────────────────────────────────────────

async fn exec_get(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let topic_id = args["topic_id"].as_i64().ok_or("topic_id is required")?;

    let url = format!("{}/t/{}.json", base_url, topic_id);
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let title = data["title"].as_str().unwrap_or("?");
    let category_id = data["category_id"].as_i64().unwrap_or(0);
    let views = data["views"].as_i64().unwrap_or(0);
    let reply_count = data["reply_count"].as_i64().unwrap_or(0);
    let like_count = data["like_count"].as_i64().unwrap_or(0);
    let closed = data["closed"].as_bool().unwrap_or(false);
    let pinned = data["pinned"].as_bool().unwrap_or(false);
    let tags: Vec<&str> = data["tags"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    let mut lines = Vec::new();
    lines.push(format!("# {} (topic {})", title, topic_id));
    lines.push(format!(
        "Category: {} · {} views · {} replies · {} likes{}{}",
        category_id,
        views,
        reply_count,
        like_count,
        if pinned { " · 📌 pinned" } else { "" },
        if closed { " · 🔒 closed" } else { "" },
    ));
    if !tags.is_empty() {
        lines.push(format!("Tags: {}", tags.join(", ")));
    }
    lines.push(String::new());

    // Render posts
    let posts = data["post_stream"]["posts"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    for p in posts {
        let post_num = p["post_number"].as_i64().unwrap_or(0);
        let author = p["username"].as_str().unwrap_or("?");
        let cooked = p["cooked"].as_str().unwrap_or("");
        let created = p["created_at"].as_str().unwrap_or("?");
        let likes = p["like_count"].as_i64().unwrap_or(0);
        let post_id = p["id"].as_i64().unwrap_or(0);

        // Strip HTML tags from cooked content for cleaner output
        let text = strip_html(cooked);

        lines.push(format!(
            "---\n**Post #{} by @{}** (post_id: {}) — {} · {} likes\n{}",
            post_num, author, post_id, created, likes, text
        ));
    }

    Ok(lines.join("\n"))
}

// ── create topic ───────────────────────────────────────────────────────

async fn exec_create(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let title = args["title"].as_str().ok_or("title is required")?;
    let raw = args["raw"]
        .as_str()
        .ok_or("raw (body content) is required")?;
    let category = args["category"]
        .as_i64()
        .ok_or("category (ID) is required")?;

    let mut body = json!({
        "title": title,
        "raw": raw,
        "category": category
    });

    if let Some(tags) = args["tags"].as_array() {
        body["tags"] = json!(tags);
    }
    if let Some(created_at) = args["created_at"].as_str() {
        body["created_at"] = json!(created_at);
    }

    let url = format!("{}/posts.json", base_url);
    let result = discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    let topic_id = result["topic_id"].as_i64().unwrap_or(0);
    let post_id = result["id"].as_i64().unwrap_or(0);
    let topic_slug = result["topic_slug"].as_str().unwrap_or("");

    info!("[discourse] Created topic {} (post {})", topic_id, post_id);
    Ok(format!(
        "Topic created!\n• Topic ID: {}\n• Post ID: {}\n• URL: {}/t/{}/{}",
        topic_id, post_id, base_url, topic_slug, topic_id
    ))
}

// ── update topic ───────────────────────────────────────────────────────

async fn exec_update(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let topic_id = args["topic_id"].as_i64().ok_or("topic_id is required")?;

    let mut body = json!({});
    if let Some(title) = args["title"].as_str() {
        body["title"] = json!(title);
    }
    if let Some(cat) = args["category_id"].as_i64() {
        body["category_id"] = json!(cat);
    }
    if let Some(tags) = args["tags"].as_array() {
        body["tags"] = json!(tags);
    }

    let url = format!("{}/t/-/{}.json", base_url, topic_id);
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    info!("[discourse] Updated topic {}", topic_id);
    Ok(format!("Topic {} updated successfully.", topic_id))
}

// ── close/open/archive (status toggles) ────────────────────────────────

async fn exec_status(
    args: &Value,
    app_handle: &tauri::AppHandle,
    status: &str,
    enabled: bool,
) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let topic_id = args["topic_id"].as_i64().ok_or("topic_id is required")?;

    let body = json!({
        "status": status,
        "enabled": if enabled { "true" } else { "false" }
    });

    let url = format!("{}/t/{}/status.json", base_url, topic_id);
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    let action = if enabled {
        match status {
            "closed" => "closed",
            "archived" => "archived",
            _ => "updated",
        }
    } else {
        "re-opened"
    };

    info!("[discourse] Topic {} {}", topic_id, action);
    Ok(format!("Topic {} {}.", topic_id, action))
}

// ── pin / unpin ────────────────────────────────────────────────────────

async fn exec_pin(args: &Value, app_handle: &tauri::AppHandle, pin: bool) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let topic_id = args["topic_id"].as_i64().ok_or("topic_id is required")?;

    let status = if pin {
        let globally = args["globally"].as_bool().unwrap_or(false);
        if globally {
            "pinned_globally"
        } else {
            "pinned"
        }
    } else {
        "pinned"
    };

    let mut body = json!({
        "status": status,
        "enabled": if pin { "true" } else { "false" }
    });

    if pin {
        if let Some(until) = args["until"].as_str() {
            body["until"] = json!(until);
        }
    }

    let url = format!("{}/t/{}/status.json", base_url, topic_id);
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    let action = if pin { "pinned" } else { "unpinned" };
    info!("[discourse] Topic {} {}", topic_id, action);
    Ok(format!("Topic {} {}.", topic_id, action))
}

// ── delete topic ───────────────────────────────────────────────────────

async fn exec_delete(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let topic_id = args["topic_id"].as_i64().ok_or("topic_id is required")?;

    let url = format!("{}/t/{}.json", base_url, topic_id);
    discourse_request(&client, reqwest::Method::DELETE, &url, None).await?;

    info!("[discourse] Deleted topic {}", topic_id);
    Ok(format!("Topic {} deleted.", topic_id))
}

// ── invite to topic ────────────────────────────────────────────────────

async fn exec_invite(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let topic_id = args["topic_id"].as_i64().ok_or("topic_id is required")?;

    let mut body = json!({});
    if let Some(u) = args["username"].as_str() {
        body["user"] = json!(u);
    } else if let Some(e) = args["email"].as_str() {
        body["email"] = json!(e);
    } else {
        return Err("Either 'username' or 'email' is required".into());
    }

    let url = format!("{}/t/{}/invite.json", base_url, topic_id);
    discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    info!("[discourse] Invited user to topic {}", topic_id);
    Ok(format!("User invited to topic {}.", topic_id))
}

// ── topic timer ────────────────────────────────────────────────────────

async fn exec_timer(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let topic_id = args["topic_id"].as_i64().ok_or("topic_id is required")?;
    let time = args["time"].as_str().unwrap_or("");
    let status_type = args["status_type"].as_str().unwrap_or("close");

    let mut body = json!({
        "time": time,
        "status_type": status_type
    });

    if let Some(based) = args["based_on_last_post"].as_bool() {
        body["based_on_last_post"] = json!(based);
    }
    if let Some(cat) = args["category_id"].as_i64() {
        body["category_id"] = json!(cat);
    }

    let url = format!("{}/t/{}/timer.json", base_url, topic_id);
    discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    if time.is_empty() {
        info!("[discourse] Cleared timer on topic {}", topic_id);
        Ok(format!("Timer cleared on topic {}.", topic_id))
    } else {
        info!(
            "[discourse] Set {} timer on topic {}",
            status_type, topic_id
        );
        Ok(format!(
            "Timer set on topic {}: {} at {}",
            topic_id, status_type, time
        ))
    }
}

// ── HTML stripper ──────────────────────────────────────────────────────

/// Minimal HTML tag stripper for converting Discourse cooked HTML to plain text.
fn strip_html(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    // Collapse multiple blank lines
    let mut prev_blank = false;
    let mut cleaned = String::new();
    for line in result.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !prev_blank {
                cleaned.push('\n');
                prev_blank = true;
            }
        } else {
            cleaned.push_str(trimmed);
            cleaned.push('\n');
            prev_blank = false;
        }
    }
    cleaned.trim().to_string()
}
