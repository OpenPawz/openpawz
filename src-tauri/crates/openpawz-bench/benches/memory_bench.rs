use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use openpawz_bench::*;
use openpawz_core::atoms::engram_types::{
    ConsolidationState, EdgeType, EpisodicMemory, MemoryEdge, MemoryScope, MemorySource,
    ProceduralMemory, ProceduralStep, SemanticMemory, TieredContent,
};
use openpawz_core::engine::engram;
use openpawz_core::engine::memory;
use std::hint::black_box;
use std::sync::atomic::{AtomicU64, Ordering};

static MEM_CTR: AtomicU64 = AtomicU64::new(0);
static RELATE_CTR: AtomicU64 = AtomicU64::new(0);
static PROC_CTR: AtomicU64 = AtomicU64::new(0);
static EP_CTR: AtomicU64 = AtomicU64::new(0);
static SEM_CTR: AtomicU64 = AtomicU64::new(0);

// ── SessionStore memory methods ──────────────────────────────────────────

fn bench_store_memory(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("memory/store", |b| {
        b.iter(|| {
            let i = MEM_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .store_memory(
                    &format!("m-{}", i),
                    MEMORY_CORPUS[(i as usize) % MEMORY_CORPUS.len()],
                    "fact",
                    5,
                    None,
                    Some("bench-agent"),
                )
                .unwrap();
        });
    });
}

fn bench_search_keyword(c: &mut Criterion) {
    let store = fresh_store();
    for (i, content) in MEMORY_CORPUS.iter().enumerate() {
        store
            .store_memory(&format!("sk-{}", i), content, "fact", 5, None, Some("a"))
            .unwrap();
    }
    c.bench_function("memory/search_keyword", |b| {
        b.iter(|| {
            black_box(
                store
                    .search_memories_keyword(black_box("kubernetes"), 10)
                    .unwrap(),
            )
        });
    });
}

fn bench_search_bm25(c: &mut Criterion) {
    let store = fresh_store();
    for (i, content) in MEMORY_CORPUS.iter().enumerate() {
        store
            .store_memory(&format!("bm-{}", i), content, "fact", 5, None, Some("a"))
            .unwrap();
    }
    c.bench_function("memory/search_bm25", |b| {
        b.iter(|| {
            black_box(
                store
                    .search_memories_bm25(black_box("deployment scaling"), 10, None)
                    .unwrap(),
            )
        });
    });
}

fn bench_list_memories(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory/list");
    for &count in &[20, 100, 500] {
        let store = fresh_store();
        for i in 0..count {
            store
                .store_memory(
                    &format!("lm-{}", i),
                    MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                    "fact",
                    3,
                    None,
                    None,
                )
                .unwrap();
        }
        group.bench_with_input(BenchmarkId::from_parameter(count), &store, |b, store| {
            b.iter(|| black_box(store.list_memories(black_box(count)).unwrap().len()));
        });
    }
    group.finish();
}

fn bench_memory_stats(c: &mut Criterion) {
    let store = fresh_store();
    for (i, content) in MEMORY_CORPUS.iter().enumerate() {
        store
            .store_memory(&format!("ms-{}", i), content, "fact", 5, None, Some("a"))
            .unwrap();
    }
    c.bench_function("memory/stats", |b| {
        b.iter(|| black_box(store.memory_stats().unwrap()));
    });
}

// ── Engram graph (sync fns) ─────────────────────────────────────────────

fn bench_graph_relate(c: &mut Criterion) {
    let store = fresh_store();
    // Seed some memories for edges.
    for i in 0..50 {
        store
            .store_memory(
                &format!("gr-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                "fact",
                5,
                None,
                None,
            )
            .unwrap();
    }
    c.bench_function("graph/relate", |b| {
        b.iter(|| {
            let i = RELATE_CTR.fetch_add(1, Ordering::Relaxed);
            let a = i % 50;
            let b_idx = (i + 7) % 50;
            engram::relate(
                &store,
                &format!("gr-{}", a),
                &format!("gr-{}", b_idx),
                EdgeType::RelatedTo,
                0.8,
            )
            .unwrap();
        });
    });
}

fn bench_graph_decay(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..100 {
        store
            .store_memory(
                &format!("gd-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                "fact",
                5,
                None,
                None,
            )
            .unwrap();
    }
    c.bench_function("graph/apply_decay", |b| {
        b.iter(|| black_box(engram::apply_decay(&store, 7.0).unwrap()));
    });
}

fn bench_graph_gc(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..100 {
        store
            .store_memory(
                &format!("gc-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                "fact",
                1,
                None,
                None,
            )
            .unwrap();
    }
    c.bench_function("graph/garbage_collect", |b| {
        b.iter(|| black_box(engram::garbage_collect(&store, 0, 50, None).unwrap()));
    });
}

fn bench_graph_stats(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..50 {
        store
            .store_memory(
                &format!("gs-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                "fact",
                5,
                None,
                None,
            )
            .unwrap();
    }
    c.bench_function("graph/memory_stats", |b| {
        b.iter(|| black_box(engram::memory_stats(&store).unwrap()));
    });
}

fn bench_store_procedural(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("graph/store_procedural", |b| {
        b.iter(|| {
            let i = PROC_CTR.fetch_add(1, Ordering::Relaxed);
            let mem = ProceduralMemory {
                id: format!("proc-{}", i),
                trigger: "user asks to deploy".into(),
                steps: vec![
                    ProceduralStep {
                        description: "Run tests".into(),
                        tool_name: Some("execute_command".into()),
                        args_pattern: Some("cargo test".into()),
                        expected_outcome: None,
                    },
                    ProceduralStep {
                        description: "Build release".into(),
                        tool_name: Some("execute_command".into()),
                        args_pattern: Some("cargo build --release".into()),
                        expected_outcome: None,
                    },
                ],
                success_rate: 0.9,
                execution_count: 5,
                scope: MemoryScope {
                    global: false,
                    project_id: None,
                    squad_id: None,
                    agent_id: Some("bench-agent".into()),
                    channel: None,
                    channel_user_id: None,
                },
                created_at: now(),
                updated_at: None,
            };
            engram::store_procedural(&store, &mem).unwrap();
        });
    });
}

// ── Episodic memory CRUD ─────────────────────────────────────────────────

fn make_episodic(id: &str, content: &str) -> EpisodicMemory {
    EpisodicMemory {
        id: id.into(),
        content: TieredContent::from_text(content),
        category: "fact".into(),
        importance: 0.7,
        agent_id: "bench-agent".into(),
        session_id: "bench-session".into(),
        source: MemorySource::default(),
        consolidation_state: ConsolidationState::Fresh,
        scope: MemoryScope {
            global: false,
            project_id: None,
            squad_id: None,
            agent_id: Some("bench-agent".into()),
            channel: None,
            channel_user_id: None,
        },
        created_at: now(),
        ..Default::default()
    }
}

fn bench_episodic_store(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("episodic/store", |b| {
        b.iter(|| {
            let i = EP_CTR.fetch_add(1, Ordering::Relaxed);
            let mem = make_episodic(
                &format!("ep-{}", i),
                MEMORY_CORPUS[(i as usize) % MEMORY_CORPUS.len()],
            );
            store.engram_store_episodic(black_box(&mem)).unwrap();
        });
    });
}

fn bench_episodic_get(c: &mut Criterion) {
    let store = fresh_store();
    for (i, content) in MEMORY_CORPUS.iter().enumerate() {
        store
            .engram_store_episodic(&make_episodic(&format!("eg-{}", i), content))
            .unwrap();
    }
    c.bench_function("episodic/get", |b| {
        let mut i = 0usize;
        b.iter(|| {
            i = (i + 1) % MEMORY_CORPUS.len();
            black_box(
                store
                    .engram_get_episodic(black_box(&format!("eg-{}", i)))
                    .unwrap(),
            );
        });
    });
}

fn bench_episodic_batch_get(c: &mut Criterion) {
    let mut group = c.benchmark_group("episodic/batch_get");
    for &count in &[10, 50, 200] {
        let store = fresh_store();
        let mut ids = Vec::new();
        for i in 0..count {
            let id = format!("eb-{}", i);
            store
                .engram_store_episodic(&make_episodic(&id, MEMORY_CORPUS[i % MEMORY_CORPUS.len()]))
                .unwrap();
            ids.push(id);
        }
        group.bench_with_input(
            BenchmarkId::from_parameter(count),
            &(store, ids),
            |b, (store, ids)| {
                b.iter(|| black_box(store.engram_get_episodic_batch(black_box(ids)).unwrap()));
            },
        );
    }
    group.finish();
}

fn bench_episodic_search_bm25(c: &mut Criterion) {
    let mut group = c.benchmark_group("episodic/search_bm25");
    for &count in &[20, 100, 500] {
        let store = fresh_store();
        for i in 0..count {
            store
                .engram_store_episodic(&make_episodic(
                    &format!("esb-{}", i),
                    MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                ))
                .unwrap();
        }
        let scope = MemoryScope::default();
        group.bench_with_input(
            BenchmarkId::from_parameter(count),
            &(store, scope),
            |b, (store, scope)| {
                b.iter(|| {
                    black_box(
                        store
                            .engram_search_episodic_bm25(
                                black_box("kubernetes deployment scaling"),
                                scope,
                                10,
                            )
                            .unwrap(),
                    )
                });
            },
        );
    }
    group.finish();
}

fn bench_episodic_search_vector(c: &mut Criterion) {
    let store = fresh_store();
    let model = "bench-model";
    for (i, content) in MEMORY_CORPUS.iter().enumerate() {
        let mut mem = make_episodic(&format!("esv-{}", i), content);
        mem.embedding = Some(random_vec(384));
        mem.embedding_model = Some(model.into());
        store.engram_store_episodic(&mem).unwrap();
    }
    let query_emb = random_vec(384);
    let scope = MemoryScope::default();
    c.bench_function("episodic/search_vector", |b| {
        b.iter(|| {
            black_box(
                store
                    .engram_search_episodic_vector(black_box(&query_emb), model, &scope, 10, 0.3)
                    .unwrap(),
            )
        });
    });
}

// ── Semantic memory CRUD ─────────────────────────────────────────────────

fn bench_semantic_store(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("semantic/store", |b| {
        b.iter(|| {
            let i = SEM_CTR.fetch_add(1, Ordering::Relaxed);
            let mem = SemanticMemory {
                id: format!("sem-{}", i),
                subject: "Kubernetes".into(),
                predicate: "uses".into(),
                object: "container orchestration".into(),
                full_text: MEMORY_CORPUS[(i as usize) % MEMORY_CORPUS.len()].into(),
                category: "technology".into(),
                scope: MemoryScope::default(),
                created_at: now(),
                ..Default::default()
            };
            store.engram_store_semantic(black_box(&mem)).unwrap();
        });
    });
}

fn bench_semantic_search_bm25(c: &mut Criterion) {
    let store = fresh_store();
    for (i, content) in MEMORY_CORPUS.iter().enumerate() {
        let mem = SemanticMemory {
            id: format!("ssb-{}", i),
            subject: "tech".into(),
            predicate: "uses".into(),
            object: content
                .split_whitespace()
                .next()
                .unwrap_or("unknown")
                .into(),
            full_text: (*content).into(),
            category: "fact".into(),
            scope: MemoryScope::default(),
            created_at: now(),
            ..Default::default()
        };
        store.engram_store_semantic(&mem).unwrap();
    }
    let scope = MemoryScope::default();
    c.bench_function("semantic/search_bm25", |b| {
        b.iter(|| {
            black_box(
                store
                    .engram_search_semantic_bm25(black_box("kubernetes deployment"), &scope, 10)
                    .unwrap(),
            )
        });
    });
}

// ── Spreading activation ─────────────────────────────────────────────────

fn bench_spreading_activation(c: &mut Criterion) {
    let store = fresh_store();
    for (i, content) in MEMORY_CORPUS.iter().enumerate() {
        store
            .store_memory(&format!("sa-{}", i), content, "fact", 5, None, None)
            .unwrap();
    }
    // Create edges forming a connected graph
    for i in 0..MEMORY_CORPUS.len() - 1 {
        engram::relate(
            &store,
            &format!("sa-{}", i),
            &format!("sa-{}", i + 1),
            EdgeType::RelatedTo,
            0.8,
        )
        .unwrap();
        // Add some cross-edges
        if i + 3 < MEMORY_CORPUS.len() {
            engram::relate(
                &store,
                &format!("sa-{}", i),
                &format!("sa-{}", i + 3),
                EdgeType::SupportedBy,
                0.5,
            )
            .unwrap();
        }
    }
    let seeds = vec!["sa-0".into(), "sa-5".into()];
    c.bench_function("graph/spreading_activation", |b| {
        b.iter(|| {
            black_box(
                store
                    .engram_spreading_activation(black_box(&seeds), 0.3)
                    .unwrap(),
            )
        });
    });
}

// ── Community detection ──────────────────────────────────────────────────

fn bench_community_detection(c: &mut Criterion) {
    let store = fresh_store();
    // Create a graph with clear communities (2 clusters of 10 memories)
    for i in 0..20 {
        store
            .store_memory(
                &format!("cd-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                "fact",
                5,
                None,
                None,
            )
            .unwrap();
    }
    // Cluster A: 0-9 densely connected
    for i in 0..10 {
        for j in (i + 1)..10 {
            engram::relate(
                &store,
                &format!("cd-{}", i),
                &format!("cd-{}", j),
                EdgeType::RelatedTo,
                0.7,
            )
            .unwrap();
        }
    }
    // Cluster B: 10-19 densely connected
    for i in 10..20 {
        for j in (i + 1)..20 {
            engram::relate(
                &store,
                &format!("cd-{}", i),
                &format!("cd-{}", j),
                EdgeType::RelatedTo,
                0.6,
            )
            .unwrap();
        }
    }
    // Weak bridge between clusters
    engram::relate(&store, "cd-5", "cd-15", EdgeType::RelatedTo, 0.2).unwrap();

    c.bench_function("graph/community_detection", |b| {
        b.iter(|| black_box(engram::community_detection::detect_communities(&store).unwrap()));
    });
}

// ── Fact extraction heuristic ────────────────────────────────────────────

fn bench_extract_facts(c: &mut Criterion) {
    let user_msgs = &[
        ("preference", "I prefer dark mode and use Vim keybindings. My name is Alex."),
        ("context", "Our stack uses Kubernetes on AWS with PostgreSQL. The codebase is Rust + TypeScript."),
        ("instruction", "Always use snake_case for variable names. Never commit directly to main. Remember to run tests."),
    ];
    let assistant_response = "I've noted your preferences. I found that the Kubernetes cluster is running in us-east-1 with auto-scaling enabled. The solution is to use Helm charts for deployment management.";

    let mut group = c.benchmark_group("memory/extract_facts");
    for (label, user_msg) in user_msgs {
        group.bench_with_input(BenchmarkId::new("type", *label), user_msg, |b, user_msg| {
            b.iter(|| {
                black_box(memory::extract_memorable_facts_heuristic(
                    black_box(user_msg),
                    black_box(assistant_response),
                ))
            });
        });
    }
    group.finish();
}

// ── GC candidates listing ────────────────────────────────────────────────

fn bench_gc_candidates(c: &mut Criterion) {
    let mut group = c.benchmark_group("episodic/gc_candidates");
    for &count in &[50, 200, 1000] {
        let store = fresh_store();
        for i in 0..count {
            let mut mem = make_episodic(
                &format!("gcc-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
            );
            mem.importance = (i % 10) as f32 * 0.1;
            store.engram_store_episodic(&mem).unwrap();
        }
        group.bench_with_input(BenchmarkId::from_parameter(count), &store, |b, store| {
            b.iter(|| black_box(store.engram_list_gc_candidates(black_box(3), 50).unwrap()));
        });
    }
    group.finish();
}

criterion_group!(
    store_ops,
    bench_store_memory,
    bench_search_keyword,
    bench_search_bm25,
    bench_list_memories,
    bench_memory_stats,
);
criterion_group!(
    graph_ops,
    bench_graph_relate,
    bench_graph_decay,
    bench_graph_gc,
    bench_graph_stats,
    bench_store_procedural,
);
criterion_group!(
    episodic_ops,
    bench_episodic_store,
    bench_episodic_get,
    bench_episodic_batch_get,
    bench_episodic_search_bm25,
    bench_episodic_search_vector,
);
criterion_group!(
    semantic_ops,
    bench_semantic_store,
    bench_semantic_search_bm25,
);
// ── Content overlap (dedup hot path) ─────────────────────────────────────

fn bench_content_overlap(c: &mut Criterion) {
    let long_a = MEMORY_CORPUS[..10].join(" ");
    let long_b = MEMORY_CORPUS[5..15].join(" ");
    let pairs: Vec<(&str, &str, &str)> = vec![
        ("identical", MEMORY_CORPUS[0], MEMORY_CORPUS[0]),
        ("similar", MEMORY_CORPUS[0], MEMORY_CORPUS[4]),
        ("disjoint", MEMORY_CORPUS[1], MEMORY_CORPUS[8]),
        ("long", &long_a, &long_b),
    ];
    let mut group = c.benchmark_group("memory/content_overlap");
    for (label, a, b) in &pairs {
        group.bench_with_input(
            BenchmarkId::new("pair", *label),
            &(*a, *b),
            |bench, (a, b)| {
                bench.iter(|| black_box(memory::content_overlap(black_box(a), black_box(b))));
            },
        );
    }
    group.finish();
}

criterion_group!(
    advanced_ops,
    bench_spreading_activation,
    bench_community_detection,
    bench_extract_facts,
    bench_gc_candidates,
);
criterion_group!(dedup_ops, bench_content_overlap);

// ── Memory single-item ops ───────────────────────────────────────────────

fn bench_get_memory_by_id(c: &mut Criterion) {
    let store = fresh_store();
    for (i, content) in MEMORY_CORPUS.iter().enumerate() {
        store
            .store_memory(&format!("gm-{}", i), content, "fact", 5, None, Some("a"))
            .unwrap();
    }
    c.bench_function("memory/get_by_id", |b| {
        let mut i = 0usize;
        b.iter(|| {
            i = (i + 1) % MEMORY_CORPUS.len();
            black_box(
                store
                    .get_memory_by_id(black_box(&format!("gm-{}", i)))
                    .unwrap(),
            );
        });
    });
}

fn bench_delete_memory(c: &mut Criterion) {
    let store = fresh_store();
    static DEL_CTR: AtomicU64 = AtomicU64::new(0);
    for i in 0..5000 {
        store
            .store_memory(
                &format!("dm-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                "fact",
                3,
                None,
                None,
            )
            .unwrap();
    }
    c.bench_function("memory/delete", |b| {
        b.iter(|| {
            let i = DEL_CTR.fetch_add(1, Ordering::Relaxed);
            let _ = store.delete_memory(black_box(&format!("dm-{}", i)));
        });
    });
}

fn bench_search_bm25_scaled(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory/bm25_scaled");
    for &count in &[20, 100, 500, 2000] {
        let store = fresh_store();
        for i in 0..count {
            store
                .store_memory(
                    &format!("bms-{}", i),
                    MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                    "fact",
                    5,
                    None,
                    Some("a"),
                )
                .unwrap();
        }
        group.bench_with_input(BenchmarkId::from_parameter(count), &store, |b, store| {
            b.iter(|| {
                black_box(
                    store
                        .search_memories_bm25(black_box("kubernetes deployment scaling"), 10, None)
                        .unwrap(),
                )
            });
        });
    }
    group.finish();
}

fn bench_search_by_embedding(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..200 {
        let emb = random_vec_bytes(384);
        store
            .store_memory(
                &format!("emb-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                "fact",
                5,
                Some(&emb),
                Some("bench-agent"),
            )
            .unwrap();
    }
    let query_emb = random_vec(384);
    c.bench_function("memory/search_by_embedding_200", |b| {
        b.iter(|| {
            black_box(
                store
                    .search_memories_by_embedding(black_box(&query_emb), 10, 0.3, None)
                    .unwrap()
                    .len(),
            )
        });
    });
}

// ── Engram graph edge ops ────────────────────────────────────────────────

static EDGE_CTR: AtomicU64 = AtomicU64::new(0);

fn bench_engram_add_edge(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..50 {
        store
            .engram_store_episodic(&make_episodic(
                &format!("ae-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
            ))
            .unwrap();
    }
    c.bench_function("graph/add_edge", |b| {
        b.iter(|| {
            let i = EDGE_CTR.fetch_add(1, Ordering::Relaxed);
            let edge = MemoryEdge {
                source_id: format!("ae-{}", i % 50),
                target_id: format!("ae-{}", (i + 7) % 50),
                edge_type: EdgeType::RelatedTo,
                weight: 0.8,
                created_at: now(),
            };
            store.engram_add_edge(black_box(&edge)).unwrap();
        });
    });
}

fn bench_engram_get_edges_from(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..30 {
        store
            .engram_store_episodic(&make_episodic(
                &format!("ef-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
            ))
            .unwrap();
    }
    // Create edges from node 0 to many targets
    for i in 1..20 {
        let edge = MemoryEdge {
            source_id: "ef-0".into(),
            target_id: format!("ef-{}", i),
            edge_type: EdgeType::RelatedTo,
            weight: 0.7,
            created_at: now(),
        };
        store.engram_add_edge(&edge).unwrap();
    }
    c.bench_function("graph/get_edges_from", |b| {
        b.iter(|| {
            black_box(
                store
                    .engram_get_edges_from(black_box("ef-0"))
                    .unwrap()
                    .len(),
            )
        });
    });
}

fn bench_engram_count_edges(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..20 {
        store
            .engram_store_episodic(&make_episodic(
                &format!("ce-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
            ))
            .unwrap();
    }
    for i in 0..19 {
        let edge = MemoryEdge {
            source_id: format!("ce-{}", i),
            target_id: format!("ce-{}", i + 1),
            edge_type: EdgeType::RelatedTo,
            weight: 0.6,
            created_at: now(),
        };
        store.engram_add_edge(&edge).unwrap();
    }
    c.bench_function("graph/count_edges", |b| {
        b.iter(|| black_box(store.engram_count_edges().unwrap()));
    });
}

// ── Engram procedural search ─────────────────────────────────────────────

fn bench_engram_search_procedural(c: &mut Criterion) {
    let store = fresh_store();
    let triggers = &[
        "user asks to deploy",
        "user wants to run tests",
        "user needs database backup",
        "user asks to set up monitoring",
        "user wants to configure CI/CD",
    ];
    for (i, trigger) in triggers.iter().enumerate() {
        let mem = ProceduralMemory {
            id: format!("sp-{}", i),
            trigger: (*trigger).into(),
            steps: vec![ProceduralStep {
                description: "Execute step".into(),
                tool_name: Some("execute_command".into()),
                args_pattern: Some("cargo test".into()),
                expected_outcome: None,
            }],
            success_rate: 0.9,
            execution_count: 5,
            scope: MemoryScope::default(),
            created_at: now(),
            updated_at: None,
        };
        engram::store_procedural(&store, &mem).unwrap();
    }
    c.bench_function("procedural/search", |b| {
        b.iter(|| {
            black_box(
                store
                    .engram_search_procedural(
                        black_box("deploy application"),
                        &MemoryScope::default(),
                        5,
                    )
                    .unwrap(),
            )
        });
    });
}

// ── Engram counts ────────────────────────────────────────────────────────

fn bench_engram_counts(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..50 {
        store
            .engram_store_episodic(&make_episodic(
                &format!("cnt-{}", i),
                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
            ))
            .unwrap();
    }
    let mut group = c.benchmark_group("engram/count");
    group.bench_function("episodic", |b| {
        b.iter(|| black_box(store.engram_count_episodic(None).unwrap()));
    });
    group.bench_function("episodic_by_agent", |b| {
        b.iter(|| black_box(store.engram_count_episodic(Some("bench-agent")).unwrap()));
    });
    group.bench_function("semantic", |b| {
        b.iter(|| black_box(store.engram_count_semantic().unwrap()));
    });
    group.bench_function("procedural", |b| {
        b.iter(|| black_box(store.engram_count_procedural().unwrap()));
    });
    group.finish();
}

criterion_group!(memory_item_ops, bench_get_memory_by_id, bench_delete_memory);
criterion_group!(
    memory_search_scaled,
    bench_search_bm25_scaled,
    bench_search_by_embedding,
);
criterion_group!(
    graph_edge_ops,
    bench_engram_add_edge,
    bench_engram_get_edges_from,
    bench_engram_count_edges,
);
criterion_group!(procedural_search, bench_engram_search_procedural);
criterion_group!(engram_counts, bench_engram_counts);
criterion_main!(
    store_ops,
    graph_ops,
    episodic_ops,
    semantic_ops,
    advanced_ops,
    dedup_ops,
    memory_item_ops,
    memory_search_scaled,
    graph_edge_ops,
    procedural_search,
    engram_counts
);
