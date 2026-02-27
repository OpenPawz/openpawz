// Integration test: Loop detection & redirect injection
//
// Exercises detect_response_loop from engine::chat to verify:
// - Cross-turn repetition detection (Jaccard similarity)
// - Question-loop detection (consecutive `?`-ending responses)
// - Topic-ignoring detection
// - Short-directive loop detection
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
                || m.content.as_text_ref().contains("loop"))
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
    let mut msgs = vec![
        msg(Role::User, "Hello"),
        msg(Role::Assistant, "Hi there!"),
    ];
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
    let mut msgs = vec![
        msg(Role::User, "Hello"),
        msg(Role::User, "Are you there?"),
    ];
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
