use std::sync::Arc;
use tokio::sync::RwLock;
use sqlx::MySqlPool;

use super::models::{ConnectionConfig, ServerInfo};
use super::tunnel::TunnelClient;

#[derive(Clone)]
pub enum SessionBackend {
    Direct(MySqlPool),
    Tunnel(TunnelClient),
}

#[derive(Clone)]
pub struct ActiveSession {
    pub backend: SessionBackend,
    pub config: ConnectionConfig,
    pub server_info: ServerInfo,
}

#[derive(Clone, Default)]
pub struct DbState {
    pub session: Arc<RwLock<Option<ActiveSession>>>,
}

impl DbState {
    pub fn new() -> Self {
        Self {
            session: Arc::new(RwLock::new(None)),
        }
    }
}
