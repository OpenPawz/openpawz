// discourse/users.rs — User management
//
// Tools:
//   discourse_list_users       — list users (active, new, staff, suspended)
//   discourse_get_user         — get detailed profile for a user
//   discourse_create_user      — create a new user account (admin)
//   discourse_suspend_user     — suspend a user with reason and duration
//   discourse_unsuspend_user   — lift a suspension
//   discourse_silence_user     — silence (mute) a user
//   discourse_unsilence_user   — unsilence a user
//   discourse_set_trust_level  — set a user's trust level (0-4)
//   discourse_add_to_group     — add a user to a group
//   discourse_remove_from_group — remove a user from a group
//   discourse_list_groups      — list all groups
//   discourse_send_pm          — send a private message to a user

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
                name: "discourse_list_users".into(),
                description: "List users on the forum. Filter by type: active, new, staff, suspended, blocked.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "filter": { "type": "string", "enum": ["active", "new", "staff", "suspended", "blocked"], "description": "User filter. Default: active." },
                        "page": { "type": "integer", "description": "Page number (1-based). Default: 1." },
                        "order": { "type": "string", "enum": ["created", "last_emailed", "seen", "username", "email", "trust_level"], "description": "Sort order." },
                        "asc": { "type": "boolean", "description": "Sort ascending. Default: false (descending)." }
                    }
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_get_user".into(),
                description: "Get detailed profile information for a user by username. Includes bio, trust level, stats, groups.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "username": { "type": "string", "description": "Username to look up." }
                    },
                    "required": ["username"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_create_user".into(),
                description: "Create a new user account. Requires admin API key. The user receives an activation email.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Display name." },
                        "username": { "type": "string", "description": "Username (unique, no spaces)." },
                        "email": { "type": "string", "description": "Email address." },
                        "password": { "type": "string", "description": "Password (min 10 chars by default)." },
                        "active": { "type": "boolean", "description": "If true, activate immediately (skip email confirmation). Admin only." },
                        "approved": { "type": "boolean", "description": "If true, approve immediately (skip admin approval queue). Admin only." }
                    },
                    "required": ["name", "username", "email", "password"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_suspend_user".into(),
                description: "Suspend a user for a specified duration with a reason. Suspended users cannot log in.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "user_id": { "type": "integer", "description": "User ID to suspend." },
                        "duration": { "type": "integer", "description": "Suspension duration in days." },
                        "reason": { "type": "string", "description": "Reason for suspension (shown to user)." },
                        "message": { "type": "string", "description": "Optional private message to the user." }
                    },
                    "required": ["user_id", "duration", "reason"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_unsuspend_user".into(),
                description: "Lift a user's suspension, restoring their access.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "user_id": { "type": "integer", "description": "User ID to unsuspend." }
                    },
                    "required": ["user_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_silence_user".into(),
                description: "Silence a user — they can browse but cannot post, reply, or message.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "user_id": { "type": "integer", "description": "User ID to silence." },
                        "duration": { "type": "integer", "description": "Silence duration in days (omit for indefinite)." },
                        "reason": { "type": "string", "description": "Reason for silencing." }
                    },
                    "required": ["user_id", "reason"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_unsilence_user".into(),
                description: "Unsilence a user, restoring their ability to post.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "user_id": { "type": "integer", "description": "User ID to unsilence." }
                    },
                    "required": ["user_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_set_trust_level".into(),
                description: "Set a user's trust level. Levels: 0=new, 1=basic, 2=member, 3=regular, 4=leader. Trust levels control what a user can do on the forum.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "user_id": { "type": "integer", "description": "User ID." },
                        "level": { "type": "integer", "description": "Trust level (0-4)." }
                    },
                    "required": ["user_id", "level"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_add_to_group".into(),
                description: "Add a user to a group. Groups control category permissions and can receive mass mentions.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "group_id": { "type": "integer", "description": "Group ID." },
                        "username": { "type": "string", "description": "Username to add." }
                    },
                    "required": ["group_id", "username"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_remove_from_group".into(),
                description: "Remove a user from a group.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "group_id": { "type": "integer", "description": "Group ID." },
                        "user_id": { "type": "integer", "description": "User ID to remove." }
                    },
                    "required": ["group_id", "user_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_list_groups".into(),
                description: "List all groups on the forum with member counts and visibility.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {}
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_send_pm".into(),
                description: "Send a private message (PM) to one or more users. Creates a new PM topic.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "description": "PM subject line." },
                        "raw": { "type": "string", "description": "Message body in Markdown." },
                        "target_recipients": { "type": "string", "description": "Comma-separated usernames to send to." }
                    },
                    "required": ["title", "raw", "target_recipients"]
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
        "discourse_list_users" => {
            Some(exec_list(args, app_handle).await.map_err(|e| e.to_string()))
        }
        "discourse_get_user" => Some(exec_get(args, app_handle).await.map_err(|e| e.to_string())),
        "discourse_create_user" => Some(
            exec_create(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_suspend_user" => Some(
            exec_suspend(args, app_handle, true)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_unsuspend_user" => Some(
            exec_suspend(args, app_handle, false)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_silence_user" => Some(
            exec_silence(args, app_handle, true)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_unsilence_user" => Some(
            exec_silence(args, app_handle, false)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_set_trust_level" => Some(
            exec_trust(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_add_to_group" => Some(
            exec_group_add(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_remove_from_group" => Some(
            exec_group_remove(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_list_groups" => Some(
            exec_list_groups(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_send_pm" => Some(exec_pm(args, app_handle).await.map_err(|e| e.to_string())),
        _ => None,
    }
}

// ── list users ─────────────────────────────────────────────────────────

async fn exec_list(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let filter = args["filter"].as_str().unwrap_or("active");
    let page = args["page"].as_i64().unwrap_or(1);
    let order = args["order"].as_str().unwrap_or("created");
    let asc = args["asc"].as_bool().unwrap_or(false);

    let url = format!(
        "{}/admin/users/list/{}.json?page={}&order={}&asc={}",
        base_url, filter, page, order, asc
    );
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let users = data.as_array().map(|a| a.as_slice()).unwrap_or(&[]);

    let mut lines = Vec::new();
    lines.push(format!(
        "**{} users** ({}, page {})\n",
        users.len(),
        filter,
        page
    ));

    for u in users {
        let id = u["id"].as_i64().unwrap_or(0);
        let uname = u["username"].as_str().unwrap_or("?");
        let email = u["email"].as_str().unwrap_or("?");
        let trust = u["trust_level"].as_i64().unwrap_or(0);
        let active = u["active"].as_bool().unwrap_or(false);
        let admin = u["admin"].as_bool().unwrap_or(false);
        let mod_flag = u["moderator"].as_bool().unwrap_or(false);
        let created = u["created_at"].as_str().unwrap_or("?");
        let last_seen = u["last_seen_at"].as_str().unwrap_or("never");

        let mut flags = Vec::new();
        if admin {
            flags.push("👑admin");
        }
        if mod_flag {
            flags.push("🛡️mod");
        }
        if !active {
            flags.push("⏸️inactive");
        }
        let flag_str = if flags.is_empty() {
            String::new()
        } else {
            format!(" [{}]", flags.join(", "))
        };

        lines.push(format!(
            "• **@{}** (id: {}) TL{}{}\n  {} · joined {} · last seen {}",
            uname, id, trust, flag_str, email, created, last_seen
        ));
    }

    Ok(lines.join("\n"))
}

// ── get user ───────────────────────────────────────────────────────────

async fn exec_get(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let uname = args["username"].as_str().ok_or("username is required")?;

    let url = format!("{}/u/{}.json", base_url, uname);
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;
    let u = &data["user"];

    let id = u["id"].as_i64().unwrap_or(0);
    let name = u["name"].as_str().unwrap_or("?");
    let trust = u["trust_level"].as_i64().unwrap_or(0);
    let admin = u["admin"].as_bool().unwrap_or(false);
    let mod_flag = u["moderator"].as_bool().unwrap_or(false);
    let created = u["created_at"].as_str().unwrap_or("?");
    let last_seen = u["last_seen_at"].as_str().unwrap_or("never");
    let last_posted = u["last_posted_at"].as_str().unwrap_or("never");
    let bio = u["bio_raw"].as_str().unwrap_or("(none)");
    let post_count = u["post_count"].as_i64().unwrap_or(0);
    let topic_count = u["topic_count"].as_i64().unwrap_or(0);
    let likes_given = u["like_given_count"].as_i64().unwrap_or(0);
    let likes_received = u["like_count"].as_i64().unwrap_or(0);
    let badge_count = u["badge_count"].as_i64().unwrap_or(0);

    let groups: Vec<&str> = u["groups"]
        .as_array()
        .map(|a| a.iter().filter_map(|g| g["name"].as_str()).collect())
        .unwrap_or_default();

    let mut flags = Vec::new();
    if admin {
        flags.push("admin");
    }
    if mod_flag {
        flags.push("moderator");
    }

    Ok(format!(
        "**@{}** ({}) · id: {}\n\
        Trust level: {} · {} · Joined: {} · Last seen: {}\n\
        {} posts · {} topics · {} likes given · {} likes received · {} badges\n\
        Last posted: {}\n\
        Bio: {}\n\
        Groups: {}",
        uname,
        name,
        id,
        trust,
        if flags.is_empty() {
            "member".to_string()
        } else {
            flags.join(", ")
        },
        created,
        last_seen,
        post_count,
        topic_count,
        likes_given,
        likes_received,
        badge_count,
        last_posted,
        bio,
        if groups.is_empty() {
            "(none)".to_string()
        } else {
            groups.join(", ")
        },
    ))
}

// ── create user ────────────────────────────────────────────────────────

async fn exec_create(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let name = args["name"].as_str().ok_or("name is required")?;
    let uname = args["username"].as_str().ok_or("username is required")?;
    let email = args["email"].as_str().ok_or("email is required")?;
    let password = args["password"].as_str().ok_or("password is required")?;

    let mut body = json!({
        "name": name,
        "username": uname,
        "email": email,
        "password": password
    });

    if let Some(active) = args["active"].as_bool() {
        body["active"] = json!(active);
    }
    if let Some(approved) = args["approved"].as_bool() {
        body["approved"] = json!(approved);
    }

    let url = format!("{}/users.json", base_url);
    let result = discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    let success = result["success"].as_bool().unwrap_or(false);
    let user_id = result["user_id"].as_i64().unwrap_or(0);

    if success {
        info!("[discourse] Created user @{} (id: {})", uname, user_id);
        Ok(format!(
            "User created!\n• Username: @{}\n• ID: {}\n• Profile: {}/u/{}",
            uname, user_id, base_url, uname
        ))
    } else {
        let msg = result["message"].as_str().unwrap_or("Unknown error");
        Err(format!("Failed to create user: {}", msg).into())
    }
}

// ── suspend / unsuspend ────────────────────────────────────────────────

async fn exec_suspend(
    args: &Value,
    app_handle: &tauri::AppHandle,
    suspend: bool,
) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let user_id = args["user_id"].as_i64().ok_or("user_id is required")?;

    if suspend {
        let duration = args["duration"]
            .as_i64()
            .ok_or("duration (days) is required")?;
        let reason = args["reason"].as_str().ok_or("reason is required")?;

        let mut body = json!({
            "suspend_until": format!("{}d", duration),
            "reason": reason
        });
        if let Some(msg) = args["message"].as_str() {
            body["message"] = json!(msg);
        }

        let url = format!("{}/admin/users/{}/suspend.json", base_url, user_id);
        discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

        info!(
            "[discourse] Suspended user {} for {} days",
            user_id, duration
        );
        Ok(format!(
            "User {} suspended for {} days. Reason: {}",
            user_id, duration, reason
        ))
    } else {
        let url = format!("{}/admin/users/{}/unsuspend.json", base_url, user_id);
        discourse_request(&client, reqwest::Method::PUT, &url, None).await?;

        info!("[discourse] Unsuspended user {}", user_id);
        Ok(format!("User {} unsuspended.", user_id))
    }
}

// ── silence / unsilence ────────────────────────────────────────────────

async fn exec_silence(
    args: &Value,
    app_handle: &tauri::AppHandle,
    silence: bool,
) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let user_id = args["user_id"].as_i64().ok_or("user_id is required")?;

    if silence {
        let reason = args["reason"].as_str().ok_or("reason is required")?;
        let mut body = json!({ "reason": reason });
        if let Some(dur) = args["duration"].as_i64() {
            body["silenced_till"] = json!(format!("{}d", dur));
        }

        let url = format!("{}/admin/users/{}/silence.json", base_url, user_id);
        discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

        info!("[discourse] Silenced user {}", user_id);
        Ok(format!("User {} silenced. Reason: {}", user_id, reason))
    } else {
        let url = format!("{}/admin/users/{}/unsilence.json", base_url, user_id);
        discourse_request(&client, reqwest::Method::PUT, &url, None).await?;

        info!("[discourse] Unsilenced user {}", user_id);
        Ok(format!("User {} unsilenced.", user_id))
    }
}

// ── set trust level ────────────────────────────────────────────────────

async fn exec_trust(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let user_id = args["user_id"].as_i64().ok_or("user_id is required")?;
    let level = args["level"].as_i64().ok_or("level (0-4) is required")?;

    if !(0..=4).contains(&level) {
        return Err("Trust level must be between 0 and 4".into());
    }

    let body = json!({ "level": level });
    let url = format!("{}/admin/users/{}/trust_level.json", base_url, user_id);
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    let level_name = match level {
        0 => "New User",
        1 => "Basic",
        2 => "Member",
        3 => "Regular",
        4 => "Leader",
        _ => "?",
    };

    info!("[discourse] Set user {} to TL{}", user_id, level);
    Ok(format!(
        "User {} trust level set to {} ({}).",
        user_id, level, level_name
    ))
}

// ── group add ──────────────────────────────────────────────────────────

async fn exec_group_add(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let group_id = args["group_id"].as_i64().ok_or("group_id is required")?;
    let uname = args["username"].as_str().ok_or("username is required")?;

    let body = json!({ "usernames": uname });
    let url = format!("{}/groups/{}/members.json", base_url, group_id);
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    info!("[discourse] Added @{} to group {}", uname, group_id);
    Ok(format!("@{} added to group {}.", uname, group_id))
}

// ── group remove ───────────────────────────────────────────────────────

async fn exec_group_remove(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let group_id = args["group_id"].as_i64().ok_or("group_id is required")?;
    let user_id = args["user_id"].as_i64().ok_or("user_id is required")?;

    let body = json!({ "user_id": user_id });
    let url = format!("{}/groups/{}/members.json", base_url, group_id);
    discourse_request(&client, reqwest::Method::DELETE, &url, Some(&body)).await?;

    info!(
        "[discourse] Removed user {} from group {}",
        user_id, group_id
    );
    Ok(format!("User {} removed from group {}.", user_id, group_id))
}

// ── list groups ────────────────────────────────────────────────────────

async fn exec_list_groups(_args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let url = format!("{}/groups.json", base_url);
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let groups = data["groups"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    let mut lines = Vec::new();
    lines.push(format!("**{} groups**\n", groups.len()));

    for g in groups {
        let id = g["id"].as_i64().unwrap_or(0);
        let name = g["name"].as_str().unwrap_or("?");
        let members = g["user_count"].as_i64().unwrap_or(0);
        let visibility = g["visibility_level"].as_i64().unwrap_or(0);
        let vis_str = match visibility {
            0 => "public",
            1 => "logged-in",
            2 => "members-only",
            3 => "staff-only",
            4 => "owners-only",
            _ => "?",
        };
        let automatic = g["automatic"].as_bool().unwrap_or(false);

        lines.push(format!(
            "• **{}** (id: {}) · {} members · {} {}",
            name,
            id,
            members,
            vis_str,
            if automatic { "· auto" } else { "" },
        ));
    }

    Ok(lines.join("\n"))
}

// ── send PM ────────────────────────────────────────────────────────────

async fn exec_pm(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let title = args["title"].as_str().ok_or("title is required")?;
    let raw = args["raw"].as_str().ok_or("raw (content) is required")?;
    let recipients = args["target_recipients"]
        .as_str()
        .ok_or("target_recipients (comma-separated usernames) is required")?;

    let body = json!({
        "title": title,
        "raw": raw,
        "target_recipients": recipients,
        "archetype": "private_message"
    });

    let url = format!("{}/posts.json", base_url);
    let result = discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    let topic_id = result["topic_id"].as_i64().unwrap_or(0);
    let post_id = result["id"].as_i64().unwrap_or(0);

    info!("[discourse] PM sent to {} (topic {})", recipients, topic_id);
    Ok(format!(
        "PM sent!\n• Topic ID: {}\n• Post ID: {}\n• Recipients: {}",
        topic_id, post_id, recipients
    ))
}
