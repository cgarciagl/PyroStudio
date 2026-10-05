use futures_util::future::BoxFuture;
use sqlx::MySqlPool;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::backend::{DatabaseBackend, DirectBackend, TunnelBackend};
use super::error::PyroError;
use super::models::{
    CellUpdateRequest, ConnectionConfig, DeleteRowRequest, QueryExecutionResult, ServerInfo,
};

#[derive(Clone)]
pub enum SessionBackend {
    Direct(DirectBackend),
    Tunnel(TunnelBackend),
}

impl DatabaseBackend for SessionBackend {
    fn execute_query<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        match self {
            Self::Direct(b) => b.execute_query(sql, database),
            Self::Tunnel(b) => b.execute_query(sql, database),
        }
    }

    fn update_cell<'a>(
        &'a self,
        req: &'a CellUpdateRequest,
    ) -> BoxFuture<'a, Result<(), PyroError>> {
        match self {
            Self::Direct(b) => b.update_cell(req),
            Self::Tunnel(b) => b.update_cell(req),
        }
    }

    fn delete_row<'a>(&'a self, req: &'a DeleteRowRequest) -> BoxFuture<'a, Result<(), PyroError>> {
        match self {
            Self::Direct(b) => b.delete_row(req),
            Self::Tunnel(b) => b.delete_row(req),
        }
    }

    fn close<'a>(&'a self) -> BoxFuture<'a, ()> {
        match self {
            Self::Direct(b) => b.close(),
            Self::Tunnel(b) => b.close(),
        }
    }
}

impl SessionBackend {
    pub fn direct_pool(&self) -> Option<&MySqlPool> {
        match self {
            Self::Direct(d) => Some(d.pool()),
            Self::Tunnel(_) => None,
        }
    }
}

#[derive(Clone)]
pub struct ActiveSession {
    pub backend: SessionBackend,
    pub config: ConnectionConfig,
    pub server_info: ServerInfo,
}

impl ActiveSession {
    pub fn pool(&self) -> Result<MySqlPool, PyroError> {
        self.backend.direct_pool().cloned().ok_or_else(|| {
            PyroError::InvalidOperation(
                "Operación directa de pool no soportada mediante Túnel HTTP".into(),
            )
        })
    }
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
