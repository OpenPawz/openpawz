// Paw Agent Engine — WhatsApp Bridge (via Evolution API)
//
// Module layout:
//   config        — WhatsAppConfig, CONFIG_KEY, load/save/approve/deny/remove
//   docker        — EVOLUTION_IMAGE, CONTAINER_NAME, discover_colima_socket,
//                   ensure_docker_ready, ensure_evolution_container
//   evolution_api — create/delete/connect instance, extract_qr, send_whatsapp_message
//   webhook       — run_webhook_listener (raw TCP HTTP server)
//   messages      — handle_inbound_message
//   bridge        — statics, start_bridge, stop_bridge, get_status, run_whatsapp_bridge

pub mod bridge;
pub mod config;
pub(crate) mod docker;
pub(crate) mod evolution_api;
pub(crate) mod messages;
pub(crate) mod webhook;

// ── Re-exports (preserve crate::engine::whatsapp::* API) ─────────────

pub use bridge::{get_status, start_bridge, stop_bridge};
pub use config::{approve_user, deny_user, load_config, remove_user, save_config, WhatsAppConfig};
