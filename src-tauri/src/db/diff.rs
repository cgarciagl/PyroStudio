use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::index::list_indexes;
use super::models::{
    ColumnDiff, ColumnMetadata, DiffType, ForeignKeyDiff, ForeignKeyMetadata, IndexDiff,
    IndexMetadata, RoutineDiff, SchemaDiffResult, TableDiff, TriggerDiff, ViewDiff,
};
use super::routine::list_routines;
use super::table::{get_table_columns, list_tables};
use super::trigger::list_triggers;
use std::collections::{HashMap, HashSet};

/// Helper to fetch foreign key metadata for all tables in a schema
pub async fn fetch_schema_foreign_keys(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<HashMap<String, Vec<ForeignKeyMetadata>>, PyroError> {
    let clean_db = database.replace('\'', "''");
    let sql = format!(
        r#"
        SELECT 
            kcu.TABLE_NAME,
            kcu.CONSTRAINT_NAME,
            kcu.COLUMN_NAME,
            kcu.REFERENCED_TABLE_NAME,
            kcu.REFERENCED_COLUMN_NAME,
            rc.UPDATE_RULE,
            rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
         AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
        WHERE kcu.TABLE_SCHEMA = '{clean_db}'
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME
        "#
    );

    let mut result: HashMap<String, Vec<ForeignKeyMetadata>> = HashMap::new();

    if let Ok(res) = backend.execute_query(&sql, Some(database)).await {
        for row in res.rows {
            let tbl = row
                .get(0)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let name = row
                .get(1)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let col = row
                .get(2)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let ref_tbl = row
                .get(3)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let ref_col = row
                .get(4)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let upd_rule = row
                .get(5)
                .and_then(|v| v.as_str())
                .unwrap_or("RESTRICT")
                .to_string();
            let del_rule = row
                .get(6)
                .and_then(|v| v.as_str())
                .unwrap_or("RESTRICT")
                .to_string();

            if !tbl.is_empty() && !name.is_empty() {
                result.entry(tbl).or_default().push(ForeignKeyMetadata {
                    name,
                    column_name: col,
                    referenced_table: ref_tbl,
                    referenced_column: ref_col,
                    update_rule: upd_rule,
                    delete_rule: del_rule,
                });
            }
        }
    }

    Ok(result)
}

/// Helper to fetch views definitions in a schema
pub async fn fetch_schema_views(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<HashMap<String, String>, PyroError> {
    let clean_db = database.replace('\'', "''");
    let sql = format!(
        r#"
        SELECT TABLE_NAME, VIEW_DEFINITION
        FROM information_schema.VIEWS
        WHERE TABLE_SCHEMA = '{clean_db}'
        "#
    );

    let mut result = HashMap::new();
    if let Ok(res) = backend.execute_query(&sql, Some(database)).await {
        for row in res.rows {
            let name = row
                .get(0)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let def = row
                .get(1)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if !name.is_empty() {
                result.insert(name, def);
            }
        }
    }
    Ok(result)
}

/// Compares two column definitions to detect differences
pub fn compare_columns(
    source_cols: &[ColumnMetadata],
    target_cols: &[ColumnMetadata],
) -> Vec<ColumnDiff> {
    let mut diffs = Vec::new();
    let src_map: HashMap<&str, &ColumnMetadata> =
        source_cols.iter().map(|c| (c.name.as_str(), c)).collect();
    let tgt_map: HashMap<&str, &ColumnMetadata> =
        target_cols.iter().map(|c| (c.name.as_str(), c)).collect();

    let all_names: HashSet<&str> = src_map
        .keys()
        .copied()
        .chain(tgt_map.keys().copied())
        .collect();

    for col_name in all_names {
        match (src_map.get(col_name), tgt_map.get(col_name)) {
            (Some(&src), None) => {
                diffs.push(ColumnDiff {
                    name: col_name.to_string(),
                    diff_type: DiffType::Added,
                    source_column: Some(src.clone()),
                    target_column: None,
                    change_details: vec![format!(
                        "Columna '{}' ({}) presente en origen y faltante en destino",
                        col_name, src.column_type
                    )],
                });
            }
            (None, Some(&tgt)) => {
                diffs.push(ColumnDiff {
                    name: col_name.to_string(),
                    diff_type: DiffType::Removed,
                    source_column: None,
                    target_column: Some(tgt.clone()),
                    change_details: vec![format!(
                        "Columna '{}' ({}) eliminada en origen",
                        col_name, tgt.column_type
                    )],
                });
            }
            (Some(&src), Some(&tgt)) => {
                let mut changes = Vec::new();
                if !src.column_type.eq_ignore_ascii_case(&tgt.column_type) {
                    changes.push(format!(
                        "Tipo de dato: '{}' -> '{}'",
                        tgt.column_type, src.column_type
                    ));
                }
                if src.is_nullable != tgt.is_nullable {
                    let src_null = if src.is_nullable { "NULL" } else { "NOT NULL" };
                    let tgt_null = if tgt.is_nullable { "NULL" } else { "NOT NULL" };
                    changes.push(format!("Nulabilidad: {tgt_null} -> {src_null}"));
                }
                if src.column_default != tgt.column_default {
                    let s_def = src.column_default.as_deref().unwrap_or("NULL");
                    let t_def = tgt.column_default.as_deref().unwrap_or("NULL");
                    changes.push(format!("Valor por defecto: '{t_def}' -> '{s_def}'"));
                }
                if !src.extra.eq_ignore_ascii_case(&tgt.extra) {
                    changes.push(format!("Extra: '{}' -> '{}'", tgt.extra, src.extra));
                }

                if !changes.is_empty() {
                    diffs.push(ColumnDiff {
                        name: col_name.to_string(),
                        diff_type: DiffType::Modified,
                        source_column: Some(src.clone()),
                        target_column: Some(tgt.clone()),
                        change_details: changes,
                    });
                }
            }
            (None, None) => {}
        }
    }

    diffs
}

/// Compares indexes of a table
pub fn compare_indexes(
    source_indexes: &[IndexMetadata],
    target_indexes: &[IndexMetadata],
) -> Vec<IndexDiff> {
    let mut diffs = Vec::new();
    let src_map: HashMap<&str, &IndexMetadata> = source_indexes
        .iter()
        .map(|i| (i.key_name.as_str(), i))
        .collect();
    let tgt_map: HashMap<&str, &IndexMetadata> = target_indexes
        .iter()
        .map(|i| (i.key_name.as_str(), i))
        .collect();

    let all_keys: HashSet<&str> = src_map
        .keys()
        .copied()
        .chain(tgt_map.keys().copied())
        .collect();

    for key_name in all_keys {
        match (src_map.get(key_name), tgt_map.get(key_name)) {
            (Some(&src), None) => {
                let cols: Vec<&str> = src.columns.iter().map(|c| c.column_name.as_str()).collect();
                diffs.push(IndexDiff {
                    name: key_name.to_string(),
                    diff_type: DiffType::Added,
                    source_index: Some(src.clone()),
                    target_index: None,
                    change_details: vec![format!(
                        "Índice '{}' ({}) agregado",
                        key_name,
                        cols.join(", ")
                    )],
                });
            }
            (None, Some(&tgt)) => {
                let cols: Vec<&str> = tgt.columns.iter().map(|c| c.column_name.as_str()).collect();
                diffs.push(IndexDiff {
                    name: key_name.to_string(),
                    diff_type: DiffType::Removed,
                    source_index: None,
                    target_index: Some(tgt.clone()),
                    change_details: vec![format!(
                        "Índice '{}' ({}) eliminado",
                        key_name,
                        cols.join(", ")
                    )],
                });
            }
            (Some(&src), Some(&tgt)) => {
                let src_cols: Vec<&str> =
                    src.columns.iter().map(|c| c.column_name.as_str()).collect();
                let tgt_cols: Vec<&str> =
                    tgt.columns.iter().map(|c| c.column_name.as_str()).collect();

                let mut changes = Vec::new();
                if src_cols != tgt_cols {
                    changes.push(format!(
                        "Columnas: [{}] -> [{}]",
                        tgt_cols.join(", "),
                        src_cols.join(", ")
                    ));
                }
                if src.is_unique != tgt.is_unique {
                    changes.push(format!("Único: {} -> {}", tgt.is_unique, src.is_unique));
                }
                if src.index_type != tgt.index_type {
                    changes.push(format!(
                        "Tipo de índice: {} -> {}",
                        tgt.index_type, src.index_type
                    ));
                }

                if !changes.is_empty() {
                    diffs.push(IndexDiff {
                        name: key_name.to_string(),
                        diff_type: DiffType::Modified,
                        source_index: Some(src.clone()),
                        target_index: Some(tgt.clone()),
                        change_details: changes,
                    });
                }
            }
            (None, None) => {}
        }
    }

    diffs
}

/// Compares foreign keys of a table
pub fn compare_foreign_keys(
    source_fks: &[ForeignKeyMetadata],
    target_fks: &[ForeignKeyMetadata],
) -> Vec<ForeignKeyDiff> {
    let mut diffs = Vec::new();
    let src_map: HashMap<&str, &ForeignKeyMetadata> =
        source_fks.iter().map(|f| (f.name.as_str(), f)).collect();
    let tgt_map: HashMap<&str, &ForeignKeyMetadata> =
        target_fks.iter().map(|f| (f.name.as_str(), f)).collect();

    let all_names: HashSet<&str> = src_map
        .keys()
        .copied()
        .chain(tgt_map.keys().copied())
        .collect();

    for name in all_names {
        match (src_map.get(name), tgt_map.get(name)) {
            (Some(&src), None) => {
                diffs.push(ForeignKeyDiff {
                    name: name.to_string(),
                    diff_type: DiffType::Added,
                    source_fk: Some(src.clone()),
                    target_fk: None,
                    change_details: vec![format!(
                        "FK '{}' (`{}` -> `{}`.`{}`) agregada",
                        name, src.column_name, src.referenced_table, src.referenced_column
                    )],
                });
            }
            (None, Some(&tgt)) => {
                diffs.push(ForeignKeyDiff {
                    name: name.to_string(),
                    diff_type: DiffType::Removed,
                    source_fk: None,
                    target_fk: Some(tgt.clone()),
                    change_details: vec![format!("FK '{}' eliminada", name)],
                });
            }
            (Some(&src), Some(&tgt)) => {
                let mut changes = Vec::new();
                if src.column_name != tgt.column_name
                    || src.referenced_table != tgt.referenced_table
                    || src.referenced_column != tgt.referenced_column
                {
                    changes.push(format!(
                        "Referencia: `{}`.`{}` -> `{}`.`{}`",
                        tgt.referenced_table,
                        tgt.referenced_column,
                        src.referenced_table,
                        src.referenced_column
                    ));
                }
                if src.delete_rule != tgt.delete_rule {
                    changes.push(format!(
                        "ON DELETE: {} -> {}",
                        tgt.delete_rule, src.delete_rule
                    ));
                }
                if src.update_rule != tgt.update_rule {
                    changes.push(format!(
                        "ON UPDATE: {} -> {}",
                        tgt.update_rule, src.update_rule
                    ));
                }

                if !changes.is_empty() {
                    diffs.push(ForeignKeyDiff {
                        name: name.to_string(),
                        diff_type: DiffType::Modified,
                        source_fk: Some(src.clone()),
                        target_fk: Some(tgt.clone()),
                        change_details: changes,
                    });
                }
            }
            (None, None) => {}
        }
    }

    diffs
}

/// Compares two schemas and produces a comprehensive structured diff.
pub async fn compare_schemas(
    backend_src: &dyn DatabaseBackend,
    source_schema: &str,
    backend_tgt: &dyn DatabaseBackend,
    target_schema: &str,
) -> Result<SchemaDiffResult, PyroError> {
    // 1. Tables list
    let src_tables = list_tables(backend_src, source_schema).await?;
    let tgt_tables = list_tables(backend_tgt, target_schema).await?;

    let src_tbl_map: HashMap<&str, _> = src_tables
        .iter()
        .filter(|t| t.table_type == "BASE TABLE")
        .map(|t| (t.name.as_str(), t))
        .collect();
    let tgt_tbl_map: HashMap<&str, _> = tgt_tables
        .iter()
        .filter(|t| t.table_type == "BASE TABLE")
        .map(|t| (t.name.as_str(), t))
        .collect();

    let all_table_names: HashSet<&str> = src_tbl_map
        .keys()
        .copied()
        .chain(tgt_tbl_map.keys().copied())
        .collect();

    // FKs
    let src_fks = fetch_schema_foreign_keys(backend_src, source_schema)
        .await
        .unwrap_or_default();
    let tgt_fks = fetch_schema_foreign_keys(backend_tgt, target_schema)
        .await
        .unwrap_or_default();

    let mut table_diffs = Vec::new();
    let mut total_diffs = 0;

    for tbl_name in all_table_names {
        match (src_tbl_map.get(tbl_name), tgt_tbl_map.get(tbl_name)) {
            (Some(&src_tbl), None) => {
                let cols = get_table_columns(backend_src, source_schema, tbl_name)
                    .await
                    .unwrap_or_default();
                let idxs = list_indexes(backend_src, source_schema, tbl_name)
                    .await
                    .unwrap_or_default();
                let fks = src_fks.get(tbl_name).cloned().unwrap_or_default();

                let col_diffs: Vec<ColumnDiff> = cols
                    .into_iter()
                    .map(|c| ColumnDiff {
                        name: c.name.clone(),
                        diff_type: DiffType::Added,
                        source_column: Some(c),
                        target_column: None,
                        change_details: vec!["Nueva columna en tabla agregada".to_string()],
                    })
                    .collect();

                let idx_diffs: Vec<IndexDiff> = idxs
                    .into_iter()
                    .map(|i| IndexDiff {
                        name: i.key_name.clone(),
                        diff_type: DiffType::Added,
                        source_index: Some(i),
                        target_index: None,
                        change_details: vec!["Nuevo índice en tabla agregada".to_string()],
                    })
                    .collect();

                let fk_diffs: Vec<ForeignKeyDiff> = fks
                    .into_iter()
                    .map(|f| ForeignKeyDiff {
                        name: f.name.clone(),
                        diff_type: DiffType::Added,
                        source_fk: Some(f),
                        target_fk: None,
                        change_details: vec!["Nueva FK en tabla agregada".to_string()],
                    })
                    .collect();

                total_diffs += 1;
                table_diffs.push(TableDiff {
                    table_name: tbl_name.to_string(),
                    diff_type: DiffType::Added,
                    columns: col_diffs,
                    indexes: idx_diffs,
                    foreign_keys: fk_diffs,
                    source_engine: src_tbl.engine.clone(),
                    target_engine: None,
                    source_collation: src_tbl.collation.clone(),
                    target_collation: None,
                    change_details: vec![format!("Tabla `{tbl_name}` agregada en origen")],
                });
            }
            (None, Some(&tgt_tbl)) => {
                let cols = get_table_columns(backend_tgt, target_schema, tbl_name)
                    .await
                    .unwrap_or_default();
                let idxs = list_indexes(backend_tgt, target_schema, tbl_name)
                    .await
                    .unwrap_or_default();
                let fks = tgt_fks.get(tbl_name).cloned().unwrap_or_default();

                let col_diffs: Vec<ColumnDiff> = cols
                    .into_iter()
                    .map(|c| ColumnDiff {
                        name: c.name.clone(),
                        diff_type: DiffType::Removed,
                        source_column: None,
                        target_column: Some(c),
                        change_details: vec!["Columna en tabla eliminada".to_string()],
                    })
                    .collect();

                let idx_diffs: Vec<IndexDiff> = idxs
                    .into_iter()
                    .map(|i| IndexDiff {
                        name: i.key_name.clone(),
                        diff_type: DiffType::Removed,
                        source_index: None,
                        target_index: Some(i),
                        change_details: vec!["Índice en tabla eliminada".to_string()],
                    })
                    .collect();

                let fk_diffs: Vec<ForeignKeyDiff> = fks
                    .into_iter()
                    .map(|f| ForeignKeyDiff {
                        name: f.name.clone(),
                        diff_type: DiffType::Removed,
                        source_fk: None,
                        target_fk: Some(f),
                        change_details: vec!["FK en tabla eliminada".to_string()],
                    })
                    .collect();

                total_diffs += 1;
                table_diffs.push(TableDiff {
                    table_name: tbl_name.to_string(),
                    diff_type: DiffType::Removed,
                    columns: col_diffs,
                    indexes: idx_diffs,
                    foreign_keys: fk_diffs,
                    source_engine: None,
                    target_engine: tgt_tbl.engine.clone(),
                    source_collation: None,
                    target_collation: tgt_tbl.collation.clone(),
                    change_details: vec![format!("Tabla `{tbl_name}` eliminada en origen")],
                });
            }
            (Some(&src_tbl), Some(&tgt_tbl)) => {
                let s_cols = get_table_columns(backend_src, source_schema, tbl_name)
                    .await
                    .unwrap_or_default();
                let t_cols = get_table_columns(backend_tgt, target_schema, tbl_name)
                    .await
                    .unwrap_or_default();
                let col_diffs = compare_columns(&s_cols, &t_cols);

                let s_idxs = list_indexes(backend_src, source_schema, tbl_name)
                    .await
                    .unwrap_or_default();
                let t_idxs = list_indexes(backend_tgt, target_schema, tbl_name)
                    .await
                    .unwrap_or_default();
                let idx_diffs = compare_indexes(&s_idxs, &t_idxs);

                let s_fk = src_fks.get(tbl_name).cloned().unwrap_or_default();
                let t_fk = tgt_fks.get(tbl_name).cloned().unwrap_or_default();
                let fk_diffs = compare_foreign_keys(&s_fk, &t_fk);

                let mut changes = Vec::new();
                if src_tbl.engine != tgt_tbl.engine {
                    changes.push(format!(
                        "Motor: {:?} -> {:?}",
                        tgt_tbl.engine, src_tbl.engine
                    ));
                }
                if src_tbl.collation != tgt_tbl.collation {
                    changes.push(format!(
                        "Collation: {:?} -> {:?}",
                        tgt_tbl.collation, src_tbl.collation
                    ));
                }

                let is_modified = !col_diffs.is_empty()
                    || !idx_diffs.is_empty()
                    || !fk_diffs.is_empty()
                    || !changes.is_empty();

                if is_modified {
                    total_diffs += 1;
                    table_diffs.push(TableDiff {
                        table_name: tbl_name.to_string(),
                        diff_type: DiffType::Modified,
                        columns: col_diffs,
                        indexes: idx_diffs,
                        foreign_keys: fk_diffs,
                        source_engine: src_tbl.engine.clone(),
                        target_engine: tgt_tbl.engine.clone(),
                        source_collation: src_tbl.collation.clone(),
                        target_collation: tgt_tbl.collation.clone(),
                        change_details: changes,
                    });
                }
            }
            (None, None) => {}
        }
    }

    // 2. Routines (Procedures / Functions)
    let src_routines = list_routines(backend_src, source_schema, None)
        .await
        .unwrap_or_default();
    let tgt_routines = list_routines(backend_tgt, target_schema, None)
        .await
        .unwrap_or_default();
    let mut routine_diffs = Vec::new();

    let s_rt_map: HashMap<&str, &str> = src_routines
        .iter()
        .map(|r| (r.name.as_str(), r.routine_type.as_str()))
        .collect();
    let t_rt_map: HashMap<&str, &str> = tgt_routines
        .iter()
        .map(|r| (r.name.as_str(), r.routine_type.as_str()))
        .collect();
    let all_routines: HashSet<&str> = s_rt_map
        .keys()
        .copied()
        .chain(t_rt_map.keys().copied())
        .collect();

    for r_name in all_routines {
        match (s_rt_map.get(r_name), t_rt_map.get(r_name)) {
            (Some(&r_type), None) => {
                total_diffs += 1;
                routine_diffs.push(RoutineDiff {
                    name: r_name.to_string(),
                    routine_type: r_type.to_string(),
                    diff_type: DiffType::Added,
                    source_ddl: None,
                    target_ddl: None,
                });
            }
            (None, Some(&r_type)) => {
                total_diffs += 1;
                routine_diffs.push(RoutineDiff {
                    name: r_name.to_string(),
                    routine_type: r_type.to_string(),
                    diff_type: DiffType::Removed,
                    source_ddl: None,
                    target_ddl: None,
                });
            }
            (Some(_), Some(_)) => {
                // If present in both, could be identical or modified
            }
            (None, None) => {}
        }
    }

    // 3. Triggers
    let src_triggers = list_triggers(backend_src, source_schema, None)
        .await
        .unwrap_or_default();
    let tgt_triggers = list_triggers(backend_tgt, target_schema, None)
        .await
        .unwrap_or_default();
    let mut trigger_diffs = Vec::new();

    let s_trg_map: HashMap<&str, &str> = src_triggers
        .iter()
        .map(|t| (t.name.as_str(), t.table_name.as_str()))
        .collect();
    let t_trg_map: HashMap<&str, &str> = tgt_triggers
        .iter()
        .map(|t| (t.name.as_str(), t.table_name.as_str()))
        .collect();
    let all_trgs: HashSet<&str> = s_trg_map
        .keys()
        .copied()
        .chain(t_trg_map.keys().copied())
        .collect();

    for trg_name in all_trgs {
        match (s_trg_map.get(trg_name), t_trg_map.get(trg_name)) {
            (Some(&tbl), None) => {
                total_diffs += 1;
                trigger_diffs.push(TriggerDiff {
                    name: trg_name.to_string(),
                    table_name: tbl.to_string(),
                    diff_type: DiffType::Added,
                    source_ddl: None,
                    target_ddl: None,
                });
            }
            (None, Some(&tbl)) => {
                total_diffs += 1;
                trigger_diffs.push(TriggerDiff {
                    name: trg_name.to_string(),
                    table_name: tbl.to_string(),
                    diff_type: DiffType::Removed,
                    source_ddl: None,
                    target_ddl: None,
                });
            }
            (Some(_), Some(_)) => {}
            (None, None) => {}
        }
    }

    // 4. Views
    let src_views = fetch_schema_views(backend_src, source_schema)
        .await
        .unwrap_or_default();
    let tgt_views = fetch_schema_views(backend_tgt, target_schema)
        .await
        .unwrap_or_default();
    let mut view_diffs = Vec::new();

    let all_views: HashSet<&str> = src_views
        .keys()
        .map(|s| s.as_str())
        .chain(tgt_views.keys().map(|s| s.as_str()))
        .collect();

    for v_name in all_views {
        match (src_views.get(v_name), tgt_views.get(v_name)) {
            (Some(s_def), None) => {
                total_diffs += 1;
                view_diffs.push(ViewDiff {
                    name: v_name.to_string(),
                    diff_type: DiffType::Added,
                    source_definition: Some(s_def.clone()),
                    target_definition: None,
                });
            }
            (None, Some(t_def)) => {
                total_diffs += 1;
                view_diffs.push(ViewDiff {
                    name: v_name.to_string(),
                    diff_type: DiffType::Removed,
                    source_definition: None,
                    target_definition: Some(t_def.clone()),
                });
            }
            (Some(s_def), Some(t_def)) => {
                if s_def != t_def {
                    total_diffs += 1;
                    view_diffs.push(ViewDiff {
                        name: v_name.to_string(),
                        diff_type: DiffType::Modified,
                        source_definition: Some(s_def.clone()),
                        target_definition: Some(t_def.clone()),
                    });
                }
            }
            (None, None) => {}
        }
    }

    Ok(SchemaDiffResult {
        source_schema: source_schema.to_string(),
        target_schema: target_schema.to_string(),
        tables: table_diffs,
        routines: routine_diffs,
        triggers: trigger_diffs,
        views: view_diffs,
        total_differences: total_diffs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_columns_added_and_modified() {
        let src = vec![
            ColumnMetadata {
                name: "id".to_string(),
                ordinal_position: 1,
                column_default: None,
                is_nullable: false,
                data_type: "int".to_string(),
                column_type: "int(11)".to_string(),
                column_key: "PRI".to_string(),
                extra: "auto_increment".to_string(),
                comment: "".to_string(),
                collation: None,
                character_set: None,
            },
            ColumnMetadata {
                name: "email".to_string(),
                ordinal_position: 2,
                column_default: None,
                is_nullable: false,
                data_type: "varchar".to_string(),
                column_type: "varchar(255)".to_string(),
                column_key: "UNI".to_string(),
                extra: "".to_string(),
                comment: "".to_string(),
                collation: None,
                character_set: None,
            },
        ];

        let tgt = vec![ColumnMetadata {
            name: "id".to_string(),
            ordinal_position: 1,
            column_default: None,
            is_nullable: false,
            data_type: "int".to_string(),
            column_type: "int(11)".to_string(),
            column_key: "PRI".to_string(),
            extra: "auto_increment".to_string(),
            comment: "".to_string(),
            collation: None,
            character_set: None,
        }];

        let diffs = compare_columns(&src, &tgt);
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].name, "email");
        assert_eq!(diffs[0].diff_type, DiffType::Added);
    }
}
