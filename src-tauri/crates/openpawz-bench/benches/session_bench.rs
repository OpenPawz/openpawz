use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use openpawz_bench::*;
use openpawz_core::atoms::types::TaskAgent;
use std::hint::black_box;
use std::sync::atomic::{AtomicU64, Ordering};

static SESSION_CTR: AtomicU64 = AtomicU64::new(0);
static MSG_CTR: AtomicU64 = AtomicU64::new(0);
static TASK_CTR: AtomicU64 = AtomicU64::new(0);
static AGENT_CTR: AtomicU64 = AtomicU64::new(0);
static ACT_CTR: AtomicU64 = AtomicU64::new(0);

fn bench_session_create(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("session/create", |b| {
        b.iter(|| {
            let i = SESSION_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .create_session(&format!("s-{}", i), "bench-model", None, None)
                .unwrap();
        });
    });
}

fn bench_session_list(c: &mut Criterion) {
    let mut group = c.benchmark_group("session/list");
    for &count in &[10, 100, 500] {
        let store = fresh_store();
        for i in 0..count {
            store
                .create_session(&format!("sl-{}", i), "model", None, None)
                .unwrap();
        }
        group.bench_with_input(BenchmarkId::from_parameter(count), &store, |b, store| {
            b.iter(|| black_box(store.list_sessions(black_box(count as i64)).unwrap().len()));
        });
    }
    group.finish();
}

fn bench_message_add(c: &mut Criterion) {
    let store = fresh_store();
    store
        .create_session("msg-bench", "model", None, None)
        .unwrap();
    c.bench_function("message/add", |b| {
        b.iter(|| {
            let i = MSG_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .add_message(&make_message(
                    &format!("m-{}", i),
                    "msg-bench",
                    "user",
                    "What is the meaning of life?",
                ))
                .unwrap();
        });
    });
}

fn bench_message_get(c: &mut Criterion) {
    let mut group = c.benchmark_group("message/get");
    for &count in &[50, 200, 1000] {
        let store = fresh_store();
        store
            .create_session("get-bench", "model", None, None)
            .unwrap();
        for i in 0..count {
            store
                .add_message(&make_message(
                    &format!("mg-{}", i),
                    "get-bench",
                    if i % 2 == 0 { "user" } else { "assistant" },
                    &format!(
                        "Message {} with realistic content length to simulate actual usage.",
                        i
                    ),
                ))
                .unwrap();
        }
        group.bench_with_input(BenchmarkId::from_parameter(count), &store, |b, store| {
            b.iter(|| {
                black_box(
                    store
                        .get_messages(black_box("get-bench"), count as i64)
                        .unwrap()
                        .len(),
                )
            });
        });
    }
    group.finish();
}

fn bench_task_create(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("task/create", |b| {
        b.iter(|| {
            let i = TASK_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .create_task(black_box(&make_task(&format!("t-{}", i))))
                .unwrap();
        });
    });
}

fn bench_task_list(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..200 {
        store.create_task(&make_task(&format!("tl-{}", i))).unwrap();
    }
    c.bench_function("task/list_200", |b| {
        b.iter(|| black_box(store.list_tasks().unwrap().len()));
    });
}

fn bench_agent_file_set(c: &mut Criterion) {
    let store = fresh_store();
    let content = "# SOUL\n\nYou are a meticulous researcher who values accuracy above all.\
        \n\n## Principles\n\n- Always cite sources\n- Prefer depth over breadth\n- Flag uncertainty";
    c.bench_function("agent/file_set", |b| {
        b.iter(|| {
            let i = AGENT_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .set_agent_file(&format!("ag-{}", i % 10), &format!("f-{}.md", i), content)
                .unwrap();
        });
    });
}

fn bench_agent_file_get(c: &mut Criterion) {
    let store = fresh_store();
    store
        .set_agent_file("read-agent", "SOUL.md", "You are a helpful assistant.")
        .unwrap();
    c.bench_function("agent/file_get", |b| {
        b.iter(|| {
            black_box(
                store
                    .get_agent_file(black_box("read-agent"), black_box("SOUL.md"))
                    .unwrap(),
            )
        });
    });
}

// ── Session single-item ops ───────────────────────────────────────────────

fn bench_session_get(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..50 {
        store
            .create_session(&format!("sg-{}", i), "model", None, None)
            .unwrap();
    }
    c.bench_function("session/get", |b| {
        let mut i = 0usize;
        b.iter(|| {
            i = (i + 1) % 50;
            black_box(store.get_session(black_box(&format!("sg-{}", i))).unwrap());
        });
    });
}

fn bench_session_delete(c: &mut Criterion) {
    let store = fresh_store();
    static DEL_CTR: AtomicU64 = AtomicU64::new(0);
    // Pre-create a large batch
    for i in 0..5000 {
        store
            .create_session(&format!("sd-{}", i), "model", None, None)
            .unwrap();
    }
    c.bench_function("session/delete", |b| {
        b.iter(|| {
            let i = DEL_CTR.fetch_add(1, Ordering::Relaxed);
            let _ = store.delete_session(black_box(&format!("sd-{}", i)));
        });
    });
}

fn bench_session_list_filtered(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..200 {
        store
            .create_session(
                &format!("sf-{}", i),
                "model",
                None,
                Some(if i % 3 == 0 {
                    "agent-alpha"
                } else {
                    "agent-beta"
                }),
            )
            .unwrap();
    }
    let mut group = c.benchmark_group("session/list_filtered");
    group.bench_function("all", |b| {
        b.iter(|| {
            black_box(
                store
                    .list_sessions_filtered(black_box(100), None)
                    .unwrap()
                    .len(),
            )
        });
    });
    group.bench_function("by_agent", |b| {
        b.iter(|| {
            black_box(
                store
                    .list_sessions_filtered(black_box(100), Some("agent-alpha"))
                    .unwrap()
                    .len(),
            )
        });
    });
    group.finish();
}

fn bench_session_rename(c: &mut Criterion) {
    let store = fresh_store();
    store
        .create_session("rename-sess", "model", None, None)
        .unwrap();
    c.bench_function("session/rename", |b| {
        b.iter(|| {
            store
                .rename_session(black_box("rename-sess"), black_box("New Label"))
                .unwrap()
        });
    });
}

fn bench_clear_messages(c: &mut Criterion) {
    let store = fresh_store();
    // Create session with messages, then benchmark clearing
    store
        .create_session("clear-sess", "model", None, None)
        .unwrap();
    c.bench_function("session/clear_messages", |b| {
        b.iter_with_setup(
            || {
                for i in 0..50 {
                    let _ = store.add_message(&make_message(
                        &format!("clr-{}-{}", ACT_CTR.fetch_add(1, Ordering::Relaxed), i),
                        "clear-sess",
                        "user",
                        "temp message",
                    ));
                }
            },
            |_| store.clear_messages(black_box("clear-sess")).unwrap(),
        );
    });
}

fn bench_prune_session_messages(c: &mut Criterion) {
    let store = fresh_store();
    store
        .create_session("prune-sess", "model", None, None)
        .unwrap();
    for i in 0..500 {
        store
            .add_message(&make_message(
                &format!("prn-{}", i),
                "prune-sess",
                "user",
                "Message for pruning benchmark",
            ))
            .unwrap();
    }
    c.bench_function("session/prune_to_100", |b| {
        b.iter(|| {
            black_box(
                store
                    .prune_session_messages(black_box("prune-sess"), 100)
                    .unwrap(),
            )
        });
    });
}

fn bench_load_conversation(c: &mut Criterion) {
    let store = fresh_store();
    store
        .create_session("conv-sess", "model", None, None)
        .unwrap();
    for i in 0..100 {
        store
            .add_message(&make_message(
                &format!("conv-{}", i),
                "conv-sess",
                if i % 2 == 0 { "user" } else { "assistant" },
                &format!(
                    "Turn {} of the conversation with realistic message length for benchmarking.",
                    i
                ),
            ))
            .unwrap();
    }
    c.bench_function("session/load_conversation", |b| {
        b.iter(|| {
            black_box(
                store
                    .load_conversation(
                        black_box("conv-sess"),
                        Some("You are a helpful assistant."),
                        Some(4096),
                        None,
                    )
                    .unwrap()
                    .len(),
            )
        });
    });
}

// ── Task extended ops ────────────────────────────────────────────────────

fn bench_task_update(c: &mut Criterion) {
    let store = fresh_store();
    let task = make_task("upd-task");
    store.create_task(&task).unwrap();
    c.bench_function("task/update", |b| {
        let mut t = task.clone();
        let mut i = 0u64;
        b.iter(|| {
            i += 1;
            t.status = if i % 2 == 0 {
                "in_progress".into()
            } else {
                "done".into()
            };
            store.update_task(black_box(&t)).unwrap();
        });
    });
}

fn bench_task_activity(c: &mut Criterion) {
    let store = fresh_store();
    store.create_task(&make_task("act-task")).unwrap();
    static TA_CTR: AtomicU64 = AtomicU64::new(0);
    c.bench_function("task/add_activity", |b| {
        b.iter(|| {
            let i = TA_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .add_task_activity(
                    &format!("ta-{}", i),
                    "act-task",
                    "comment",
                    Some("bench-agent"),
                    "Benchmark activity entry",
                )
                .unwrap();
        });
    });
}

fn bench_task_list_activity(c: &mut Criterion) {
    let store = fresh_store();
    store.create_task(&make_task("tla-task")).unwrap();
    for i in 0..100 {
        store
            .add_task_activity(
                &format!("tla-{}", i),
                "tla-task",
                "comment",
                Some("agent"),
                &format!("Activity {}", i),
            )
            .unwrap();
    }
    c.bench_function("task/list_activity_50", |b| {
        b.iter(|| {
            black_box(
                store
                    .list_task_activity(black_box("tla-task"), 50)
                    .unwrap()
                    .len(),
            )
        });
    });
}

fn bench_task_set_agents(c: &mut Criterion) {
    let store = fresh_store();
    store.create_task(&make_task("tsa-task")).unwrap();
    let agents: Vec<TaskAgent> = (0..3)
        .map(|i| TaskAgent {
            agent_id: format!("ta-agent-{}", i),
            role: if i == 0 {
                "lead".into()
            } else {
                "collaborator".into()
            },
        })
        .collect();
    c.bench_function("task/set_agents_3", |b| {
        b.iter(|| {
            store
                .set_task_agents(black_box("tsa-task"), black_box(&agents))
                .unwrap()
        });
    });
}

fn bench_task_get_agents(c: &mut Criterion) {
    let store = fresh_store();
    store.create_task(&make_task("tga-task")).unwrap();
    store
        .set_task_agents(
            "tga-task",
            &[
                TaskAgent {
                    agent_id: "ag-1".into(),
                    role: "lead".into(),
                },
                TaskAgent {
                    agent_id: "ag-2".into(),
                    role: "collaborator".into(),
                },
            ],
        )
        .unwrap();
    c.bench_function("task/get_agents", |b| {
        b.iter(|| black_box(store.get_task_agents(black_box("tga-task")).unwrap().len()));
    });
}

// ── Agent file extended ops ──────────────────────────────────────────────

fn bench_agent_file_list(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..10 {
        store
            .set_agent_file(
                "list-agent",
                &format!("file-{}.md", i),
                &format!("Content for file {}", i),
            )
            .unwrap();
    }
    c.bench_function("agent/file_list", |b| {
        b.iter(|| {
            black_box(
                store
                    .list_agent_files(black_box("list-agent"))
                    .unwrap()
                    .len(),
            )
        });
    });
}

fn bench_compose_agent_context(c: &mut Criterion) {
    let store = fresh_store();
    store
        .set_agent_file("ctx-agent", "SOUL.md", "You are a meticulous researcher.")
        .unwrap();
    store
        .set_agent_file(
            "ctx-agent",
            "INSTRUCTIONS.md",
            "Always cite sources. Prefer depth.",
        )
        .unwrap();
    store
        .set_agent_file(
            "ctx-agent",
            "KNOWLEDGE.md",
            "Domain knowledge about Kubernetes and Rust.",
        )
        .unwrap();
    c.bench_function("agent/compose_context", |b| {
        b.iter(|| black_box(store.compose_agent_context(black_box("ctx-agent")).unwrap()));
    });
}

criterion_group!(
    sessions,
    bench_session_create,
    bench_session_list,
    bench_session_get,
    bench_session_delete,
    bench_session_list_filtered,
    bench_session_rename,
    bench_clear_messages,
    bench_prune_session_messages,
    bench_load_conversation,
);
criterion_group!(messages, bench_message_add, bench_message_get);
criterion_group!(
    tasks,
    bench_task_create,
    bench_task_list,
    bench_task_update,
    bench_task_activity,
    bench_task_list_activity,
    bench_task_set_agents,
    bench_task_get_agents,
);
criterion_group!(
    agents,
    bench_agent_file_set,
    bench_agent_file_get,
    bench_agent_file_list,
    bench_compose_agent_context,
);
criterion_main!(sessions, messages, tasks, agents);
