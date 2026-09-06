pub mod commands;

use std::sync::Arc;
use protofs_core::cache::CacheDatabase;
use protofs_core::mtproto::MockTelegramTransport;
use protofs_core::sync::SyncEngine;
use commands::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    println!("Initializing ProtoFS Core Runtime...");
    let transport = Arc::new(MockTelegramTransport::new());
    let cache = CacheDatabase::open_in_memory()?;
    let engine = Arc::new(SyncEngine::new(transport, cache.clone()));

    let _app_state = AppState { engine, cache };
    println!("ProtoFS Core Runtime ready. Frontend dist mounted.");

    Ok(())
}
