use crate::OutputFormat;
use clap::Subcommand;
use openpawz_core::engine::sessions::SessionStore;

#[derive(Subcommand)]
pub enum MemoryAction {
    /// List stored memories
    List {
        /// Maximum memories to show
        #[arg(long, default_value = "20")]
        limit: usize,
        /// Filter by agent ID
        #[arg(long)]
        agent: Option<String>,
    },
    /// Store a new memory
    Store {
        /// Memory content
        content: String,
        /// Category (e.g. "general", "preference", "fact")
        #[arg(long, default_value = "general")]
        category: String,
        /// Importance (0-10)
        #[arg(long, default_value = "5")]
        importance: u8,
        /// Agent ID
        #[arg(long)]
        agent: Option<String>,
    },
    /// Delete a memory
    Delete {
        /// Memory ID
        id: String,
    },
}

pub async fn run(
    store: &SessionStore,
    action: MemoryAction,
    format: &OutputFormat,
) -> Result<(), String> {
    match action {
        MemoryAction::List { limit, agent: _ } => {
            let memories = store.list_memories(limit).map_err(|e| e.to_string())?;
            match format {
                OutputFormat::Json => {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&memories).map_err(|e| e.to_string())?
                    );
                }
                OutputFormat::Quiet => {
                    for m in &memories {
                        println!("{}", m.id);
                    }
                }
                OutputFormat::Human => {
                    if memories.is_empty() {
                        println!("No memories stored.");
                    } else {
                        for m in &memories {
                            println!(
                                "[{}] ({}, imp:{}) {}",
                                &m.id[..8.min(m.id.len())],
                                m.category,
                                m.importance,
                                truncate(&m.content, 100)
                            );
                        }
                        println!("\n{} memor(ies)", memories.len());
                    }
                }
            }
            Ok(())
        }
        MemoryAction::Store {
            content,
            category,
            importance,
            agent,
        } => {
            let id = uuid::Uuid::new_v4().to_string();
            store
                .store_memory(&id, &content, &category, importance, None, agent.as_deref())
                .map_err(|e| e.to_string())?;
            match format {
                OutputFormat::Json => {
                    println!("{}", serde_json::json!({ "id": id, "status": "stored" }));
                }
                OutputFormat::Quiet => println!("{}", id),
                OutputFormat::Human => {
                    println!("Stored memory {} ({})", &id[..8], category);
                }
            }
            Ok(())
        }
        MemoryAction::Delete { id } => {
            store.delete_memory(&id).map_err(|e| e.to_string())?;
            match format {
                OutputFormat::Quiet => {}
                _ => println!("Deleted memory '{}'", id),
            }
            Ok(())
        }
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..s.floor_char_boundary(max - 1)])
    }
}
