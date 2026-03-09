// pawz-code — config.rs
// Loads/saves ~/.pawz-code/config.toml. Creates a default on first run.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// HTTP port for the SSE server
    #[serde(default = "default_port")]
    pub port: u16,
    /// Bind address — "127.0.0.1" (safe default) or "0.0.0.0"
    #[serde(default = "default_bind")]
    pub bind: String,
    /// Bearer token required on every /chat/stream request
    pub auth_token: String,
    /// LLM provider: "anthropic" | "openai"
    #[serde(default = "default_provider")]
    pub provider: String,
    /// API key for the provider
    #[serde(default)]
    pub api_key: String,
    /// Model name (e.g. "claude-opus-4-5", "gpt-4o", "llama3")
    #[serde(default = "default_model")]
    pub model: String,
    /// Base URL override — required for OpenAI-compatible providers (Ollama, OpenRouter, etc.)
    #[serde(default)]
    pub base_url: Option<String>,
    /// Max agent loop rounds before forcing a final answer
    #[serde(default = "default_max_rounds")]
    pub max_rounds: u32,
    /// Optional workspace root injected into every system prompt
    #[serde(default)]
    pub workspace_root: Option<String>,
}

fn default_port() -> u16 {
    3941
}
fn default_bind() -> String {
    "127.0.0.1".into()
}
fn default_provider() -> String {
    "anthropic".into()
}
fn default_model() -> String {
    "claude-opus-4-5".into()
}
fn default_max_rounds() -> u32 {
    20
}

impl Config {
    pub fn config_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".pawz-code")
            .join("config.toml")
    }

    pub fn db_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".pawz-code")
            .join("memory.db")
    }

    pub fn load_or_create() -> Result<Self> {
        let path = Self::config_path();
        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            let config: Config = toml::from_str(&content)?;
            return Ok(config);
        }

        // First run: generate default config with a random auth token
        let config = Config {
            port: default_port(),
            bind: default_bind(),
            auth_token: uuid::Uuid::new_v4().to_string().replace('-', ""),
            provider: default_provider(),
            api_key: String::new(),
            model: default_model(),
            base_url: None,
            max_rounds: default_max_rounds(),
            workspace_root: None,
        };

        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(&path, toml::to_string_pretty(&config)?)?;

        eprintln!(
            "\n[pawz-code] Created config: {}\n\
             [pawz-code] Set 'api_key' and (optionally) 'workspace_root' then restart.\n\
             [pawz-code] Auth token for VS Code: {}\n",
            path.display(),
            config.auth_token
        );

        Ok(config)
    }
}
