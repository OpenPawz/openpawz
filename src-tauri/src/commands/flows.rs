// commands/flows.rs — Thin Tauri command wrappers for flow operations.
//
// Business logic lives in engine/sessions/flows.rs. This file only:
//   1. Extracts Tauri State<> from managed state
//   2. Delegates to the engine layer
//   3. Maps errors to String for the IPC boundary

use crate::engine::state::EngineState;
use crate::engine::types::{Flow, FlowRun};
use log::info;
use tauri::State;

// ── Flow Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn engine_flows_list(state: State<'_, EngineState>) -> Result<Vec<Flow>, String> {
    state.store.list_flows().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn engine_flows_get(
    state: State<'_, EngineState>,
    flow_id: String,
) -> Result<Option<Flow>, String> {
    state.store.get_flow(&flow_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn engine_flows_save(state: State<'_, EngineState>, flow: Flow) -> Result<(), String> {
    info!("[engine] Saving flow: {} ({})", flow.name, flow.id);
    state.store.save_flow(&flow).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn engine_flows_delete(state: State<'_, EngineState>, flow_id: String) -> Result<(), String> {
    info!("[engine] Deleting flow: {}", flow_id);
    state.store.delete_flow(&flow_id).map_err(|e| e.to_string())
}

// ── Flow Run Commands ──────────────────────────────────────────────────────

#[tauri::command]
pub fn engine_flow_runs_list(
    state: State<'_, EngineState>,
    flow_id: String,
    limit: Option<u32>,
) -> Result<Vec<FlowRun>, String> {
    let limit = limit.unwrap_or(50);
    state
        .store
        .list_flow_runs(&flow_id, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn engine_flow_run_create(state: State<'_, EngineState>, run: FlowRun) -> Result<(), String> {
    info!(
        "[engine] Recording flow run: {} for flow {}",
        run.id, run.flow_id
    );
    state.store.create_flow_run(&run).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn engine_flow_run_update(state: State<'_, EngineState>, run: FlowRun) -> Result<(), String> {
    state.store.update_flow_run(&run).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn engine_flow_run_delete(state: State<'_, EngineState>, run_id: String) -> Result<(), String> {
    state
        .store
        .delete_flow_run(&run_id)
        .map_err(|e| e.to_string())
}
