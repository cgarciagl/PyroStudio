use futures_util::future::BoxFuture;
use futures_util::FutureExt;
use std::collections::HashMap;

use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{
    ColumnMetadata, DatabaseSchema, ForeignKeyMetadata, IndexMetadata, PrimaryKey,
    TableExtendedStats, TableMetadata, TriggerDetail, TriggerMetadata,
};

pub type IntrospectFuture<'a, T> = BoxFuture<'a, Result<T, PyroError>>;

pub struct TableStorage {
    pub statistics: TableExtendedStats,
    pub ddl: String,
}

/// Reads schema metadata with engine-specific catalog queries. Implementations
/// run plain SQL through the backend, so they work over any transport.
pub trait SchemaIntrospector: Send + Sync {
    fn list_databases<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
    ) -> IntrospectFuture<'a, Vec<DatabaseSchema>>;

    fn list_tables<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
    ) -> IntrospectFuture<'a, Vec<TableMetadata>>;

    fn table_columns<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, Vec<ColumnMetadata>>;

    /// Columns that identify a row; empty when the table cannot be edited safely.
    fn primary_key<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, PrimaryKey>;

    /// Table name → column names, for editor autocompletion.
    fn completion_schema<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
    ) -> IntrospectFuture<'a, HashMap<String, Vec<String>>>;

    fn list_indexes<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, Vec<IndexMetadata>>;

    fn list_triggers<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: Option<&'a str>,
    ) -> IntrospectFuture<'a, Vec<TriggerMetadata>>;

    fn trigger_definition<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        name: &'a str,
    ) -> IntrospectFuture<'a, TriggerDetail>;

    /// Table name → its foreign keys.
    fn foreign_keys<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
    ) -> IntrospectFuture<'a, HashMap<String, Vec<ForeignKeyMetadata>>>;

    /// Physical statistics and creation DDL of a table.
    fn table_storage<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, TableStorage>;

    /// Select list used to browse a table; engines with an implicit row id add
    /// it so rows without a primary key stay editable.
    fn browse_select_list<'a>(
        &self,
        _backend: &'a dyn DatabaseBackend,
        _database: &'a str,
        _table: &'a str,
    ) -> IntrospectFuture<'a, String> {
        async { Ok("*".to_string()) }.boxed()
    }
}

/// Introspector matching the engine behind `backend`.
pub fn introspector(backend: &dyn DatabaseBackend) -> &'static dyn SchemaIntrospector {
    backend.engine().introspector()
}
