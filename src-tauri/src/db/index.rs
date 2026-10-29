use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::{CreateIndexRequest, IndexMetadata};
use super::row_filter::target_database;

/// Lists all indexes for a specific table.
pub async fn list_indexes(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Vec<IndexMetadata>, PyroError> {
    introspector(backend)
        .list_indexes(backend, database, table)
        .await
}

/// Creates a new index on a table.
pub async fn create_index(
    backend: &dyn DatabaseBackend,
    req: CreateIndexRequest,
) -> Result<(), PyroError> {
    let sql = backend.engine().dialect().create_index(&req)?;
    backend
        .execute_query(&sql, target_database(&req.database))
        .await?;
    Ok(())
}

/// Drops an index by name or PRIMARY key.
pub async fn drop_index(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
    index_name: &str,
) -> Result<(), PyroError> {
    let database = target_database(database);
    let sql = backend
        .engine()
        .dialect()
        .drop_index(database, table, index_name)?;
    backend.execute_query(&sql, database).await?;
    Ok(())
}
