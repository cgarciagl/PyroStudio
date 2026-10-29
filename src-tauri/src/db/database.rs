use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::DatabaseSchema;

/// Lists all databases and schemas with their approximate table counts.
pub async fn list_databases(
    backend: &dyn DatabaseBackend,
) -> Result<Vec<DatabaseSchema>, PyroError> {
    introspector(backend).list_databases(backend).await
}
