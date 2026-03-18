use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use openpawz_bench::*;
use openpawz_core::atoms::engram_types::{HybridSearchConfig, RerankStrategy, TokenizerType};

use openpawz_core::engine::engram::anticipatory::{self, TopicPredictor};
use openpawz_core::engine::engram::entity_tracking;
use openpawz_core::engine::engram::gated_search;
use openpawz_core::engine::engram::hnsw::HnswIndex;
use openpawz_core::engine::engram::hybrid_search::weighted_rrf_fuse;
use openpawz_core::engine::engram::intent_classifier;
use openpawz_core::engine::engram::metadata_inference;
use openpawz_core::engine::engram::model_caps;
use openpawz_core::engine::engram::projection;
use openpawz_core::engine::engram::recall_tuner;
use openpawz_core::engine::engram::reranking;
use openpawz_core::engine::engram::retrieval_quality;
use openpawz_core::engine::engram::temporal_search;
use openpawz_core::engine::engram::SensoryBuffer;
use openpawz_core::engine::engram::{
    build_tree, pack_with_fallback, rerank_results, resolve_hybrid_weight, score_affect,
    select_level, Tokenizer, WorkingMemory,
};
use std::hint::black_box;

const DIMS: usize = 384;

// ── HNSW ─────────────────────────────────────────────────────────────────

fn bench_hnsw_insert(c: &mut Criterion) {
    let mut group = c.benchmark_group("hnsw/insert");
    group.sample_size(10); // Large inserts are slow; reduce samples for stable CI
    for &n in &[100, 500, 2000] {
        group.bench_with_input(BenchmarkId::from_parameter(n), &n, |b, &n| {
            b.iter_with_setup(
                || HnswIndex::new(),
                |mut idx| {
                    for i in 0..n {
                        idx.insert(&format!("v-{}", i), random_vec(DIMS));
                    }
                    black_box(idx.len());
                },
            );
        });
    }
    group.finish();
}

fn bench_hnsw_search(c: &mut Criterion) {
    let mut group = c.benchmark_group("hnsw/search");
    for &n in &[100, 1000, 5000] {
        let mut idx = HnswIndex::new();
        for i in 0..n {
            idx.insert(&format!("v-{}", i), random_vec(DIMS));
        }
        group.bench_with_input(BenchmarkId::from_parameter(n), &idx, |b, idx| {
            let q = random_vec(DIMS);
            b.iter(|| black_box(idx.search(black_box(&q), 10, 0.3)));
        });
    }
    group.finish();
}

fn bench_hnsw_vs_brute_force(c: &mut Criterion) {
    let n = 1000;
    let mut hnsw = HnswIndex::new();
    let mut vecs: Vec<Vec<f32>> = Vec::with_capacity(n);
    for i in 0..n {
        let v = random_vec(DIMS);
        hnsw.insert(&format!("v-{}", i), v.clone());
        vecs.push(v);
    }
    let query = random_vec(DIMS);

    let mut group = c.benchmark_group("hnsw/vs_brute_force_1k");

    group.bench_function("hnsw_k10", |b| {
        b.iter(|| black_box(hnsw.search(black_box(&query), 10, 0.0)));
    });

    group.bench_function("brute_force_k10", |b| {
        b.iter(|| {
            let mut scored: Vec<(usize, f64)> = vecs
                .iter()
                .enumerate()
                .map(|(i, v)| (i, cosine_sim(black_box(&query), v)))
                .collect();
            scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            scored.truncate(10);
            black_box(scored.len())
        });
    });

    group.finish();
}

#[inline]
fn cosine_sim(a: &[f32], b: &[f32]) -> f64 {
    let (mut dot, mut na, mut nb) = (0.0f64, 0.0f64, 0.0f64);
    for (x, y) in a.iter().zip(b.iter()) {
        let (xf, yf) = (*x as f64, *y as f64);
        dot += xf * yf;
        na += xf * xf;
        nb += yf * yf;
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom < 1e-12 {
        0.0
    } else {
        dot / denom
    }
}

// ── Reranking ────────────────────────────────────────────────────────────

fn bench_rerank_rrf(c: &mut Criterion) {
    let candidates: Vec<_> = MEMORY_CORPUS
        .iter()
        .enumerate()
        .map(|(i, c)| make_retrieved_memory(&format!("rr-{}", i), c, 0.5 + (i as f32 * 0.02)))
        .collect();
    c.bench_function("reranking/rrf", |b| {
        b.iter(|| {
            black_box(rerank_results(
                black_box(&candidates),
                "deployment",
                None,
                RerankStrategy::RRF,
                0.5,
            ))
        });
    });
}

fn bench_rerank_mmr(c: &mut Criterion) {
    let candidates: Vec<_> = MEMORY_CORPUS
        .iter()
        .enumerate()
        .map(|(i, c)| make_retrieved_memory(&format!("rm-{}", i), c, 0.5 + (i as f32 * 0.02)))
        .collect();
    let query_emb = random_vec(DIMS);
    c.bench_function("reranking/mmr", |b| {
        b.iter(|| {
            black_box(rerank_results(
                black_box(&candidates),
                "deployment",
                Some(&query_emb),
                RerankStrategy::MMR,
                0.7,
            ))
        });
    });
}

// ── Hybrid search helpers ────────────────────────────────────────────────

fn bench_resolve_hybrid_weight(c: &mut Criterion) {
    let config = HybridSearchConfig::default();
    c.bench_function("hybrid/resolve_weight", |b| {
        b.iter(|| {
            black_box(resolve_hybrid_weight(
                black_box("what is kubernetes scaling strategy"),
                black_box(&config),
            ))
        });
    });
}

fn bench_weighted_rrf_fuse(c: &mut Criterion) {
    let bm25: Vec<String> = (0..50).map(|i| format!("id-{}", i)).collect();
    let vec_ids: Vec<String> = (0..50).rev().map(|i| format!("id-{}", i)).collect();
    c.bench_function("hybrid/weighted_rrf_fuse", |b| {
        b.iter(|| black_box(weighted_rrf_fuse(&bm25, &vec_ids, 0.3, 60.0)));
    });
}

// ── Abstraction tree ─────────────────────────────────────────────────────

fn bench_build_tree(c: &mut Criterion) {
    let tok = Tokenizer::heuristic();
    let memories: Vec<_> = MEMORY_CORPUS
        .iter()
        .enumerate()
        .map(|(i, c)| make_retrieved_memory(&format!("at-{}", i), c, 0.5 + (i as f32 * 0.02)))
        .collect();
    c.bench_function("abstraction/build_tree", |b| {
        b.iter(|| black_box(build_tree(black_box(&memories), &tok)));
    });
}

fn bench_pack_with_fallback(c: &mut Criterion) {
    let tok = Tokenizer::heuristic();
    let memories: Vec<_> = MEMORY_CORPUS
        .iter()
        .enumerate()
        .map(|(i, c)| make_retrieved_memory(&format!("pf-{}", i), c, 0.5 + (i as f32 * 0.02)))
        .collect();
    let tree = build_tree(&memories, &tok);
    c.bench_function("abstraction/pack_with_fallback", |b| {
        b.iter(|| black_box(pack_with_fallback(black_box(&tree), 2048)));
    });
}

fn bench_select_level(c: &mut Criterion) {
    let tok = Tokenizer::heuristic();
    let memories: Vec<_> = MEMORY_CORPUS
        .iter()
        .enumerate()
        .map(|(i, c)| make_retrieved_memory(&format!("sl-{}", i), c, 0.5 + (i as f32 * 0.02)))
        .collect();
    let tree = build_tree(&memories, &tok);
    c.bench_function("abstraction/select_level", |b| {
        b.iter(|| black_box(select_level(black_box(&tree), 1024)));
    });
}

// ── Tokenizer ────────────────────────────────────────────────────────────

fn bench_count_tokens(c: &mut Criterion) {
    let mut group = c.benchmark_group("tokenizer/count_tokens");
    for kind in &[
        TokenizerType::Cl100kBase,
        TokenizerType::O200kBase,
        TokenizerType::Heuristic,
    ] {
        let tok = Tokenizer::new(*kind);
        let text = MEMORY_CORPUS.join(" ").repeat(10);
        group.bench_with_input(
            BenchmarkId::new("kind", format!("{:?}", kind)),
            &(tok, text),
            |b, (tok, text)| {
                b.iter(|| black_box(tok.count_tokens(black_box(text))));
            },
        );
    }
    group.finish();
}

fn bench_truncate_to_budget(c: &mut Criterion) {
    let tok = Tokenizer::heuristic();
    let text = MEMORY_CORPUS.join("\n").repeat(20);
    c.bench_function("tokenizer/truncate_to_budget", |b| {
        b.iter(|| black_box(tok.truncate_to_budget(black_box(&text), 512)));
    });
}

// ── Sensory buffer ───────────────────────────────────────────────────────

fn bench_sensory_push(c: &mut Criterion) {
    let tok = Tokenizer::heuristic();
    c.bench_function("sensory/push", |b| {
        let mut buf = SensoryBuffer::new(50, tok.clone());
        b.iter(|| {
            buf.push(
                "What is Helm?".into(),
                "Helm is a package manager for Kubernetes.".into(),
                None,
            );
        });
    });
}

fn bench_sensory_format(c: &mut Criterion) {
    let tok = Tokenizer::heuristic();
    let mut buf = SensoryBuffer::new(50, tok);
    for _ in 0..40 {
        buf.push(
            "Q".into(),
            "A: long answer with details about the topic".into(),
            None,
        );
    }
    c.bench_function("sensory/format_for_context", |b| {
        b.iter(|| black_box(buf.format_for_context(2048)));
    });
}

// ── Working memory ───────────────────────────────────────────────────────

fn bench_working_memory_insert_recall(c: &mut Criterion) {
    let tok = Tokenizer::heuristic();
    c.bench_function("working_mem/insert_recall", |b| {
        let mut wm = WorkingMemory::new("bench-agent".into(), 8000, tok.clone());
        let mut i = 0u64;
        b.iter(|| {
            i += 1;
            wm.insert_recall(
                format!("recall-{}", i),
                MEMORY_CORPUS[(i as usize) % MEMORY_CORPUS.len()].into(),
                0.8,
            );
        });
    });
}

fn bench_working_memory_decay(c: &mut Criterion) {
    let tok = Tokenizer::heuristic();
    let mut wm = WorkingMemory::new("bench-agent".into(), 16000, tok);
    for (i, content) in MEMORY_CORPUS.iter().enumerate() {
        wm.insert_recall(
            format!("d-{}", i),
            (*content).into(),
            0.9 - (i as f32 * 0.03),
        );
    }
    c.bench_function("working_mem/decay_priorities", |b| {
        b.iter(|| wm.decay_priorities(black_box(0.95)));
    });
}

fn bench_working_memory_format(c: &mut Criterion) {
    let tok = Tokenizer::heuristic();
    let mut wm = WorkingMemory::new("bench-agent".into(), 16000, tok);
    for (i, content) in MEMORY_CORPUS.iter().enumerate() {
        wm.insert_recall(format!("f-{}", i), (*content).into(), 0.8);
    }
    c.bench_function("working_mem/format_for_context", |b| {
        b.iter(|| black_box(wm.format_for_context()));
    });
}

// ── Emotional memory ─────────────────────────────────────────────────────

fn bench_score_affect(c: &mut Criterion) {
    c.bench_function("affect/score_affect", |b| {
        b.iter(|| {
            black_box(score_affect(black_box(
                "I'm thrilled the deployment succeeded after a stressful night!",
            )))
        });
    });
}

// ── Intent classification ────────────────────────────────────────────────

fn bench_classify_intent(c: &mut Criterion) {
    let queries = &[
        ("factual", "What is the default port for PostgreSQL?"),
        ("procedural", "How do I set up SSH keys on Ubuntu?"),
        ("causal", "Why did the deploy fail last night?"),
        ("episodic", "What happened in the standup on Tuesday?"),
        ("exploratory", "Tell me about our Kubernetes architecture"),
    ];
    let mut group = c.benchmark_group("intent/classify");
    for (label, query) in queries {
        group.bench_with_input(BenchmarkId::new("type", *label), query, |b, query| {
            b.iter(|| black_box(intent_classifier::classify_intent(black_box(query))));
        });
    }
    group.finish();
}

fn bench_intent_weights(c: &mut Criterion) {
    c.bench_function("intent/weights", |b| {
        b.iter(|| {
            black_box(intent_classifier::intent_weights(black_box(
                "How do I configure the CI/CD pipeline for auto-scaling?",
            )))
        });
    });
}

// ── Entity extraction ────────────────────────────────────────────────────

fn bench_extract_entities(c: &mut Criterion) {
    let texts = &[
        ("short", "Deploy to AWS us-east-1 using Terraform."),
        (
            "medium",
            "John Smith configured the PostgreSQL cluster on Kubernetes with Helm charts. \
            The React frontend talks to a Redis cache behind Cloudflare.",
        ),
        ("long", &MEMORY_CORPUS.join(". ")),
    ];
    let mut group = c.benchmark_group("entity/extract");
    for (label, text) in texts {
        group.bench_with_input(BenchmarkId::new("size", *label), text, |b, text| {
            b.iter(|| black_box(entity_tracking::extract_entities(black_box(text))));
        });
    }
    group.finish();
}

// ── Metadata inference ───────────────────────────────────────────────────

fn bench_infer_metadata(c: &mut Criterion) {
    let content = "The file src/main.rs uses tokio for async. See https://docs.rs/tokio. \
        We deploy via Kubernetes with Helm charts on AWS.
        ```rust
        pub fn main() {
            println!(\"hello\");
        }
        ```";
    c.bench_function("metadata/infer", |b| {
        b.iter(|| black_box(metadata_inference::infer_metadata(black_box(content))));
    });
}

fn bench_infer_metadata_full(c: &mut Criterion) {
    let content = "On 2025-03-15, the team deployed v2.3.0 to production. \
        The file src/engine.ts was refactored to use TypeScript generics. \
        See https://github.com/org/repo/pull/42 for details. \
        Technologies: Rust, React, PostgreSQL, Redis, Kubernetes.";
    c.bench_function("metadata/infer_full", |b| {
        b.iter(|| black_box(metadata_inference::infer_metadata_full(black_box(content))));
    });
}

fn bench_detect_programming_language(c: &mut Criterion) {
    let samples = &[
        (
            "rust",
            "pub fn process(data: &[u8]) -> Result<Vec<u8>, Error> { todo!() }",
        ),
        (
            "python",
            "def train_model(X, y): return RandomForestClassifier().fit(X, y)",
        ),
        (
            "typescript",
            "const handler = async (req: Request): Promise<Response> => { }",
        ),
    ];
    let mut group = c.benchmark_group("metadata/detect_lang");
    for (label, code) in samples {
        group.bench_with_input(BenchmarkId::new("lang", *label), code, |b, code| {
            b.iter(|| {
                black_box(metadata_inference::detect_programming_language(black_box(
                    code,
                )))
            });
        });
    }
    group.finish();
}

// ── Temporal search helpers ──────────────────────────────────────────────

fn bench_recency_score(c: &mut Criterion) {
    let timestamps = &[
        ("1h_ago", chrono::Utc::now() - chrono::Duration::hours(1)),
        ("24h_ago", chrono::Utc::now() - chrono::Duration::hours(24)),
        ("7d_ago", chrono::Utc::now() - chrono::Duration::days(7)),
        ("30d_ago", chrono::Utc::now() - chrono::Duration::days(30)),
    ];
    let mut group = c.benchmark_group("temporal/recency_score");
    for (label, ts) in timestamps {
        let ts_str = ts.to_rfc3339();
        group.bench_with_input(BenchmarkId::new("age", *label), &ts_str, |b, ts_str| {
            b.iter(|| black_box(temporal_search::recency_score(black_box(ts_str), 24.0)));
        });
    }
    group.finish();
}

fn bench_cluster_temporal(c: &mut Criterion) {
    let mut memories: Vec<_> = MEMORY_CORPUS
        .iter()
        .enumerate()
        .map(|(i, content)| {
            let mut m = make_retrieved_memory(&format!("tc-{}", i), content, 0.7);
            // Spread memories across 48 hours
            let ts = chrono::Utc::now() - chrono::Duration::minutes(i as i64 * 30);
            m.created_at = ts.to_rfc3339();
            m
        })
        .collect();
    // Sort by time for realistic input
    memories.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    c.bench_function("temporal/cluster", |b| {
        b.iter(|| {
            black_box(temporal_search::cluster_temporal(
                black_box(&memories),
                3600,
            ))
        });
    });
}

// ── Recall tuner ─────────────────────────────────────────────────────────

fn bench_recall_tuner(c: &mut Criterion) {
    c.bench_function("recall_tuner/observe_and_tune", |b| {
        let mut ndcg = 0.5;
        b.iter(|| {
            ndcg = (ndcg + 0.01) % 1.0;
            black_box(recall_tuner::observe_and_tune(black_box(ndcg)));
        });
    });
}

// ── Retrieval quality ────────────────────────────────────────────────────

fn bench_compute_ndcg(c: &mut Criterion) {
    let memories: Vec<_> = MEMORY_CORPUS
        .iter()
        .enumerate()
        .map(|(i, content)| {
            make_retrieved_memory(&format!("ndcg-{}", i), content, 0.9 - i as f32 * 0.04)
        })
        .collect();
    c.bench_function("quality/compute_ndcg", |b| {
        b.iter(|| black_box(retrieval_quality::compute_ndcg(black_box(&memories))));
    });
}

fn bench_compute_avg_relevancy(c: &mut Criterion) {
    let memories: Vec<_> = MEMORY_CORPUS
        .iter()
        .enumerate()
        .map(|(i, content)| {
            make_retrieved_memory(&format!("ar-{}", i), content, 0.5 + i as f32 * 0.02)
        })
        .collect();
    c.bench_function("quality/average_relevancy", |b| {
        b.iter(|| {
            black_box(retrieval_quality::compute_average_relevancy(black_box(
                &memories,
            )))
        });
    });
}

// ── Gated search ─────────────────────────────────────────────────────────

fn bench_gate_decision(c: &mut Criterion) {
    let queries = &[
        ("skip_greeting", "hello"),
        ("skip_math", "2 + 2"),
        ("defer_ambiguous", "delete it"),
        (
            "retrieve_factual",
            "What port does PostgreSQL use by default?",
        ),
        (
            "retrieve_procedural",
            "How do I set up SSH keys on a new server?",
        ),
        (
            "deep_causal",
            "Why did the build fail after upgrading to Rust 1.78?",
        ),
    ];
    let mut group = c.benchmark_group("gate/decision");
    for (label, query) in queries {
        group.bench_with_input(BenchmarkId::new("type", *label), query, |b, query| {
            b.iter(|| black_box(gated_search::gate_decision(black_box(query))));
        });
    }
    group.finish();
}

// ── Model capabilities ───────────────────────────────────────────────────

fn bench_resolve_model_caps(c: &mut Criterion) {
    let models = &[
        ("gpt5", "gpt-5.3"),
        ("claude", "claude-opus-4-6"),
        ("gemini", "gemini-3.1-pro"),
        ("llama", "llama-4:70b"),
        ("unknown", "custom-finetune-v3"),
    ];
    let mut group = c.benchmark_group("model_caps/resolve");
    for (label, model) in models {
        group.bench_with_input(BenchmarkId::new("model", *label), model, |b, model| {
            b.iter(|| black_box(model_caps::resolve_model_capabilities(black_box(model))));
        });
    }
    group.finish();
}

fn bench_normalize_model_name(c: &mut Criterion) {
    c.bench_function("model_caps/normalize_name", |b| {
        b.iter(|| {
            black_box(model_caps::normalize_model_name(black_box(
                "GPT-5.3-2026-01-20",
            )))
        });
    });
}

// ── Anticipatory pre-loading (topic predictor) ───────────────────────────

fn bench_topic_predict(c: &mut Criterion) {
    let topics = &[
        "kubernetes",
        "databases",
        "authentication",
        "monitoring",
        "deployment",
        "testing",
        "security",
        "caching",
    ];
    let mut predictor = TopicPredictor::new();
    // Train with realistic transition patterns
    for _ in 0..20 {
        for &topic in topics {
            predictor.observe(topic);
        }
        // Add some common transitions
        predictor.observe("deployment");
        predictor.observe("monitoring");
        predictor.observe("deployment");
        predictor.observe("testing");
    }

    c.bench_function("anticipatory/predict_next", |b| {
        b.iter(|| black_box(predictor.predict_next(black_box(5))));
    });
}

fn bench_topic_observe(c: &mut Criterion) {
    c.bench_function("anticipatory/observe", |b| {
        let mut predictor = TopicPredictor::new();
        let mut i = 0usize;
        let topics = &[
            "rust",
            "python",
            "kubernetes",
            "docker",
            "aws",
            "testing",
            "databases",
            "security",
            "monitoring",
            "deployment",
        ];
        b.iter(|| {
            let topic = topics[i % topics.len()];
            predictor.observe(black_box(topic));
            i += 1;
        });
    });
}

fn bench_build_prefetch_queries(c: &mut Criterion) {
    let mut predictor = TopicPredictor::new();
    for topic in &["kubernetes", "deployment", "monitoring", "security"] {
        predictor.observe(topic);
    }
    predictor.observe("deployment"); // make deployment the current
    c.bench_function("anticipatory/build_prefetch", |b| {
        b.iter(|| black_box(anticipatory::build_prefetch_queries(black_box(&predictor))));
    });
}

// ── Projection (embedding → 3D) ─────────────────────────────────────────

fn bench_projection(c: &mut Criterion) {
    let mut group = c.benchmark_group("projection/to_3d");
    for &count in &[50, 200, 1000] {
        let vectors: Vec<(String, Vec<f32>)> = (0..count)
            .map(|i| (format!("v-{}", i), random_vec(DIMS)))
            .collect();
        group.bench_with_input(
            BenchmarkId::from_parameter(count),
            &vectors,
            |b, vectors| {
                b.iter(|| black_box(projection::project_to_3d(black_box(vectors))));
            },
        );
    }
    group.finish();
}

criterion_group!(
    hnsw,
    bench_hnsw_insert,
    bench_hnsw_search,
    bench_hnsw_vs_brute_force
);
criterion_group!(reranking, bench_rerank_rrf, bench_rerank_mmr,);
criterion_group!(hybrid, bench_resolve_hybrid_weight, bench_weighted_rrf_fuse,);
criterion_group!(
    abstraction,
    bench_build_tree,
    bench_pack_with_fallback,
    bench_select_level,
);
criterion_group!(tokenizer, bench_count_tokens, bench_truncate_to_budget,);
criterion_group!(sensory, bench_sensory_push, bench_sensory_format);
criterion_group!(
    working_mem,
    bench_working_memory_insert_recall,
    bench_working_memory_decay,
    bench_working_memory_format,
);
criterion_group!(affect, bench_score_affect);
criterion_group!(
    nlp,
    bench_classify_intent,
    bench_intent_weights,
    bench_extract_entities,
    bench_infer_metadata,
    bench_infer_metadata_full,
    bench_detect_programming_language,
);
criterion_group!(temporal, bench_recency_score, bench_cluster_temporal,);
criterion_group!(
    quality,
    bench_recall_tuner,
    bench_compute_ndcg,
    bench_compute_avg_relevancy,
);
criterion_group!(
    gate,
    bench_gate_decision,
    bench_resolve_model_caps,
    bench_normalize_model_name,
);
criterion_group!(
    anticipatory,
    bench_topic_predict,
    bench_topic_observe,
    bench_build_prefetch_queries,
);
criterion_group!(projection_ops, bench_projection);

// ── Model capabilities extended ──────────────────────────────────────────

fn bench_resolve_context_window(c: &mut Criterion) {
    let models = &[
        ("gpt5", "gpt-5.3"),
        ("claude", "claude-opus-4-6"),
        ("gemini", "gemini-3.1-pro"),
        ("llama", "llama-4:70b"),
        ("unknown", "custom-finetune-v3"),
    ];
    let mut group = c.benchmark_group("model_caps/context_window");
    for (label, model) in models {
        group.bench_with_input(BenchmarkId::new("model", *label), model, |b, model| {
            b.iter(|| black_box(model_caps::resolve_context_window(black_box(model), 4096)));
        });
    }
    group.finish();
}

fn bench_resolve_max_output(c: &mut Criterion) {
    let models = &["gpt-5.3", "claude-opus-4-6", "gemini-3.1-pro"];
    let mut group = c.benchmark_group("model_caps/max_output");
    for model in models {
        group.bench_with_input(BenchmarkId::new("model", *model), model, |b, model| {
            b.iter(|| black_box(model_caps::resolve_max_output_tokens(black_box(model))));
        });
    }
    group.finish();
}

fn bench_resolve_injection_resistance(c: &mut Criterion) {
    let models = &["gpt-5.3", "claude-opus-4-6", "llama-4:8b"];
    let mut group = c.benchmark_group("model_caps/injection_resistance");
    for model in models {
        group.bench_with_input(BenchmarkId::new("model", *model), model, |b, model| {
            b.iter(|| black_box(model_caps::resolve_injection_resistance(black_box(model))));
        });
    }
    group.finish();
}

// ── Cross-type dedup ─────────────────────────────────────────────────────

fn bench_cross_type_dedup(c: &mut Criterion) {
    let mut group = c.benchmark_group("reranking/cross_type_dedup");
    for &count in &[10, 50, 200] {
        group.bench_with_input(BenchmarkId::from_parameter(count), &count, |b, &count| {
            b.iter_with_setup(
                || {
                    (0..count)
                        .map(|i| {
                            make_retrieved_memory(
                                &format!("dedup-{}", i),
                                MEMORY_CORPUS[i % MEMORY_CORPUS.len()],
                                0.9 - (i as f32 * 0.003),
                            )
                        })
                        .collect::<Vec<_>>()
                },
                |mut results| {
                    reranking::cross_type_dedup(black_box(&mut results), 0.8);
                    black_box(results.len());
                },
            );
        });
    }
    group.finish();
}

// ── Metadata serialization round-trip ────────────────────────────────────

fn bench_metadata_serialize(c: &mut Criterion) {
    let meta = metadata_inference::infer_metadata_full(
        "On 2025-03-15 we deployed v2.3.0. File src/engine.ts uses TypeScript. \
         Tech: Rust, React, PostgreSQL, Redis. See https://github.com/org/repo.",
    );
    c.bench_function("metadata/serialize", |b| {
        b.iter(|| black_box(metadata_inference::serialize_metadata(black_box(&meta))));
    });
}

fn bench_metadata_deserialize(c: &mut Criterion) {
    let meta = metadata_inference::infer_metadata_full(
        "On 2025-03-15 we deployed v2.3.0. File src/engine.ts uses TypeScript.",
    );
    let json = metadata_inference::serialize_metadata(&meta).unwrap();
    c.bench_function("metadata/deserialize", |b| {
        b.iter(|| black_box(metadata_inference::deserialize_metadata(black_box(&json))));
    });
}

fn bench_extract_dates(c: &mut Criterion) {
    let texts = &[
        ("none", "The kubernetes cluster runs in us-east-1."),
        ("one", "Deployed on 2025-03-15 to production."),
        (
            "multi",
            "Between 2025-01-01 and 2025-12-31, we had 3 incidents on 2025-06-15.",
        ),
    ];
    let mut group = c.benchmark_group("metadata/extract_dates");
    for (label, text) in texts {
        group.bench_with_input(BenchmarkId::new("content", *label), text, |b, text| {
            b.iter(|| black_box(metadata_inference::extract_dates(black_box(text))));
        });
    }
    group.finish();
}

// ── Emotional memory extended ────────────────────────────────────────────

fn bench_modulated_half_life(c: &mut Criterion) {
    use openpawz_core::engine::engram::modulated_half_life;
    let text = "The server is on fire but we recovered gracefully.";
    let affect = score_affect(text);
    c.bench_function("affect/modulated_half_life", |b| {
        b.iter(|| black_box(modulated_half_life(black_box(7.0), black_box(&affect))));
    });
}

// ── Retrieval quality extended ───────────────────────────────────────────

fn bench_build_quality_metrics(c: &mut Criterion) {
    let memories: Vec<_> = MEMORY_CORPUS
        .iter()
        .enumerate()
        .map(|(i, content)| {
            make_retrieved_memory(&format!("qm-{}", i), content, 0.9 - i as f32 * 0.04)
        })
        .collect();
    c.bench_function("quality/build_metrics", |b| {
        b.iter(|| {
            black_box(retrieval_quality::build_quality_metrics(
                black_box(&memories),
                50,
                12,
                None,
                0.5,
            ))
        });
    });
}

criterion_group!(
    model_caps_extended,
    bench_resolve_context_window,
    bench_resolve_max_output,
    bench_resolve_injection_resistance,
);
criterion_group!(dedup, bench_cross_type_dedup);
criterion_group!(
    metadata_serde,
    bench_metadata_serialize,
    bench_metadata_deserialize,
    bench_extract_dates,
);
criterion_group!(affect_extended, bench_modulated_half_life);
criterion_group!(quality_extended, bench_build_quality_metrics);
criterion_main!(
    hnsw,
    reranking,
    hybrid,
    abstraction,
    tokenizer,
    sensory,
    working_mem,
    affect,
    nlp,
    temporal,
    quality,
    gate,
    anticipatory,
    projection_ops,
    model_caps_extended,
    dedup,
    metadata_serde,
    affect_extended,
    quality_extended
);
