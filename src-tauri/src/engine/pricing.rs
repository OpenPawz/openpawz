// Paw Agent Engine — Model pricing & task complexity
// Extracted from engine/types.rs.
// ModelPrice struct lives in crate::atoms::types.

use crate::atoms::types::*;

pub fn model_price(model: &str) -> ModelPrice {
    // Normalize: strip provider prefixes like "anthropic/"
    let m = model.split('/').next_back().unwrap_or(model);
    match m {
        // Anthropic
        s if s.starts_with("claude-3-haiku") => ModelPrice {
            input: 0.25,
            output: 1.25,
        },
        s if s.starts_with("claude-haiku-4") => ModelPrice {
            input: 1.00,
            output: 5.00,
        },
        s if s.starts_with("claude-sonnet-4")
            || s.starts_with("claude-3-5-sonnet")
            || s.starts_with("claude-3-sonnet") =>
        {
            ModelPrice {
                input: 3.00,
                output: 15.00,
            }
        }
        s if s.starts_with("claude-opus-4") || s.starts_with("claude-3-opus") => ModelPrice {
            input: 15.00,
            output: 75.00,
        },
        // Google
        s if s.starts_with("gemini-3.1-pro") || s.starts_with("gemini-3-pro") => ModelPrice {
            input: 2.00,
            output: 12.00,
        },
        s if s.starts_with("gemini-3-flash") => ModelPrice {
            input: 0.50,
            output: 3.00,
        },
        s if s.starts_with("gemini-2.5-flash-lite") => ModelPrice {
            input: 0.05,
            output: 0.20,
        },
        s if s.starts_with("gemini-2.0-flash") || s.starts_with("gemini-2.5-flash") => ModelPrice {
            input: 0.15,
            output: 0.60,
        },
        s if s.starts_with("gemini-2.5-pro")
            || s.starts_with("gemini-1.5-pro")
            || s.starts_with("gemini-pro") =>
        {
            ModelPrice {
                input: 1.25,
                output: 10.00,
            }
        }
        // OpenAI
        s if s.starts_with("gpt-4o-mini")
            || s.starts_with("gpt-4.1-mini")
            || s.starts_with("gpt-4.1-nano") =>
        {
            ModelPrice {
                input: 0.15,
                output: 0.60,
            }
        }
        s if s.starts_with("gpt-4o") || s.starts_with("gpt-4.1") => ModelPrice {
            input: 2.50,
            output: 10.00,
        },
        s if s.starts_with("o4-mini") || s.starts_with("o3-mini") => ModelPrice {
            input: 1.10,
            output: 4.40,
        },
        s if s.starts_with("o3") || s.starts_with("o1") => ModelPrice {
            input: 10.00,
            output: 40.00,
        },
        // DeepSeek
        s if s.starts_with("deepseek-chat") || s.starts_with("deepseek-v3") => ModelPrice {
            input: 0.27,
            output: 1.10,
        },
        s if s.starts_with("deepseek-reasoner") || s.starts_with("deepseek-r1") => ModelPrice {
            input: 0.55,
            output: 2.19,
        },
        // Fallback: assume cheap model
        _ => ModelPrice {
            input: 0.50,
            output: 2.00,
        },
    }
}

/// Estimate USD cost given token counts and model name.
/// Accounts for Anthropic cache tokens: reads charged at 10%, creation at 25%.
pub fn estimate_cost_usd(
    model: &str,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_create: u64,
) -> f64 {
    let p = model_price(model);
    // Regular input tokens (subtract cached from total input for accurate costing)
    let regular_input = input.saturating_sub(cache_read + cache_create);
    let input_cost = (regular_input as f64 * p.input / 1_000_000.0)
        + (cache_read as f64 * p.input * 0.10 / 1_000_000.0)   // 90% discount on reads
        + (cache_create as f64 * p.input * 1.25 / 1_000_000.0); // 25% surcharge on writes
    let output_cost = output as f64 * p.output / 1_000_000.0;
    input_cost + output_cost
}

// ── Task Complexity Classification ─────────────────────────────────────

/// How complex a user message is — determines model tier.
/// Classify a user message's complexity to choose the right model tier.
///
/// Uses the retrieval gate as the first pass — `GateDecision::Skip` means
/// the query is trivial (greeting, identity question, topic switch) and
/// `DeepRetrieve` means it's definitely complex. Only `Retrieve` queries
/// fall through to the keyword heuristics.
///
/// This unification prevents the gate and auto-tier from disagreeing
/// (e.g., gate says "trivial" but auto-tier says "use expensive model").
pub fn classify_task_complexity(message: &str) -> TaskComplexity {
    use crate::engine::engram::gated_search::{gate_decision, GateDecision};

    let msg = message.to_lowercase();
    let len = msg.len();

    // ── Phase 1: Length heuristic (checked first — overrides gate) ───────
    // Long messages are usually complex regardless of structure.
    if len > 1500 {
        return TaskComplexity::Complex;
    }

    // ── Phase 0: Use retrieval gate as primary structural classifier ─────
    // The gate already does structural analysis (noun density, verb patterns,
    // anaphora detection, deep-signal matching). Leverage it.
    match gate_decision(message) {
        GateDecision::Skip | GateDecision::Defer(_) => return TaskComplexity::Simple,
        GateDecision::DeepRetrieve => return TaskComplexity::Complex,
        _ => {} // Retrieve/Refuse → fall through to keyword heuristics
    }

    // Code-related signals
    let code_signals = [
        "write code",
        "implement",
        "refactor",
        "debug",
        "fix the bug",
        "create a function",
        "write a script",
        "build a",
        "architect",
        "```",
        "code review",
        "unit test",
        "write test",
        "optimize",
        "performance",
        "algorithm",
    ];

    // Analysis / reasoning signals
    let reasoning_signals = [
        "analyze",
        "compare",
        "explain why",
        "reason",
        "think through",
        "pros and cons",
        "trade-off",
        "evaluate",
        "assess",
        "plan",
        "strategy",
        "design",
        "architecture",
        "step by step",
        "break down",
        "complex",
        "research",
        "investigate",
        "deep dive",
        "write a report",
        "summarize",
        "synthesis",
    ];

    // Multi-step signals
    let multi_step = [
        "and then",
        "after that",
        "first,",
        "second,",
        "third,",
        "steps:",
        "1.",
        "2.",
        "3.",
        "multiple",
        "several",
        "all of",
    ];

    for signal in code_signals
        .iter()
        .chain(reasoning_signals.iter())
        .chain(multi_step.iter())
    {
        if msg.contains(signal) {
            return TaskComplexity::Complex;
        }
    }

    TaskComplexity::Simple
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── model_price ────────────────────────────────────────────────

    #[test]
    fn claude_3_haiku_price() {
        let p = model_price("claude-3-haiku-20240307");
        assert_eq!(p.input, 0.25);
        assert_eq!(p.output, 1.25);
    }

    #[test]
    fn claude_haiku_4_price() {
        let p = model_price("claude-haiku-4-20250501");
        assert_eq!(p.input, 1.00);
        assert_eq!(p.output, 5.00);
    }

    #[test]
    fn claude_sonnet_4_price() {
        let p = model_price("claude-sonnet-4-20250514");
        assert_eq!(p.input, 3.00);
        assert_eq!(p.output, 15.00);
    }

    #[test]
    fn claude_3_5_sonnet_price() {
        let p = model_price("claude-3-5-sonnet-20241022");
        assert_eq!(p.input, 3.00);
        assert_eq!(p.output, 15.00);
    }

    #[test]
    fn claude_opus_4_price() {
        let p = model_price("claude-opus-4-20250514");
        assert_eq!(p.input, 15.00);
        assert_eq!(p.output, 75.00);
    }

    #[test]
    fn claude_3_opus_price() {
        let p = model_price("claude-3-opus-20240229");
        assert_eq!(p.input, 15.00);
        assert_eq!(p.output, 75.00);
    }

    #[test]
    fn gemini_3_flash_price() {
        let p = model_price("gemini-3-flash");
        assert_eq!(p.input, 0.50);
        assert_eq!(p.output, 3.00);
    }

    #[test]
    fn gemini_2_5_flash_lite_price() {
        let p = model_price("gemini-2.5-flash-lite-001");
        assert_eq!(p.input, 0.05);
        assert_eq!(p.output, 0.20);
    }

    #[test]
    fn gemini_2_0_flash_price() {
        let p = model_price("gemini-2.0-flash");
        assert_eq!(p.input, 0.15);
        assert_eq!(p.output, 0.60);
    }

    #[test]
    fn gemini_2_5_flash_price() {
        let p = model_price("gemini-2.5-flash-preview-05-20");
        assert_eq!(p.input, 0.15);
        assert_eq!(p.output, 0.60);
    }

    #[test]
    fn gemini_2_5_pro_price() {
        let p = model_price("gemini-2.5-pro-preview-05-06");
        assert_eq!(p.input, 1.25);
        assert_eq!(p.output, 10.00);
    }

    #[test]
    fn gemini_1_5_pro_price() {
        let p = model_price("gemini-1.5-pro-002");
        assert_eq!(p.input, 1.25);
        assert_eq!(p.output, 10.00);
    }

    #[test]
    fn gpt_4o_mini_price() {
        let p = model_price("gpt-4o-mini-2024-07-18");
        assert_eq!(p.input, 0.15);
        assert_eq!(p.output, 0.60);
    }

    #[test]
    fn gpt_4_1_mini_price() {
        let p = model_price("gpt-4.1-mini");
        assert_eq!(p.input, 0.15);
        assert_eq!(p.output, 0.60);
    }

    #[test]
    fn gpt_4_1_nano_price() {
        let p = model_price("gpt-4.1-nano");
        assert_eq!(p.input, 0.15);
        assert_eq!(p.output, 0.60);
    }

    #[test]
    fn gpt_4o_price() {
        let p = model_price("gpt-4o-2024-11-20");
        assert_eq!(p.input, 2.50);
        assert_eq!(p.output, 10.00);
    }

    #[test]
    fn gpt_4_1_price() {
        let p = model_price("gpt-4.1");
        assert_eq!(p.input, 2.50);
        assert_eq!(p.output, 10.00);
    }

    #[test]
    fn o4_mini_price() {
        let p = model_price("o4-mini-2025-04-16");
        assert_eq!(p.input, 1.10);
        assert_eq!(p.output, 4.40);
    }

    #[test]
    fn o3_mini_price() {
        let p = model_price("o3-mini");
        assert_eq!(p.input, 1.10);
        assert_eq!(p.output, 4.40);
    }

    #[test]
    fn o3_price() {
        let p = model_price("o3-2025-04-16");
        assert_eq!(p.input, 10.00);
        assert_eq!(p.output, 40.00);
    }

    #[test]
    fn o1_price() {
        let p = model_price("o1-preview");
        assert_eq!(p.input, 10.00);
        assert_eq!(p.output, 40.00);
    }

    #[test]
    fn deepseek_chat_price() {
        let p = model_price("deepseek-chat");
        assert_eq!(p.input, 0.27);
        assert_eq!(p.output, 1.10);
    }

    #[test]
    fn deepseek_v3_price() {
        let p = model_price("deepseek-v3");
        assert_eq!(p.input, 0.27);
        assert_eq!(p.output, 1.10);
    }

    #[test]
    fn deepseek_reasoner_price() {
        let p = model_price("deepseek-reasoner");
        assert_eq!(p.input, 0.55);
        assert_eq!(p.output, 2.19);
    }

    #[test]
    fn deepseek_r1_price() {
        let p = model_price("deepseek-r1");
        assert_eq!(p.input, 0.55);
        assert_eq!(p.output, 2.19);
    }

    #[test]
    fn unknown_model_gets_fallback() {
        let p = model_price("some-random-model");
        assert_eq!(p.input, 0.50);
        assert_eq!(p.output, 2.00);
    }

    #[test]
    fn provider_prefix_stripped() {
        // "anthropic/claude-3-haiku-20240307" → strips prefix
        let p = model_price("anthropic/claude-3-haiku-20240307");
        assert_eq!(p.input, 0.25);
        assert_eq!(p.output, 1.25);
    }

    #[test]
    fn openrouter_prefix_stripped() {
        let p = model_price("openai/gpt-4o-mini-2024-07-18");
        assert_eq!(p.input, 0.15);
        assert_eq!(p.output, 0.60);
    }

    // ── estimate_cost_usd ──────────────────────────────────────────

    #[test]
    fn basic_cost_no_cache() {
        // 1000 input tokens at $3.00/M = $0.003
        // 500 output tokens at $15.00/M = $0.0075
        let cost = estimate_cost_usd("claude-sonnet-4-20250514", 1000, 500, 0, 0);
        let expected = (1000.0 * 3.0 / 1_000_000.0) + (500.0 * 15.0 / 1_000_000.0);
        assert!((cost - expected).abs() < 1e-10);
    }

    #[test]
    fn zero_tokens_zero_cost() {
        let cost = estimate_cost_usd("gpt-4o", 0, 0, 0, 0);
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn cache_read_discount() {
        // 1000 total input, 800 cache_read → 200 regular
        // Regular: 200 * 3.0 / 1M = 0.0006
        // Cache read: 800 * 3.0 * 0.10 / 1M = 0.00024
        // Output: 100 * 15.0 / 1M = 0.0015
        let cost = estimate_cost_usd("claude-sonnet-4-20250514", 1000, 100, 800, 0);
        let regular_input = 200.0 * 3.0 / 1_000_000.0;
        let cache_read = 800.0 * 3.0 * 0.10 / 1_000_000.0;
        let output = 100.0 * 15.0 / 1_000_000.0;
        let expected = regular_input + cache_read + output;
        assert!((cost - expected).abs() < 1e-10);
    }

    #[test]
    fn cache_create_surcharge() {
        // 500 total input, 300 cache_create → 200 regular
        let cost = estimate_cost_usd("claude-sonnet-4-20250514", 500, 50, 0, 300);
        let regular_input = 200.0 * 3.0 / 1_000_000.0;
        let cache_create = 300.0 * 3.0 * 1.25 / 1_000_000.0; // 25% surcharge
        let output = 50.0 * 15.0 / 1_000_000.0;
        let expected = regular_input + cache_create + output;
        assert!((cost - expected).abs() < 1e-10);
    }

    #[test]
    fn large_token_count_accuracy() {
        // 1M input tokens, 500K output on Claude Opus
        let cost = estimate_cost_usd("claude-opus-4", 1_000_000, 500_000, 0, 0);
        let expected = (1_000_000.0 * 15.0 / 1_000_000.0) + (500_000.0 * 75.0 / 1_000_000.0);
        assert!((cost - expected).abs() < 1e-10);
        // $15 + $37.5 = $52.5
        assert!((cost - 52.5).abs() < 1e-10);
    }

    // ── classify_task_complexity ────────────────────────────────────

    #[test]
    fn simple_greeting() {
        assert_eq!(classify_task_complexity("hello"), TaskComplexity::Simple);
    }

    #[test]
    fn simple_question() {
        assert_eq!(
            classify_task_complexity("What time is it?"),
            TaskComplexity::Simple
        );
    }

    #[test]
    fn complex_code_signal() {
        assert_eq!(
            classify_task_complexity("Write code to parse JSON"),
            TaskComplexity::Complex
        );
    }

    #[test]
    fn complex_implement_signal() {
        assert_eq!(
            classify_task_complexity("Implement a binary search tree"),
            TaskComplexity::Complex
        );
    }

    #[test]
    fn complex_refactor_signal() {
        assert_eq!(
            classify_task_complexity("Refactor the authentication module"),
            TaskComplexity::Complex
        );
    }

    #[test]
    fn complex_debug_signal() {
        assert_eq!(
            classify_task_complexity("Debug this memory leak"),
            TaskComplexity::Complex
        );
    }

    #[test]
    fn complex_reasoning_analyse() {
        assert_eq!(
            classify_task_complexity("Analyze the market trends"),
            TaskComplexity::Complex
        );
    }

    #[test]
    fn complex_reasoning_step_by_step() {
        assert_eq!(
            classify_task_complexity("Explain step by step how DNS works"),
            TaskComplexity::Complex
        );
    }

    #[test]
    fn complex_multi_step() {
        assert_eq!(
            classify_task_complexity("First, fetch data. After that, parse it."),
            TaskComplexity::Complex
        );
    }

    #[test]
    fn complex_code_block() {
        assert_eq!(
            classify_task_complexity("Check this ```rust fn main() {}```"),
            TaskComplexity::Complex
        );
    }

    #[test]
    fn complex_long_message() {
        let long = "a".repeat(1501);
        assert_eq!(classify_task_complexity(&long), TaskComplexity::Complex);
    }

    #[test]
    fn simple_short_message() {
        assert_eq!(
            classify_task_complexity("How are you?"),
            TaskComplexity::Simple
        );
    }

    #[test]
    fn complex_unit_test_signal() {
        assert_eq!(
            classify_task_complexity("Write a unit test for the parser"),
            TaskComplexity::Complex
        );
    }

    #[test]
    fn complex_research_signal() {
        assert_eq!(
            classify_task_complexity("Research the best database options"),
            TaskComplexity::Complex
        );
    }

    #[test]
    fn simple_at_1500_boundary() {
        let exactly_1500 = "b".repeat(1500);
        assert_eq!(
            classify_task_complexity(&exactly_1500),
            TaskComplexity::Simple
        );
    }

    #[test]
    fn case_insensitive_signals() {
        assert_eq!(
            classify_task_complexity("WRITE CODE for me"),
            TaskComplexity::Complex
        );
        assert_eq!(
            classify_task_complexity("Optimize the query"),
            TaskComplexity::Complex
        );
    }
}
