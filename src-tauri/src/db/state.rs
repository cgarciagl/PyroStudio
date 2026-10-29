use futures_util::future::BoxFuture;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::backend::{
    BackendTransaction, DatabaseBackend, DirectBackend, EngineError, RowStream,
    TableTransactionality, TunnelBackend,
};
use super::engine::DbEngine;
use super::error::PyroError;
use super::models::{
    CellUpdateRequest, ConnectionConfig, DeleteRowRequest, QueryExecutionResult, ServerInfo,
};
use super::param_query::ParamQuery;
use super::sqlite::SqliteBackend;
use super::ssh::SshTunnel;

#[derive(Clone)]
pub enum SessionBackend {
    Direct(DirectBackend),
    Tunnel(Box<TunnelBackend>),
    Ssh {
        backend: DirectBackend,
        tunnel: SshTunnel,
    },
    Sqlite(SqliteBackend),
}

impl SessionBackend {
    /// Backend that actually runs the statements, whatever the transport.
    fn active(&self) -> &dyn DatabaseBackend {
        match self {
            Self::Direct(backend) => backend,
            Self::Tunnel(backend) => backend.as_ref(),
            Self::Ssh { backend, .. } => backend,
            Self::Sqlite(backend) => backend,
        }
    }
}

impl DatabaseBackend for SessionBackend {
    fn engine(&self) -> DbEngine {
        self.active().engine()
    }

    fn execute_query<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        self.active().execute_query(sql, database)
    }

    fn execute_query_cancellable<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
        query_id: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        self.active()
            .execute_query_cancellable(sql, database, query_id)
    }

    fn execute_batch<'a>(
        &'a self,
        queries: &'a [&'a str],
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<Vec<QueryExecutionResult>, PyroError>> {
        self.active().execute_batch(queries, database)
    }

    fn cancel_query<'a>(&'a self, query_id: &'a str) -> BoxFuture<'a, Result<bool, PyroError>> {
        self.active().cancel_query(query_id)
    }

    fn update_cell<'a>(
        &'a self,
        req: &'a CellUpdateRequest,
    ) -> BoxFuture<'a, Result<(), PyroError>> {
        self.active().update_cell(req)
    }

    fn delete_row<'a>(&'a self, req: &'a DeleteRowRequest) -> BoxFuture<'a, Result<(), PyroError>> {
        self.active().delete_row(req)
    }

    fn execute_transaction<'a>(
        &'a self,
        statements: &'a [String],
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<usize, PyroError>> {
        self.active().execute_transaction(statements, database)
    }

    fn stream_rows<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<RowStream, EngineError>> {
        self.active().stream_rows(sql, database)
    }

    fn supports_transactions(&self) -> bool {
        self.active().supports_transactions()
    }

    fn begin_transaction(&self) -> BoxFuture<'_, Result<Box<dyn BackendTransaction>, EngineError>> {
        self.active().begin_transaction()
    }

    fn execute_params<'a>(
        &'a self,
        query: &'a ParamQuery,
    ) -> BoxFuture<'a, Result<u64, EngineError>> {
        self.active().execute_params(query)
    }

    fn table_transactionality<'a>(
        &'a self,
        database: &'a str,
        table: &'a str,
    ) -> BoxFuture<'a, Result<TableTransactionality, EngineError>> {
        self.active().table_transactionality(database, table)
    }

    fn close<'a>(&'a self) -> BoxFuture<'a, ()> {
        if let Self::Ssh { tunnel, .. } = self {
            let close_pool = self.active().close();
            tunnel.close();
            return close_pool;
        }
        self.active().close()
    }
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
