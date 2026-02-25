// Integration test: Memory roundtrip (store → search → delete)

use super::test_store;

#[test]
fn store_and_list_memories() {
    let store = test_store();
    store
        .store_memory(
            "m1",
            "The capital of France is Paris",
            "facts",
            8,
            None,
            None,
        )
        .unwrap();
    store
        .store_memory(
            "m2",
            "Rust is a systems programming language",
            "tech",
            7,
            None,
            None,
        )
        .unwrap();

    let memories = store.list_memories(10).unwrap();
    assert_eq!(memories.len(), 2);
}

#[test]
fn store_memory_with_agent_scope() {
    let store = test_store();
    store
        .store_memory("m1", "Agent 1 fact", "general", 5, None, Some("agent-1"))
        .unwrap();
    store
        .store_memory("m2", "Agent 2 fact", "general", 5, None, Some("agent-2"))
        .unwrap();
    store
        .store_memory("m3", "Shared fact", "general", 5, None, None)
        .unwrap();

    // BM25 search with agent scope should find agent-1's memories + shared
    let results = store
        .search_memories_bm25("fact", 10, Some("agent-1"))
        .unwrap();
    assert!(results.iter().any(|m| m.content == "Agent 1 fact"));
}

#[test]
fn delete_memory_removes_it() {
    let store = test_store();
    store
        .store_memory("m1", "Temporary fact", "general", 5, None, None)
        .unwrap();
    store.delete_memory("m1").unwrap();
    let memories = store.list_memories(10).unwrap();
    assert!(memories.is_empty());
}

#[test]
fn memory_stats_are_accurate() {
    let store = test_store();
    let stats = store.memory_stats().unwrap();
    assert_eq!(stats.total_memories, 0);

    store
        .store_memory("m1", "Fact 1", "general", 5, None, None)
        .unwrap();
    store
        .store_memory("m2", "Fact 2", "tech", 7, None, None)
        .unwrap();

    let stats = store.memory_stats().unwrap();
    assert_eq!(stats.total_memories, 2);
}

#[test]
fn memory_stats_track_categories() {
    let store = test_store();
    store
        .store_memory("m1", "Fact 1", "general", 5, None, None)
        .unwrap();
    store
        .store_memory("m2", "Fact 2", "tech", 7, None, None)
        .unwrap();
    store
        .store_memory("m3", "Fact 3", "tech", 6, None, None)
        .unwrap();

    let stats = store.memory_stats().unwrap();
    assert_eq!(stats.categories.len(), 2);
    // "tech" should be first (highest count)
    assert_eq!(stats.categories[0].0, "tech");
    assert_eq!(stats.categories[0].1, 2);
    assert_eq!(stats.categories[1].0, "general");
    assert_eq!(stats.categories[1].1, 1);
}

#[test]
fn search_memories_bm25() {
    let store = test_store();
    store
        .store_memory(
            "m1",
            "The Eiffel Tower is in Paris France",
            "facts",
            8,
            None,
            None,
        )
        .unwrap();
    store
        .store_memory("m2", "Rust was created by Mozilla", "tech", 7, None, None)
        .unwrap();
    store
        .store_memory("m3", "Paris has great restaurants", "travel", 6, None, None)
        .unwrap();

    let results = store.search_memories_bm25("Paris", 10, None).unwrap();
    assert!(!results.is_empty());
    // All results should contain "Paris"
    for m in &results {
        assert!(m.content.to_lowercase().contains("paris"));
    }
}

#[test]
fn search_memories_keyword_fallback() {
    let store = test_store();
    store
        .store_memory(
            "m1",
            "Python is great for data science",
            "tech",
            7,
            None,
            None,
        )
        .unwrap();
    store
        .store_memory(
            "m2",
            "JavaScript runs in the browser",
            "tech",
            7,
            None,
            None,
        )
        .unwrap();
    store
        .store_memory("m3", "The weather is nice today", "general", 3, None, None)
        .unwrap();

    let results = store.search_memories_keyword("browser", 10).unwrap();
    assert_eq!(results.len(), 1);
    assert!(results[0].content.contains("browser"));
}

#[test]
fn store_memory_upserts_on_same_id() {
    let store = test_store();
    store
        .store_memory("m1", "Original content", "general", 5, None, None)
        .unwrap();
    store
        .store_memory("m1", "Updated content", "general", 8, None, None)
        .unwrap();

    let memories = store.list_memories(10).unwrap();
    assert_eq!(memories.len(), 1);
    assert_eq!(memories[0].content, "Updated content");
    assert_eq!(memories[0].importance, 8);
}

#[test]
fn list_memories_without_embeddings() {
    let store = test_store();
    store
        .store_memory("m1", "No embedding", "general", 5, None, None)
        .unwrap();
    // Store one with a dummy embedding
    let dummy_embedding = vec![0u8; 16];
    store
        .store_memory(
            "m2",
            "Has embedding",
            "general",
            5,
            Some(&dummy_embedding),
            None,
        )
        .unwrap();

    let without = store.list_memories_without_embeddings(10).unwrap();
    assert_eq!(without.len(), 1);
    assert_eq!(without[0].content, "No embedding");
}

#[test]
fn update_memory_embedding() {
    let store = test_store();
    store
        .store_memory("m1", "Some memory", "general", 5, None, None)
        .unwrap();

    // Initially no embedding
    let without = store.list_memories_without_embeddings(10).unwrap();
    assert_eq!(without.len(), 1);

    // Add embedding via backfill
    let dummy = vec![0u8; 16];
    store.update_memory_embedding("m1", &dummy).unwrap();

    // Should no longer appear in without-embeddings list
    let without = store.list_memories_without_embeddings(10).unwrap();
    assert!(without.is_empty());
}
