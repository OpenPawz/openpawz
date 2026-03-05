// discourse/posts.rs — Post management
//
// Tools:
//   discourse_reply          — reply to a topic (create a post)
//   discourse_edit_post      — edit an existing post's content
//   discourse_delete_post    — delete a post
//   discourse_like_post      — like a post
//   discourse_unlike_post    — remove a like from a post
//   discourse_get_post       — get a single post by ID
//   discourse_post_revisions — view edit history of a post
//   discourse_wiki_post      — toggle wiki mode on a post

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
                name: "discourse_reply".into(),
                description: "Reply to an existing topic. Creates a new post in the thread. Supports Markdown. Can optionally reply to a specific post within the topic.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "topic_id": { "type": "integer", "description": "The topic ID to reply to." },
                        "raw": { "type": "string", "description": "Reply content in Markdown." },
                        "reply_to_post_number": { "type": "integer", "description": "Post number within the topic to reply to (creates a threaded reply). Omit to reply to the topic generally." },
                        "whisper": { "type": "boolean", "description": "If true, create a staff whisper (only visible to staff). Default: false." }
                    },
                    "required": ["topic_id", "raw"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_edit_post".into(),
                description: "Edit an existing post's content. Requires the post_id (not the topic_id). Creates an edit revision.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "post_id": { "type": "integer", "description": "The post ID to edit." },
                        "raw": { "type": "string", "description": "New post content in Markdown." },
                        "edit_reason": { "type": "string", "description": "Reason for the edit (shown in revision history)." }
                    },
                    "required": ["post_id", "raw"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_delete_post".into(),
                description: "Delete a post by ID. The first post in a topic deletes the entire topic.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "post_id": { "type": "integer", "description": "The post ID to delete." },
                        "force_destroy": { "type": "boolean", "description": "If true, permanently destroy (no soft-delete). Admin only. Default: false." }
                    },
                    "required": ["post_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_like_post".into(),
                description: "Like a post. Equivalent to clicking the ❤️ button.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "post_id": { "type": "integer", "description": "The post ID to like." }
                    },
                    "required": ["post_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_unlike_post".into(),
                description: "Remove a like from a post.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "post_id": { "type": "integer", "description": "The post ID to unlike." }
                    },
                    "required": ["post_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_get_post".into(),
                description: "Get a single post by its ID. Returns the full content, author, likes, and metadata.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "post_id": { "type": "integer", "description": "The post ID." }
                    },
                    "required": ["post_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_post_revisions".into(),
                description: "View the edit history (revisions) of a post. Shows diffs between versions.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "post_id": { "type": "integer", "description": "The post ID." },
                        "revision": { "type": "integer", "description": "Specific revision number. Omit for latest." }
                    },
                    "required": ["post_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_wiki_post".into(),
                description: "Toggle wiki mode on a post. Wiki posts can be edited by any trust level 1+ user, making them collaborative.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "post_id": { "type": "integer", "description": "The post ID." },
                        "wiki": { "type": "boolean", "description": "true to enable wiki mode, false to disable." }
                    },
                    "required": ["post_id", "wiki"]
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
        "discourse_reply" => Some(
            exec_reply(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_edit_post" => Some(exec_edit(args, app_handle).await.map_err(|e| e.to_string())),
        "discourse_delete_post" => Some(
            exec_delete(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_like_post" => Some(
            exec_like(args, app_handle, true)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_unlike_post" => Some(
            exec_like(args, app_handle, false)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_get_post" => Some(exec_get(args, app_handle).await.map_err(|e| e.to_string())),
        "discourse_post_revisions" => Some(
            exec_revisions(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_wiki_post" => Some(exec_wiki(args, app_handle).await.map_err(|e| e.to_string())),
        _ => None,
    }
}

// ── reply to topic ─────────────────────────────────────────────────────

async fn exec_reply(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let topic_id = args["topic_id"].as_i64().ok_or("topic_id is required")?;
    let raw = args["raw"].as_str().ok_or("raw (content) is required")?;

    let mut body = json!({
        "topic_id": topic_id,
        "raw": raw
    });

    if let Some(reply_to) = args["reply_to_post_number"].as_i64() {
        body["reply_to_post_number"] = json!(reply_to);
    }
    if args["whisper"].as_bool().unwrap_or(false) {
        body["post_type"] = json!(4); // whisper
    }

    let url = format!("{}/posts.json", base_url);
    let result = discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    let post_id = result["id"].as_i64().unwrap_or(0);
    let post_number = result["post_number"].as_i64().unwrap_or(0);

    info!(
        "[discourse] Reply created: post {} in topic {}",
        post_id, topic_id
    );
    Ok(format!(
        "Reply posted!\n• Post ID: {}\n• Post #: {}\n• Topic: {}\n• URL: {}/t/{}#post_{}",
        post_id, post_number, topic_id, base_url, topic_id, post_number
    ))
}

// ── edit post ──────────────────────────────────────────────────────────

async fn exec_edit(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let post_id = args["post_id"].as_i64().ok_or("post_id is required")?;
    let raw = args["raw"].as_str().ok_or("raw (content) is required")?;

    let mut body = json!({ "post": { "raw": raw } });
    if let Some(reason) = args["edit_reason"].as_str() {
        body["post"]["edit_reason"] = json!(reason);
    }

    let url = format!("{}/posts/{}.json", base_url, post_id);
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    info!("[discourse] Edited post {}", post_id);
    Ok(format!("Post {} edited successfully.", post_id))
}

// ── delete post ────────────────────────────────────────────────────────

async fn exec_delete(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let post_id = args["post_id"].as_i64().ok_or("post_id is required")?;
    let force = args["force_destroy"].as_bool().unwrap_or(false);

    let url = if force {
        format!("{}/posts/{}.json?force_destroy=true", base_url, post_id)
    } else {
        format!("{}/posts/{}.json", base_url, post_id)
    };

    discourse_request(&client, reqwest::Method::DELETE, &url, None).await?;

    info!("[discourse] Deleted post {}", post_id);
    Ok(format!("Post {} deleted.", post_id))
}

// ── like / unlike ──────────────────────────────────────────────────────

async fn exec_like(
    args: &Value,
    app_handle: &tauri::AppHandle,
    like: bool,
) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let post_id = args["post_id"].as_i64().ok_or("post_id is required")?;

    if like {
        let body = json!({
            "id": post_id,
            "post_action_type_id": 2, // 2 = like
            "flag_topic": false
        });
        let url = format!("{}/post_actions.json", base_url);
        discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;
        info!("[discourse] Liked post {}", post_id);
        Ok(format!("Post {} liked. ❤️", post_id))
    } else {
        let url = format!(
            "{}/post_actions/{}.json?post_action_type_id=2",
            base_url, post_id
        );
        discourse_request(&client, reqwest::Method::DELETE, &url, None).await?;
        info!("[discourse] Unliked post {}", post_id);
        Ok(format!("Post {} unliked.", post_id))
    }
}

// ── get post ───────────────────────────────────────────────────────────

async fn exec_get(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let post_id = args["post_id"].as_i64().ok_or("post_id is required")?;

    let url = format!("{}/posts/{}.json", base_url, post_id);
    let p = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let author = p["username"].as_str().unwrap_or("?");
    let topic_id = p["topic_id"].as_i64().unwrap_or(0);
    let post_number = p["post_number"].as_i64().unwrap_or(0);
    let cooked = p["cooked"].as_str().unwrap_or("");
    let raw = p["raw"].as_str().unwrap_or(cooked);
    let created = p["created_at"].as_str().unwrap_or("?");
    let updated = p["updated_at"].as_str().unwrap_or("?");
    let likes = p["like_count"].as_i64().unwrap_or(0);
    let reads = p["reads"].as_i64().unwrap_or(0);
    let wiki = p["wiki"].as_bool().unwrap_or(false);
    let version = p["version"].as_i64().unwrap_or(1);

    Ok(format!(
        "**Post #{} by @{}** (post_id: {})\n\
        Topic: {} · Created: {} · Updated: {}\n\
        {} likes · {} reads · version {} {}\n\n\
        {}",
        post_number,
        author,
        post_id,
        topic_id,
        created,
        updated,
        likes,
        reads,
        version,
        if wiki { "· 📖 wiki" } else { "" },
        raw
    ))
}

// ── post revisions ─────────────────────────────────────────────────────

async fn exec_revisions(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let post_id = args["post_id"].as_i64().ok_or("post_id is required")?;
    let revision = args["revision"].as_i64();

    let url = if let Some(rev) = revision {
        format!("{}/posts/{}/revisions/{}.json", base_url, post_id, rev)
    } else {
        format!("{}/posts/{}/revisions/latest.json", base_url, post_id)
    };

    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let current_rev = data["current_revision"].as_i64().unwrap_or(1);
    let total_revs = data["previous_revision"].as_i64().map(|_| current_rev);
    let user = data["username"].as_str().unwrap_or("?");
    let created = data["created_at"].as_str().unwrap_or("?");

    let body_changes = data["body_changes"]["inline"]
        .as_str()
        .unwrap_or("(no body changes)");
    let title_changes = data["title_changes"]["inline"].as_str().unwrap_or("");

    let mut out = format!("**Revision {}** by @{} ({})\n", current_rev, user, created);
    if let Some(total) = total_revs {
        out.push_str(&format!("Total revisions: ~{}\n", total));
    }
    if !title_changes.is_empty() {
        out.push_str(&format!("\nTitle changes:\n{}\n", title_changes));
    }
    out.push_str(&format!("\nBody changes:\n{}", body_changes));

    Ok(out)
}

// ── wiki toggle ────────────────────────────────────────────────────────

async fn exec_wiki(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let post_id = args["post_id"].as_i64().ok_or("post_id is required")?;
    let wiki = args["wiki"]
        .as_bool()
        .ok_or("wiki (true/false) is required")?;

    let body = json!({ "wiki": wiki });
    let url = format!("{}/posts/{}/wiki.json", base_url, post_id);
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    let action = if wiki { "enabled" } else { "disabled" };
    info!("[discourse] Wiki {} on post {}", action, post_id);
    Ok(format!("Wiki mode {} on post {}.", action, post_id))
}
