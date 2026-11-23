//! Cross-connection and cross-engine object & data migration (Data Transfer).
//!
//! Supports migrating tables (structure, data, or both), views, routines,
//! triggers, and events between any two connections (active or saved),
//! including across different engines (`MySql` <-> `Sqlite`).

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Emitter;

use super::backend::DatabaseBackend;
use super::connection::create_standalone_session;
use super::dialect::{Dialect, SQLITE_DIALECT};
use super::diff::fetch_schema_views;
use super::engine::DbEngine;
use super::error::PyroError;
use super::event::{get_event_definition, list_events};
use super::introspect::introspector;
use super::models::{
    ColumnMetadata, ConnectionConfig, DatabaseSchema, EventMetadata, ForeignKeyMetadata,
    IndexMetadata, RoutineMetadata, TableMetadata, TriggerMetadata,
};
use super::read_only::read_only_error;
use super::routine::{get_routine_definition, list_routines};
use super::row_filter::target_database;
use super::schema_design::{
    column_sql, design_column, foreign_key_clause, is_generated_extra, DesignColumn,
    DesignForeignKey,
};
use super::sql_utils::sql_string_literal;
use super::state::DbState;
use super::trigger::{get_trigger_definition, list_triggers};

pub const PROGRESS_EVENT: &str = "transfer-progress";
const DEFAULT_BATCH_SIZE: usize = 250;
const MAX_BATCH_SIZE: usize = 2000;

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

pub fn init_progress(app: tauri::AppHandle) {
    let _ = APP.set(app);
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressEvent {
    pub transfer_id: String,
    pub phase: String,
    pub current_object: String,
    pub completed_objects: usize,
    pub total_objects: usize,
    pub current_rows: u64,
    pub total_rows_transferred: u64,
    pub status: String,
    pub message: String,
}

fn emit_progress(event: TransferProgressEvent) {
    if let Some(app) = APP.get() {
        let _ = app.emit(PROGRESS_EVENT, event);
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferDatabaseCatalog {
    pub engine: DbEngine,
    pub databases: Vec<DatabaseSchema>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferObjectsCatalog {
    pub engine: DbEngine,
    pub tables: Vec<TableMetadata>,
    pub views: Vec<String>,
    pub routines: Vec<RoutineMetadata>,
    pub triggers: Vec<TriggerMetadata>,
    pub events: Vec<EventMetadata>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TableTransferMode {
    StructureAndData,
    StructureOnly,
    DataOnly,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TableTransferItem {
    pub name: String,
    pub mode: TableTransferMode,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RoutineTransferItem {
    pub name: String,
    pub routine_type: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct TransferOptions {
    pub drop_existing: bool,
    pub create_if_not_exists: bool,
    pub truncate_before_insert: bool,
    pub disable_foreign_keys: bool,
    pub continue_on_error: bool,
    pub batch_size: usize,
}

impl Default for TransferOptions {
    fn default() -> Self {
        Self {
            drop_existing: false,
            create_if_not_exists: true,
            truncate_before_insert: false,
            disable_foreign_keys: true,
            continue_on_error: true,
            batch_size: DEFAULT_BATCH_SIZE,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TransferRequest {
    pub transfer_id: String,
    #[serde(default)]
    pub source_connection: Option<ConnectionConfig>,
    pub source_database: String,
    #[serde(default)]
    pub target_connection: Option<ConnectionConfig>,
    pub target_database: String,
    #[serde(default)]
    pub tables: Vec<TableTransferItem>,
    #[serde(default)]
    pub views: Vec<String>,
    #[serde(default)]
    pub routines: Vec<RoutineTransferItem>,
    #[serde(default)]
    pub triggers: Vec<String>,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default)]
    pub options: TransferOptions,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferPreview {
    pub source_engine: DbEngine,
    pub target_engine: DbEngine,
    pub cross_engine: bool,
    pub warnings: Vec<String>,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferItemResult {
    pub object_type: String,
    pub name: String,
    pub status: String,
    pub rows_transferred: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferResult {
    pub source_engine: DbEngine,
    pub target_engine: DbEngine,
    pub total_objects: usize,
    pub succeeded: usize,
    pub warnings: usize,
    pub failed: usize,
    pub total_rows_transferred: u64,
    pub elapsed_ms: u64,
    pub items: Vec<TransferItemResult>,
}

struct OpenedEndpoints {
    source_standalone: Option<super::state::ActiveSession>,
    target_standalone: Option<super::state::ActiveSession>,
    active: Option<super::state::ActiveSession>,
}

impl OpenedEndpoints {
    async fn open(
        source_cfg: Option<ConnectionConfig>,
        target_cfg: Option<ConnectionConfig>,
        state: &DbState,
    ) -> Result<Self, PyroError> {
        let source_standalone = match source_cfg {
            Some(cfg) => Some(create_standalone_session(cfg).await?),
            None => None,
        };
        let target_standalone = match target_cfg {
            Some(cfg) => match create_standalone_session(cfg).await {
                Ok(sess) => Some(sess),
                Err(err) => {
                    if let Some(s) = source_standalone {
                        s.backend.close().await;
                    }
                    return Err(err);
                }
            },
            None => None,
        };
        let active = if source_standalone.is_none() || target_standalone.is_none() {
            match super::service::get_session(state).await {
                Ok(sess) => Some(sess),
                Err(err) => {
                    if let Some(s) = source_standalone {
                        s.backend.close().await;
                    }
                    if let Some(t) = target_standalone {
                        t.backend.close().await;
                    }
                    return Err(err);
                }
            }
        } else {
            None
        };
        Ok(Self {
            source_standalone,
            target_standalone,
            active,
        })
    }

    fn source(&self) -> &dyn DatabaseBackend {
        self.source_standalone
            .as_ref()
            .map(|s| &s.backend)
            .or(self.active.as_ref().map(|s| &s.backend))
            .expect("source backend must exist")
    }

    fn target(&self) -> &dyn DatabaseBackend {
        self.target_standalone
            .as_ref()
            .map(|s| &s.backend)
            .or(self.active.as_ref().map(|s| &s.backend))
            .expect("target backend must exist")
    }

    fn target_config(&self) -> &ConnectionConfig {
        self.target_standalone
            .as_ref()
            .map(|s| &s.config)
            .or(self.active.as_ref().map(|s| &s.config))
            .expect("target config must exist")
    }

    async fn close(self) {
        if let Some(s) = self.source_standalone {
            s.backend.close().await;
        }
        if let Some(t) = self.target_standalone {
            t.backend.close().await;
        }
    }
}

pub async fn inspect_transfer_databases(
    connection: Option<ConnectionConfig>,
    state: &DbState,
) -> Result<TransferDatabaseCatalog, PyroError> {
    if let Some(cfg) = connection {
        let session = create_standalone_session(cfg).await?;
        let engine = session.backend.engine();
        let res = introspector(&session.backend)
            .list_databases(&session.backend)
            .await;
        session.backend.close().await;
        Ok(TransferDatabaseCatalog {
            engine,
            databases: res?,
        })
    } else {
        let session = super::service::get_session(state).await?;
        let engine = session.backend.engine();
        let databases = introspector(&session.backend)
            .list_databases(&session.backend)
            .await?;
        Ok(TransferDatabaseCatalog { engine, databases })
    }
}

pub async fn inspect_transfer_objects(
    connection: Option<ConnectionConfig>,
    database: String,
    state: &DbState,
) -> Result<TransferObjectsCatalog, PyroError> {
    if let Some(cfg) = connection {
        let session = create_standalone_session(cfg).await?;
        let res = read_objects_catalog(&session.backend, &database).await;
        session.backend.close().await;
        res
    } else {
        let session = super::service::get_session(state).await?;
        read_objects_catalog(&session.backend, &database).await
    }
}

async fn read_objects_catalog(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<TransferObjectsCatalog, PyroError> {
    let engine = backend.engine();
    let schema = introspector(backend);
    let all_tables = schema.list_tables(backend, database).await?;

    let mut tables = Vec::new();
    let mut views = Vec::new();
    for t in all_tables {
        if t.table_type.to_ascii_uppercase().contains("VIEW") {
            views.push(t.name);
        } else {
            tables.push(t);
        }
    }

    let routines = if engine == DbEngine::MySql {
        list_routines(backend, database, None)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let triggers = list_triggers(backend, database, None)
        .await
        .unwrap_or_default();

    let events = if engine == DbEngine::MySql {
        list_events(backend, database).await.unwrap_or_default()
    } else {
        Vec::new()
    };

    Ok(TransferObjectsCatalog {
        engine,
        tables,
        views,
        routines,
        triggers,
        events,
    })
}

// ─── Cross-Engine Type & DDL Translation ─────────────────────────────────────

fn qi(engine: DbEngine, name: &str) -> Result<String, PyroError> {
    engine.dialect().quote_identifier(name)
}

fn qualify(engine: DbEngine, database: &str, object: &str) -> Result<String, PyroError> {
    let db_arg = target_database(database);
    engine.dialect().qualify_table(db_arg, object)
}

/// Maps a column type from `source_engine` to `target_engine`.
pub fn map_column_type(
    source_engine: DbEngine,
    target_engine: DbEngine,
    raw_type: &str,
    is_indexed_or_pk: bool,
) -> String {
    if source_engine == target_engine {
        return raw_type.to_string();
    }
    let lower = raw_type.trim().to_ascii_lowercase();
    let base = lower
        .split('(')
        .next()
        .unwrap_or("")
        .split_whitespace()
        .next()
        .unwrap_or("");

    match (source_engine, target_engine) {
        (DbEngine::MySql, DbEngine::Sqlite) => {
            if lower.starts_with("tinyint(1)")
                || base == "bool"
                || base == "boolean"
                || base == "bit"
            {
                "INTEGER".to_string()
            } else if base.contains("int") {
                "INTEGER".to_string()
            } else if matches!(base, "float" | "double" | "real") {
                "REAL".to_string()
            } else if matches!(base, "decimal" | "numeric") {
                "NUMERIC".to_string()
            } else if base.contains("blob") || base.contains("binary") {
                "BLOB".to_string()
            } else {
                // varchar, char, text, json, enum, set, date, datetime, timestamp, time, year
                "TEXT".to_string()
            }
        }
        (DbEngine::Sqlite, DbEngine::MySql) => {
            if base.contains("int") {
                "BIGINT".to_string()
            } else if matches!(base, "real" | "float" | "double") {
                "DOUBLE".to_string()
            } else if matches!(base, "numeric" | "decimal") {
                "DECIMAL(18,4)".to_string()
            } else if base.contains("blob") {
                "LONGBLOB".to_string()
            } else if base.contains("char") {
                if lower.contains('(') {
                    raw_type.to_string()
                } else {
                    "VARCHAR(255)".to_string()
                }
            } else if is_indexed_or_pk {
                // MySQL cannot index TEXT/BLOB columns without a prefix length.
                "VARCHAR(255)".to_string()
            } else {
                "TEXT".to_string()
            }
        }
        _ => raw_type.to_string(),
    }
}

fn translate_default(
    source_engine: DbEngine,
    target_engine: DbEngine,
    default_val: Option<String>,
    is_expr: bool,
) -> (Option<String>, bool) {
    let Some(val) = default_val else {
        return (None, false);
    };
    if source_engine == target_engine {
        return (Some(val), is_expr);
    }
    let lower = val.trim().to_ascii_lowercase();
    match (source_engine, target_engine) {
        (DbEngine::MySql, DbEngine::Sqlite) => {
            if lower.contains("current_timestamp") || lower == "now()" {
                return (Some("(datetime('now'))".to_string()), true);
            }
            if lower.starts_with("b'") && lower.ends_with('\'') && lower.len() >= 3 {
                let inner = &lower[2..lower.len() - 1];
                return (
                    Some(if inner == "1" { "1" } else { "0" }.to_string()),
                    false,
                );
            }
            (Some(val), is_expr)
        }
        (DbEngine::Sqlite, DbEngine::MySql) => {
            if lower.contains("datetime('now')") || lower.contains("current_timestamp") {
                return (Some("CURRENT_TIMESTAMP".to_string()), true);
            }
            if lower.contains("date('now')") || lower.contains("current_date") {
                return (Some("(CURDATE())".to_string()), true);
            }
            let trimmed = val.trim();
            // SQLite sometimes stores string defaults with surrounding single quotes in pragma_table_info
            if trimmed.starts_with('\'') && trimmed.ends_with('\'') && trimmed.len() >= 2 {
                let unquoted = trimmed[1..trimmed.len() - 1].replace("''", "'");
                return (Some(unquoted), false);
            }
            (Some(val), is_expr)
        }
        _ => (Some(val), is_expr),
    }
}

/// Builds the DDL statements (DROP optional + CREATE TABLE + CREATE INDEX) for a table
/// in `target_engine`, translating types and constraints when `source_engine != target_engine`.
pub fn build_table_ddl(
    source_engine: DbEngine,
    target_engine: DbEngine,
    target_db: &str,
    table_name: &str,
    columns: &[ColumnMetadata],
    indexes: &[IndexMetadata],
    fks: &[ForeignKeyMetadata],
    options: &TransferOptions,
) -> Result<(Vec<String>, Vec<String>), PyroError> {
    let mut warnings = Vec::new();
    let mut stmts = Vec::new();
    let cross_engine = source_engine != target_engine;

    let table_ref = qualify(target_engine, target_db, table_name)?;
    if options.drop_existing {
        stmts.push(format!("DROP TABLE IF EXISTS {table_ref};"));
    }

    // Determine columns referenced by PK or indexes so SQLite->MySQL TEXT columns become VARCHAR(255)
    let mut indexed_cols: HashSet<String> = HashSet::new();
    for col in columns {
        if col.column_key.eq_ignore_ascii_case("pri") {
            indexed_cols.insert(col.name.to_ascii_lowercase());
        }
    }
    for idx in indexes {
        for c in &idx.columns {
            indexed_cols.insert(c.column_name.to_ascii_lowercase());
        }
    }
    for fk in fks {
        indexed_cols.insert(fk.column_name.to_ascii_lowercase());
    }

    let mut design_cols: Vec<DesignColumn> = Vec::new();
    let mut generated_cols: Vec<String> = Vec::new();

    for col in columns {
        if is_generated_extra(&col.extra) {
            generated_cols.push(col.name.clone());
            continue;
        }
        let mut dc = design_column(source_engine, col.clone(), true);
        if cross_engine {
            let is_idx = indexed_cols.contains(&col.name.to_ascii_lowercase());
            dc.column_type = map_column_type(source_engine, target_engine, &dc.column_type, is_idx);
            let (def_val, def_expr) = translate_default(
                source_engine,
                target_engine,
                dc.default_value,
                dc.default_is_expression,
            );
            dc.default_value = def_val;
            dc.default_is_expression = def_expr;
            if target_engine == DbEngine::Sqlite {
                dc.on_update = None;
                dc.collation = None;
                dc.charset = None;
                dc.comment.clear();
            }
        }
        design_cols.push(dc);
    }

    if !generated_cols.is_empty() {
        warnings.push(format!(
            "Tabla `{table_name}`: columnas generadas omitidas ({}).",
            generated_cols.join(", ")
        ));
    }

    let pk_cols: Vec<String> = design_cols
        .iter()
        .filter(|c| c.primary_key)
        .map(|c| c.name.clone())
        .collect();

    // SQLite only supports AUTOINCREMENT on a single INTEGER PRIMARY KEY column.
    let single_pk = pk_cols.len() == 1;
    for dc in &mut design_cols {
        if target_engine == DbEngine::Sqlite && dc.auto_increment {
            if !single_pk || !dc.primary_key {
                dc.auto_increment = false;
                warnings.push(format!(
                    "Tabla `{table_name}`: AUTO_INCREMENT en `{}` omitido (SQLite solo lo soporta en PK simple).",
                    dc.name
                ));
            } else {
                dc.column_type = "INTEGER".to_string();
            }
        }
    }

    let has_inline_sqlite_pk = target_engine == DbEngine::Sqlite
        && design_cols
            .iter()
            .any(|c| c.primary_key && c.auto_increment);

    let mut lines: Vec<String> = design_cols
        .iter()
        .map(|c| format!("  {}", column_sql(target_engine, c, true)))
        .collect();

    if !pk_cols.is_empty() && !has_inline_sqlite_pk {
        let pk_list = pk_cols
            .iter()
            .map(|c| qi(target_engine, c))
            .collect::<Result<Vec<_>, _>>()?
            .join(", ");
        lines.push(format!("  PRIMARY KEY ({pk_list})"));
    }

    // Foreign keys (group multi-column FKs by constraint name preserving order)
    let mut grouped_fks: Vec<DesignForeignKey> = Vec::new();
    for fk in fks {
        if let Some(existing) = grouped_fks.iter_mut().find(|g| g.name == fk.name) {
            existing.columns.push(fk.column_name.clone());
            existing
                .referenced_columns
                .push(fk.referenced_column.clone());
        } else {
            grouped_fks.push(DesignForeignKey {
                name: fk.name.clone(),
                columns: vec![fk.column_name.clone()],
                referenced_table: fk.referenced_table.clone(),
                referenced_columns: vec![fk.referenced_column.clone()],
                on_delete: fk.delete_rule.clone(),
                on_update: fk.update_rule.clone(),
            });
        }
    }
    for dfk in &grouped_fks {
        lines.push(format!("  {}", foreign_key_clause(target_engine, dfk)));
    }

    let if_not_exists = if !options.drop_existing && options.create_if_not_exists {
        "IF NOT EXISTS "
    } else {
        ""
    };

    let create_sql = if target_engine == DbEngine::Sqlite {
        format!(
            "CREATE TABLE {if_not_exists}{table_ref} (\n{}\n);",
            lines.join(",\n")
        )
    } else {
        format!(
            "CREATE TABLE {if_not_exists}{table_ref} (\n{}\n) ENGINE=InnoDB;",
            lines.join(",\n")
        )
    };
    stmts.push(create_sql);

    // Secondary indexes
    for idx in indexes {
        if idx.is_primary {
            continue;
        }
        let col_list = idx
            .columns
            .iter()
            .map(|c| qi(target_engine, &c.column_name))
            .collect::<Result<Vec<_>, _>>()?
            .join(", ");
        if col_list.is_empty() {
            continue;
        }
        let unique = if idx.is_unique { "UNIQUE " } else { "" };
        if target_engine == DbEngine::Sqlite {
            // Index names in SQLite are schema-wide; prefix with table name if generic
            let idx_name = if idx.key_name.starts_with(&format!("{table_name}_")) {
                idx.key_name.clone()
            } else {
                format!("{table_name}_{}", idx.key_name)
            };
            let q_idx = qualify(target_engine, target_db, &idx_name)?;
            let q_tbl = qi(target_engine, table_name)?;
            stmts.push(format!(
                "CREATE {unique}INDEX IF NOT EXISTS {q_idx} ON {q_tbl} ({col_list});"
            ));
        } else {
            let q_idx = qi(target_engine, &idx.key_name)?;
            stmts.push(format!(
                "CREATE {unique}INDEX {q_idx} ON {table_ref} ({col_list});"
            ));
        }
    }

    Ok((stmts, warnings))
}

fn adapt_view_sql(
    source_engine: DbEngine,
    target_engine: DbEngine,
    source_db: &str,
    target_db: &str,
    view_name: &str,
    definition: &str,
    options: &TransferOptions,
) -> Result<(Vec<String>, Vec<String>), PyroError> {
    let mut warnings = Vec::new();
    let mut stmts = Vec::new();
    let view_ref = qualify(target_engine, target_db, view_name)?;

    if options.drop_existing {
        stmts.push(format!("DROP VIEW IF EXISTS {view_ref};"));
    }

    let mut body = definition.trim().to_string();
    // SQLite stores full `CREATE VIEW ... AS SELECT ...` in sqlite_master.sql
    if source_engine == DbEngine::Sqlite {
        if let Some(pos) = body.to_ascii_uppercase().find(" AS ") {
            body = body[pos + 4..].trim().to_string();
        }
    }

    if source_engine != target_engine {
        warnings.push(format!(
            "Vista `{view_name}`: se tradujeron identificadores entre {} y {}; revise funciones específicas del motor si falla.",
            source_engine.display_name(),
            target_engine.display_name()
        ));
        if target_engine == DbEngine::Sqlite {
            // Strip `source_db`. qualifiers and convert backticks to double quotes
            let prefix = format!("`{source_db}`.");
            body = body.replace(&prefix, "").replace('`', "\"");
        } else {
            body = body.replace('"', "`");
        }
    } else if source_engine == DbEngine::MySql && !source_db.is_empty() && !target_db.is_empty() {
        let src_prefix = format!("`{source_db}`.");
        let tgt_prefix = format!("`{target_db}`.");
        body = body.replace(&src_prefix, &tgt_prefix);
    }

    let create_kw = if target_engine == DbEngine::MySql && !options.drop_existing {
        "CREATE OR REPLACE VIEW"
    } else if target_engine == DbEngine::Sqlite
        && !options.drop_existing
        && options.create_if_not_exists
    {
        "CREATE VIEW IF NOT EXISTS"
    } else {
        "CREATE VIEW"
    };

    stmts.push(format!("{create_kw} {view_ref} AS {body};"));
    Ok((stmts, warnings))
}

fn strip_mysql_definer(ddl: &str) -> String {
    // Remove `DEFINER=`...`@`...`` clause so target users without SUPER privilege can create objects
    let upper = ddl.to_ascii_uppercase();
    if let Some(start) = upper.find("DEFINER=") {
        let rest = &ddl[start + 8..];
        let mut in_tick = false;
        let mut end_rel = 0;
        for (i, ch) in rest.char_indices() {
            if ch == '`' {
                in_tick = !in_tick;
            } else if ch.is_whitespace() && !in_tick {
                end_rel = i;
                break;
            }
        }
        if end_rel > 0 {
            let mut out = String::with_capacity(ddl.len());
            out.push_str(&ddl[..start]);
            out.push_str(rest[end_rel..].trim_start());
            return out;
        }
    }
    ddl.to_string()
}

pub async fn preview_transfer_plan(
    request: TransferRequest,
    state: &DbState,
) -> Result<TransferPreview, PyroError> {
    let endpoints = OpenedEndpoints::open(
        request.source_connection.clone(),
        request.target_connection.clone(),
        state,
    )
    .await?;

    let res = build_transfer_preview(endpoints.source(), endpoints.target(), &request).await;
    endpoints.close().await;
    res
}

async fn build_transfer_preview(
    source: &dyn DatabaseBackend,
    target: &dyn DatabaseBackend,
    request: &TransferRequest,
) -> Result<TransferPreview, PyroError> {
    let source_engine = source.engine();
    let target_engine = target.engine();
    let cross_engine = source_engine != target_engine;
    let mut warnings = Vec::new();
    let mut statements = Vec::new();

    let src_schema = introspector(source);
    let all_fks = src_schema
        .foreign_keys(source, &request.source_database)
        .await
        .unwrap_or_default();

    for item in &request.tables {
        if item.mode == TableTransferMode::DataOnly {
            if request.options.truncate_before_insert {
                let tref = qualify(target_engine, &request.target_database, &item.name)?;
                statements.push(target_engine.dialect().truncate_table(&tref));
            }
            continue;
        }
        let cols = src_schema
            .table_columns(source, &request.source_database, &item.name)
            .await?;
        let indexes = src_schema
            .list_indexes(source, &request.source_database, &item.name)
            .await
            .unwrap_or_default();
        let fks = all_fks.get(&item.name).cloned().unwrap_or_default();
        let (ddl, w) = build_table_ddl(
            source_engine,
            target_engine,
            &request.target_database,
            &item.name,
            &cols,
            &indexes,
            &fks,
            &request.options,
        )?;
        statements.extend(ddl);
        warnings.extend(w);
    }

    if !request.views.is_empty() {
        let views_map = fetch_views_for_engine(source, &request.source_database).await?;
        for view_name in &request.views {
            if let Some(def) = views_map.get(view_name) {
                let (ddl, w) = adapt_view_sql(
                    source_engine,
                    target_engine,
                    &request.source_database,
                    &request.target_database,
                    view_name,
                    def,
                    &request.options,
                )?;
                statements.extend(ddl);
                warnings.extend(w);
            }
        }
    }

    if cross_engine && (!request.routines.is_empty() || !request.events.is_empty()) {
        warnings.push(
            "Rutinas (funciones/procedimientos) y eventos no son compatibles con SQLite y serán omitidos."
                .to_string(),
        );
    }
    if cross_engine && !request.triggers.is_empty() {
        warnings.push(
            "La sintaxis de triggers difiere entre MariaDB/MySQL y SQLite; es posible que fallen si usan bloques específicos del motor."
                .to_string(),
        );
    }

    Ok(TransferPreview {
        source_engine,
        target_engine,
        cross_engine,
        warnings,
        statements,
    })
}

async fn fetch_views_for_engine(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<HashMap<String, String>, PyroError> {
    if backend.engine() == DbEngine::Sqlite {
        let schema = target_database(database).unwrap_or("main");
        let q_schema = SQLITE_DIALECT.quote_identifier(schema)?;
        let sql = format!(
            "SELECT name, sql FROM {q_schema}.sqlite_master WHERE type = 'view' AND sql IS NOT NULL"
        );
        let res = backend.execute_query(&sql, Some(schema)).await?;
        let mut map = HashMap::new();
        for row in res.rows {
            if let (Some(name), Some(sql_def)) = (
                row.first().and_then(|v| v.as_str()),
                row.get(1).and_then(|v| v.as_str()),
            ) {
                map.insert(name.to_string(), sql_def.to_string());
            }
        }
        Ok(map)
    } else {
        fetch_schema_views(backend, database).await
    }
}

pub async fn execute_data_transfer(
    request: TransferRequest,
    state: &DbState,
) -> Result<TransferResult, PyroError> {
    let endpoints = OpenedEndpoints::open(
        request.source_connection.clone(),
        request.target_connection.clone(),
        state,
    )
    .await?;

    if endpoints.target_config().read_only {
        endpoints.close().await;
        return Err(read_only_error(
            "La conexión destino está en modo solo lectura; no se puede ejecutar la migración.",
        ));
    }

    let result = run_transfer(endpoints.source(), endpoints.target(), &request).await;
    endpoints.close().await;
    result
}

async fn set_foreign_keys_enabled(backend: &dyn DatabaseBackend, database: &str, enabled: bool) {
    let db_arg = target_database(database);
    let sql = match backend.engine() {
        DbEngine::MySql => {
            if enabled {
                "SET FOREIGN_KEY_CHECKS = 1"
            } else {
                "SET FOREIGN_KEY_CHECKS = 0"
            }
        }
        DbEngine::Sqlite => {
            if enabled {
                "PRAGMA foreign_keys = ON"
            } else {
                "PRAGMA foreign_keys = OFF"
            }
        }
    };
    let _ = backend.execute_query(sql, db_arg).await;
}

async fn run_transfer(
    source: &dyn DatabaseBackend,
    target: &dyn DatabaseBackend,
    request: &TransferRequest,
) -> Result<TransferResult, PyroError> {
    let started = Instant::now();
    if request.options.disable_foreign_keys {
        set_foreign_keys_enabled(target, &request.target_database, false).await;
    }

    let inner_res = run_transfer_inner(source, target, request, started).await;

    if request.options.disable_foreign_keys {
        set_foreign_keys_enabled(target, &request.target_database, true).await;
    }

    inner_res
}

async fn run_transfer_inner(
    source: &dyn DatabaseBackend,
    target: &dyn DatabaseBackend,
    request: &TransferRequest,
    started: Instant,
) -> Result<TransferResult, PyroError> {
    let source_engine = source.engine();
    let target_engine = target.engine();
    let cross_engine = source_engine != target_engine;
    let target_db_arg = target_database(&request.target_database);
    let batch_size = request.options.batch_size.clamp(1, MAX_BATCH_SIZE);

    let total_objects = request.tables.len()
        + request.views.len()
        + request.routines.len()
        + request.triggers.len()
        + request.events.len();

    let mut completed_objects = 0usize;
    let mut total_rows_transferred = 0u64;
    let mut items = Vec::with_capacity(total_objects);

    emit_progress(TransferProgressEvent {
        transfer_id: request.transfer_id.clone(),
        phase: "preparing".into(),
        current_object: String::new(),
        completed_objects: 0,
        total_objects,
        current_rows: 0,
        total_rows_transferred: 0,
        status: "running".into(),
        message: "Preparando migración...".into(),
    });

    let src_schema = introspector(source);
    let all_fks = src_schema
        .foreign_keys(source, &request.source_database)
        .await
        .unwrap_or_default();

    let mut abort = false;

    // 1. Tables (structure + data)
    for item in &request.tables {
        if abort {
            break;
        }
        let mut table_rows = 0u64;
        let mut table_warnings: Vec<String> = Vec::new();
        let mut table_err: Option<String> = None;

        emit_progress(TransferProgressEvent {
            transfer_id: request.transfer_id.clone(),
            phase: "structure".into(),
            current_object: item.name.clone(),
            completed_objects,
            total_objects,
            current_rows: 0,
            total_rows_transferred,
            status: "running".into(),
            message: format!("Procesando tabla `{}`...", item.name),
        });

        let cols_res = src_schema
            .table_columns(source, &request.source_database, &item.name)
            .await;

        let cols = match cols_res {
            Ok(c) => c,
            Err(err) => {
                let msg = err.to_string();
                items.push(TransferItemResult {
                    object_type: "table".into(),
                    name: item.name.clone(),
                    status: "error".into(),
                    rows_transferred: 0,
                    message: msg.clone(),
                });
                completed_objects += 1;
                if !request.options.continue_on_error {
                    abort = true;
                }
                continue;
            }
        };

        if item.mode != TableTransferMode::DataOnly {
            let indexes = src_schema
                .list_indexes(source, &request.source_database, &item.name)
                .await
                .unwrap_or_default();
            let fks = all_fks.get(&item.name).cloned().unwrap_or_default();
            match build_table_ddl(
                source_engine,
                target_engine,
                &request.target_database,
                &item.name,
                &cols,
                &indexes,
                &fks,
                &request.options,
            ) {
                Ok((stmts, w)) => {
                    table_warnings.extend(w);
                    for stmt in stmts {
                        if let Err(err) = target.execute_query(&stmt, target_db_arg).await {
                            table_err = Some(err.to_string());
                            break;
                        }
                    }
                }
                Err(err) => {
                    table_err = Some(err.to_string());
                }
            }
        }

        if table_err.is_none() && item.mode != TableTransferMode::StructureOnly {
            if request.options.truncate_before_insert {
                match qualify(target_engine, &request.target_database, &item.name) {
                    Ok(tref) => {
                        let trunc_sql = target_engine.dialect().truncate_table(&tref);
                        if let Err(err) = target.execute_query(&trunc_sql, target_db_arg).await {
                            table_err = Some(format!("Error al vaciar tabla destino: {err}"));
                        }
                    }
                    Err(err) => {
                        table_err = Some(err.to_string());
                    }
                }
            }

            if table_err.is_none() {
                match transfer_table_rows(
                    source,
                    target,
                    request,
                    &item.name,
                    &cols,
                    batch_size,
                    completed_objects,
                    total_objects,
                    total_rows_transferred,
                )
                .await
                {
                    Ok(rows) => {
                        table_rows = rows;
                        total_rows_transferred += rows;
                    }
                    Err(err) => {
                        table_err = Some(err.to_string());
                    }
                }
            }
        }

        completed_objects += 1;
        let (status, message) = if let Some(err) = table_err {
            if !request.options.continue_on_error {
                abort = true;
            }
            ("error".to_string(), err)
        } else if !table_warnings.is_empty() {
            (
                "warning".to_string(),
                format!("{} ({table_rows} filas)", table_warnings.join(" ")),
            )
        } else {
            (
                "success".to_string(),
                match item.mode {
                    TableTransferMode::StructureOnly => "Estructura creada".to_string(),
                    TableTransferMode::DataOnly => format!("{table_rows} filas copiadas"),
                    TableTransferMode::StructureAndData => {
                        format!("Estructura y {table_rows} filas copiadas")
                    }
                },
            )
        };

        emit_progress(TransferProgressEvent {
            transfer_id: request.transfer_id.clone(),
            phase: "data".into(),
            current_object: item.name.clone(),
            completed_objects,
            total_objects,
            current_rows: table_rows,
            total_rows_transferred,
            status: status.clone(),
            message: message.clone(),
        });

        items.push(TransferItemResult {
            object_type: "table".into(),
            name: item.name.clone(),
            status,
            rows_transferred: table_rows,
            message,
        });
    }

    // 2. Views
    if !abort && !request.views.is_empty() {
        let views_map = fetch_views_for_engine(source, &request.source_database)
            .await
            .unwrap_or_default();
        for view_name in &request.views {
            if abort {
                break;
            }
            let mut status = "success".to_string();
            let mut message = "Vista migrada".to_string();

            if let Some(def) = views_map.get(view_name) {
                match adapt_view_sql(
                    source_engine,
                    target_engine,
                    &request.source_database,
                    &request.target_database,
                    view_name,
                    def,
                    &request.options,
                ) {
                    Ok((stmts, w)) => {
                        for stmt in stmts {
                            if let Err(err) = target.execute_query(&stmt, target_db_arg).await {
                                status = if cross_engine { "warning" } else { "error" }.into();
                                message = err.to_string();
                                if !cross_engine && !request.options.continue_on_error {
                                    abort = true;
                                }
                                break;
                            }
                        }
                        if status == "success" && !w.is_empty() {
                            status = "warning".into();
                            message = w.join(" ");
                        }
                    }
                    Err(err) => {
                        status = "error".into();
                        message = err.to_string();
                        if !request.options.continue_on_error {
                            abort = true;
                        }
                    }
                }
            } else {
                status = "error".into();
                message = "No se encontró la definición de la vista en origen.".into();
            }

            completed_objects += 1;
            emit_progress(TransferProgressEvent {
                transfer_id: request.transfer_id.clone(),
                phase: "views".into(),
                current_object: view_name.clone(),
                completed_objects,
                total_objects,
                current_rows: 0,
                total_rows_transferred,
                status: status.clone(),
                message: message.clone(),
            });
            items.push(TransferItemResult {
                object_type: "view".into(),
                name: view_name.clone(),
                status,
                rows_transferred: 0,
                message,
            });
        }
    }

    // 3. Routines (Functions & Procedures)
    for r in &request.routines {
        if abort {
            break;
        }
        let (status, message) = if cross_engine || target_engine == DbEngine::Sqlite {
            (
                "skipped".to_string(),
                "SQLite no soporta procedimientos ni funciones almacenadas.".to_string(),
            )
        } else {
            match get_routine_definition(source, &request.source_database, &r.name, &r.routine_type)
                .await
            {
                Ok(detail) => {
                    let mut ok = true;
                    let mut err_msg = String::new();
                    if request.options.drop_existing {
                        let r_ref = qualify(target_engine, &request.target_database, &r.name)?;
                        let kind = if r.routine_type.eq_ignore_ascii_case("PROCEDURE") {
                            "PROCEDURE"
                        } else {
                            "FUNCTION"
                        };
                        let _ = target
                            .execute_query(&format!("DROP {kind} IF EXISTS {r_ref}"), target_db_arg)
                            .await;
                    }
                    let ddl = strip_mysql_definer(&detail.ddl);
                    if let Err(err) = target.execute_query(&ddl, target_db_arg).await {
                        ok = false;
                        err_msg = err.to_string();
                        if !request.options.continue_on_error {
                            abort = true;
                        }
                    }
                    if ok {
                        ("success".to_string(), format!("{} migrada", r.routine_type))
                    } else {
                        ("error".to_string(), err_msg)
                    }
                }
                Err(err) => ("error".to_string(), err.to_string()),
            }
        };

        completed_objects += 1;
        emit_progress(TransferProgressEvent {
            transfer_id: request.transfer_id.clone(),
            phase: "routines".into(),
            current_object: r.name.clone(),
            completed_objects,
            total_objects,
            current_rows: 0,
            total_rows_transferred,
            status: status.clone(),
            message: message.clone(),
        });
        items.push(TransferItemResult {
            object_type: "routine".into(),
            name: r.name.clone(),
            status,
            rows_transferred: 0,
            message,
        });
    }

    // 4. Triggers
    for trig_name in &request.triggers {
        if abort {
            break;
        }
        let (status, message) = if cross_engine {
            (
                "skipped".to_string(),
                "Los triggers entre motores diferentes requieren traducción manual de cuerpo PL/SQL.".to_string(),
            )
        } else {
            match get_trigger_definition(source, &request.source_database, trig_name).await {
                Ok(detail) => {
                    if request.options.drop_existing {
                        let t_ref = qualify(target_engine, &request.target_database, trig_name)?;
                        let _ = target
                            .execute_query(
                                &format!("DROP TRIGGER IF EXISTS {t_ref}"),
                                target_db_arg,
                            )
                            .await;
                    }
                    let ddl = if target_engine == DbEngine::MySql {
                        strip_mysql_definer(&detail.ddl)
                    } else {
                        detail.ddl
                    };
                    match target.execute_query(&ddl, target_db_arg).await {
                        Ok(_) => ("success".to_string(), "Trigger migrado".to_string()),
                        Err(err) => {
                            if !request.options.continue_on_error {
                                abort = true;
                            }
                            ("error".to_string(), err.to_string())
                        }
                    }
                }
                Err(err) => ("error".to_string(), err.to_string()),
            }
        };

        completed_objects += 1;
        emit_progress(TransferProgressEvent {
            transfer_id: request.transfer_id.clone(),
            phase: "triggers".into(),
            current_object: trig_name.clone(),
            completed_objects,
            total_objects,
            current_rows: 0,
            total_rows_transferred,
            status: status.clone(),
            message: message.clone(),
        });
        items.push(TransferItemResult {
            object_type: "trigger".into(),
            name: trig_name.clone(),
            status,
            rows_transferred: 0,
            message,
        });
    }

    // 5. Events
    for ev_name in &request.events {
        if abort {
            break;
        }
        let (status, message) = if cross_engine || target_engine == DbEngine::Sqlite {
            (
                "skipped".to_string(),
                "SQLite no soporta eventos programados.".to_string(),
            )
        } else {
            match get_event_definition(source, &request.source_database, ev_name).await {
                Ok(detail) => {
                    if request.options.drop_existing {
                        let e_ref = qualify(target_engine, &request.target_database, ev_name)?;
                        let _ = target
                            .execute_query(&format!("DROP EVENT IF EXISTS {e_ref}"), target_db_arg)
                            .await;
                    }
                    let ddl = strip_mysql_definer(&detail.ddl);
                    match target.execute_query(&ddl, target_db_arg).await {
                        Ok(_) => ("success".to_string(), "Evento migrado".to_string()),
                        Err(err) => {
                            if !request.options.continue_on_error {
                                abort = true;
                            }
                            ("error".to_string(), err.to_string())
                        }
                    }
                }
                Err(err) => ("error".to_string(), err.to_string()),
            }
        };

        completed_objects += 1;
        emit_progress(TransferProgressEvent {
            transfer_id: request.transfer_id.clone(),
            phase: "events".into(),
            current_object: ev_name.clone(),
            completed_objects,
            total_objects,
            current_rows: 0,
            total_rows_transferred,
            status: status.clone(),
            message: message.clone(),
        });
        items.push(TransferItemResult {
            object_type: "event".into(),
            name: ev_name.clone(),
            status,
            rows_transferred: 0,
            message,
        });
    }

    let succeeded = items.iter().filter(|i| i.status == "success").count();
    let warnings = items
        .iter()
        .filter(|i| i.status == "warning" || i.status == "skipped")
        .count();
    let failed = items.iter().filter(|i| i.status == "error").count();
    let elapsed_ms = started.elapsed().as_millis() as u64;

    emit_progress(TransferProgressEvent {
        transfer_id: request.transfer_id.clone(),
        phase: "completed".into(),
        current_object: String::new(),
        completed_objects,
        total_objects,
        current_rows: 0,
        total_rows_transferred,
        status: if failed > 0 { "warning" } else { "success" }.into(),
        message: format!(
            "Migración finalizada en {elapsed_ms} ms ({succeeded} exitosos, {warnings} advertencias, {failed} errores)."
        ),
    });

    Ok(TransferResult {
        source_engine,
        target_engine,
        total_objects,
        succeeded,
        warnings,
        failed,
        total_rows_transferred,
        elapsed_ms,
        items,
    })
}

#[allow(clippy::too_many_arguments)]
async fn transfer_table_rows(
    source: &dyn DatabaseBackend,
    target: &dyn DatabaseBackend,
    request: &TransferRequest,
    table_name: &str,
    columns: &[ColumnMetadata],
    batch_size: usize,
    completed_objects: usize,
    total_objects: usize,
    total_rows_so_far: u64,
) -> Result<u64, PyroError> {
    let source_engine = source.engine();
    let target_engine = target.engine();
    let src_db_arg = target_database(&request.source_database);
    let tgt_db_arg = target_database(&request.target_database);

    let insertable_cols: Vec<&ColumnMetadata> = columns
        .iter()
        .filter(|c| !is_generated_extra(&c.extra))
        .collect();
    if insertable_cols.is_empty() {
        return Ok(0);
    }

    let src_table_ref = qualify(source_engine, &request.source_database, table_name)?;
    let tgt_table_ref = qualify(target_engine, &request.target_database, table_name)?;

    let src_select_cols = insertable_cols
        .iter()
        .map(|c| qi(source_engine, &c.name))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");

    let tgt_insert_cols = insertable_cols
        .iter()
        .map(|c| qi(target_engine, &c.name))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");

    let pk_cols: Vec<String> = insertable_cols
        .iter()
        .filter(|c| c.column_key.eq_ignore_ascii_case("pri"))
        .map(|c| qi(source_engine, &c.name))
        .collect::<Result<Vec<_>, _>>()?;

    let order_clause = if pk_cols.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", pk_cols.join(", "))
    };

    let target_dialect = target_engine.dialect();
    let mut offset = 0usize;
    let mut copied = 0u64;

    loop {
        let select_sql = format!(
            "SELECT {src_select_cols} FROM {src_table_ref}{order_clause} LIMIT {batch_size} OFFSET {offset}"
        );
        let chunk = source.execute_query(&select_sql, src_db_arg).await?;
        let row_count = chunk.rows.len();
        if row_count == 0 {
            break;
        }

        let mut values_sql = Vec::with_capacity(row_count);
        for row in &chunk.rows {
            let row_literals: Vec<String> = (0..insertable_cols.len())
                .map(|idx| {
                    let val = row.get(idx).unwrap_or(&Value::Null);
                    format_value_for_target(target_dialect, val)
                })
                .collect();
            values_sql.push(format!("({})", row_literals.join(", ")));
        }

        let insert_sql = format!(
            "INSERT INTO {tgt_table_ref} ({tgt_insert_cols}) VALUES {};",
            values_sql.join(", ")
        );
        target.execute_query(&insert_sql, tgt_db_arg).await?;

        copied += row_count as u64;
        offset += row_count;

        emit_progress(TransferProgressEvent {
            transfer_id: request.transfer_id.clone(),
            phase: "data".into(),
            current_object: table_name.to_string(),
            completed_objects,
            total_objects,
            current_rows: copied,
            total_rows_transferred: total_rows_so_far + copied,
            status: "running".into(),
            message: format!("Copiando `{table_name}` ({copied} filas)..."),
        });

        if row_count < batch_size {
            break;
        }
    }

    Ok(copied)
}

fn format_value_for_target(dialect: &dyn Dialect, value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => dialect.string_literal(s),
        other => sql_string_literal(dialect, &other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::IndexColumn;

    #[test]
    fn maps_mysql_types_to_sqlite() {
        assert_eq!(
            map_column_type(DbEngine::MySql, DbEngine::Sqlite, "int(11)", true),
            "INTEGER"
        );
        assert_eq!(
            map_column_type(DbEngine::MySql, DbEngine::Sqlite, "tinyint(1)", false),
            "INTEGER"
        );
        assert_eq!(
            map_column_type(DbEngine::MySql, DbEngine::Sqlite, "varchar(255)", false),
            "TEXT"
        );
        assert_eq!(
            map_column_type(DbEngine::MySql, DbEngine::Sqlite, "decimal(10,2)", false),
            "NUMERIC"
        );
        assert_eq!(
            map_column_type(DbEngine::MySql, DbEngine::Sqlite, "longblob", false),
            "BLOB"
        );
    }

    #[test]
    fn maps_sqlite_types_to_mysql_including_indexed_text() {
        assert_eq!(
            map_column_type(DbEngine::Sqlite, DbEngine::MySql, "INTEGER", true),
            "BIGINT"
        );
        assert_eq!(
            map_column_type(DbEngine::Sqlite, DbEngine::MySql, "TEXT", false),
            "TEXT"
        );
        assert_eq!(
            map_column_type(DbEngine::Sqlite, DbEngine::MySql, "TEXT", true),
            "VARCHAR(255)"
        );
        assert_eq!(
            map_column_type(DbEngine::Sqlite, DbEngine::MySql, "REAL", false),
            "DOUBLE"
        );
    }

    #[test]
    fn builds_cross_engine_table_ddl_mysql_to_sqlite() {
        let cols = vec![
            ColumnMetadata {
                name: "id".into(),
                ordinal_position: 1,
                column_default: None,
                is_nullable: false,
                data_type: "int".into(),
                column_type: "int(11)".into(),
                column_key: "PRI".into(),
                extra: "auto_increment".into(),
                comment: "pk".into(),
                collation: Some("utf8mb4_general_ci".into()),
                character_set: None,
            },
            ColumnMetadata {
                name: "email".into(),
                ordinal_position: 2,
                column_default: None,
                is_nullable: false,
                data_type: "varchar".into(),
                column_type: "varchar(180)".into(),
                column_key: "UNI".into(),
                extra: "".into(),
                comment: "".into(),
                collation: Some("utf8mb4_general_ci".into()),
                character_set: None,
            },
            ColumnMetadata {
                name: "created_at".into(),
                ordinal_position: 3,
                column_default: Some("CURRENT_TIMESTAMP".into()),
                is_nullable: false,
                data_type: "timestamp".into(),
                column_type: "timestamp".into(),
                column_key: "".into(),
                extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP".into(),
                comment: "".into(),
                collation: None,
                character_set: None,
            },
        ];
        let indexes = vec![IndexMetadata {
            key_name: "idx_email".into(),
            is_primary: false,
            is_unique: true,
            index_type: "BTREE".into(),
            columns: vec![IndexColumn {
                seq_in_index: 1,
                column_name: "email".into(),
                sub_part: None,
                collation: None,
            }],
            comment: None,
        }];
        let opts = TransferOptions {
            drop_existing: true,
            create_if_not_exists: true,
            ..Default::default()
        };

        let (stmts, warnings) = build_table_ddl(
            DbEngine::MySql,
            DbEngine::Sqlite,
            "main",
            "users",
            &cols,
            &indexes,
            &[],
            &opts,
        )
        .unwrap();

        assert!(warnings.is_empty());
        assert_eq!(stmts[0], "DROP TABLE IF EXISTS \"main\".\"users\";");
        assert!(stmts[1].contains("\"id\" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT"));
        assert!(stmts[1].contains("\"email\" TEXT NOT NULL"));
        assert!(stmts[1].contains("DEFAULT (datetime('now'))"));
        assert!(!stmts[1].contains("ENGINE=InnoDB"));
        assert!(stmts[2].contains("CREATE UNIQUE INDEX IF NOT EXISTS \"main\".\"users_idx_email\" ON \"users\" (\"email\")"));
    }

    #[test]
    fn adapts_view_between_mysql_and_sqlite() {
        let opts = TransferOptions::default();
        let (stmts, warnings) = adapt_view_sql(
            DbEngine::MySql,
            DbEngine::Sqlite,
            "app_db",
            "main",
            "active_users",
            "select `app_db`.`users`.`id` AS `id` from `app_db`.`users`",
            &opts,
        )
        .unwrap();

        assert_eq!(warnings.len(), 1);
        assert!(stmts[0].starts_with(
            "CREATE VIEW IF NOT EXISTS \"main\".\"active_users\" AS select \"users\".\"id\""
        ));
    }
}
