use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::{TriggerDetail, TriggerMetadata};
use super::row_filter::target_database;

/// Lists all triggers for a database or table.
pub async fn list_triggers(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: Option<&str>,
) -> Result<Vec<TriggerMetadata>, PyroError> {
    introspector(backend)
        .list_triggers(backend, database, table)
        .await
}

/// Retrieves the DDL and configuration details of a trigger.
pub async fn get_trigger_definition(
    backend: &dyn DatabaseBackend,
    database: &str,
    name: &str,
) -> Result<TriggerDetail, PyroError> {
    introspector(backend)
        .trigger_definition(backend, database, name)
        .await
}

/// Drops a trigger.
pub async fn drop_trigger(
    backend: &dyn DatabaseBackend,
    database: &str,
    name: &str,
) -> Result<(), PyroError> {
    let db_arg = target_database(database);
    let trigger_ref = backend.engine().dialect().qualify_table(db_arg, name)?;
    let sql = format!("DROP TRIGGER IF EXISTS {trigger_ref}");
    backend.execute_query(&sql, db_arg).await?;
    Ok(())
}

/// Saves a trigger, replacing any previous version if renamed.
pub async fn save_trigger(
    backend: &dyn DatabaseBackend,
    database: &str,
    old_name: Option<&str>,
    ddl: &str,
) -> Result<(), PyroError> {
    let db_arg = target_database(database);

    if let Some(name) = old_name {
        if !name.trim().is_empty() {
            let old_ref = backend
                .engine()
                .dialect()
                .qualify_table(db_arg, name.trim())?;
            let drop_sql = format!("DROP TRIGGER IF EXISTS {old_ref}");
            backend.execute_query(&drop_sql, db_arg).await?;
        }
    }

    backend.execute_query(ddl, db_arg).await?;
    Ok(())
}
