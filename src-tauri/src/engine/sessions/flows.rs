// engine/sessions/flows.rs — Flow & FlowRun persistence layer.
//
// Implements SessionStore methods for CRUD operations on flows
// and their execution run history.  Follows the tasks.rs pattern:
//   from_row() → manual column mapping, params![] for bind parameters,
//   EngineResult<T> for error propagation.

use super::SessionStore;
use crate::atoms::error::EngineResult;
use crate::engine::types::{Flow, FlowRun};
use rusqlite::params;

// ── Row Mapping ────────────────────────────────────────────────────────────

impl Flow {
    /// Map a row with columns (id, name, description, folder, graph_json,
    /// created_at, updated_at) → Flow.
    fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Flow {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            folder: row.get(3)?,
            graph_json: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    }
}

impl FlowRun {
    /// Map a row with columns (id, flow_id, status, duration_ms, events_json,
    /// error, started_at, finished_at) → FlowRun.
    fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(FlowRun {
            id: row.get(0)?,
            flow_id: row.get(1)?,
            status: row.get(2)?,
            duration_ms: row.get(3)?,
            events_json: row.get(4)?,
            error: row.get(5)?,
            started_at: row.get(6)?,
            finished_at: row.get(7)?,
        })
    }
}

// ── Flow CRUD ──────────────────────────────────────────────────────────────

impl SessionStore {
    /// List all flows, ordered by updated_at DESC.
    pub fn list_flows(&self) -> EngineResult<Vec<Flow>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, folder, graph_json, created_at, updated_at
             FROM flows ORDER BY updated_at DESC",
        )?;

        let flows = stmt
            .query_map([], Flow::from_row)?
            .filter_map(|r| r.ok())
            .collect();

        Ok(flows)
    }

    /// Get a single flow by ID.
    pub fn get_flow(&self, flow_id: &str) -> EngineResult<Option<Flow>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, folder, graph_json, created_at, updated_at
             FROM flows WHERE id = ?1",
        )?;

        let flow = stmt.query_row(params![flow_id], Flow::from_row).ok();
        Ok(flow)
    }

    /// Create or update a flow (upsert).
    pub fn save_flow(&self, flow: &Flow) -> EngineResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO flows (id, name, description, folder, graph_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               description = excluded.description,
               folder = excluded.folder,
               graph_json = excluded.graph_json,
               updated_at = datetime('now')",
            params![
                flow.id,
                flow.name,
                flow.description,
                flow.folder,
                flow.graph_json,
                flow.created_at,
            ],
        )?;
        Ok(())
    }

    /// Delete a flow and its run history (CASCADE).
    pub fn delete_flow(&self, flow_id: &str) -> EngineResult<()> {
        let conn = self.conn.lock();
        // Manually delete runs first (SQLite FK CASCADE requires PRAGMA foreign_keys=ON)
        conn.execute("DELETE FROM flow_runs WHERE flow_id = ?1", params![flow_id])?;
        conn.execute("DELETE FROM flows WHERE id = ?1", params![flow_id])?;
        Ok(())
    }

    // ── Flow Run CRUD ──────────────────────────────────────────────────

    /// Record a new flow run.
    pub fn create_flow_run(&self, run: &FlowRun) -> EngineResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO flow_runs (id, flow_id, status, duration_ms, events_json, error, started_at, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                run.id,
                run.flow_id,
                run.status,
                run.duration_ms,
                run.events_json,
                run.error,
                run.started_at,
                run.finished_at,
            ],
        )?;
        Ok(())
    }

    /// Update a flow run (typically to set status, duration, finished_at on completion).
    pub fn update_flow_run(&self, run: &FlowRun) -> EngineResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE flow_runs SET status=?2, duration_ms=?3, events_json=?4,
                    error=?5, finished_at=?6
             WHERE id=?1",
            params![
                run.id,
                run.status,
                run.duration_ms,
                run.events_json,
                run.error,
                run.finished_at,
            ],
        )?;
        Ok(())
    }

    /// List runs for a flow, most recent first.
    pub fn list_flow_runs(&self, flow_id: &str, limit: u32) -> EngineResult<Vec<FlowRun>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, flow_id, status, duration_ms, events_json, error, started_at, finished_at
             FROM flow_runs WHERE flow_id = ?1
             ORDER BY started_at DESC LIMIT ?2",
        )?;

        let runs = stmt
            .query_map(params![flow_id, limit], FlowRun::from_row)?
            .filter_map(|r| r.ok())
            .collect();

        Ok(runs)
    }

    /// Delete a single flow run.
    pub fn delete_flow_run(&self, run_id: &str) -> EngineResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM flow_runs WHERE id = ?1", params![run_id])?;
        Ok(())
    }
}
