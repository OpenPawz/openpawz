use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use openpawz_bench::*;
use openpawz_core::atoms::types::{
    AgentMessage, Flow, FlowRun, Project, ProjectAgent, Squad, SquadMember,
};
use std::hint::black_box;
use std::sync::atomic::{AtomicU64, Ordering};

static CONFIG_CTR: AtomicU64 = AtomicU64::new(0);
static FLOW_CTR: AtomicU64 = AtomicU64::new(0);
static SQUAD_CTR: AtomicU64 = AtomicU64::new(0);
static CANVAS_CTR: AtomicU64 = AtomicU64::new(0);
static PROJECT_CTR: AtomicU64 = AtomicU64::new(0);
static TEL_CTR: AtomicU64 = AtomicU64::new(0);
static DASH_CTR: AtomicU64 = AtomicU64::new(0);
static TMPL_CTR: AtomicU64 = AtomicU64::new(0);
static TRADE_CTR: AtomicU64 = AtomicU64::new(0);
static AMSG_CTR: AtomicU64 = AtomicU64::new(0);
static SKILL_CTR: AtomicU64 = AtomicU64::new(0);
static TAB_CTR: AtomicU64 = AtomicU64::new(0);
static VAULT_CTR: AtomicU64 = AtomicU64::new(0);

// ── Config key/value store ───────────────────────────────────────────────

fn bench_config_set(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("config/set", |b| {
        b.iter(|| {
            let i = CONFIG_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .set_config(
                    &format!("key-{}", i % 50),
                    black_box("bench-value-with-some-realistic-length"),
                )
                .unwrap();
        });
    });
}

fn bench_config_get(c: &mut Criterion) {
    let store = fresh_store();
    let keys: Vec<String> = (0..50)
        .map(|i| {
            let k = format!("key-{}", i);
            store.set_config(&k, &format!("value-{}", i)).unwrap();
            k
        })
        .collect();
    c.bench_function("config/get", |b| {
        let mut i = 0usize;
        b.iter(|| {
            i = (i + 1) % 50;
            black_box(store.get_config(black_box(&keys[i])).unwrap());
        });
    });
}

fn bench_config_get_miss(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("config/get_miss", |b| {
        b.iter(|| black_box(store.get_config(black_box("nonexistent-key")).unwrap()));
    });
}

// ── Flow CRUD ────────────────────────────────────────────────────────────

fn make_flow(id: &str) -> Flow {
    let ts = now();
    Flow {
        id: id.into(),
        name: "Benchmark Flow".into(),
        description: Some("A flow created during benchmarking".into()),
        folder: None,
        graph_json: r#"{"nodes":[{"id":"n1","type":"trigger"},{"id":"n2","type":"action"}],"edges":[{"from":"n1","to":"n2"}]}"#.into(),
        created_at: ts.clone(),
        updated_at: ts,
    }
}

fn make_flow_run(id: &str, flow_id: &str) -> FlowRun {
    FlowRun {
        id: id.into(),
        flow_id: flow_id.into(),
        status: "success".into(),
        duration_ms: Some(1234),
        events_json: Some(r#"[{"type":"start"},{"type":"complete"}]"#.into()),
        error: None,
        started_at: now(),
        finished_at: Some(now()),
    }
}

fn bench_flow_save(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("flow/save", |b| {
        b.iter(|| {
            let i = FLOW_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .save_flow(black_box(&make_flow(&format!("fl-{}", i))))
                .unwrap();
        });
    });
}

fn bench_flow_get(c: &mut Criterion) {
    let store = fresh_store();
    let ids: Vec<String> = (0..50)
        .map(|i| {
            let id = format!("fg-{}", i);
            store.save_flow(&make_flow(&id)).unwrap();
            id
        })
        .collect();
    c.bench_function("flow/get", |b| {
        let mut i = 0usize;
        b.iter(|| {
            i = (i + 1) % 50;
            black_box(store.get_flow(black_box(&ids[i])).unwrap());
        });
    });
}

fn bench_flow_list(c: &mut Criterion) {
    let mut group = c.benchmark_group("flow/list");
    for &count in &[10, 50, 200] {
        let store = fresh_store();
        for i in 0..count {
            store.save_flow(&make_flow(&format!("fll-{}", i))).unwrap();
        }
        group.bench_with_input(BenchmarkId::from_parameter(count), &store, |b, store| {
            b.iter(|| black_box(store.list_flows().unwrap().len()));
        });
    }
    group.finish();
}

static FLOW_RUN_CTR: AtomicU64 = AtomicU64::new(0);

fn bench_flow_run_create(c: &mut Criterion) {
    let store = fresh_store();
    store.save_flow(&make_flow("fr-flow")).unwrap();
    c.bench_function("flow/run_create", |b| {
        b.iter(|| {
            let i = FLOW_RUN_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .create_flow_run(black_box(&make_flow_run(&format!("fr-{}", i), "fr-flow")))
                .unwrap();
        });
    });
}

fn bench_flow_run_list(c: &mut Criterion) {
    let store = fresh_store();
    store.save_flow(&make_flow("frl-flow")).unwrap();
    for i in 0..100 {
        store
            .create_flow_run(&make_flow_run(&format!("frl-{}", i), "frl-flow"))
            .unwrap();
    }
    c.bench_function("flow/run_list_100", |b| {
        b.iter(|| {
            black_box(
                store
                    .list_flow_runs(black_box("frl-flow"), 100)
                    .unwrap()
                    .len(),
            )
        });
    });
}

// ── Squad operations ─────────────────────────────────────────────────────

fn make_squad(id: &str, member_count: usize) -> Squad {
    let ts = now();
    Squad {
        id: id.into(),
        name: "Benchmark Squad".into(),
        goal: "Run fast".into(),
        status: "active".into(),
        members: (0..member_count)
            .map(|i| SquadMember {
                agent_id: format!("agent-{}", i),
                role: if i == 0 {
                    "coordinator".into()
                } else {
                    "member".into()
                },
            })
            .collect(),
        created_at: ts.clone(),
        updated_at: ts,
    }
}

fn bench_squad_create(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("squad/create", |b| {
        b.iter(|| {
            let i = SQUAD_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .create_squad(black_box(&make_squad(&format!("sq-{}", i), 4)))
                .unwrap();
        });
    });
}

fn bench_squad_list(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..20 {
        store
            .create_squad(&make_squad(&format!("sql-{}", i), 3))
            .unwrap();
    }
    c.bench_function("squad/list_20", |b| {
        b.iter(|| black_box(store.list_squads().unwrap().len()));
    });
}

fn bench_agents_share_squad(c: &mut Criterion) {
    let store = fresh_store();
    store.create_squad(&make_squad("shared-sq", 5)).unwrap();
    c.bench_function("squad/agents_share", |b| {
        b.iter(|| black_box(store.agents_share_squad(black_box("agent-0"), black_box("agent-3"))));
    });
}

fn bench_agent_in_squad(c: &mut Criterion) {
    let store = fresh_store();
    store.create_squad(&make_squad("scope-sq", 5)).unwrap();
    c.bench_function("squad/agent_in_squad", |b| {
        b.iter(|| black_box(store.agent_in_squad(black_box("agent-2"), black_box("scope-sq"))));
    });
}

// ── Canvas operations ────────────────────────────────────────────────────

fn bench_canvas_upsert(c: &mut Criterion) {
    let store = fresh_store();
    store
        .create_session("canvas-sess", "model", None, None)
        .unwrap();
    c.bench_function("canvas/upsert", |b| {
        b.iter(|| {
            let i = CANVAS_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .upsert_canvas_component(
                    &format!("cc-{}", i),
                    Some("canvas-sess"),
                    None,
                    "bench-agent",
                    "code_block",
                    "Benchmark Canvas",
                    r#"{"language":"rust","code":"fn main() {}"}"#,
                    Some(r#"{"x":0,"y":0,"w":400,"h":300}"#),
                )
                .unwrap();
        });
    });
}

fn bench_canvas_list_by_session(c: &mut Criterion) {
    let mut group = c.benchmark_group("canvas/list_by_session");
    for &count in &[5, 20, 100] {
        let store = fresh_store();
        store
            .create_session("cls-sess", "model", None, None)
            .unwrap();
        for i in 0..count {
            store
                .upsert_canvas_component(
                    &format!("cls-{}", i),
                    Some("cls-sess"),
                    None,
                    "agent",
                    "chart",
                    &format!("Chart {}", i),
                    "{}",
                    None,
                )
                .unwrap();
        }
        group.bench_with_input(BenchmarkId::from_parameter(count), &store, |b, store| {
            b.iter(|| {
                black_box(
                    store
                        .list_canvas_by_session(black_box("cls-sess"))
                        .unwrap()
                        .len(),
                )
            });
        });
    }
    group.finish();
}

fn bench_canvas_patch(c: &mut Criterion) {
    let store = fresh_store();
    store
        .create_session("cp-sess", "model", None, None)
        .unwrap();
    store
        .upsert_canvas_component(
            "cp-1",
            Some("cp-sess"),
            None,
            "agent",
            "text",
            "Patch Target",
            "original data",
            None,
        )
        .unwrap();
    c.bench_function("canvas/patch", |b| {
        b.iter(|| {
            black_box(
                store
                    .patch_canvas_component(
                        black_box("cp-1"),
                        Some("Updated Title"),
                        Some("updated data"),
                        None,
                    )
                    .unwrap(),
            )
        });
    });
}

// ── Project operations ───────────────────────────────────────────────────

fn make_project(id: &str, agent_count: usize) -> Project {
    let ts = now();
    Project {
        id: id.into(),
        title: "Benchmark Project".into(),
        goal: "Maximize throughput".into(),
        status: "running".into(),
        boss_agent: "boss-agent".into(),
        agents: (0..agent_count)
            .map(|i| ProjectAgent {
                agent_id: format!("pa-{}", i),
                role: if i == 0 {
                    "boss".into()
                } else {
                    "worker".into()
                },
                specialty: "general".into(),
                status: "idle".into(),
                current_task: None,
                model: None,
                system_prompt: None,
                capabilities: vec!["read_file".into(), "execute_command".into()],
            })
            .collect(),
        created_at: ts.clone(),
        updated_at: ts,
    }
}

fn bench_project_create(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("project/create", |b| {
        b.iter(|| {
            let i = PROJECT_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .create_project(black_box(&make_project(&format!("proj-{}", i), 3)))
                .unwrap();
        });
    });
}

fn bench_project_list(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..20 {
        store
            .create_project(&make_project(&format!("pl-{}", i), 3))
            .unwrap();
    }
    c.bench_function("project/list_20", |b| {
        b.iter(|| black_box(store.list_projects().unwrap().len()));
    });
}

fn bench_project_set_agents(c: &mut Criterion) {
    let store = fresh_store();
    store.create_project(&make_project("psa-proj", 0)).unwrap();
    let agents: Vec<ProjectAgent> = (0..5)
        .map(|i| ProjectAgent {
            agent_id: format!("psa-agent-{}", i),
            role: "worker".into(),
            specialty: "coder".into(),
            status: "idle".into(),
            current_task: None,
            model: None,
            system_prompt: None,
            capabilities: vec![],
        })
        .collect();
    c.bench_function("project/set_agents_5", |b| {
        b.iter(|| {
            store
                .set_project_agents(black_box("psa-proj"), black_box(&agents))
                .unwrap()
        });
    });
}

fn bench_agents_share_project(c: &mut Criterion) {
    let store = fresh_store();
    store.create_project(&make_project("asp-proj", 5)).unwrap();
    c.bench_function("project/agents_share", |b| {
        b.iter(|| black_box(store.agents_share_project(black_box("pa-0"), black_box("pa-3"))));
    });
}

fn bench_agent_in_project(c: &mut Criterion) {
    let store = fresh_store();
    store.create_project(&make_project("aip-proj", 5)).unwrap();
    c.bench_function("project/agent_in_project", |b| {
        b.iter(|| black_box(store.agent_in_project(black_box("pa-2"), black_box("aip-proj"))));
    });
}

fn bench_get_agent_model(c: &mut Criterion) {
    let store = fresh_store();
    let mut proj = make_project("gam-proj", 3);
    proj.agents[0].model = Some("gpt-5.3".into());
    store.create_project(&proj).unwrap();
    c.bench_function("project/get_agent_model", |b| {
        b.iter(|| black_box(store.get_agent_model(black_box("pa-0"))));
    });
}

// ── Telemetry ────────────────────────────────────────────────────────────

fn bench_telemetry_record(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("telemetry/record", |b| {
        b.iter(|| {
            let i = TEL_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .record_metric(
                    "2026-03-17",
                    &format!("tl-sess-{}", i % 10),
                    "gpt-5.3",
                    2000,
                    500,
                    0.015,
                    3,
                    450,
                    1200,
                    1650,
                    2,
                )
                .unwrap();
        });
    });
}

fn bench_telemetry_daily(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..100 {
        store
            .record_metric(
                "2026-03-17",
                &format!("td-sess-{}", i),
                if i % 2 == 0 {
                    "gpt-5.3"
                } else {
                    "claude-sonnet-4"
                },
                1500 + (i * 10) as u64,
                400 + (i * 5) as u64,
                0.01 + (i as f64 * 0.001),
                2,
                300,
                1000,
                1300,
                1,
            )
            .unwrap();
    }
    c.bench_function("telemetry/daily_summary", |b| {
        b.iter(|| black_box(store.get_daily_metrics(black_box("2026-03-17")).unwrap()));
    });
}

fn bench_telemetry_model_breakdown(c: &mut Criterion) {
    let store = fresh_store();
    let models = &[
        "gpt-5.3",
        "claude-opus-4-6",
        "claude-sonnet-4",
        "gemini-3.1-pro",
        "gemini-3-flash",
        "deepseek-reasoner",
    ];
    for i in 0..200 {
        store
            .record_metric(
                "2026-03-17",
                &format!("tmb-sess-{}", i),
                models[i % models.len()],
                2000,
                500,
                0.02,
                2,
                300,
                1000,
                1300,
                1,
            )
            .unwrap();
    }
    c.bench_function("telemetry/model_breakdown", |b| {
        b.iter(|| black_box(store.get_model_breakdown(black_box("2026-03-17")).unwrap()));
    });
}

fn bench_telemetry_range(c: &mut Criterion) {
    let store = fresh_store();
    for day in 1..=30 {
        for i in 0..10 {
            store
                .record_metric(
                    &format!("2026-03-{:02}", day),
                    &format!("tr-sess-{}", i),
                    "gpt-5.3",
                    1500,
                    400,
                    0.01,
                    2,
                    300,
                    1000,
                    1300,
                    1,
                )
                .unwrap();
        }
    }
    c.bench_function("telemetry/range_30d", |b| {
        b.iter(|| {
            black_box(
                store
                    .get_metrics_range(black_box("2026-03-01"), black_box("2026-03-30"))
                    .unwrap(),
            )
        });
    });
}

// ── Dashboard CRUD ───────────────────────────────────────────────────────

fn bench_dashboard_create(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("dashboard/create", |b| {
        b.iter(|| {
            let i = DASH_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .create_dashboard(
                    &format!("dash-{}", i),
                    "Bench Dashboard",
                    "chart-bar",
                    "bench-agent",
                    None,
                    None,
                    false,
                    None,
                    None,
                )
                .unwrap();
        });
    });
}

fn bench_dashboard_get(c: &mut Criterion) {
    let store = fresh_store();
    let ids: Vec<String> = (0..50)
        .map(|i| {
            let id = format!("dg-{}", i);
            store
                .create_dashboard(
                    &id,
                    "Dashboard",
                    "icon",
                    "agent",
                    None,
                    None,
                    i % 3 == 0,
                    None,
                    None,
                )
                .unwrap();
            id
        })
        .collect();
    c.bench_function("dashboard/get", |b| {
        let mut i = 0usize;
        b.iter(|| {
            i = (i + 1) % 50;
            black_box(store.get_dashboard(black_box(&ids[i])).unwrap());
        });
    });
}

fn bench_dashboard_list(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..30 {
        store
            .create_dashboard(
                &format!("dl-{}", i),
                &format!("Dashboard {}", i),
                "icon",
                "agent",
                None,
                None,
                i % 5 == 0,
                None,
                None,
            )
            .unwrap();
    }
    c.bench_function("dashboard/list_30", |b| {
        b.iter(|| black_box(store.list_dashboards().unwrap().len()));
    });
}

fn bench_dashboard_list_pinned(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..30 {
        store
            .create_dashboard(
                &format!("dp-{}", i),
                &format!("Dashboard {}", i),
                "icon",
                "agent",
                None,
                None,
                i % 3 == 0,
                None,
                None,
            )
            .unwrap();
    }
    c.bench_function("dashboard/list_pinned", |b| {
        b.iter(|| black_box(store.list_pinned_dashboards().unwrap().len()));
    });
}

// ── Dashboard Templates ──────────────────────────────────────────────────

fn bench_template_create(c: &mut Criterion) {
    let store = fresh_store();
    let comps = r#"[{"type":"chart","title":"Metrics"},{"type":"table","title":"Data"}]"#;
    let tags = r#"["analytics","monitoring"]"#;
    c.bench_function("template/create", |b| {
        b.iter(|| {
            let i = TMPL_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .create_template(
                    &format!("tpl-{}", i),
                    "Bench Template",
                    "A template for benchmarking",
                    "template-icon",
                    comps,
                    tags,
                    Some("Set up monitoring dashboard"),
                    "builtin",
                )
                .unwrap();
        });
    });
}

fn bench_template_list(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..20 {
        store
            .create_template(
                &format!("tl-{}", i),
                &format!("Template {}", i),
                "desc",
                "icon",
                "[]",
                "[]",
                None,
                if i % 2 == 0 { "builtin" } else { "community" },
            )
            .unwrap();
    }
    c.bench_function("template/list_all", |b| {
        b.iter(|| black_box(store.list_templates(None).unwrap().len()));
    });
}

// ── Trade History ────────────────────────────────────────────────────────

fn bench_trade_insert(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("trade/insert", |b| {
        b.iter(|| {
            let i = TRADE_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .insert_trade(
                    "spot",
                    Some("buy"),
                    Some("BTC-USD"),
                    Some("USD"),
                    "0.005",
                    Some("market"),
                    Some(&format!("ord-{}", i)),
                    "filled",
                    Some("250.00"),
                    None,
                    "benchmark trade",
                    Some("sess-1"),
                    Some("agent-1"),
                    None,
                )
                .unwrap();
        });
    });
}

fn bench_trade_list(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..100 {
        store
            .insert_trade(
                "spot",
                Some("buy"),
                Some("ETH-USD"),
                Some("USD"),
                "1.0",
                Some("limit"),
                Some(&format!("trl-{}", i)),
                "filled",
                Some("3500.00"),
                None,
                "test trade",
                None,
                None,
                None,
            )
            .unwrap();
    }
    c.bench_function("trade/list_100", |b| {
        b.iter(|| black_box(store.list_trades(black_box(100)).unwrap().len()));
    });
}

// ── Agent-to-Agent Messages ──────────────────────────────────────────────

fn bench_agent_message_send(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("agent_msg/send", |b| {
        b.iter(|| {
            let i = AMSG_CTR.fetch_add(1, Ordering::Relaxed);
            let msg = AgentMessage {
                id: format!("am-{}", i),
                from_agent: "agent-alpha".into(),
                to_agent: "agent-beta".into(),
                channel: "general".into(),
                content: "Benchmark inter-agent message content".into(),
                metadata: None,
                read: false,
                created_at: now(),
            };
            store.send_agent_message(black_box(&msg)).unwrap();
        });
    });
}

fn bench_agent_message_get(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..200 {
        store
            .send_agent_message(&AgentMessage {
                id: format!("amg-{}", i),
                from_agent: if i % 2 == 0 {
                    "agent-alpha"
                } else {
                    "agent-beta"
                }
                .into(),
                to_agent: if i % 2 == 0 {
                    "agent-beta"
                } else {
                    "agent-alpha"
                }
                .into(),
                channel: "general".into(),
                content: format!("Message {}", i),
                metadata: None,
                read: false,
                created_at: now(),
            })
            .unwrap();
    }
    c.bench_function("agent_msg/get_100", |b| {
        b.iter(|| {
            black_box(
                store
                    .get_agent_messages(black_box("agent-beta"), None, black_box(100))
                    .unwrap()
                    .len(),
            )
        });
    });
}

// ── Skill KV Store ───────────────────────────────────────────────────────

fn bench_skill_store_set(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("skill_store/set", |b| {
        b.iter(|| {
            let i = SKILL_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .skill_store_set(
                    "bench-skill",
                    &format!("key-{}", i % 50),
                    black_box("bench-value-with-realistic-content"),
                )
                .unwrap();
        });
    });
}

fn bench_skill_store_get(c: &mut Criterion) {
    let store = fresh_store();
    let keys: Vec<String> = (0..50)
        .map(|i| {
            let k = format!("sk-{}", i);
            store.skill_store_set("bench-skill", &k, "value").unwrap();
            k
        })
        .collect();
    c.bench_function("skill_store/get", |b| {
        let mut i = 0usize;
        b.iter(|| {
            i = (i + 1) % 50;
            black_box(
                store
                    .skill_store_get(black_box("bench-skill"), black_box(&keys[i]))
                    .unwrap(),
            );
        });
    });
}

fn bench_skill_store_list(c: &mut Criterion) {
    let store = fresh_store();
    for i in 0..30 {
        store
            .skill_store_set("list-skill", &format!("key-{}", i), &format!("val-{}", i))
            .unwrap();
    }
    c.bench_function("skill_store/list_30", |b| {
        b.iter(|| {
            black_box(
                store
                    .skill_store_list(black_box("list-skill"))
                    .unwrap()
                    .len(),
            )
        });
    });
}

criterion_group!(
    config_ops,
    bench_config_set,
    bench_config_get,
    bench_config_get_miss
);
criterion_group!(
    flow_ops,
    bench_flow_save,
    bench_flow_get,
    bench_flow_list,
    bench_flow_run_create,
    bench_flow_run_list,
);
criterion_group!(
    squad_ops,
    bench_squad_create,
    bench_squad_list,
    bench_agents_share_squad,
    bench_agent_in_squad,
);
criterion_group!(
    canvas_ops,
    bench_canvas_upsert,
    bench_canvas_list_by_session,
    bench_canvas_patch,
);
criterion_group!(
    project_ops,
    bench_project_create,
    bench_project_list,
    bench_project_set_agents,
    bench_agents_share_project,
    bench_agent_in_project,
    bench_get_agent_model,
);
criterion_group!(
    telemetry_ops,
    bench_telemetry_record,
    bench_telemetry_daily,
    bench_telemetry_model_breakdown,
    bench_telemetry_range,
);
criterion_group!(
    dashboard_ops,
    bench_dashboard_create,
    bench_dashboard_get,
    bench_dashboard_list,
    bench_dashboard_list_pinned,
);
criterion_group!(template_ops, bench_template_create, bench_template_list);
criterion_group!(trade_ops, bench_trade_insert, bench_trade_list);
criterion_group!(
    agent_msg_ops,
    bench_agent_message_send,
    bench_agent_message_get,
);
criterion_group!(
    skill_store_ops,
    bench_skill_store_set,
    bench_skill_store_get,
    bench_skill_store_list,
);

// ── Dashboard tabs ───────────────────────────────────────────────────────

fn bench_tab_open(c: &mut Criterion) {
    let store = fresh_store();
    // Pre-create a dashboard for tabs
    store
        .create_dashboard(
            "tab-dash",
            "Tab Dashboard",
            "icon",
            "agent",
            None,
            None,
            false,
            None,
            None,
        )
        .unwrap();
    c.bench_function("tab/open", |b| {
        b.iter(|| {
            let i = TAB_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .open_tab(
                    black_box(&format!("tab-{}", i)),
                    black_box("tab-dash"),
                    black_box("main-window"),
                )
                .unwrap();
        });
    });
}

fn bench_tab_list(c: &mut Criterion) {
    let store = fresh_store();
    store
        .create_dashboard(
            "lt-dash",
            "Tab Dashboard",
            "icon",
            "agent",
            None,
            None,
            false,
            None,
            None,
        )
        .unwrap();
    for i in 0..20 {
        store
            .open_tab(&format!("lt-{}", i), "lt-dash", "main-window")
            .unwrap();
    }
    c.bench_function("tab/list_20", |b| {
        b.iter(|| black_box(store.list_tabs(black_box("main-window")).unwrap().len()));
    });
}

fn bench_tab_activate(c: &mut Criterion) {
    let store = fresh_store();
    store
        .create_dashboard(
            "at-dash",
            "Tab Dashboard",
            "icon",
            "agent",
            None,
            None,
            false,
            None,
            None,
        )
        .unwrap();
    for i in 0..10 {
        store
            .open_tab(&format!("at-{}", i), "at-dash", "main-window")
            .unwrap();
    }
    c.bench_function("tab/activate", |b| {
        let mut i = 0usize;
        b.iter(|| {
            i = (i + 1) % 10;
            store
                .activate_tab(black_box(&format!("at-{}", i)), black_box("main-window"))
                .unwrap();
        });
    });
}

fn bench_tab_get_active(c: &mut Criterion) {
    let store = fresh_store();
    store
        .create_dashboard(
            "ga-dash",
            "Tab Dashboard",
            "icon",
            "agent",
            None,
            None,
            false,
            None,
            None,
        )
        .unwrap();
    store.open_tab("ga-tab", "ga-dash", "main-window").unwrap();
    store.activate_tab("ga-tab", "main-window").unwrap();
    c.bench_function("tab/get_active", |b| {
        b.iter(|| black_box(store.get_active_tab(black_box("main-window")).unwrap()));
    });
}

// ── Trading positions ────────────────────────────────────────────────────

fn bench_position_insert(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("position/insert", |b| {
        b.iter(|| {
            store
                .insert_position(
                    "So11111111111111111111111111111111111111112",
                    "SOL",
                    150.0,
                    1.0,
                    10.0,
                    0.30,
                    2.0,
                    Some("bench-agent"),
                )
                .unwrap();
        });
    });
}

fn bench_position_list(c: &mut Criterion) {
    let store = fresh_store();
    for _ in 0..50 {
        store
            .insert_position("mint-xyz", "TOKEN", 1.0, 0.5, 100.0, 0.25, 3.0, None)
            .unwrap();
    }
    c.bench_function("position/list_all", |b| {
        b.iter(|| black_box(store.list_positions(None).unwrap().len()));
    });
}

fn bench_position_list_open(c: &mut Criterion) {
    let store = fresh_store();
    for _ in 0..50 {
        store
            .insert_position("mint-xyz", "TOKEN", 1.0, 0.5, 100.0, 0.25, 3.0, None)
            .unwrap();
    }
    c.bench_function("position/list_open", |b| {
        b.iter(|| black_box(store.list_positions(Some("open")).unwrap().len()));
    });
}

fn bench_position_update_price(c: &mut Criterion) {
    let store = fresh_store();
    let id = store
        .insert_position("mint-upd", "SOL", 150.0, 1.0, 10.0, 0.30, 2.0, None)
        .unwrap();
    c.bench_function("position/update_price", |b| {
        let mut price = 150.0f64;
        b.iter(|| {
            price += 0.01;
            store
                .update_position_price(black_box(&id), black_box(price))
                .unwrap();
        });
    });
}

fn bench_position_close(c: &mut Criterion) {
    let store = fresh_store();
    c.bench_function("position/close", |b| {
        b.iter_with_setup(
            || {
                store
                    .insert_position("mint-cls", "SOL", 150.0, 1.0, 10.0, 0.30, 2.0, None)
                    .unwrap()
            },
            |id| {
                store
                    .close_position(black_box(&id), "closed_manual", None)
                    .unwrap()
            },
        );
    });
}

// ── Skill vault (credential store) ──────────────────────────────────────

fn bench_skill_vault_set(c: &mut Criterion) {
    let store = fresh_store();
    store.init_skill_tables().unwrap();
    c.bench_function("skill_vault/set", |b| {
        b.iter(|| {
            let i = VAULT_CTR.fetch_add(1, Ordering::Relaxed);
            store
                .set_skill_credential(
                    "bench-skill",
                    &format!("cred-{}", i % 20),
                    black_box("encrypted-value-AES256GCM-nonce-ct-tag"),
                )
                .unwrap();
        });
    });
}

fn bench_skill_vault_get(c: &mut Criterion) {
    let store = fresh_store();
    store.init_skill_tables().unwrap();
    for i in 0..20 {
        store
            .set_skill_credential("bench-skill", &format!("vc-{}", i), "encrypted-value")
            .unwrap();
    }
    c.bench_function("skill_vault/get", |b| {
        let mut i = 0usize;
        b.iter(|| {
            i = (i + 1) % 20;
            black_box(
                store
                    .get_skill_credential(black_box("bench-skill"), black_box(&format!("vc-{}", i)))
                    .unwrap(),
            );
        });
    });
}

fn bench_skill_vault_list_keys(c: &mut Criterion) {
    let store = fresh_store();
    store.init_skill_tables().unwrap();
    for i in 0..15 {
        store
            .set_skill_credential("list-skill", &format!("key-{}", i), "encrypted")
            .unwrap();
    }
    c.bench_function("skill_vault/list_keys", |b| {
        b.iter(|| {
            black_box(
                store
                    .list_skill_credential_keys(black_box("list-skill"))
                    .unwrap()
                    .len(),
            )
        });
    });
}

fn bench_skill_enabled(c: &mut Criterion) {
    let store = fresh_store();
    store.init_skill_tables().unwrap();
    store.set_skill_enabled("enabled-skill", true).unwrap();
    c.bench_function("skill_vault/is_enabled", |b| {
        b.iter(|| black_box(store.is_skill_enabled(black_box("enabled-skill")).unwrap()));
    });
}

criterion_group!(
    tab_ops,
    bench_tab_open,
    bench_tab_list,
    bench_tab_activate,
    bench_tab_get_active,
);
criterion_group!(
    position_ops,
    bench_position_insert,
    bench_position_list,
    bench_position_list_open,
    bench_position_update_price,
    bench_position_close,
);
criterion_group!(
    skill_vault_ops,
    bench_skill_vault_set,
    bench_skill_vault_get,
    bench_skill_vault_list_keys,
    bench_skill_enabled,
);
criterion_main!(
    config_ops,
    flow_ops,
    squad_ops,
    canvas_ops,
    project_ops,
    telemetry_ops,
    dashboard_ops,
    template_ops,
    trade_ops,
    agent_msg_ops,
    skill_store_ops,
    tab_ops,
    position_ops,
    skill_vault_ops
);
