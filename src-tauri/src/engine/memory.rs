// Paw Agent Engine — Memory System
// Provides long-term semantic memory using SQLite + embedding vectors.
// Uses Ollama (local) for embeddings by default — works out of the box.
// Also supports OpenAI-compatible embedding APIs.

use crate::engine::types::*;
use crate::engine::sessions::{SessionStore, f32_vec_to_bytes};
use log::{info, warn, error};
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

/// Track whether we've already tried to pull the model this session.
static MODEL_PULL_ATTEMPTED: AtomicBool = AtomicBool::new(false);

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
    /// On first failure, attempts to auto-pull the model from Ollama.
    pub async fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        // Try Ollama format first (new /api/embed endpoint, then legacy /api/embeddings)
        let ollama_result = self.embed_ollama(text).await;
        if let Ok(vec) = ollama_result {
            return Ok(vec);
        }

        let ollama_err = ollama_result.unwrap_err();

        // If model not found, try auto-pulling it (once per session)
        if (ollama_err.contains("not found") || ollama_err.contains("404") || ollama_err.contains("does not exist"))
            && !MODEL_PULL_ATTEMPTED.swap(true, Ordering::SeqCst)
        {
            info!("[memory] Model '{}' not found, attempting auto-pull...", self.model);
            match self.pull_model().await {
                Ok(()) => {
                    info!("[memory] Model '{}' pulled successfully, retrying embed", self.model);
                    let retry = self.embed_ollama(text).await;
                    if let Ok(vec) = retry {
                        return Ok(vec);
                    }
                }
                Err(e) => {
                    warn!("[memory] Auto-pull failed: {}", e);
                }
            }
        }

        // Try OpenAI-compatible format: POST /v1/embeddings
        let openai_result = self.embed_openai(text).await;
        if let Ok(vec) = openai_result {
            return Ok(vec);
        }

        Err(format!(
            "Embedding failed. Ollama: {} | OpenAI: {}",
            ollama_err,
            openai_result.unwrap_err()
        ))
    }

    /// Ollama current API: POST /api/embed { model, input } → { embeddings: [[f32...]] }
    /// Falls back to legacy: POST /api/embeddings { model, prompt } → { embedding: [f32...] }
    async fn embed_ollama(&self, text: &str) -> Result<Vec<f32>, String> {
        // ── Try new /api/embed endpoint first (Ollama 0.4+) ──
        let new_url = format!("{}/api/embed", self.base_url.trim_end_matches('/'));
        let new_body = json!({
            "model": self.model,
            "input": text,
        });

        let new_result = self.client.post(&new_url)
            .json(&new_body)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await;

        if let Ok(resp) = new_result {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<Value>().await {
                    // New format returns { embeddings: [[f32...], ...] }
                    if let Some(embeddings) = v["embeddings"].as_array() {
                        if let Some(first) = embeddings.first().and_then(|e| e.as_array()) {
                            let vec: Vec<f32> = first.iter()
                                .filter_map(|v| v.as_f64().map(|f| f as f32))
                                .collect();
                            if !vec.is_empty() {
                                return Ok(vec);
                            }
                        }
                    }
                    // Some Ollama versions return singular "embedding" even on /api/embed
                    if let Some(embedding) = v["embedding"].as_array() {
                        let vec: Vec<f32> = embedding.iter()
                            .filter_map(|v| v.as_f64().map(|f| f as f32))
                            .collect();
                        if !vec.is_empty() {
                            return Ok(vec);
                        }
                    }
                }
            } else {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                // If it's a model-not-found error, propagate it clearly
                if status.as_u16() == 404 || body.contains("not found") || body.contains("does not exist") {
                    return Err(format!("Model '{}' not found — {}", self.model, body));
                }
                // For other errors, fall through to legacy endpoint
                info!("[memory] New /api/embed returned {} — trying legacy endpoint", status);
            }
        }

        // ── Fall back to legacy /api/embeddings endpoint ──
        let legacy_url = format!("{}/api/embeddings", self.base_url.trim_end_matches('/'));
        let legacy_body = json!({
            "model": self.model,
            "prompt": text,
        });

        let resp = self.client.post(&legacy_url)
            .json(&legacy_body)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Ollama not reachable at {} — is Ollama running? Error: {}", self.base_url, e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Ollama embed {} — {}", status, text));
        }

        let v: Value = resp.json().await
            .map_err(|e| format!("Ollama embed parse error: {}", e))?;

        // Legacy format returns { embedding: [f32...] }
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

    /// Check if the embedding service is reachable and the model works.
    pub async fn test_connection(&self) -> Result<usize, String> {
        let vec = self.embed("test connection").await?;
        Ok(vec.len())
    }

    /// Check if Ollama is reachable.
    pub async fn check_ollama_running(&self) -> Result<bool, String> {
        let url = format!("{}/api/tags", self.base_url.trim_end_matches('/'));
        match self.client.get(&url)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
        {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    /// Check if the configured model is available in Ollama.
    pub async fn check_model_available(&self) -> Result<bool, String> {
        let url = format!("{}/api/tags", self.base_url.trim_end_matches('/'));
        let resp = self.client.get(&url)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| format!("Cannot reach Ollama: {}", e))?;

        if !resp.status().is_success() {
            return Err("Ollama returned an error".into());
        }

        let v: Value = resp.json().await
            .map_err(|e| format!("Parse error: {}", e))?;

        if let Some(models) = v["models"].as_array() {
            let model_base = self.model.split(':').next().unwrap_or(&self.model);
            for m in models {
                if let Some(name) = m["name"].as_str() {
                    let name_base = name.split(':').next().unwrap_or(name);
                    if name_base == model_base || name == self.model {
                        return Ok(true);
                    }
                }
                // Also check the "model" field
                if let Some(name) = m["model"].as_str() {
                    let name_base = name.split(':').next().unwrap_or(name);
                    if name_base == model_base || name == self.model {
                        return Ok(true);
                    }
                }
            }
        }
        Ok(false)
    }

    /// Pull a model from Ollama. Blocks until download completes.
    pub async fn pull_model(&self) -> Result<(), String> {
        let url = format!("{}/api/pull", self.base_url.trim_end_matches('/'));
        let body = json!({
            "name": self.model,
            "stream": false,
        });

        info!("[memory] Pulling model '{}' from Ollama (this may take a minute)...", self.model);

        let resp = self.client.post(&url)
            .json(&body)
            .timeout(std::time::Duration::from_secs(600)) // 10 min timeout for large models
            .send()
            .await
            .map_err(|e| format!("Pull request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Pull failed {} — {}", status, text));
        }

        let v: Value = resp.json().await.unwrap_or(json!({}));
        let status = v["status"].as_str().unwrap_or("unknown");
        info!("[memory] Model pull complete: {}", status);
        Ok(())
    }

    /// Pull a model from Ollama with streaming progress.
    /// Calls `on_progress` with (status, completed_bytes, total_bytes) for each update.
    pub async fn pull_model_streaming<F>(&self, mut on_progress: F) -> Result<(), String>
    where
        F: FnMut(&str, u64, u64),
    {
        let url = format!("{}/api/pull", self.base_url.trim_end_matches('/'));
        let body = json!({
            "name": self.model,
            "stream": true,
        });

        info!("[memory] Pulling model '{}' from Ollama (streaming)...", self.model);

        let resp = self.client.post(&url)
            .json(&body)
            .timeout(std::time::Duration::from_secs(600))
            .send()
            .await
            .map_err(|e| format!("Pull request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Pull failed {} — {}", status, text));
        }

        // Read streaming JSON lines
        let body_text = resp.text().await.map_err(|e| format!("Read error: {}", e))?;
        for line in body_text.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                let status = v["status"].as_str().unwrap_or("downloading");
                let completed = v["completed"].as_u64().unwrap_or(0);
                let total = v["total"].as_u64().unwrap_or(0);
                on_progress(status, completed, total);
            }
        }

        info!("[memory] Model '{}' pull complete", self.model);
        Ok(())
    }
}

/// Store a memory with embedding.
/// If embedding_client is provided, computes embedding automatically.
/// Logs clearly when embeddings succeed or fail.
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
                info!("[memory] ✓ Embedded {} dims for memory {}", vec.len(), &id[..8]);
                Some(f32_vec_to_bytes(&vec))
            }
            Err(e) => {
                error!("[memory] ✗ Embedding failed for memory {} — storing without vector: {}", &id[..8], e);
                None
            }
        }
    } else {
        warn!("[memory] No embedding client — storing memory {} without vector (semantic search won't find this)", &id[..8]);
        None
    };

    store.store_memory(&id, content, category, importance, embedding_bytes.as_deref())?;
    info!("[memory] Stored memory {} cat={} imp={} has_embedding={}",
        &id[..8], category, importance, embedding_bytes.is_some());
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
    let query_preview = &query[..query.len().min(80)];

    // Try semantic search first
    if let Some(client) = embedding_client {
        match client.embed(query).await {
            Ok(query_vec) => {
                info!("[memory] Query embedded ({} dims), searching...", query_vec.len());
                let results = store.search_memories_by_embedding(&query_vec, limit, threshold)?;
                if !results.is_empty() {
                    info!("[memory] Semantic search: {} results for '{}' (top score: {:.3})",
                        results.len(), query_preview,
                        results.first().and_then(|r| r.score).unwrap_or(0.0));
                    return Ok(results);
                }
                info!("[memory] Semantic search returned 0 results above threshold {:.2}, falling back to keyword", threshold);
            }
            Err(e) => {
                warn!("[memory] Embedding query failed, falling back to keyword search: {}", e);
            }
        }
    } else {
        info!("[memory] No embedding client available, using keyword search only");
    }

    // Keyword fallback
    let results = store.search_memories_keyword(query, limit)?;
    info!("[memory] Keyword search: {} results for '{}'", results.len(), query_preview);
    Ok(results)
}

/// Backfill embeddings for memories that don't have vectors yet.
/// Returns (success_count, fail_count).
pub async fn backfill_embeddings(
    store: &SessionStore,
    client: &EmbeddingClient,
) -> Result<(usize, usize), String> {
    let memories = store.list_memories_without_embeddings(500)?;
    if memories.is_empty() {
        info!("[memory] Backfill: all memories already have embeddings");
        return Ok((0, 0));
    }

    info!("[memory] Backfill: embedding {} memories...", memories.len());
    let mut success = 0usize;
    let mut fail = 0usize;

    for mem in &memories {
        match client.embed(&mem.content).await {
            Ok(vec) => {
                let bytes = f32_vec_to_bytes(&vec);
                if let Err(e) = store.update_memory_embedding(&mem.id, &bytes) {
                    warn!("[memory] Backfill: failed to update {} — {}", &mem.id[..8], e);
                    fail += 1;
                } else {
                    success += 1;
                }
            }
            Err(e) => {
                warn!("[memory] Backfill: embed failed for {} — {}", &mem.id[..8], e);
                fail += 1;
            }
        }
        // Small delay to avoid overwhelming Ollama
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    info!("[memory] Backfill complete: {} succeeded, {} failed", success, fail);
    Ok((success, fail))
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
