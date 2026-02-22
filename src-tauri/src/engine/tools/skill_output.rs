// Paw Agent Engine — Skill Output tool (Phase F.2)
// Allows agents to persist structured JSON data that gets rendered
// as dashboard widgets on the Today view.

use crate::atoms::types::*;
use crate::engine::state::EngineState;
use log::info;
use tauri::Manager;

/// Valid widget types that the frontend can render.
const VALID_WIDGET_TYPES: &[&str] = &["status", "metric", "table", "log", "kv"];

pub fn definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "skill_output".into(),
                description: "Persist structured data for a dashboard widget. The data will be displayed as a card on the user's Today dashboard. Use this to show live status, metrics, tables, logs, or key-value summaries.".into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "skill_id": {
                            "type": "string",
                            "description": "ID of the skill producing this output (e.g. 'weather', 'portfolio-tracker')"
                        },
                        "widget_type": {
                            "type": "string",
                            "enum": ["status", "metric", "table", "log", "kv"],
                            "description": "Widget layout: status (icon+text), metric (big number + trend), table (rows+columns), log (timestamped entries), kv (key-value pairs)"
                        },
                        "title": {
                            "type": "string",
                            "description": "Widget card title shown on the dashboard"
                        },
                        "data": {
                            "type": "object",
                            "description": "Structured data for the widget. Shape depends on widget_type: status → {icon, text, badge}; metric → {value, unit, change, trend}; table → {columns: [...], rows: [[...]]}; log → {entries: [{time, text, level}]}; kv → {pairs: [{key, value, type}]}"
                        }
                    },
                    "required": ["skill_id", "widget_type", "title", "data"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".into(),
            function: FunctionDefinition {
                name: "delete_skill_output".into(),
                description: "Remove a skill's dashboard widget output.".into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "skill_id": {
                            "type": "string",
                            "description": "ID of the skill whose output to remove"
                        }
                    },
                    "required": ["skill_id"]
                }),
            },
        },
    ]
}

pub async fn execute(
    name: &str,
    args: &serde_json::Value,
    app_handle: &tauri::AppHandle,
    agent_id: &str,
) -> Option<Result<String, String>> {
    Some(match name {
        "skill_output" => execute_skill_output(args, app_handle, agent_id)
            .map_err(|e| e.to_string()),
        "delete_skill_output" => execute_delete_skill_output(args, app_handle, agent_id)
            .map_err(|e| e.to_string()),
        _ => return None,
    })
}

fn execute_skill_output(
    args: &serde_json::Value,
    app_handle: &tauri::AppHandle,
    agent_id: &str,
) -> Result<String, String> {
    let skill_id = args["skill_id"]
        .as_str()
        .ok_or("Missing required parameter: skill_id")?;
    let widget_type = args["widget_type"]
        .as_str()
        .ok_or("Missing required parameter: widget_type")?;
    let title = args["title"]
        .as_str()
        .ok_or("Missing required parameter: title")?;
    let data = &args["data"];

    // Validate widget type
    if !VALID_WIDGET_TYPES.contains(&widget_type) {
        return Err(format!(
            "Invalid widget_type '{}'. Must be one of: {}",
            widget_type,
            VALID_WIDGET_TYPES.join(", ")
        ));
    }

    // Validate data is an object
    if !data.is_object() {
        return Err("Parameter 'data' must be a JSON object".to_string());
    }

    let data_str = serde_json::to_string(data)
        .map_err(|e| format!("Failed to serialize data: {e}"))?;

    // Generate deterministic ID from skill_id + agent_id
    let id = format!("so-{}-{}", skill_id, agent_id);

    let state = app_handle
        .try_state::<EngineState>()
        .ok_or("Engine state not available")?;

    state
        .store
        .upsert_skill_output(&id, skill_id, agent_id, widget_type, title, &data_str)?;

    info!(
        "[engine] Skill output persisted: skill={} agent={} type={} title={}",
        skill_id, agent_id, widget_type, title
    );

    Ok(format!(
        "Dashboard widget '{}' ({}) saved. It will appear on the Today dashboard.",
        title, widget_type
    ))
}

fn execute_delete_skill_output(
    args: &serde_json::Value,
    app_handle: &tauri::AppHandle,
    agent_id: &str,
) -> Result<String, String> {
    let skill_id = args["skill_id"]
        .as_str()
        .ok_or("Missing required parameter: skill_id")?;

    let id = format!("so-{}-{}", skill_id, agent_id);

    let state = app_handle
        .try_state::<EngineState>()
        .ok_or("Engine state not available")?;

    let deleted = state.store.delete_skill_output(&id)?;

    if deleted {
        info!("[engine] Skill output deleted: skill={} agent={}", skill_id, agent_id);
        Ok(format!("Widget for skill '{}' removed from dashboard.", skill_id))
    } else {
        Ok(format!("No widget found for skill '{}' — nothing to remove.", skill_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn definitions_not_empty() {
        let defs = definitions();
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].function.name, "skill_output");
        assert_eq!(defs[1].function.name, "delete_skill_output");
    }

    #[test]
    fn valid_widget_types_complete() {
        assert!(VALID_WIDGET_TYPES.contains(&"status"));
        assert!(VALID_WIDGET_TYPES.contains(&"metric"));
        assert!(VALID_WIDGET_TYPES.contains(&"table"));
        assert!(VALID_WIDGET_TYPES.contains(&"log"));
        assert!(VALID_WIDGET_TYPES.contains(&"kv"));
    }
}
