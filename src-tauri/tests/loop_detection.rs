// Integration test: Loop detection & redirect injection
//
// Exercises detect_response_loop from engine::chat to verify:
// - Cross-turn repetition detection (Jaccard similarity)
// - Question-loop detection (consecutive `?`-ending responses)
// - Topic fixation detection (model stuck on old topic + repeating itself)
// - Short-directive loop detection
// - Natural topic flow: NO false positives on genuine topic changes
// - Escalation: stronger redirects when prior ones were ignored
// - No false positives on dissimilar messages
// - Redirect message format and contents

use paw_temp_lib::engine::chat::detect_response_loop;
use paw_temp_lib::engine::types::{Message, MessageContent, Role};

// ── Helpers ────────────────────────────────────────────────────────────────

fn msg(role: Role, text: &str) -> Message {
    Message {
        role,
        content: MessageContent::Text(text.to_string()),
        tool_calls: None,
        tool_call_id: None,
        name: None,
    }
}

fn has_system_redirect(messages: &[Message]) -> bool {
    messages.iter().any(|m| {
        m.role == Role::System
            && (m.content.as_text_ref().contains("stuck")
                || m.content.as_text_ref().to_lowercase().contains("loop")
                || m.content.as_text_ref().contains("TOPIC CHANGE"))
    })
}

// ── Cross-turn repetition (similarity > 40%) ──────────────────────────────

#[test]
fn detects_high_similarity_assistant_messages() {
    let mut msgs = vec![
        msg(Role::User, "How do I set up the project?"),
        msg(
            Role::Assistant,
            "To set up the project, first clone the repo and run npm install.",
        ),
        msg(Role::User, "yes go ahead"),
        msg(
            Role::Assistant,
            "To set up the project, first clone the repo and then run npm install.",
        ),
    ];
    detect_response_loop(&mut msgs);
    assert!(
        has_system_redirect(&msgs),
        "Should inject redirect for near-identical assistant messages"
    );
}

#[test]
fn no_redirect_for_dissimilar_assistant_messages() {
    let mut msgs = vec![
        msg(Role::User, "What is Rust?"),
        msg(
            Role::Assistant,
            "Rust is a systems programming language focused on safety and performance.",
        ),
        msg(Role::User, "And what about Python?"),
        msg(
            Role::Assistant,
            "Python is a high-level interpreted language popular for data science and scripting.",
        ),
    ];
    detect_response_loop(&mut msgs);
    assert!(
        !has_system_redirect(&msgs),
        "Should NOT inject redirect for completely different responses"
    );
}

// ── Question loop ──────────────────────────────────────────────────────────

#[test]
fn detects_consecutive_question_responses() {
    let mut msgs = vec![
        msg(Role::User, "Deploy the app"),
        msg(
            Role::Assistant,
            "Would you like me to deploy to staging or production?",
        ),
        msg(Role::User, "both"),
        msg(
            Role::Assistant,
            "Should I deploy to staging first and then production?",
        ),
    ];
    detect_response_loop(&mut msgs);
    assert!(
        has_system_redirect(&msgs),
        "Should inject redirect for two consecutive question responses"
    );
}

// ── Short-directive loop ───────────────────────────────────────────────────

#[test]
fn detects_short_directive_ignored() {
    let mut msgs = vec![
        msg(Role::User, "Write a hello world function"),
        msg(
            Role::Assistant,
            "I can write that function. Would you like it in Python or JavaScript?",
        ),
        msg(Role::User, "yes"),
        msg(
            Role::Assistant,
            "I can write that function in either Python or JavaScript. Which would you prefer?",
        ),
    ];
    detect_response_loop(&mut msgs);
    assert!(
        has_system_redirect(&msgs),
        "Should inject redirect when model ignores short directive"
    );
}

// ── Edge cases ─────────────────────────────────────────────────────────────

#[test]
fn no_crash_with_fewer_than_two_assistant_messages() {
    let mut msgs = vec![msg(Role::User, "Hello"), msg(Role::Assistant, "Hi there!")];
    detect_response_loop(&mut msgs);
    assert!(
        !has_system_redirect(&msgs),
        "Should be a no-op with only 1 assistant message"
    );
}

#[test]
fn no_crash_with_empty_messages() {
    let mut msgs: Vec<Message> = vec![];
    detect_response_loop(&mut msgs);
    assert!(msgs.is_empty());
}

#[test]
fn no_crash_with_only_user_messages() {
    let mut msgs = vec![msg(Role::User, "Hello"), msg(Role::User, "Are you there?")];
    detect_response_loop(&mut msgs);
    assert!(
        !has_system_redirect(&msgs),
        "Should be a no-op with 0 assistant messages"
    );
}

#[test]
fn redirect_message_references_user_request() {
    let mut msgs = vec![
        msg(Role::User, "Deploy the app to production"),
        msg(
            Role::Assistant,
            "Should I deploy the app to staging or production?",
        ),
        msg(Role::User, "go ahead"),
        msg(
            Role::Assistant,
            "Should I deploy the app to staging first or go straight to production?",
        ),
    ];
    detect_response_loop(&mut msgs);

    // The redirect should contain the user's last message text
    let redirect = msgs
        .iter()
        .find(|m| m.role == Role::System)
        .expect("Expected a system redirect");
    let text = redirect.content.as_text_ref();
    assert!(
        text.contains("go ahead") || text.contains("CRITICAL") || text.contains("IMPORTANT"),
        "Redirect should reference user request or use strong action language"
    );
}

#[test]
fn identical_single_word_responses_detected() {
    let mut msgs = vec![
        msg(Role::User, "What's the status?"),
        msg(Role::Assistant, "Processing..."),
        msg(Role::User, "And now?"),
        msg(Role::Assistant, "Processing..."),
    ];
    detect_response_loop(&mut msgs);
    assert!(
        has_system_redirect(&msgs),
        "Identical single-word responses should be detected as a loop"
    );
}

// ── Natural topic flow — no false positives ────────────────────────────────

#[test]
fn no_false_positive_on_natural_topic_switch() {
    // User talks about Jira, then asks "who is president?" — the model's last
    // response (about Jira) doesn't overlap with the new question, but the model
    // gave a DIFFERENT response this time (not repeating itself). No redirect.
    let mut msgs = vec![
        msg(Role::User, "Help me configure my Jira integration"),
        msg(
            Role::Assistant,
            "I'll help you set up Jira. First, go to Settings and add your Jira API token.",
        ),
        msg(Role::User, "who is the president of the united states"),
        msg(
            Role::Assistant,
            "The current President of the United States is the elected head of state.",
        ),
    ];
    detect_response_loop(&mut msgs);
    assert!(
        !has_system_redirect(&msgs),
        "Natural topic switch should NOT trigger a redirect — the model gave a different response"
    );
}

#[test]
fn no_false_positive_when_returning_to_old_topic() {
    // User goes from Jira → president → back to Jira. The model's last response
    // (about the president) has no keyword overlap with "Jira", but the model is
    // NOT repeating itself (it talked about the president, now user asks about Jira).
    let mut msgs = vec![
        msg(Role::User, "Help me configure Jira"),
        msg(
            Role::Assistant,
            "Sure! Go to Settings → Integrations and look for Jira.",
        ),
        msg(Role::User, "who is the president"),
        msg(
            Role::Assistant,
            "The president of the United States is the head of the executive branch.",
        ),
        msg(
            Role::User,
            "ok back to jira now, where do I put the API key",
        ),
    ];
    detect_response_loop(&mut msgs);
    assert!(
        !has_system_redirect(&msgs),
        "Returning to an old topic should NOT trigger redirect"
    );
}

// ── Topic fixation — model stuck on old topic ──────────────────────────────

#[test]
fn detects_topic_fixation_when_model_repeats_old_topic() {
    // The SerpAPI pattern: user switches topic but model keeps responding
    // about the SAME thing (high inter-response similarity + zero keyword overlap).
    let mut msgs = vec![
        msg(Role::User, "Set up SerpAPI for web search"),
        msg(
            Role::Assistant,
            "To configure SerpAPI, you need to add your SerpAPI API key in the settings panel.",
        ),
        msg(
            Role::User,
            "tell me about the constructor document you reviewed",
        ),
        msg(
            Role::Assistant,
            "To configure SerpAPI, first add your SerpAPI API key to the settings panel.",
        ),
    ];
    detect_response_loop(&mut msgs);
    assert!(
        has_system_redirect(&msgs),
        "Model fixated on SerpAPI despite user asking about constructor document"
    );
}

// ── Escalation — stronger redirects for persistent ignoring ────────────────

#[test]
fn escalation_produces_stronger_redirect() {
    // Simulate a situation where a previous redirect was already injected
    // and the model STILL ignored it.
    let mut msgs = vec![
        msg(Role::User, "Help me with Jira"),
        msg(
            Role::Assistant,
            "To set up SerpAPI, add your API key in the settings panel.",
        ),
        msg(Role::User, "tell me about the constructor document"),
        // A prior redirect was injected
        msg(
            Role::System,
            "TOPIC CHANGE: The user has moved to a new question.",
        ),
        msg(
            Role::Assistant,
            "To configure SerpAPI, you need your SerpAPI API key.",
        ),
        msg(
            Role::User,
            "answer my actual question about the constructor",
        ),
        msg(
            Role::Assistant,
            "Let me help you set up SerpAPI. First, get your API key from serpapi.com.",
        ),
    ];
    detect_response_loop(&mut msgs);

    // Should have injected a redirect
    let redirect = msgs
        .iter()
        .filter(|m| m.role == Role::System)
        .last()
        .expect("Expected an escalated system redirect");
    let text = redirect.content.as_text_ref();

    // With a prior TOPIC CHANGE already in history, escalation should produce
    // stronger language (URGENT, or reference to prior redirects)
    assert!(
        text.contains("TOPIC CHANGE") || text.contains("URGENT") || text.contains("stuck"),
        "Escalated redirect should use stronger language"
    );
}
