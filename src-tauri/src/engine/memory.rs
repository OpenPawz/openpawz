// Paw Agent Engine — Memory System
// Provides long-term semantic memory using SQLite + embedding vectors.
// Supports Ollama (local) and OpenAI-compatible embedding APIs.

use crate::engine::types::*;
use crate::engine::sessions::{SessionStore, f32_vec_to_bytes};
use log::{info, warn};
use reqwest::Client;
use serde_json::{json, Value};

/// Embedding client — calls Ollama or OpenAI-compatible embedding API.
pub struct EmbeddingClient {
    client: Client,
    base_url: String,
    model: String,
}

impl EmbeddingClient {
    pub fn new(config: &MemoryConfig) -> Self {
        EmbeddingClient {
            client: Client::new(),
            base_url: config.embedding_base_url.clone(),
            model: config.embedding_model.clone(),
        }
    }

    /// Get embedding vector for a text string.
    /// Tries Ollama API format first, falls back to OpenAI format.
    pub async fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        // Try Ollama format: POST /api/embeddings
        let ollama_result = self.embed_ollama(text).await;
        if let Ok(vec) = ollama_result {
            return Ok(vec);
        }

        // Try OpenAI-compatible format: POST /v1/embeddings
        let openai_result = self.embed_openai(text).await;
        if let Ok(vec) = openai_result {
            return Ok(vec);
        }

        Err(format!(
            "Embedding failed for both Ollama and OpenAI formats. Ollama: {}, OpenAI: {}",
            ollama_result.unwrap_err(),
            openai_result.unwrap_err()
        ))
    }

    /// Ollama format: POST /api/embeddings { model, prompt }
    async fn embed_ollama(&self, text: &str) -> Result<Vec<f32>, String> {
        let url = format!("{}/api/embeddings", self.base_url.trim_end_matches('/'));
        let body = json!({
            "model": self.model,
            "prompt": text,
        });

        let resp = self.client.post(&url)
            .json(&body)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("Ollama embed request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Ollama embed {} — {}", status, text));
        }

        let v: Value = resp.json().await
            .map_err(|e| format!("Ollama embed parse error: {}", e))?;

        // Ollama returns { embedding: [f32...] }
        let embedding = v["embedding"].as_array()
            .ok_or_else(|| "No 'embedding' array in Ollama response".to_string())?;

        let vec: Vec<f32> = embedding.iter()
            .filter_map(|v| v.as_f64().map(|f| f as f32))
            .collect();

        if vec.is_empty() {
            return Err("Empty embedding vector from Ollama".into());
        }

        Ok(vec)
    }

    /// OpenAI-compatible format: POST /v1/embeddings { model, input }
    async fn embed_openai(&self, text: &str) -> Result<Vec<f32>, String> {
        let url = format!("{}/v1/embeddings", self.base_url.trim_end_matches('/'));
        let body = json!({
            "model": self.model,
            "input": text,
        });

        let resp = self.client.post(&url)
            .json(&body)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("OpenAI embed request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("OpenAI embed {} — {}", status, text));
        }

        let v: Value = resp.json().await
            .map_err(|e| format!("OpenAI embed parse error: {}", e))?;

        // OpenAI returns { data: [{ embedding: [f32...] }] }
        let embedding = v["data"][0]["embedding"].as_array()
            .ok_or_else(|| "No 'data[0].embedding' array in OpenAI response".to_string())?;

        let vec: Vec<f32> = embedding.iter()
            .filter_map(|v| v.as_f64().map(|f| f as f32))
            .collect();

        if vec.is_empty() {
            return Err("Empty embedding vector from OpenAI format".into());
        }

        Ok(vec)
    }

    /// Check if the embedding service is reachable and working.
    pub async fn test_connection(&self) -> Result<usize, String> {
        let vec = self.embed("test connection").await?;
        Ok(vec.len())
    }
}

/// Store a memory with optional embedding.
/// If embedding_client is provided, computes embedding automatically.
pub async fn store_memory(
    store: &SessionStore,
    content: &str,
    category: &str,
    importance: u8,
    embedding_client: Option<&EmbeddingClient>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();

    let embedding_bytes = if let Some(client) = embedding_client {
        match client.embed(content).await {
            Ok(vec) => {
                info!("[memory] Embedded {} dims for memory {}", vec.len(), &id[..8]);
                Some(f32_vec_to_bytes(&vec))
            }
            Err(e) => {
                warn!("[memory] Embedding failed, storing without: {}", e);
                None
            }
        }
    } else {
        None
    };

    store.store_memory(&id, content, category, importance, embedding_bytes.as_deref())?;
    info!("[memory] Stored memory {} cat={} imp={}", &id[..8], category, importance);
    Ok(id)
}

/// Search memories semantically (embedding) or by keyword fallback.
pub async fn search_memories(
    store: &SessionStore,
    query: &str,
    limit: usize,
    threshold: f64,
    embedding_client: Option<&EmbeddingClient>,
) -> Result<Vec<Memory>, String> {
    // Try semantic search first
    if let Some(client) = embedding_client {
        match client.embed(query).await {
            Ok(query_vec) => {
                let results = store.search_memories_by_embedding(&query_vec, limit, threshold)?;
                if !results.is_empty() {
                    info!("[memory] Semantic search: {} results for '{}'", results.len(), &query[..query.len().min(50)]);
                    return Ok(results);
                }
                info!("[memory] Semantic search returned 0 results, falling back to keyword");
            }
            Err(e) => {
                warn!("[memory] Embedding query failed, falling back to keyword: {}", e);
            }
        }
    }

    // Keyword fallback
    let results = store.search_memories_keyword(query, limit)?;
    info!("[memory] Keyword search: {} results for '{}'", results.len(), &query[..query.len().min(50)]);
    Ok(results)
}

/// Auto-capture: extract memorable facts from an assistant response.
/// Uses a simple heuristic approach — no LLM call needed.
/// Returns content strings suitable for memory storage.
pub fn extract_memorable_facts(user_message: &str, _assistant_response: &str) -> Vec<(String, String)> {
    // Extract facts from the conversation that are worth remembering.
    // We look for patterns that indicate personal/preference/factual information.
    let mut facts: Vec<(String, String)> = Vec::new();

    let user_lower = user_message.to_lowercase();

    // User preference patterns: "I like...", "I prefer...", "my favorite...", "I use..."
    let preference_patterns = [
        "i like ", "i love ", "i prefer ", "i use ", "i work with ",
        "my favorite ", "my name is ", "i'm ", "i am ", "i live ",
        "my job ", "i work at ", "i work as ",
    ];
    for pattern in &preference_patterns {
        if user_lower.contains(pattern) {
            // Capture the whole user message as a preference
            facts.push((user_message.to_string(), "preference".into()));
            break;
        }
    }

    // Factual statements from user: things that seem like facts about the user's environment
    let fact_patterns = [
        "my project ", "my repo ", "my app ", "the codebase ",
        "we use ", "our stack ", "our team ", "the database ",
    ];
    for pattern in &fact_patterns {
        if user_lower.contains(pattern) {
            facts.push((user_message.to_string(), "context".into()));
            break;
        }
    }

    // Instructions: "always...", "never...", "remember that..."
    let instruction_patterns = [
        "always ", "never ", "remember that ", "remember to ",
        "don't forget ", "make sure to ", "keep in mind ",
    ];
    for pattern in &instruction_patterns {
        if user_lower.contains(pattern) {
            facts.push((user_message.to_string(), "instruction".into()));
            break;
        }
    }

    facts
}
