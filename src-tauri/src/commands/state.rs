// commands/state.rs — Re-export shim.
// Canonical home is now engine/state.rs. This module re-exports
// everything so existing commands:: imports continue to compile.

pub use crate::engine::state::*;
