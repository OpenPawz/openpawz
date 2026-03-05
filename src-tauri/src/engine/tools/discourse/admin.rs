// discourse/admin.rs — Site administration tools
//
// Tools:
//   discourse_site_settings       — list / search site settings
//   discourse_update_setting      — update a single site setting
//   discourse_site_stats          — get forum-wide statistics
//   discourse_list_badges         — list all badges
//   discourse_grant_badge         — grant a badge to a user
//   discourse_revoke_badge        — revoke a badge from a user
//   discourse_create_badge        — create a custom badge
//   discourse_list_plugins        — list installed plugins
//   discourse_list_backups        — list available backups
//   discourse_create_backup       — start a new backup
//   discourse_list_reports        — get a report (signups, topics, posts, etc.)
//   discourse_set_site_text       — override a site text / translation string
//   discourse_create_group        — create a new group
//   discourse_update_group        — update group settings

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
                name: "discourse_site_settings".into(),
                description: "List or search site settings. Returns setting names, values, descriptions, and defaults.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "filter": { "type": "string", "description": "Filter settings by keyword (e.g. 'logo', 'title', 'email', 'theme')." },
                        "category": { "type": "string", "description": "Settings category: required, basic, login, posting, email, files, trust, security, onebox, spam, rate_limiting, developer, embedding, legal, uncategorized." }
                    }
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_update_setting".into(),
                description: "Update a single site setting by name. Use discourse_site_settings first to find the exact setting name.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "setting": { "type": "string", "description": "The exact setting name (e.g. 'title', 'site_description', 'logo_url')." },
                        "value": { "type": "string", "description": "New value for the setting." }
                    },
                    "required": ["setting", "value"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_site_stats".into(),
                description: "Get forum-wide statistics: total topics, posts, users, active users, likes, etc.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {}
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_list_badges".into(),
                description: "List all badges on the forum, including grant counts and types.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {}
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_grant_badge".into(),
                description: "Grant a badge to a user by username and badge ID.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "username": { "type": "string", "description": "Username to grant badge to." },
                        "badge_id": { "type": "integer", "description": "Badge ID (use discourse_list_badges to find)." },
                        "reason": { "type": "string", "description": "Reason for granting the badge (optional)." }
                    },
                    "required": ["username", "badge_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_revoke_badge".into(),
                description: "Revoke a specific badge grant from a user by user_badge_id.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "user_badge_id": { "type": "integer", "description": "The user_badge ID (from the badge grant, not the badge ID)." }
                    },
                    "required": ["user_badge_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_create_badge".into(),
                description: "Create a custom badge. Badges can be granted manually or via SQL query.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Badge name." },
                        "description": { "type": "string", "description": "Badge description." },
                        "badge_type_id": { "type": "integer", "description": "1=gold, 2=silver, 3=bronze." },
                        "icon": { "type": "string", "description": "Font Awesome icon name (e.g. 'fa-certificate')." },
                        "allow_title": { "type": "boolean", "description": "Allow users to use this badge as their title." },
                        "multiple_grant": { "type": "boolean", "description": "Can be granted multiple times." },
                        "listable": { "type": "boolean", "description": "Show on the public badges page." },
                        "enabled": { "type": "boolean", "description": "Badge is active. Default: true." }
                    },
                    "required": ["name", "badge_type_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_list_plugins".into(),
                description: "List all installed plugins with their versions and enabled status.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {}
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_list_backups".into(),
                description: "List available site backups with sizes and dates.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {}
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_create_backup".into(),
                description: "Start a new site backup. This runs asynchronously on the server.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "with_uploads": { "type": "boolean", "description": "Include uploads in backup. Default: false (faster)." }
                    }
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_list_reports".into(),
                description: "Get a report/dashboard metric. Reports: signups, topics, posts, visits, likes, flags, bookmarks, emails. Returns 30-day trend data.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "report_type": { "type": "string", "description": "Report type: signups, topics, posts, visits, likes, flags, bookmarks, emails, page_views, time_to_first_response." },
                        "start_date": { "type": "string", "description": "Start date (ISO 8601, e.g. '2024-01-01')." },
                        "end_date": { "type": "string", "description": "End date (ISO 8601, e.g. '2024-01-31')." }
                    },
                    "required": ["report_type"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_set_site_text".into(),
                description: "Override a site text / translation string. Use this to customize UI text like the welcome message, about page, guidelines, etc.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "text_id": { "type": "string", "description": "The translation key (e.g. 'js.topic.create', 'system_messages.welcome_user.title')." },
                        "value": { "type": "string", "description": "New text value. Supports Markdown." }
                    },
                    "required": ["text_id", "value"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_create_group".into(),
                description: "Create a new group with specified settings.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Group name (lowercase, hyphens ok)." },
                        "full_name": { "type": "string", "description": "Display name." },
                        "bio_raw": { "type": "string", "description": "Group description in Markdown." },
                        "visibility_level": { "type": "integer", "description": "0=public, 1=logged-in, 2=members, 3=staff, 4=owners." },
                        "mentionable_level": { "type": "integer", "description": "Who can @mention this group: 0=nobody, 1=only members, 2=TL3+, 3=members+TL3, 4=everyone, 99=staff." },
                        "messageable_level": { "type": "integer", "description": "Who can message this group: same levels as mentionable." },
                        "members_visibility_level": { "type": "integer", "description": "Who can see member list: same levels as visibility." }
                    },
                    "required": ["name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_update_group".into(),
                description: "Update an existing group's settings by group ID.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "group_id": { "type": "integer", "description": "Group ID." },
                        "name": { "type": "string", "description": "New group name." },
                        "full_name": { "type": "string", "description": "New display name." },
                        "bio_raw": { "type": "string", "description": "New description in Markdown." },
                        "visibility_level": { "type": "integer", "description": "0=public, 1=logged-in, 2=members, 3=staff, 4=owners." },
                        "mentionable_level": { "type": "integer", "description": "Who can @mention." },
                        "messageable_level": { "type": "integer", "description": "Who can message." }
                    },
                    "required": ["group_id"]
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
        "discourse_site_settings" => Some(
            exec_settings_list(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_update_setting" => Some(
            exec_settings_update(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_site_stats" => Some(
            exec_stats(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_list_badges" => Some(
            exec_list_badges(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_grant_badge" => Some(
            exec_grant_badge(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_revoke_badge" => Some(
            exec_revoke_badge(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_create_badge" => Some(
            exec_create_badge(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_list_plugins" => Some(
            exec_list_plugins(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_list_backups" => Some(
            exec_list_backups(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_create_backup" => Some(
            exec_create_backup(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_list_reports" => Some(
            exec_report(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_set_site_text" => Some(
            exec_set_text(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_create_group" => Some(
            exec_create_group(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_update_group" => Some(
            exec_update_group(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        _ => None,
    }
}

// ── site settings list ─────────────────────────────────────────────────

async fn exec_settings_list(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let filter = args["filter"].as_str().unwrap_or("");
    let category = args["category"].as_str().unwrap_or("");

    let mut url = format!("{}/admin/site_settings.json", base_url);
    let mut query_parts: Vec<String> = Vec::new();
    if !filter.is_empty() {
        query_parts.push(format!("filter={}", urlencoding::encode(filter)));
    }
    if !category.is_empty() {
        query_parts.push(format!("category={}", urlencoding::encode(category)));
    }
    if !query_parts.is_empty() {
        url = format!("{}?{}", url, query_parts.join("&"));
    }

    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let settings = data["site_settings"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    let mut lines = Vec::new();
    lines.push(format!("**{} settings**", settings.len()));
    if !filter.is_empty() {
        lines.push(format!("Filter: \"{}\"", filter));
    }
    lines.push(String::new());

    for s in settings.iter().take(50) {
        let setting = s["setting"].as_str().unwrap_or("?");
        let value = &s["value"];
        let desc = s["description"].as_str().unwrap_or("");
        let default_val = &s["default"];

        let val_str = match value {
            Value::String(s) => {
                if s.len() > 80 {
                    format!("{}…", &s[..80])
                } else {
                    s.clone()
                }
            }
            other => other.to_string(),
        };

        let default_str = if value != default_val {
            format!(" (default: {})", default_val)
        } else {
            String::new()
        };

        lines.push(format!("• **{}**: `{}`{}", setting, val_str, default_str));
        if !desc.is_empty() {
            lines.push(format!("  {}", desc));
        }
    }

    if settings.len() > 50 {
        lines.push(format!(
            "\n…and {} more. Use filter/category to narrow results.",
            settings.len() - 50
        ));
    }

    Ok(lines.join("\n"))
}

// ── update site setting ────────────────────────────────────────────────

async fn exec_settings_update(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let setting = args["setting"].as_str().ok_or("setting name is required")?;
    let value = args["value"].as_str().ok_or("value is required")?;

    let body = json!({ setting: value });
    let url = format!("{}/admin/site_settings/{}.json", base_url, setting);
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    info!("[discourse] Updated setting {} = {}", setting, value);
    Ok(format!("Setting '{}' updated to '{}'.", setting, value))
}

// ── site stats ─────────────────────────────────────────────────────────

async fn exec_stats(_args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let url = format!("{}/about.json", base_url);
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;
    let about = &data["about"];

    let stats = &about["stats"];
    Ok(format!(
        "**Forum Statistics**\n\
        Title: {}\n\
        Description: {}\n\
        Topics: {} · Posts: {} · Users: {}\n\
        Active users (7d): {} · Active users (30d): {}\n\
        Likes: {} · Admins: {} · Moderators: {}\n\
        Version: {}",
        about["title"].as_str().unwrap_or("?"),
        about["description"].as_str().unwrap_or("?"),
        stats["topic_count"].as_i64().unwrap_or(0),
        stats["post_count"].as_i64().unwrap_or(0),
        stats["user_count"].as_i64().unwrap_or(0),
        stats["7_days_active_users"].as_i64().unwrap_or(0),
        stats["30_days_active_users"].as_i64().unwrap_or(0),
        stats["like_count"].as_i64().unwrap_or(0),
        about["admins"].as_array().map(|a| a.len()).unwrap_or(0),
        about["moderators"].as_array().map(|a| a.len()).unwrap_or(0),
        about["version"].as_str().unwrap_or("?"),
    ))
}

// ── list badges ────────────────────────────────────────────────────────

async fn exec_list_badges(_args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let url = format!("{}/admin/badges.json", base_url);
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let badges = data["badges"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    let mut lines = Vec::new();
    lines.push(format!("**{} badges**\n", badges.len()));

    for b in badges {
        let id = b["id"].as_i64().unwrap_or(0);
        let name = b["name"].as_str().unwrap_or("?");
        let desc = b["description"].as_str().unwrap_or("");
        let badge_type = b["badge_type_id"].as_i64().unwrap_or(3);
        let grants = b["grant_count"].as_i64().unwrap_or(0);
        let enabled = b["enabled"].as_bool().unwrap_or(true);

        let tier = match badge_type {
            1 => "🥇",
            2 => "🥈",
            3 => "🥉",
            _ => "?",
        };
        let status = if !enabled { " (disabled)" } else { "" };

        lines.push(format!(
            "• {} **{}** (id: {}) — {} grants{}\n  {}",
            tier, name, id, grants, status, desc
        ));
    }

    Ok(lines.join("\n"))
}

// ── grant badge ────────────────────────────────────────────────────────

async fn exec_grant_badge(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let uname = args["username"].as_str().ok_or("username is required")?;
    let badge_id = args["badge_id"].as_i64().ok_or("badge_id is required")?;

    let mut body = json!({
        "username": uname,
        "badge_id": badge_id
    });
    if let Some(reason) = args["reason"].as_str() {
        body["reason"] = json!(reason);
    }

    let url = format!("{}/user_badges.json", base_url);
    let result = discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    let ub_id = result["user_badge"]["id"].as_i64().unwrap_or(0);

    info!("[discourse] Granted badge {} to @{}", badge_id, uname);
    Ok(format!(
        "Badge {} granted to @{} (user_badge_id: {}).",
        badge_id, uname, ub_id
    ))
}

// ── revoke badge ───────────────────────────────────────────────────────

async fn exec_revoke_badge(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let ub_id = args["user_badge_id"]
        .as_i64()
        .ok_or("user_badge_id is required")?;

    let url = format!("{}/user_badges/{}.json", base_url, ub_id);
    discourse_request(&client, reqwest::Method::DELETE, &url, None).await?;

    info!("[discourse] Revoked user_badge {}", ub_id);
    Ok(format!("Badge grant {} revoked.", ub_id))
}

// ── create badge ───────────────────────────────────────────────────────

async fn exec_create_badge(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let name = args["name"].as_str().ok_or("name is required")?;
    let badge_type_id = args["badge_type_id"]
        .as_i64()
        .ok_or("badge_type_id (1=gold, 2=silver, 3=bronze) is required")?;

    let mut body = json!({
        "name": name,
        "badge_type_id": badge_type_id
    });

    if let Some(d) = args["description"].as_str() {
        body["description"] = json!(d);
    }
    if let Some(i) = args["icon"].as_str() {
        body["icon"] = json!(i);
    }
    if let Some(v) = args["allow_title"].as_bool() {
        body["allow_title"] = json!(v);
    }
    if let Some(v) = args["multiple_grant"].as_bool() {
        body["multiple_grant"] = json!(v);
    }
    if let Some(v) = args["listable"].as_bool() {
        body["listable"] = json!(v);
    }
    if let Some(v) = args["enabled"].as_bool() {
        body["enabled"] = json!(v);
    }

    let url = format!("{}/admin/badges.json", base_url);
    let result = discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    let badge_id = result["badge"]["id"].as_i64().unwrap_or(0);
    let badge_name = result["badge"]["name"].as_str().unwrap_or(name);

    info!(
        "[discourse] Created badge '{}' (id: {})",
        badge_name, badge_id
    );
    Ok(format!(
        "Badge created!\n• Name: {}\n• ID: {}\n• Type: {}",
        badge_name,
        badge_id,
        match badge_type_id {
            1 => "Gold",
            2 => "Silver",
            3 => "Bronze",
            _ => "?",
        }
    ))
}

// ── list plugins ───────────────────────────────────────────────────────

async fn exec_list_plugins(_args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let url = format!("{}/admin/plugins.json", base_url);
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let plugins = data["plugins"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    let mut lines = Vec::new();
    lines.push(format!("**{} plugins**\n", plugins.len()));

    for p in plugins {
        let name = p["name"].as_str().unwrap_or("?");
        let version = p["version"].as_str().unwrap_or("?");
        let enabled = p["enabled_setting"].as_str().unwrap_or("");
        let is_official = p["is_official"].as_bool().unwrap_or(false);

        let tag = if is_official { " (official)" } else { "" };
        let status = if enabled.is_empty() {
            String::new()
        } else {
            format!(" · setting: {}", enabled)
        };

        lines.push(format!("• **{}** v{}{}{}", name, version, tag, status));
    }

    Ok(lines.join("\n"))
}

// ── list backups ───────────────────────────────────────────────────────

async fn exec_list_backups(_args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let url = format!("{}/admin/backups.json", base_url);
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let backups = data.as_array().map(|a| a.as_slice()).unwrap_or(&[]);

    let mut lines = Vec::new();
    lines.push(format!("**{} backups**\n", backups.len()));

    for b in backups {
        let filename = b["filename"].as_str().unwrap_or("?");
        let size = b["size"].as_f64().unwrap_or(0.0);
        let size_mb = size / 1_048_576.0;

        lines.push(format!("• **{}** · {:.1} MB", filename, size_mb));
    }

    Ok(lines.join("\n"))
}

// ── create backup ──────────────────────────────────────────────────────

async fn exec_create_backup(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let with_uploads = args["with_uploads"].as_bool().unwrap_or(false);

    let body = json!({ "with_uploads": with_uploads });
    let url = format!("{}/admin/backups.json", base_url);
    discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    info!(
        "[discourse] Backup started (with_uploads: {})",
        with_uploads
    );
    Ok(format!(
        "Backup started (with uploads: {}). It will run in the background — use discourse_list_backups to check progress.",
        with_uploads
    ))
}

// ── report ─────────────────────────────────────────────────────────────

async fn exec_report(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let report_type = args["report_type"]
        .as_str()
        .ok_or("report_type is required")?;

    let mut url = format!("{}/admin/reports/{}.json", base_url, report_type);

    let mut params = Vec::new();
    if let Some(start) = args["start_date"].as_str() {
        params.push(format!("start_date={}", urlencoding::encode(start)));
    }
    if let Some(end) = args["end_date"].as_str() {
        params.push(format!("end_date={}", urlencoding::encode(end)));
    }
    if !params.is_empty() {
        url = format!("{}?{}", url, params.join("&"));
    }

    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;
    let report = &data["report"];

    let title = report["title"].as_str().unwrap_or(report_type);
    let total = report["total"].as_i64().unwrap_or(0);
    let prev_total = report["prev_total"].as_i64();
    let trend = if let Some(prev) = prev_total {
        if total > prev {
            format!(" ↑ (prev: {})", prev)
        } else if total < prev {
            format!(" ↓ (prev: {})", prev)
        } else {
            format!(" → (prev: {})", prev)
        }
    } else {
        String::new()
    };

    let mut lines = Vec::new();
    lines.push(format!("**{}**: {}{}\n", title, total, trend));

    if let Some(data_arr) = report["data"].as_array() {
        lines.push("Recent data:".into());
        for d in data_arr.iter().rev().take(14).rev() {
            let x = d["x"].as_str().unwrap_or("?");
            let y = d["y"].as_i64().unwrap_or(0);
            let bar = "█".repeat(std::cmp::min(y as usize, 30));
            lines.push(format!("  {} │ {} {}", x, bar, y));
        }
    }

    Ok(lines.join("\n"))
}

// ── set site text ──────────────────────────────────────────────────────

async fn exec_set_text(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let text_id = args["text_id"].as_str().ok_or("text_id is required")?;
    let value = args["value"].as_str().ok_or("value is required")?;

    let body = json!({ "site_text": { "value": value } });
    let url = format!(
        "{}/admin/customize/site_texts/{}.json",
        base_url,
        urlencoding::encode(text_id)
    );
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    info!("[discourse] Updated site text: {}", text_id);
    Ok(format!("Site text '{}' updated.", text_id))
}

// ── create group ───────────────────────────────────────────────────────

async fn exec_create_group(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let name = args["name"].as_str().ok_or("name is required")?;

    let mut group = json!({ "name": name });
    if let Some(v) = args["full_name"].as_str() {
        group["full_name"] = json!(v);
    }
    if let Some(v) = args["bio_raw"].as_str() {
        group["bio_raw"] = json!(v);
    }
    if let Some(v) = args["visibility_level"].as_i64() {
        group["visibility_level"] = json!(v);
    }
    if let Some(v) = args["mentionable_level"].as_i64() {
        group["mentionable_level"] = json!(v);
    }
    if let Some(v) = args["messageable_level"].as_i64() {
        group["messageable_level"] = json!(v);
    }
    if let Some(v) = args["members_visibility_level"].as_i64() {
        group["members_visibility_level"] = json!(v);
    }

    let body = json!({ "group": group });
    let url = format!("{}/admin/groups.json", base_url);
    let result = discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    let group_id = result["basic_group"]["id"].as_i64().unwrap_or(0);

    info!("[discourse] Created group '{}' (id: {})", name, group_id);
    Ok(format!(
        "Group created!\n• Name: {}\n• ID: {}",
        name, group_id
    ))
}

// ── update group ───────────────────────────────────────────────────────

async fn exec_update_group(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let group_id = args["group_id"].as_i64().ok_or("group_id is required")?;

    let mut group = json!({});
    if let Some(v) = args["name"].as_str() {
        group["name"] = json!(v);
    }
    if let Some(v) = args["full_name"].as_str() {
        group["full_name"] = json!(v);
    }
    if let Some(v) = args["bio_raw"].as_str() {
        group["bio_raw"] = json!(v);
    }
    if let Some(v) = args["visibility_level"].as_i64() {
        group["visibility_level"] = json!(v);
    }
    if let Some(v) = args["mentionable_level"].as_i64() {
        group["mentionable_level"] = json!(v);
    }
    if let Some(v) = args["messageable_level"].as_i64() {
        group["messageable_level"] = json!(v);
    }

    let body = json!({ "group": group });
    let url = format!("{}/groups/{}.json", base_url, group_id);
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    info!("[discourse] Updated group {}", group_id);
    Ok(format!("Group {} updated.", group_id))
}
