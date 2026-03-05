// discourse/categories.rs — Category management
//
// Tools:
//   discourse_list_categories    — list all categories with subcategories
//   discourse_get_category       — get detailed info for a category
//   discourse_create_category    — create a new category
//   discourse_edit_category      — edit category name, color, description, permissions
//   discourse_delete_category    — delete an empty category
//   discourse_set_category_permissions — set read/write/create permissions for groups
//   discourse_reorder_categories — set category sort order

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
                name: "discourse_list_categories".into(),
                description: "List all categories on the Discourse forum, including subcategories, descriptions, topic counts, and colors.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "include_subcategories": { "type": "boolean", "description": "Include subcategories. Default: true." }
                    }
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_get_category".into(),
                description: "Get detailed information about a category including permissions, topic count, and recent topics.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "category_id": { "type": "integer", "description": "Category ID." },
                        "slug": { "type": "string", "description": "Category slug (alternative to ID)." }
                    }
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_create_category".into(),
                description: "Create a new category. Set name, color, and optionally make it a subcategory, set permissions, or add a description.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Category name." },
                        "color": { "type": "string", "description": "Hex color without # (e.g. '0088CC'). Default: auto." },
                        "text_color": { "type": "string", "description": "Text color hex without # (e.g. 'FFFFFF'). Default: FFFFFF." },
                        "slug": { "type": "string", "description": "URL slug. Auto-generated from name if omitted." },
                        "description": { "type": "string", "description": "Category description (shown under the name)." },
                        "parent_category_id": { "type": "integer", "description": "Parent category ID (to create as subcategory)." },
                        "allow_badges": { "type": "boolean", "description": "Allow badges in this category. Default: true." },
                        "topic_template": { "type": "string", "description": "Template text pre-filled for new topics in this category." },
                        "permissions": { "type": "object", "description": "Group permissions object, e.g. {\"everyone\": 1, \"staff\": 1}. Values: 1=see, 2=reply, 3=create." }
                    },
                    "required": ["name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_edit_category".into(),
                description: "Edit an existing category's name, color, description, slug, or parent.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "category_id": { "type": "integer", "description": "Category ID to edit." },
                        "name": { "type": "string", "description": "New name." },
                        "color": { "type": "string", "description": "New hex color." },
                        "text_color": { "type": "string", "description": "New text color hex." },
                        "slug": { "type": "string", "description": "New URL slug." },
                        "description": { "type": "string", "description": "New description." },
                        "parent_category_id": { "type": "integer", "description": "Move under a parent category (0 = top-level)." },
                        "topic_template": { "type": "string", "description": "New topic template." },
                        "permissions": { "type": "object", "description": "New group permissions. {\"group_name\": permission_level}." }
                    },
                    "required": ["category_id"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "discourse_delete_category".into(),
                description: "Delete an empty category. Fails if the category contains topics — move or delete them first.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "category_id": { "type": "integer", "description": "Category ID to delete." }
                    },
                    "required": ["category_id"]
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
        "discourse_list_categories" => {
            Some(exec_list(args, app_handle).await.map_err(|e| e.to_string()))
        }
        "discourse_get_category" => {
            Some(exec_get(args, app_handle).await.map_err(|e| e.to_string()))
        }
        "discourse_create_category" => Some(
            exec_create(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        "discourse_edit_category" => {
            Some(exec_edit(args, app_handle).await.map_err(|e| e.to_string()))
        }
        "discourse_delete_category" => Some(
            exec_delete(args, app_handle)
                .await
                .map_err(|e| e.to_string()),
        ),
        _ => None,
    }
}

// ── list categories ────────────────────────────────────────────────────

async fn exec_list(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let include_subs = args["include_subcategories"].as_bool().unwrap_or(true);
    let url = format!(
        "{}/categories.json?include_subcategories={}",
        base_url, include_subs
    );
    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;

    let categories = data["category_list"]["categories"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    let mut lines = Vec::new();
    lines.push(format!("**{} categories**\n", categories.len()));

    for cat in categories {
        let id = cat["id"].as_i64().unwrap_or(0);
        let name = cat["name"].as_str().unwrap_or("?");
        let slug = cat["slug"].as_str().unwrap_or("?");
        let color = cat["color"].as_str().unwrap_or("?");
        let desc = cat["description_text"].as_str().unwrap_or("");
        let topics = cat["topic_count"].as_i64().unwrap_or(0);
        let posts = cat["post_count"].as_i64().unwrap_or(0);

        lines.push(format!(
            "• **{}** (id: {}, slug: `{}`, color: #{})\n  {} topics · {} posts{}",
            name,
            id,
            slug,
            color,
            topics,
            posts,
            if desc.is_empty() {
                String::new()
            } else {
                format!("\n  {}", desc)
            },
        ));

        // Subcategories
        if let Some(subs) = cat["subcategory_ids"].as_array() {
            if !subs.is_empty() {
                let sub_ids: Vec<String> = subs
                    .iter()
                    .filter_map(|v| v.as_i64())
                    .map(|i| i.to_string())
                    .collect();
                lines.push(format!("  Subcategory IDs: {}", sub_ids.join(", ")));
            }
        }
    }

    Ok(lines.join("\n"))
}

// ── get category ───────────────────────────────────────────────────────

async fn exec_get(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let url = if let Some(id) = args["category_id"].as_i64() {
        format!("{}/c/{}/show.json", base_url, id)
    } else if let Some(slug) = args["slug"].as_str() {
        format!("{}/c/{}/show.json", base_url, slug)
    } else {
        return Err("Either category_id or slug is required".into());
    };

    let data = discourse_request(&client, reqwest::Method::GET, &url, None).await?;
    let cat = &data["category"];

    let id = cat["id"].as_i64().unwrap_or(0);
    let name = cat["name"].as_str().unwrap_or("?");
    let slug = cat["slug"].as_str().unwrap_or("?");
    let color = cat["color"].as_str().unwrap_or("?");
    let text_color = cat["text_color"].as_str().unwrap_or("?");
    let desc = cat["description_text"].as_str().unwrap_or("(none)");
    let topics = cat["topic_count"].as_i64().unwrap_or(0);
    let posts = cat["post_count"].as_i64().unwrap_or(0);
    let parent = cat["parent_category_id"].as_i64();
    let template = cat["topic_template"].as_str().unwrap_or("");

    let mut out = format!(
        "**{}** (id: {}, slug: `{}`)\n\
        Color: #{} (text: #{})\n\
        {} topics · {} posts\n\
        Description: {}",
        name, id, slug, color, text_color, topics, posts, desc
    );

    if let Some(pid) = parent {
        out.push_str(&format!("\nParent category ID: {}", pid));
    }
    if !template.is_empty() {
        out.push_str(&format!("\nTopic template: {}", template));
    }

    // Show group permissions if available
    if let Some(perms) = cat["group_permissions"].as_array() {
        let perm_strs: Vec<String> = perms
            .iter()
            .map(|p| {
                let group = p["group_name"].as_str().unwrap_or("?");
                let level = p["permission_type"].as_i64().unwrap_or(0);
                let perm = match level {
                    1 => "see",
                    2 => "reply",
                    3 => "create",
                    _ => "?",
                };
                format!("{}={}", group, perm)
            })
            .collect();
        out.push_str(&format!("\nPermissions: {}", perm_strs.join(", ")));
    }

    Ok(out)
}

// ── create category ────────────────────────────────────────────────────

async fn exec_create(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let name = args["name"].as_str().ok_or("name is required")?;

    let mut body = json!({
        "name": name,
        "color": args["color"].as_str().unwrap_or("0088CC"),
        "text_color": args["text_color"].as_str().unwrap_or("FFFFFF")
    });

    if let Some(slug) = args["slug"].as_str() {
        body["slug"] = json!(slug);
    }
    if let Some(desc) = args["description"].as_str() {
        body["description"] = json!(desc);
    }
    if let Some(parent) = args["parent_category_id"].as_i64() {
        body["parent_category_id"] = json!(parent);
    }
    if let Some(tmpl) = args["topic_template"].as_str() {
        body["topic_template"] = json!(tmpl);
    }
    if let Some(badges) = args["allow_badges"].as_bool() {
        body["allow_badges"] = json!(badges);
    }
    if let Some(perms) = args.get("permissions") {
        if perms.is_object() {
            body["permissions"] = perms.clone();
        }
    }

    let url = format!("{}/categories.json", base_url);
    let result = discourse_request(&client, reqwest::Method::POST, &url, Some(&body)).await?;

    let cat_id = result["category"]["id"].as_i64().unwrap_or(0);
    let cat_slug = result["category"]["slug"].as_str().unwrap_or("");

    info!("[discourse] Created category '{}' (id: {})", name, cat_id);
    Ok(format!(
        "Category created!\n• ID: {}\n• Name: {}\n• Slug: {}\n• URL: {}/c/{}/{}",
        cat_id, name, cat_slug, base_url, cat_slug, cat_id
    ))
}

// ── edit category ──────────────────────────────────────────────────────

async fn exec_edit(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let cat_id = args["category_id"]
        .as_i64()
        .ok_or("category_id is required")?;

    let mut body = json!({});
    if let Some(name) = args["name"].as_str() {
        body["name"] = json!(name);
    }
    if let Some(color) = args["color"].as_str() {
        body["color"] = json!(color);
    }
    if let Some(tc) = args["text_color"].as_str() {
        body["text_color"] = json!(tc);
    }
    if let Some(slug) = args["slug"].as_str() {
        body["slug"] = json!(slug);
    }
    if let Some(desc) = args["description"].as_str() {
        body["description"] = json!(desc);
    }
    if let Some(parent) = args["parent_category_id"].as_i64() {
        body["parent_category_id"] = json!(parent);
    }
    if let Some(tmpl) = args["topic_template"].as_str() {
        body["topic_template"] = json!(tmpl);
    }
    if let Some(perms) = args.get("permissions") {
        if perms.is_object() {
            body["permissions"] = perms.clone();
        }
    }

    let url = format!("{}/categories/{}.json", base_url, cat_id);
    discourse_request(&client, reqwest::Method::PUT, &url, Some(&body)).await?;

    info!("[discourse] Edited category {}", cat_id);
    Ok(format!("Category {} updated.", cat_id))
}

// ── delete category ────────────────────────────────────────────────────

async fn exec_delete(args: &Value, app_handle: &tauri::AppHandle) -> EngineResult<String> {
    let (base_url, api_key, username) = get_credentials(app_handle)?;
    let client = authorized_client(&api_key, &username);

    let cat_id = args["category_id"]
        .as_i64()
        .ok_or("category_id is required")?;

    let url = format!("{}/categories/{}.json", base_url, cat_id);
    discourse_request(&client, reqwest::Method::DELETE, &url, None).await?;

    info!("[discourse] Deleted category {}", cat_id);
    Ok(format!("Category {} deleted.", cat_id))
}
