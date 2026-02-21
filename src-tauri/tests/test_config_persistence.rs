// Integration test: Config persistence (set → get → overwrite → get)

use paw_temp_lib::engine::sessions::SessionStore;
use parking_lot::Mutex;
use rusqlite::Connection;

fn test_store() -> SessionStore {
    let conn = Connection::open_in_memory().expect("Failed to open in-memory DB");
    conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
    paw_temp_lib::engine::sessions::schema_for_testing(&conn);
    SessionStore { conn: Mutex::new(conn) }
}

#[test]
fn get_config_returns_none_for_missing_key() {
    let store = test_store();
    let result = store.get_config("nonexistent").unwrap();
    assert!(result.is_none());
}

#[test]
fn set_and_get_config() {
    let store = test_store();
    store.set_config("theme", "dark").unwrap();
    let value = store.get_config("theme").unwrap();
    assert_eq!(value.as_deref(), Some("dark"));
}

#[test]
fn set_config_overwrites_existing() {
    let store = test_store();
    store.set_config("theme", "dark").unwrap();
    store.set_config("theme", "light").unwrap();
    let value = store.get_config("theme").unwrap();
    assert_eq!(value.as_deref(), Some("light"));
}

#[test]
fn config_stores_json_values() {
    let store = test_store();
    let json = r#"{"auto_approve":true,"max_trade_usd":50.0}"#;
    store.set_config("trading_policy", json).unwrap();
    let value = store.get_config("trading_policy").unwrap().unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&value).unwrap();
    assert_eq!(parsed["auto_approve"], true);
    assert_eq!(parsed["max_trade_usd"], 50.0);
}

#[test]
fn config_handles_empty_value() {
    let store = test_store();
    store.set_config("empty_key", "").unwrap();
    let value = store.get_config("empty_key").unwrap();
    assert_eq!(value.as_deref(), Some(""));
}

#[test]
fn config_handles_special_characters() {
    let store = test_store();
    let val = "this has 'quotes' and \"double quotes\" and\nnewlines";
    store.set_config("special", val).unwrap();
    let result = store.get_config("special").unwrap().unwrap();
    assert_eq!(result, val);
}
