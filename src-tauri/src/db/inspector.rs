use super::backend::DatabaseBackend;
use super::diff::fetch_schema_foreign_keys;
use super::error::PyroError;
use super::index::list_indexes;
use super::introspect::introspector;
use super::models::TableInspectorDetails;
use super::table::get_table_columns;
use super::trigger::list_triggers;

/// Gathers comprehensive table inspection details (structure, indexes, FKs, triggers, stats, and DDL).
pub async fn get_table_inspector_details(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<TableInspectorDetails, PyroError> {
    let (structure_res, indexes_res, fks_res, triggers_res, storage_res) = tokio::join!(
        get_table_columns(backend, database, table),
        list_indexes(backend, database, table),
        fetch_schema_foreign_keys(backend, database),
        list_triggers(backend, database, None),
        introspector(backend).table_storage(backend, database, table)
    );

    let structure = structure_res?;
    let indexes = indexes_res.unwrap_or_default();
    let foreign_keys = fks_res
        .unwrap_or_default()
        .get(table)
        .cloned()
        .unwrap_or_default();
    let triggers = triggers_res
        .unwrap_or_default()
        .into_iter()
        .filter(|t| t.table_name.eq_ignore_ascii_case(table))
        .collect();
    let storage = storage_res?;

    Ok(TableInspectorDetails {
        structure,
        indexes,
        foreign_keys,
        triggers,
        statistics: storage.statistics,
        ddl: storage.ddl,
    })
}
