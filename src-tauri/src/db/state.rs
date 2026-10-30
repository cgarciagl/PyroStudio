use futures_util::future::{BoxFuture, FutureExt};
use std::sync::Arc;
use tokio::sync::RwLock;

use super::audit::{self, AuditEntry};
use super::backend::{
    BackendTransaction, DatabaseBackend, DirectBackend, EngineError, PinnedSession, RowStream,
    TableTransactionality, TunnelBackend,
};
use super::engine::DbEngine;
use super::error::PyroError;
use super::models::{
    CellUpdateRequest, ConnectionConfig, DeleteRowRequest, QueryExecutionResult, ServerInfo,
};
use super::param_query::ParamQuery;
use super::read_only;
use std::time::Instant;

/// Statements that change data or schema (everything a read-only connection rejects).
fn is_write(sql: &str) -> bool {
    read_only::ensure_read_only_sql(sql).is_err()
}
use super::sqlite::SqliteBackend;
use super::ssh::SshTunnel;

#[derive(Clone)]
pub enum SessionTransport {
    Direct(DirectBackend),
    Tunnel(Box<TunnelBackend>),
    Ssh {
        backend: DirectBackend,
        tunnel: SshTunnel,
    },
    Sqlite(SqliteBackend),
}

impl SessionTransport {
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

/// Backend of the active session: the transport plus the connection-level
/// guards every caller goes through (read-only connections, audit log).
#[derive(Clone)]
pub struct SessionBackend {
    pub transport: SessionTransport,
    pub read_only: bool,
    /// Connection name written to the audit log.
    pub audit_label: String,
}

/// Runs `operation` and appends its outcome to the audit log.
async fn audited<T>(
    mut entry: AuditEntry,
    operation: BoxFuture<'_, Result<T, PyroError>>,
    affected_rows: impl FnOnce(&T) -> Option<u64>,
) -> Result<T, PyroError> {
    let start = Instant::now();
    let result = operation.await;
    entry.duration_ms = start.elapsed().as_millis() as u64;
    match &result {
        Ok(value) => entry.affected_rows = affected_rows(value),
        Err(error) => {
            entry.success = false;
            entry.error = Some(error.to_string());
        }
    }
    audit::record(entry);
    result
}

/// Transaction opened through `begin_transaction` (Excel/CSV import...). It writes a
/// single audit entry when it ends, so a large import does not flood the log with
/// one line per row.
struct AuditedTransaction {
    inner: Option<Box<dyn BackendTransaction>>,
    entry: Option<AuditEntry>,
    start: Instant,
    statements: usize,
    first_sql: Option<String>,
    rows: u64,
    last_error: Option<String>,
}

impl AuditedTransaction {
    fn new(inner: Box<dyn BackendTransaction>, label: &str) -> Self {
        Self {
            inner: Some(inner),
            entry: Some(AuditEntry::new(label, None, "")),
            start: Instant::now(),
            statements: 0,
            first_sql: None,
            rows: 0,
            last_error: None,
        }
    }

    /// Records the summary once; `outcome` is the commit/rollback error, if any.
    fn finish(&mut self, committed: bool, outcome: Option<String>) {
        let Some(mut entry) = self.entry.take() else {
            return;
        };
        if self.statements == 0 {
            return;
        }
        let end = if committed { "COMMIT" } else { "ROLLBACK" };
        let first = self.first_sql.as_deref().unwrap_or("");
        entry.sql = audit::truncate(&format!(
            "-- Transacción: {} sentencia(s), {end}\n{first}",
            self.statements
        ));
        entry.affected_rows = Some(self.rows);
        entry.duration_ms = self.start.elapsed().as_millis() as u64;
        let error = outcome.or_else(|| {
            (!committed).then(|| {
                self.last_error
                    .clone()
                    .unwrap_or_else(|| "Transacción revertida".to_string())
            })
        });
        entry.success = error.is_none();
        entry.error = error;
        audit::record(entry);
    }
}

impl BackendTransaction for AuditedTransaction {
    fn execute<'a>(&'a mut self, query: &'a ParamQuery) -> BoxFuture<'a, Result<u64, EngineError>> {
        async move {
            let inner = self.inner.as_mut().expect("transaction already finished");
            let result = inner.execute(query).await;
            self.statements += 1;
            if self.first_sql.is_none() {
                self.first_sql = Some(query.sql().to_string());
            }
            match &result {
                Ok(rows) => self.rows += rows,
                Err(error) => self.last_error = Some(error.message.clone()),
            }
            result
        }
        .boxed()
    }

    fn commit(mut self: Box<Self>) -> BoxFuture<'static, Result<(), EngineError>> {
        let inner = self.inner.take().expect("transaction already finished");
        async move {
            let result = inner.commit().await;
            self.finish(
                result.is_ok(),
                result.as_ref().err().map(|e| e.message.clone()),
            );
            result
        }
        .boxed()
    }

    fn rollback(mut self: Box<Self>) -> BoxFuture<'static, Result<(), EngineError>> {
        let inner = self.inner.take().expect("transaction already finished");
        async move {
            let result = inner.rollback().await;
            self.finish(false, None);
            result
        }
        .boxed()
    }
}

impl Drop for AuditedTransaction {
    /// Dropped without commit: the engine rolls it back.
    fn drop(&mut self) {
        self.finish(false, None);
    }
}

impl SessionBackend {
    pub fn new(transport: SessionTransport, read_only: bool, audit_label: String) -> Self {
        Self {
            transport,
            read_only,
            audit_label,
        }
    }

    fn audit_entry(&self, database: Option<&str>, sql: &str) -> AuditEntry {
        AuditEntry::new(&self.audit_label, database, sql)
    }

    fn active(&self) -> &dyn DatabaseBackend {
        self.transport.active()
    }

    fn guard_sql(&self, sql: &str) -> Result<(), PyroError> {
        if self.read_only {
            read_only::ensure_read_only_sql(sql)?;
        }
        Ok(())
    }

    fn guard_write(&self, operation: &str) -> Result<(), PyroError> {
        if self.read_only {
            return Err(read_only::read_only_error(operation));
        }
        Ok(())
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
        if let Err(error) = self.guard_sql(sql) {
            return async move { Err(error) }.boxed();
        }
        let operation = self.active().execute_query(sql, database);
        if !is_write(sql) {
            return operation;
        }
        let entry = self.audit_entry(database, sql);
        audited(entry, operation, |r| Some(r.affected_rows)).boxed()
    }

    fn execute_query_cancellable<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
        query_id: Option<&'a str>,
    ) -> BoxFuture<'a, Result<QueryExecutionResult, PyroError>> {
        if let Err(error) = self.guard_sql(sql) {
            return async move { Err(error) }.boxed();
        }
        let operation = self
            .active()
            .execute_query_cancellable(sql, database, query_id);
        if !is_write(sql) {
            return operation;
        }
        let entry = self.audit_entry(database, sql);
        audited(entry, operation, |r| Some(r.affected_rows)).boxed()
    }

    fn execute_batch<'a>(
        &'a self,
        queries: &'a [&'a str],
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<Vec<QueryExecutionResult>, PyroError>> {
        if let Err(error) = queries.iter().try_for_each(|sql| self.guard_sql(sql)) {
            return async move { Err(error) }.boxed();
        }
        let operation = self.active().execute_batch(queries, database);
        let writes: Vec<&str> = queries.iter().copied().filter(|q| is_write(q)).collect();
        if writes.is_empty() {
            return operation;
        }
        let entry = self.audit_entry(database, &writes.join(";\n"));
        audited(entry, operation, |results| {
            Some(results.iter().map(|r| r.affected_rows).sum())
        })
        .boxed()
    }

    fn cancel_query<'a>(&'a self, query_id: &'a str) -> BoxFuture<'a, Result<bool, PyroError>> {
        self.active().cancel_query(query_id)
    }

    fn update_cell<'a>(
        &'a self,
        req: &'a CellUpdateRequest,
    ) -> BoxFuture<'a, Result<(), PyroError>> {
        if let Err(error) = self.guard_write("edición de celdas") {
            return async move { Err(error) }.boxed();
        }
        let description = format!(
            "-- edición en grid\nUPDATE `{}`.`{}` SET `{}` = …",
            req.database, req.table, req.column_name
        );
        let entry = self.audit_entry(Some(&req.database), &description);
        audited(entry, self.active().update_cell(req), |_| Some(1)).boxed()
    }

    fn delete_row<'a>(&'a self, req: &'a DeleteRowRequest) -> BoxFuture<'a, Result<(), PyroError>> {
        if let Err(error) = self.guard_write("borrado de filas") {
            return async move { Err(error) }.boxed();
        }
        let description = format!(
            "-- borrado en grid\nDELETE FROM `{}`.`{}` …",
            req.database, req.table
        );
        let entry = self.audit_entry(Some(&req.database), &description);
        audited(entry, self.active().delete_row(req), |_| Some(1)).boxed()
    }

    fn execute_transaction<'a>(
        &'a self,
        statements: &'a [String],
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<usize, PyroError>> {
        if let Err(error) = self.guard_write("transacción de escritura") {
            return async move { Err(error) }.boxed();
        }
        let entry = self.audit_entry(database, &statements.join(";\n"));
        let operation = self.active().execute_transaction(statements, database);
        audited(entry, operation, |count| Some(*count as u64)).boxed()
    }

    fn stream_rows<'a>(
        &'a self,
        sql: &'a str,
        database: Option<&'a str>,
    ) -> BoxFuture<'a, Result<RowStream, EngineError>> {
        if let Err(error) = self.guard_sql(sql) {
            return async move { Err(error.into()) }.boxed();
        }
        self.active().stream_rows(sql, database)
    }

    fn supports_transactions(&self) -> bool {
        self.active().supports_transactions()
    }

    fn begin_transaction(&self) -> BoxFuture<'_, Result<Box<dyn BackendTransaction>, EngineError>> {
        if let Err(error) = self.guard_write("transacción de escritura") {
            return async move { Err(error.into()) }.boxed();
        }
        let label = self.audit_label.clone();
        let operation = self.active().begin_transaction();
        async move {
            let inner = operation.await?;
            Ok(Box::new(AuditedTransaction::new(inner, &label)) as Box<dyn BackendTransaction>)
        }
        .boxed()
    }

    fn execute_params<'a>(
        &'a self,
        query: &'a ParamQuery,
    ) -> BoxFuture<'a, Result<u64, EngineError>> {
        if let Err(error) = self.guard_write("escritura con parámetros") {
            return async move { Err(error.into()) }.boxed();
        }
        let mut entry = self.audit_entry(None, query.sql());
        let operation = self.active().execute_params(query);
        async move {
            let start = Instant::now();
            let result = operation.await;
            entry.duration_ms = start.elapsed().as_millis() as u64;
            match &result {
                Ok(rows) => entry.affected_rows = Some(*rows),
                Err(error) => {
                    entry.success = false;
                    entry.error = Some(error.to_string());
                }
            }
            audit::record(entry);
            result
        }
        .boxed()
    }

    fn table_transactionality<'a>(
        &'a self,
        database: &'a str,
        table: &'a str,
    ) -> BoxFuture<'a, Result<TableTransactionality, EngineError>> {
        self.active().table_transactionality(database, table)
    }

    fn open_pinned_session(&self) -> BoxFuture<'_, Result<Box<dyn PinnedSession>, PyroError>> {
        // Statements on a pinned session are guarded by `manual_tx`, which
        // checks read-only connections before running them.
        self.active().open_pinned_session()
    }

    fn close<'a>(&'a self) -> BoxFuture<'a, ()> {
        if let SessionTransport::Ssh { tunnel, .. } = &self.transport {
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
