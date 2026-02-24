// Integration test: Session lifecycle (create → messages → list → delete)
// Uses an in-memory SQLite database to avoid touching the real engine DB.

use super::test_store;

#[test]
fn create_session_returns_valid_session() {
    let store = test_store();
    let session = store.create_session("s1", "gpt-4", Some("You are helpful"), None).unwrap();
    assert_eq!(session.id, "s1");
    assert_eq!(session.model, "gpt-4");
    assert_eq!(session.system_prompt.as_deref(), Some("You are helpful"));
    assert_eq!(session.message_count, 0);
}

#[test]
fn list_sessions_returns_created_sessions() {
    let store = test_store();
    store.create_session("s1", "gpt-4", None, None).unwrap();
    store.create_session("s2", "claude-3", None, None).unwrap();
    let sessions = store.list_sessions(10).unwrap();
    assert_eq!(sessions.len(), 2);
}

#[test]
fn list_sessions_respects_limit() {
    let store = test_store();
    for i in 0..5 {
        store.create_session(&format!("s{}", i), "gpt-4", None, None).unwrap();
    }
    let sessions = store.list_sessions(3).unwrap();
    assert_eq!(sessions.len(), 3);
}

#[test]
fn delete_session_removes_it() {
    let store = test_store();
    store.create_session("s1", "gpt-4", None, None).unwrap();
    store.delete_session("s1").unwrap();
    let sessions = store.list_sessions(10).unwrap();
    assert!(sessions.is_empty());
}

#[test]
fn rename_session_updates_label() {
    let store = test_store();
    store.create_session("s1", "gpt-4", None, None).unwrap();
    store.rename_session("s1", "My Chat").unwrap();
    let session = store.get_session("s1").unwrap().unwrap();
    assert_eq!(session.label.as_deref(), Some("My Chat"));
}

#[test]
fn add_message_increments_count() {
    let store = test_store();
    store.create_session("s1", "gpt-4", None, None).unwrap();

    let msg = paw_temp_lib::atoms::types::StoredMessage {
        id: "m1".into(),
        session_id: "s1".into(),
        role: "user".into(),
        content: "Hello".into(),
        tool_calls_json: None,
        tool_call_id: None,
        name: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    store.add_message(&msg).unwrap();

    let session = store.get_session("s1").unwrap().unwrap();
    assert_eq!(session.message_count, 1);
}

#[test]
fn get_messages_returns_added_messages() {
    let store = test_store();
    store.create_session("s1", "gpt-4", None, None).unwrap();

    for i in 0..3 {
        let msg = paw_temp_lib::atoms::types::StoredMessage {
            id: format!("m{}", i),
            session_id: "s1".into(),
            role: if i % 2 == 0 { "user".into() } else { "assistant".into() },
            content: format!("Message {}", i),
            tool_calls_json: None,
            tool_call_id: None,
            name: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        store.add_message(&msg).unwrap();
    }

    let messages = store.get_messages("s1", 100).unwrap();
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0].content, "Message 0");
    assert_eq!(messages[0].role, "user");
}

#[test]
fn delete_session_cascades_messages() {
    let store = test_store();
    store.create_session("s1", "gpt-4", None, None).unwrap();

    let msg = paw_temp_lib::atoms::types::StoredMessage {
        id: "m1".into(),
        session_id: "s1".into(),
        role: "user".into(),
        content: "Hello".into(),
        tool_calls_json: None,
        tool_call_id: None,
        name: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    store.add_message(&msg).unwrap();
    store.delete_session("s1").unwrap();

    let messages = store.get_messages("s1", 100).unwrap();
    assert!(messages.is_empty());
}
