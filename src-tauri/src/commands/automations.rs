// commands/automations.rs — Tauri IPC commands for automation templates
//
// Phase 2.7: activate, toggle, delete, and list automations.

use crate::engine::channels;
use serde::{Deserialize, Serialize};

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateTrigger {
    #[serde(rename = "type")]
    pub trigger_type: String,
    pub label: String,
    #[serde(default)]
    pub cron: Option<String>,
    #[serde(rename = "eventSource", default)]
    pub event_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateStep {
    #[serde(rename = "serviceId")]
    pub service_id: String,
    pub action: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub trigger: TemplateTrigger,
    pub steps: Vec<TemplateStep>,
    #[serde(rename = "requiredServices")]
    pub required_services: Vec<String>,
    pub tags: Vec<String>,
    #[serde(rename = "estimatedSetup")]
    pub estimated_setup: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveAutomation {
    pub id: String,
    #[serde(rename = "templateId", default)]
    pub template_id: Option<String>,
    pub name: String,
    pub description: String,
    pub trigger: TemplateTrigger,
    pub steps: Vec<TemplateStep>,
    pub services: Vec<String>,
    pub status: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "lastRunAt", default)]
    pub last_run_at: Option<String>,
    #[serde(rename = "lastRunResult", default)]
    pub last_run_result: Option<String>,
    #[serde(rename = "lastRunDetails", default)]
    pub last_run_details: Option<String>,
    #[serde(rename = "runCount", default)]
    pub run_count: u64,
}

// ── Storage key ────────────────────────────────────────────────────────

const STORAGE_KEY: &str = "active_automations";

fn load_automations(app_handle: &tauri::AppHandle) -> Vec<ActiveAutomation> {
    channels::load_channel_config::<Vec<ActiveAutomation>>(app_handle, STORAGE_KEY)
        .unwrap_or_default()
}

fn save_automations(
    app_handle: &tauri::AppHandle,
    automations: &[ActiveAutomation],
) -> Result<(), String> {
    channels::save_channel_config(app_handle, STORAGE_KEY, &automations.to_vec())
        .map_err(|e| e.to_string())
}

// ── Commands ───────────────────────────────────────────────────────────

/// Activate a template, creating an active automation entry.
#[tauri::command]
pub fn engine_automations_activate_template(
    app_handle: tauri::AppHandle,
    template_id: String,
    template: AutomationTemplate,
) -> Result<ActiveAutomation, String> {
    let mut automations = load_automations(&app_handle);

    let now = chrono::Utc::now().to_rfc3339();
    let auto = ActiveAutomation {
        id: format!("auto_{}_{}", template_id, now.replace([':', '-', '.'], "")),
        template_id: Some(template_id),
        name: template.name,
        description: template.description,
        trigger: template.trigger,
        steps: template.steps,
        services: template.required_services,
        status: "active".into(),
        created_at: now,
        last_run_at: None,
        last_run_result: None,
        last_run_details: None,
        run_count: 0,
    };

    automations.push(auto.clone());
    save_automations(&app_handle, &automations)?;

    Ok(auto)
}

/// List all active automations.
#[tauri::command]
pub fn engine_automations_list(
    app_handle: tauri::AppHandle,
) -> Result<Vec<ActiveAutomation>, String> {
    Ok(load_automations(&app_handle))
}

/// Pause or resume an automation.
#[tauri::command]
pub fn engine_automations_toggle(
    app_handle: tauri::AppHandle,
    automation_id: String,
    action: String,
) -> Result<(), String> {
    let mut automations = load_automations(&app_handle);
    let found = automations.iter_mut().find(|a| a.id == automation_id);
    match found {
        Some(a) => {
            a.status = match action.as_str() {
                "pause" => "paused".into(),
                "resume" => "active".into(),
                _ => return Err(format!("Unknown action: {}", action)),
            };
            save_automations(&app_handle, &automations)?;
            Ok(())
        }
        None => Err(format!("Automation not found: {}", automation_id)),
    }
}

/// Delete an automation.
#[tauri::command]
pub fn engine_automations_delete(
    app_handle: tauri::AppHandle,
    automation_id: String,
) -> Result<(), String> {
    let mut automations = load_automations(&app_handle);
    let before = automations.len();
    automations.retain(|a| a.id != automation_id);
    if automations.len() == before {
        return Err(format!("Automation not found: {}", automation_id));
    }
    save_automations(&app_handle, &automations)?;
    Ok(())
}
