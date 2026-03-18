use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use openpawz_bench::*;
use openpawz_core::atoms::engram_types::EngramConfig;
use openpawz_core::engine::engram::cognitive_state::CognitiveState;
use openpawz_core::engine::engram::gated_search;
use openpawz_core::engine::engram::memory_fusion;
use openpawz_core::engine::engram::proposition;
use openpawz_core::engine::provider_registry;
use openpawz_core::engine::scc;
use openpawz_core::engine::tool_metadata;
use std::hint::black_box;

// ── Proposition decomposition ────────────────────────────────────────────

fn bench_decompose_simple(c: &mut Criterion) {
    let text = "Rust uses ownership for memory safety.";
    c.bench_function("proposition/decompose_simple", |b| {
        b.iter(|| black_box(proposition::decompose(black_box(text))));
    });
}

fn bench_decompose_compound(c: &mut Criterion) {
    let text = "Rust uses ownership for memory safety and it prevents data races at compile time. \
        The borrow checker enforces these rules, and lifetimes annotate reference scopes. \
        Additionally, smart pointers like Box and Rc provide heap allocation patterns.";
    c.bench_function("proposition/decompose_compound", |b| {
        b.iter(|| black_box(proposition::decompose(black_box(text))));
    });
}

fn bench_decompose_long(c: &mut Criterion) {
    let text = MEMORY_CORPUS.join(". ");
    c.bench_function("proposition/decompose_long", |b| {
        b.iter(|| black_box(proposition::decompose(black_box(&text))));
    });
}

// ── Memory fusion ────────────────────────────────────────────────────────

fn bench_fusion_small(c: &mut Criterion) {
    let mut group = c.benchmark_group("fusion/run");
    for &count in &[10, 50] {
        let store = fresh_store();
        for i in 0..count {
            let emb = random_vec_bytes(384);
            store
                .store_memory(
                    &format!("fus-{}", i),
                    MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                    "fact",
                    5,
                    Some(&emb),
                    Some("bench-agent"),
                )
                .unwrap();
        }
        group.bench_with_input(BenchmarkId::from_parameter(count), &store, |b, store| {
            b.iter(|| black_box(memory_fusion::run_fusion(store).unwrap()));
        });
    }
    group.finish();
}

// ── SCC extended ─────────────────────────────────────────────────────────

fn bench_compute_capability_hash(c: &mut Criterion) {
    let caps_small = vec![
        "read_file".into(),
        "execute_command".into(),
        "write_file".into(),
    ];
    let caps_large: Vec<String> = (0..50).map(|i| format!("tool_{}", i)).collect();
    let mut group = c.benchmark_group("scc/capability_hash");
    group.bench_with_input(BenchmarkId::new("count", 3), &caps_small, |b, caps| {
        b.iter(|| black_box(scc::compute_capability_hash(black_box(caps))));
    });
    group.bench_with_input(BenchmarkId::new("count", 50), &caps_large, |b, caps| {
        b.iter(|| black_box(scc::compute_capability_hash(black_box(caps))));
    });
    group.finish();
}

fn bench_compute_memory_hash(c: &mut Criterion) {
    let store = fresh_store();
    // Seed some audit entries for the hash to read
    for i in 0..50 {
        openpawz_core::engine::audit::append(
            &store,
            openpawz_core::engine::audit::AuditCategory::Memory,
            "store",
            "agent",
            "sess",
            &format!("sub-{}", i),
            None,
            true,
        )
        .unwrap();
    }
    c.bench_function("scc/memory_hash", |b| {
        b.iter(|| black_box(scc::compute_memory_hash(black_box(&store))));
    });
}

fn bench_scc_latest_certificate(c: &mut Criterion) {
    let store = fresh_store();
    let caps = vec!["tool_a".into(), "tool_b".into()];
    for _ in 0..20 {
        scc::issue_certificate(&store, "model", &caps).unwrap();
    }
    c.bench_function("scc/latest_certificate", |b| {
        b.iter(|| black_box(scc::latest_certificate(black_box(&store)).unwrap()));
    });
}

fn bench_scc_list_certificates(c: &mut Criterion) {
    let store = fresh_store();
    let caps = vec!["tool_a".into(), "tool_b".into()];
    for _ in 0..50 {
        scc::issue_certificate(&store, "model", &caps).unwrap();
    }
    c.bench_function("scc/list_certificates_50", |b| {
        b.iter(|| black_box(scc::list_certificates(black_box(&store), 50).unwrap()));
    });
}

// ── Tool metadata extended ───────────────────────────────────────────────

fn bench_tool_mutability(c: &mut Criterion) {
    let tools = &[
        ("read_file", "known_safe"),
        ("execute_command", "known_write"),
        ("custom_mcp_tool", "unknown_fallback"),
    ];
    let mut group = c.benchmark_group("tool_meta/mutability");
    for (tool, label) in tools {
        group.bench_with_input(BenchmarkId::new("tool", *label), tool, |b, tool| {
            b.iter(|| black_box(tool_metadata::mutability(black_box(tool))));
        });
    }
    group.finish();
}

fn bench_tool_worker_allowed(c: &mut Criterion) {
    let tools = &["read_file", "execute_command", "custom_mcp_tool"];
    let mut group = c.benchmark_group("tool_meta/worker_allowed");
    for tool in tools {
        group.bench_with_input(BenchmarkId::new("tool", *tool), tool, |b, tool| {
            b.iter(|| black_box(tool_metadata::worker_allowed(black_box(tool))));
        });
    }
    group.finish();
}

fn bench_tool_orchestrator_safe(c: &mut Criterion) {
    let tools = &["read_file", "execute_command", "coinbase_get_balance"];
    let mut group = c.benchmark_group("tool_meta/orchestrator_safe");
    for tool in tools {
        group.bench_with_input(BenchmarkId::new("tool", *tool), tool, |b, tool| {
            b.iter(|| black_box(tool_metadata::orchestrator_safe(black_box(tool))));
        });
    }
    group.finish();
}

fn bench_auto_approved_tools(c: &mut Criterion) {
    c.bench_function("tool_meta/auto_approved", |b| {
        b.iter(|| black_box(tool_metadata::auto_approved_tools()));
    });
}

fn bench_tool_domain_str(c: &mut Criterion) {
    let tools = &[
        "execute_command",
        "store_memory",
        "coinbase_get_balance",
        "read_file",
        "upsert_canvas_component",
    ];
    let mut group = c.benchmark_group("tool_meta/domain_str");
    for tool in tools {
        group.bench_with_input(BenchmarkId::new("tool", *tool), tool, |b, tool| {
            b.iter(|| black_box(tool_metadata::domain_str(black_box(tool))));
        });
    }
    group.finish();
}

// ── CognitiveState (per-agent runtime) ───────────────────────────────────

fn make_engram_config() -> EngramConfig {
    EngramConfig {
        sensory_buffer_size: 20,
        working_memory_capacity: 30,
        ..Default::default()
    }
}

fn bench_cognitive_push_message(c: &mut Criterion) {
    let config = make_engram_config();
    c.bench_function("cognitive/push_message", |b| {
        let mut cs = CognitiveState::new("bench-agent".into(), &config, 8000);
        let mut i = 0usize;
        b.iter(|| {
            i += 1;
            cs.push_message(
                black_box("How do I deploy to Kubernetes?"),
                black_box("You can use Helm charts with kubectl apply."),
            );
        });
    });
}

fn bench_cognitive_classify_query(c: &mut Criterion) {
    let config = make_engram_config();
    let cs = CognitiveState::new("bench-agent".into(), &config, 8000);
    let queries = &[
        ("factual", "What is the default port for PostgreSQL?"),
        ("procedural", "How do I set up SSH keys on Ubuntu?"),
        ("causal", "Why did the deploy fail last night?"),
    ];
    let mut group = c.benchmark_group("cognitive/classify_query");
    for (label, query) in queries {
        group.bench_with_input(BenchmarkId::new("type", *label), query, |b, query| {
            b.iter(|| black_box(cs.classify_query(black_box(query))));
        });
    }
    group.finish();
}

fn bench_cognitive_adapt_wm_budget(c: &mut Criterion) {
    let config = make_engram_config();
    let models = &[
        ("gpt5", "gpt-5.3"),
        ("claude", "claude-opus-4-6"),
        ("llama_small", "llama-4:8b"),
    ];
    let mut group = c.benchmark_group("cognitive/adapt_budget");
    for (label, model) in models {
        group.bench_with_input(BenchmarkId::new("model", *label), model, |b, model| {
            b.iter(|| {
                let mut cs = CognitiveState::new("bench-agent".into(), &config, 4096);
                black_box(cs.adapt_wm_budget(black_box(model)));
            });
        });
    }
    group.finish();
}

fn bench_cognitive_snapshot_restore(c: &mut Criterion) {
    let config = make_engram_config();
    let mut cs = CognitiveState::new("bench-agent".into(), &config, 8000);
    // Pre-fill working memory
    for (i, content) in MEMORY_CORPUS.iter().enumerate() {
        cs.working_memory
            .insert_recall(format!("recall-{}", i), (*content).into(), 0.8);
    }
    c.bench_function("cognitive/snapshot", |b| {
        b.iter(|| black_box(cs.snapshot_working_memory()));
    });

    let snap = cs.snapshot_working_memory();
    c.bench_function("cognitive/restore", |b| {
        b.iter(|| {
            let mut cs2 = CognitiveState::new("bench-agent".into(), &config, 8000);
            cs2.restore_working_memory(black_box(snap.clone()));
        });
    });
}

// ── Gated search (retrieval gate) ────────────────────────────────────────

fn bench_gate_extended(c: &mut Criterion) {
    let queries = &[
        ("skip_greeting", "hello"),
        ("skip_ack", "thanks"),
        ("skip_meta", "what is your name"),
        ("defer_ambiguous", "delete it"),
        ("retrieve_simple", "What port does PostgreSQL use?"),
        (
            "deep_multi_hop",
            "What is the difference between HNSW and brute-force search?",
        ),
        (
            "deep_history",
            "summarize all the deployment issues this week",
        ),
    ];
    let mut group = c.benchmark_group("gate/extended");
    for (label, query) in queries {
        group.bench_with_input(BenchmarkId::new("type", *label), query, |b, query| {
            b.iter(|| black_box(gated_search::gate_decision(black_box(query))));
        });
    }
    group.finish();
}

// ── Provider registry lookups ────────────────────────────────────────────

fn bench_provider_has(c: &mut Criterion) {
    let ids = &["github", "slack", "notion", "nonexistent_xyz"];
    let mut group = c.benchmark_group("provider/has");
    for id in ids {
        group.bench_with_input(BenchmarkId::new("service", *id), id, |b, id| {
            b.iter(|| black_box(provider_registry::has_provider(black_box(id))));
        });
    }
    group.finish();
}

fn bench_provider_registered_ids(c: &mut Criterion) {
    c.bench_function("provider/registered_ids", |b| {
        b.iter(|| black_box(provider_registry::registered_service_ids()));
    });
}

fn bench_provider_total(c: &mut Criterion) {
    c.bench_function("provider/total", |b| {
        b.iter(|| black_box(provider_registry::total_providers()));
    });
}

criterion_group!(
    proposition_group,
    bench_decompose_simple,
    bench_decompose_compound,
    bench_decompose_long,
);
criterion_group!(fusion_group, bench_fusion_small);
criterion_group!(
    scc_extended,
    bench_compute_capability_hash,
    bench_compute_memory_hash,
    bench_scc_latest_certificate,
    bench_scc_list_certificates,
);
criterion_group!(
    tool_meta_extended,
    bench_tool_mutability,
    bench_tool_worker_allowed,
    bench_tool_orchestrator_safe,
    bench_auto_approved_tools,
    bench_tool_domain_str,
);
criterion_group!(
    cognitive_ops,
    bench_cognitive_push_message,
    bench_cognitive_classify_query,
    bench_cognitive_adapt_wm_budget,
    bench_cognitive_snapshot_restore,
);
criterion_group!(gate_ops, bench_gate_extended);
criterion_group!(
    provider_ops,
    bench_provider_has,
    bench_provider_registered_ids,
    bench_provider_total,
);
criterion_main!(
    proposition_group,
    fusion_group,
    scc_extended,
    tool_meta_extended,
    cognitive_ops,
    gate_ops,
    provider_ops
);
