// Pawz Agent Engine — TOML Manifest Module
//
// Modular replacement for the former monolithic `toml_loader.rs`.
//
// Module layout:
//   types     — serde structs (SkillManifest, ManifestMcp, TomlSkillEntry, …)
//   parser    — parse_manifest, validate_manifest, manifest_to_definition
//   scanner   — skills_dir, scan_toml_skills, load_manifest_from_path
//   installer — install_toml_skill, uninstall_toml_skill

mod installer;
mod parser;
mod scanner;
pub(crate) mod types;

// ── Re-exports (keep crate::engine::skills::toml::* API stable) ────────────

pub use installer::{install_toml_skill, uninstall_toml_skill};
pub use parser::{manifest_to_definition, parse_category, parse_manifest, validate_manifest};
pub use scanner::{load_manifest_from_path, scan_toml_skills, skills_dir};
pub use types::{SkillManifest, TomlSkillEntry};
