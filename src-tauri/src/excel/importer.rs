use calamine::{open_workbook_auto, Data, Reader};
use sqlx::{MySql, MySqlPool, QueryBuilder};
use std::collections::HashSet;
use std::time::Instant;
use tauri::Emitter;

use super::models::{
    ColumnMapping, ExcelPreviewData, ImportErrorDetail, ImportErrorStrategy, ImportMode,
    ImportProgressEvent, ImportRequest, ImportSummary,
};
use crate::db::service::{execute_query_session, get_session};
use crate::db::sql_utils::{qualify_table, quote_identifier};
use crate::db::DbState;

fn escape_sql_str(s: &str) -> String {
    let mut escaped = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '\'' => escaped.push_str("''"),
            '\\' => escaped.push_str("\\\\"),
            '\0' => escaped.push_str("\\0"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\x1a' => escaped.push_str("\\Z"),
            _ => escaped.push(c),
        }
    }
    escaped
}

fn calamine_data_to_json(data: &Data) -> serde_json::Value {
    match data {
        Data::Empty => serde_json::Value::Null,
        Data::String(s) => serde_json::Value::String(s.trim().to_string()),
        Data::Float(f) => serde_json::Number::from_f64(*f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Data::Int(i) => serde_json::Value::Number((*i).into()),
        Data::Bool(b) => serde_json::Value::Bool(*b),
        Data::DateTime(dt) => serde_json::Value::String(dt.to_string()),
        Data::DateTimeIso(s) => serde_json::Value::String(s.clone()),
        Data::DurationIso(s) => serde_json::Value::String(s.clone()),
        Data::Error(e) => serde_json::Value::String(format!("Error: {:?}", e)),
    }
}

fn calamine_cell_to_sql(cell: &Data) -> String {
    match cell {
        Data::Empty => "NULL".to_string(),
        Data::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                "NULL".to_string()
            } else {
                format!("'{}'", escape_sql_str(trimmed))
            }
        }
        Data::Int(i) => i.to_string(),
        Data::Float(f) => {
            if f.is_nan() || f.is_infinite() {
                "NULL".to_string()
            } else {
                f.to_string()
            }
        }
        Data::Bool(b) => {
            if *b {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        Data::DateTime(dt) => format!("'{}'", escape_sql_str(&dt.to_string())),
        Data::DateTimeIso(s) => format!("'{}'", escape_sql_str(s)),
        Data::DurationIso(s) => format!("'{}'", escape_sql_str(s)),
        Data::Error(_) => "NULL".to_string(),
    }
}

pub fn preview_excel(
    file_path: String,
    sheet_name: Option<String>,
) -> Result<ExcelPreviewData, String> {
    let mut workbook =
        open_workbook_auto(&file_path).map_err(|e| format!("Error al abrir archivo Excel: {e}"))?;

    let sheets = workbook.sheet_names().to_vec();
    if sheets.is_empty() {
        return Err("El archivo Excel no contiene ninguna hoja.".into());
    }

    let selected_sheet = sheet_name.unwrap_or_else(|| sheets[0].clone());

    let range = workbook
        .worksheet_range(&selected_sheet)
        .map_err(|e| format!("Error al leer hoja '{selected_sheet}': {e}"))?;

    let total_rows = range.height();
    if total_rows == 0 {
        return Ok(ExcelPreviewData {
            file_path,
            sheets,
            selected_sheet,
            headers: vec![],
            preview_rows: vec![],
            total_rows: 0,
        });
    }

    // First row as headers
    let mut headers = Vec::new();
    if let Some(first_row) = range.rows().next() {
        for (i, cell) in first_row.iter().enumerate() {
            let header_name = match cell {
                Data::String(s) => {
                    let t = s.trim();
                    if t.is_empty() {
                        format!("Columna_{}", i + 1)
                    } else {
                        t.to_string()
                    }
                }
                Data::Int(i) => i.to_string(),
                _ => format!("Columna_{}", i + 1),
            };
            headers.push(header_name);
        }
    }

    // Read first 50 rows for preview
    let mut preview_rows = Vec::new();
    for row in range.rows().skip(1).take(50) {
        let row_values: Vec<serde_json::Value> = row.iter().map(calamine_data_to_json).collect();
        preview_rows.push(row_values);
    }

    Ok(ExcelPreviewData {
        file_path,
        sheets,
        selected_sheet,
        headers,
        preview_rows,
        total_rows: total_rows.saturating_sub(1),
    })
}

struct ImportValidation {
    total_rows: usize,
    invalid_rows: HashSet<usize>,
    mapped_columns: Vec<(usize, String)>,
    key_columns: Vec<(usize, String)>,
    errors: Vec<ImportErrorDetail>,
    error_count: usize,
}

struct ImportTargetColumn {
    name: String,
    data_type: String,
    nullable: bool,
    has_default: bool,
    auto_increment: bool,
    primary_key: bool,
}

async fn validate_import(
    req: &ImportRequest,
    session: &crate::db::state::ActiveSession,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<ImportValidation, String> {
    let mut workbook = open_workbook_auto(&req.file_path)
        .map_err(|error| format!("Error abriendo libro Excel: {error}"))?;
    let sheet = req
        .sheet_name
        .clone()
        .or_else(|| workbook.sheet_names().first().cloned())
        .ok_or_else(|| "El archivo Excel no contiene hojas.".to_string())?;
    let range = workbook
        .worksheet_range(&sheet)
        .map_err(|error| format!("Error leyendo hoja '{sheet}': {error}"))?;
    let headers = range
        .rows()
        .next()
        .ok_or_else(|| "Hoja Excel vacía sin fila de encabezados.".to_string())?
        .iter()
        .enumerate()
        .map(|(index, cell)| header_value(cell, index))
        .collect::<Vec<_>>();
    if headers.iter().any(|header| header.trim().is_empty()) {
        return Err("La hoja contiene un encabezado vacío.".into());
    }

    let targets = if let Some(table) = &req.new_table_config {
        table
            .columns
            .iter()
            .map(|column| ImportTargetColumn {
                name: column.name.clone(),
                data_type: column.data_type.clone(),
                nullable: column.is_nullable,
                has_default: false,
                auto_increment: column.auto_increment,
                primary_key: column.is_primary_key,
            })
            .collect::<Vec<_>>()
    } else {
        crate::db::table::get_table_columns(&session.backend, &req.database, &req.table)
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|column| ImportTargetColumn {
                name: column.name,
                data_type: column.data_type,
                nullable: column.is_nullable,
                has_default: column.column_default.is_some(),
                auto_increment: column.extra.to_ascii_lowercase().contains("auto_increment"),
                primary_key: column.column_key.eq_ignore_ascii_case("PRI"),
            })
            .collect()
    };
    if targets.is_empty() {
        return Err("La tabla de destino no tiene columnas detectables.".into());
    }

    let mut validation = ImportValidation {
        total_rows: range.height().saturating_sub(1),
        invalid_rows: HashSet::new(),
        mapped_columns: Vec::new(),
        key_columns: Vec::new(),
        errors: Vec::new(),
        error_count: 0,
    };
    for header in duplicate_headers(&headers) {
        record_import_error(
            &mut validation,
            1,
            Some(header),
            None,
            "El archivo contiene encabezados duplicados.".into(),
        );
    }
    let mut mapped_targets = HashSet::new();
    for mapping in req.mappings.iter().filter(|mapping| !mapping.ignored) {
        let Some(excel_index) = headers
            .iter()
            .position(|header| header.eq_ignore_ascii_case(&mapping.excel_column))
        else {
            record_import_error(
                &mut validation,
                1,
                Some(mapping.excel_column.clone()),
                None,
                "La columna de Excel indicada no existe.".into(),
            );
            continue;
        };
        let Some(target) = targets
            .iter()
            .find(|target| target.name.eq_ignore_ascii_case(&mapping.db_column))
        else {
            record_import_error(
                &mut validation,
                1,
                Some(mapping.db_column.clone()),
                None,
                "La columna destino no existe.".into(),
            );
            continue;
        };
        if !mapped_targets.insert(target.name.to_ascii_lowercase()) {
            record_import_error(
                &mut validation,
                1,
                Some(target.name.clone()),
                None,
                "La columna destino está mapeada más de una vez.".into(),
            );
            continue;
        }
        validation
            .mapped_columns
            .push((excel_index, target.name.clone()));
    }
    if validation.mapped_columns.is_empty() {
        record_import_error(
            &mut validation,
            1,
            None,
            None,
            "No se encontró ninguna columna mapeada válida.".into(),
        );
        return Ok(validation);
    }

    for target in &targets {
        let mapped = mapped_targets.contains(&target.name.to_ascii_lowercase());
        if !mapped && !target.nullable && !target.has_default && !target.auto_increment {
            record_import_error(
                &mut validation,
                1,
                Some(target.name.clone()),
                None,
                "Falta una columna obligatoria sin valor predeterminado.".into(),
            );
        }
    }

    let mode_primary_key = match &req.mode {
        ImportMode::Update {
            primary_key_db,
            primary_key_excel,
        }
        | ImportMode::AppendUpdate {
            primary_key_db,
            primary_key_excel,
        }
        | ImportMode::Delete {
            primary_key_db,
            primary_key_excel,
        } => Some((primary_key_db.as_deref(), primary_key_excel.as_deref())),
        _ => None,
    };
    let key_columns = validation
        .mapped_columns
        .iter()
        .filter(|(excel_index, name)| {
            let mapping_is_key = req.mappings.iter().any(|mapping| {
                mapping.is_key
                    && mapping.db_column.eq_ignore_ascii_case(name)
                    && headers
                        .iter()
                        .position(|header| header.eq_ignore_ascii_case(&mapping.excel_column))
                        == Some(*excel_index)
            });
            let target_is_key = targets
                .iter()
                .any(|target| target.primary_key && target.name.eq_ignore_ascii_case(name));
            let configured_key = mode_primary_key.is_some_and(|(db_name, excel_name)| {
                db_name.is_some_and(|db| db.eq_ignore_ascii_case(name))
                    && excel_name.map_or(true, |excel| {
                        headers[*excel_index].eq_ignore_ascii_case(excel)
                    })
            });
            mapping_is_key || target_is_key || configured_key
        })
        .cloned()
        .collect::<Vec<_>>();
    validation.key_columns = key_columns.clone();
    let mapped_columns = validation.mapped_columns.clone();
    let mut seen_keys = HashSet::new();
    for (index, row) in range.rows().skip(1).enumerate() {
        let row_number = index + 2;
        if index % 1000 == 0 {
            emit_import_progress(
                app_handle,
                index,
                validation.total_rows,
                index.saturating_sub(validation.invalid_rows.len()),
                validation.invalid_rows.len(),
                "Validando libro Excel".into(),
            );
            tokio::task::yield_now().await;
        }
        for (excel_index, target_name) in &mapped_columns {
            let Some(target) = targets
                .iter()
                .find(|target| target.name.eq_ignore_ascii_case(target_name))
            else {
                continue;
            };
            let cell = row.get(*excel_index).unwrap_or(&Data::Empty);
            if import_cell_is_empty(cell) && !target.nullable && !target.auto_increment {
                record_row_error(
                    &mut validation,
                    row_number,
                    target_name,
                    cell,
                    "La columna no acepta NULL o vacío.".into(),
                );
            } else if is_incompatible_cell(cell, &target.data_type) {
                record_row_error(
                    &mut validation,
                    row_number,
                    target_name,
                    cell,
                    format!("El valor no es compatible con {}.", target.data_type),
                );
            }
        }
        if !key_columns.is_empty() {
            match import_row_key(row, &key_columns) {
                Err((excel_index, column)) => record_row_error(
                    &mut validation,
                    row_number,
                    &column,
                    row.get(excel_index).unwrap_or(&Data::Empty),
                    "La clave primaria está vacía.".into(),
                ),
                Ok(key) => {
                    if !seen_keys.insert(key) {
                        record_row_error(
                            &mut validation,
                            row_number,
                            &key_columns
                                .iter()
                                .map(|(_, column)| column.as_str())
                                .collect::<Vec<_>>()
                                .join(", "),
                            &Data::Empty,
                            "Clave primaria duplicada dentro del archivo.".into(),
                        );
                    }
                }
            }
        }
    }
    Ok(validation)
}

fn duplicate_headers(headers: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    headers
        .iter()
        .filter(|header| !seen.insert(header.to_ascii_lowercase()))
        .cloned()
        .collect()
}

fn import_row_key(
    row: &[Data],
    key_columns: &[(usize, String)],
) -> Result<String, (usize, String)> {
    let mut key = String::new();
    for (excel_index, column) in key_columns {
        let cell = row.get(*excel_index).unwrap_or(&Data::Empty);
        if import_cell_is_empty(cell) {
            return Err((*excel_index, column.clone()));
        }
        let value = cell_key(cell);
        key.push_str(&format!("{}:{value}|", value.len()));
    }
    Ok(key)
}

fn header_value(cell: &Data, index: usize) -> String {
    match cell {
        Data::String(value) => value.trim().to_string(),
        Data::Int(value) => value.to_string(),
        _ => format!("Columna_{}", index + 1),
    }
}

fn import_cell_is_empty(cell: &Data) -> bool {
    matches!(cell, Data::Empty) || matches!(cell, Data::String(value) if value.trim().is_empty())
}

fn is_incompatible_cell(cell: &Data, target_type: &str) -> bool {
    if matches!(cell, Data::Error(_)) || import_cell_is_empty(cell) {
        return matches!(cell, Data::Error(_));
    }
    let normalized = target_type.to_ascii_lowercase();
    let is_numeric = [
        "int", "decimal", "numeric", "float", "double", "real", "bit", "bool",
    ]
    .iter()
    .any(|kind| normalized.starts_with(kind));
    if !is_numeric {
        return false;
    }
    match cell {
        Data::Int(_) | Data::Float(_) | Data::Bool(_) => false,
        Data::String(value) => {
            let Ok(parsed) = value.trim().parse::<f64>() else {
                return true;
            };
            normalized.starts_with("int") && parsed.fract() != 0.0
        }
        _ => true,
    }
}

fn cell_key(cell: &Data) -> String {
    match cell {
        Data::String(value) => value.trim().to_string(),
        Data::Int(value) => value.to_string(),
        Data::Float(value) => value.to_string(),
        Data::Bool(value) => value.to_string(),
        Data::DateTime(value) => value.to_string(),
        Data::DateTimeIso(value) | Data::DurationIso(value) => value.clone(),
        Data::Empty => String::new(),
        Data::Error(error) => format!("{error:?}"),
    }
}

fn record_import_error(
    validation: &mut ImportValidation,
    row_number: usize,
    column: Option<String>,
    value: Option<String>,
    message: String,
) {
    validation.error_count += 1;
    if row_number > 1 {
        validation.invalid_rows.insert(row_number);
    }
    if validation.errors.len() < 100 {
        validation.errors.push(ImportErrorDetail {
            row_index: row_number,
            error_message: message,
            column,
            value,
        });
    }
}

fn record_row_error(
    validation: &mut ImportValidation,
    row_number: usize,
    column: &str,
    cell: &Data,
    message: String,
) {
    let value = if is_sensitive_column(column) {
        None
    } else {
        Some(cell_key(cell).chars().take(128).collect())
    };
    record_import_error(
        validation,
        row_number,
        Some(column.to_string()),
        value,
        message,
    );
}

fn is_sensitive_column(column: &str) -> bool {
    let name = column.to_ascii_lowercase();
    [
        "password",
        "secret",
        "token",
        "credential",
        "private",
        "key",
    ]
    .iter()
    .any(|part| name.contains(part))
}

fn supports_batched_insert(mode: &ImportMode) -> bool {
    matches!(
        mode,
        ImportMode::Append
            | ImportMode::AppendWithoutUpdate
            | ImportMode::AppendUpdate { .. }
            | ImportMode::Copy
            | ImportMode::Replace
    )
}

fn validation_summary(
    validation: ImportValidation,
    execution_time_ms: u64,
    dry_run: bool,
) -> ImportSummary {
    let skipped_rows = validation.invalid_rows.len();
    let successful_rows = if dry_run {
        validation.total_rows.saturating_sub(skipped_rows)
    } else {
        0
    };
    ImportSummary {
        total_processed: validation.total_rows,
        successful_rows,
        failed_rows: skipped_rows,
        skipped_rows: if dry_run {
            skipped_rows
        } else {
            validation.total_rows
        },
        error_count: validation.error_count,
        execution_time_ms,
        errors: validation.errors,
    }
}

fn target_table_sql(req: &ImportRequest) -> Result<String, String> {
    qualify_table(
        Some(req.database.as_str()),
        req.new_table_config
            .as_ref()
            .map(|table| table.table_name.as_str())
            .unwrap_or(req.table.as_str()),
    )
    .map_err(|error| error.to_string())
}

async fn create_new_table(
    req: &ImportRequest,
    session: &crate::db::state::ActiveSession,
) -> Result<(), String> {
    let Some(table) = &req.new_table_config else {
        return Ok(());
    };
    if table.columns.is_empty() {
        return Err("La nueva tabla debe tener al menos una columna.".into());
    }
    let engine = table.engine.as_deref().unwrap_or("InnoDB");
    let collation = table.collation.as_deref().unwrap_or("utf8mb4_unicode_ci");
    if !["InnoDB", "MyISAM", "Aria"]
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(engine))
        || !is_safe_ddl_token(collation)
    {
        return Err("El motor o la collation de la tabla no son válidos.".into());
    }
    if req.error_strategy == ImportErrorStrategy::Strict && !engine.eq_ignore_ascii_case("InnoDB") {
        return Err("El modo estricto requiere tablas InnoDB para garantizar rollback.".into());
    }

    let mut definitions = Vec::new();
    let mut primary_keys = Vec::new();
    let mut seen_names = HashSet::new();
    for column in &table.columns {
        if !seen_names.insert(column.name.to_ascii_lowercase())
            || !is_safe_column_type(&column.data_type)
        {
            return Err(format!(
                "Definición inválida para la columna '{}'.",
                column.name
            ));
        }
        let name = quote_identifier(&column.name).map_err(|error| error.to_string())?;
        let nullability = if column.is_nullable {
            "NULL"
        } else {
            "NOT NULL"
        };
        let auto_increment = if column.auto_increment {
            "AUTO_INCREMENT"
        } else {
            ""
        };
        definitions.push(format!(
            "{name} {} {nullability} {auto_increment}",
            column.data_type
        ));
        if column.is_primary_key {
            primary_keys.push(name);
        }
    }
    if !primary_keys.is_empty() {
        definitions.push(format!("PRIMARY KEY ({})", primary_keys.join(", ")));
    }
    let database = quote_identifier(&req.database).map_err(|error| error.to_string())?;
    let table_name = quote_identifier(&table.table_name).map_err(|error| error.to_string())?;
    let charset = collation.split('_').next().unwrap_or("utf8mb4");
    let query = format!(
        "CREATE TABLE {database}.{table_name} ({}) ENGINE={engine} DEFAULT CHARSET={charset} COLLATE={collation}",
        definitions.join(", ")
    );
    crate::db::service::execute_query_session(session, &query, Some(&req.database))
        .await
        .map_err(|error| format!("No se pudo crear la tabla destino: {error}"))?;
    Ok(())
}

fn is_safe_ddl_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn is_safe_column_type(value: &str) -> bool {
    let normalized = value.trim().to_ascii_uppercase();
    let allowed_prefixes = [
        "VARCHAR",
        "CHAR",
        "TEXT",
        "MEDIUMTEXT",
        "LONGTEXT",
        "TINYTEXT",
        "INT",
        "BIGINT",
        "SMALLINT",
        "MEDIUMINT",
        "TINYINT",
        "DOUBLE",
        "FLOAT",
        "DECIMAL",
        "DATE",
        "DATETIME",
        "TIME",
        "TIMESTAMP",
        "JSON",
        "BLOB",
    ];
    let base_end = normalized
        .find(|character: char| !character.is_ascii_alphanumeric())
        .unwrap_or(normalized.len());
    if base_end == 0 || !allowed_prefixes.contains(&&normalized[..base_end]) {
        return false;
    }
    let mut suffix = normalized[base_end..].trim();
    if suffix.starts_with('(') {
        let Some(end) = suffix.find(')') else {
            return false;
        };
        let parameters = &suffix[1..end];
        if parameters.is_empty()
            || !parameters
                .chars()
                .all(|character| character.is_ascii_digit() || character == ',')
            || parameters.split(',').any(str::is_empty)
        {
            return false;
        }
        suffix = suffix[end + 1..].trim();
    }
    matches!(suffix, "" | "UNSIGNED" | "ZEROFILL" | "BINARY") && !normalized.contains(';')
}

async fn import_batched(
    req: ImportRequest,
    session: crate::db::state::ActiveSession,
    mut validation: ImportValidation,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<ImportSummary, String> {
    if validation.errors.iter().any(|error| error.row_index <= 1) {
        return Ok(validation_summary(validation, 0, false));
    }
    if req.error_strategy == ImportErrorStrategy::Strict && !validation.invalid_rows.is_empty() {
        return Ok(validation_summary(validation, 0, false));
    }
    let pool: MySqlPool = session.backend.direct_pool().cloned().ok_or_else(|| {
        "La importación estricta y por lotes requiere conexión directa.".to_string()
    })?;
    if req.error_strategy == ImportErrorStrategy::Strict && req.new_table_config.is_none() {
        require_innodb_table(&pool, &req).await?;
    }
    let table_sql = target_table_sql(&req)?;
    let start = Instant::now();
    let mut workbook = open_workbook_auto(&req.file_path)
        .map_err(|error| format!("Error abriendo libro Excel: {error}"))?;
    let sheet = req
        .sheet_name
        .clone()
        .or_else(|| workbook.sheet_names().first().cloned())
        .ok_or_else(|| "El archivo Excel no contiene hojas.".to_string())?;
    let range = workbook
        .worksheet_range(&sheet)
        .map_err(|error| format!("Error leyendo hoja '{sheet}': {error}"))?;
    create_new_table(&req, &session).await?;
    let created_new_table = req.new_table_config.is_some();
    let is_strict = req.error_strategy == ImportErrorStrategy::Strict;
    let mut transaction = if is_strict {
        match pool.begin().await {
            Ok(transaction) => Some(transaction),
            Err(error) => {
                let message = format!("No se pudo iniciar la transacción de importación: {error}");
                return Err(
                    cleanup_created_table(&req, &session, created_new_table, message).await,
                );
            }
        }
    } else {
        None
    };
    if matches!(req.mode, ImportMode::Copy | ImportMode::Replace) {
        let clear_query = format!("DELETE FROM {table_sql}");
        if let Some(tx) = transaction.as_mut() {
            if sqlx::query(&clear_query).execute(&mut **tx).await.is_err() {
                drop(transaction.take());
                let message =
                    "No se pudo vaciar la tabla destino; la importación fue revertida.".to_string();
                return Err(
                    cleanup_created_table(&req, &session, created_new_table, message).await,
                );
            }
        } else {
            crate::db::service::execute_query_session(&session, &clear_query, Some(&req.database))
                .await
                .map_err(|error| format!("No se pudo vaciar la tabla destino: {error}"))?;
        }
    }

    let requested_batch_size = req.batch_size.unwrap_or(500).clamp(1, 1000);
    let parameter_limited_batch = (60_000 / validation.mapped_columns.len().max(1)).max(1);
    let batch_limit = requested_batch_size.min(parameter_limited_batch);
    let mapped_columns = validation.mapped_columns.clone();
    let mut row_batch: Vec<(usize, &[Data])> = Vec::with_capacity(batch_limit);
    let mut batch_bytes = 0usize;
    let mut imported_rows = 0usize;
    let mut database_failures = 0usize;
    let mut ignored_rows = 0usize;
    let total_rows = validation.total_rows;

    for (index, row) in range.rows().skip(1).enumerate() {
        let row_number = index + 2;
        if validation.invalid_rows.contains(&row_number) {
            continue;
        }
        batch_bytes = batch_bytes.saturating_add(estimated_row_bytes(row, &mapped_columns));
        row_batch.push((row_number, row));
        if row_batch.len() >= batch_limit || batch_bytes >= 4 * 1024 * 1024 {
            let batch_result = execute_import_batch(
                &pool,
                &req,
                &table_sql,
                &mapped_columns,
                &row_batch,
                transaction.as_mut(),
                &mut imported_rows,
                &mut database_failures,
                &mut ignored_rows,
                &mut validation,
            )
            .await;
            if let Err(message) = batch_result {
                drop(transaction.take());
                return Err(
                    cleanup_created_table(&req, &session, created_new_table, message).await,
                );
            }
            row_batch.clear();
            batch_bytes = 0;
            emit_import_progress(
                app_handle,
                imported_rows + validation.invalid_rows.len(),
                total_rows,
                imported_rows,
                validation.invalid_rows.len(),
                "Importando lotes".into(),
            );
        }
    }
    if !row_batch.is_empty() {
        let batch_result = execute_import_batch(
            &pool,
            &req,
            &table_sql,
            &mapped_columns,
            &row_batch,
            transaction.as_mut(),
            &mut imported_rows,
            &mut database_failures,
            &mut ignored_rows,
            &mut validation,
        )
        .await;
        if let Err(message) = batch_result {
            drop(transaction.take());
            return Err(cleanup_created_table(&req, &session, created_new_table, message).await);
        }
    }

    if let Some(transaction) = transaction {
        if transaction.commit().await.is_err() {
            return Err(cleanup_created_table(
                &req,
                &session,
                created_new_table,
                "No se pudo confirmar la transacción de importación.".into(),
            )
            .await);
        }
    }

    async fn cleanup_created_table(
        req: &ImportRequest,
        session: &crate::db::state::ActiveSession,
        created_new_table: bool,
        original_error: String,
    ) -> String {
        if !created_new_table {
            return original_error;
        }
        let Some(table) = &req.new_table_config else {
            return original_error;
        };
        let database = match quote_identifier(&req.database) {
            Ok(identifier) => identifier,
            Err(error) => return format!("{original_error}; no se pudo limpiar la tabla: {error}"),
        };
        let table_name = match quote_identifier(&table.table_name) {
            Ok(identifier) => identifier,
            Err(error) => return format!("{original_error}; no se pudo limpiar la tabla: {error}"),
        };
        let drop_query = format!("DROP TABLE IF EXISTS {database}.{table_name}");
        match crate::db::service::execute_query_session(session, &drop_query, Some(&req.database))
            .await
        {
            Ok(_) => original_error,
            Err(cleanup_error) => format!(
                "{original_error}; además, no se pudo eliminar la tabla creada: {cleanup_error}"
            ),
        }
    }

    let failed_rows = validation.invalid_rows.len().max(database_failures);
    let skipped_rows = failed_rows + ignored_rows;
    let error_count = validation.error_count;
    let summary = ImportSummary {
        total_processed: total_rows,
        successful_rows: imported_rows,
        failed_rows,
        skipped_rows,
        error_count,
        execution_time_ms: start.elapsed().as_millis() as u64,
        errors: validation.errors,
    };
    emit_import_progress(
        app_handle,
        total_rows,
        total_rows,
        summary.successful_rows,
        summary.failed_rows,
        "Importación completada".into(),
    );
    Ok(summary)
}

async fn import_strict_row_operations(
    req: ImportRequest,
    session: crate::db::state::ActiveSession,
    validation: ImportValidation,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<ImportSummary, String> {
    let start = Instant::now();
    let pool = session
        .backend
        .direct_pool()
        .cloned()
        .ok_or_else(|| "El modo estricto requiere una conexión directa.".to_string())?;
    require_innodb_table(&pool, &req).await?;
    let table_sql = target_table_sql(&req)?;
    let mut workbook = open_workbook_auto(&req.file_path)
        .map_err(|error| format!("Error abriendo libro Excel: {error}"))?;
    let sheet = req
        .sheet_name
        .clone()
        .or_else(|| workbook.sheet_names().first().cloned())
        .ok_or_else(|| "El archivo Excel no contiene hojas.".to_string())?;
    let range = workbook
        .worksheet_range(&sheet)
        .map_err(|error| format!("Error leyendo hoja '{sheet}': {error}"))?;
    let batch_size = req.batch_size.unwrap_or(500).clamp(1, 1000);
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("No se pudo iniciar la transacción: {error}"))?;
    let mut rows_processed = 0usize;

    match &req.mode {
        ImportMode::Delete { .. } => {
            let mut batch: Vec<(usize, &[Data])> = Vec::with_capacity(batch_size);
            for (index, row) in range.rows().skip(1).enumerate() {
                batch.push((index + 2, row));
                if batch.len() == batch_size {
                    execute_strict_delete_batch(
                        &mut transaction,
                        &table_sql,
                        &validation.key_columns,
                        &batch,
                    )
                    .await?;
                    rows_processed += batch.len();
                    batch.clear();
                    emit_import_progress(
                        app_handle,
                        rows_processed,
                        validation.total_rows,
                        rows_processed,
                        0,
                        "Eliminando registros por lotes".into(),
                    );
                    tokio::task::yield_now().await;
                }
            }
            if !batch.is_empty() {
                execute_strict_delete_batch(
                    &mut transaction,
                    &table_sql,
                    &validation.key_columns,
                    &batch,
                )
                .await?;
                rows_processed += batch.len();
            }
        }
        ImportMode::Update { .. } => {
            let update_columns = validation
                .mapped_columns
                .iter()
                .filter(|(_, column)| {
                    !validation
                        .key_columns
                        .iter()
                        .any(|(_, key)| key.eq_ignore_ascii_case(column))
                })
                .collect::<Vec<_>>();
            if update_columns.is_empty() {
                return Err("No hay columnas actualizables fuera de la clave.".into());
            }
            for (index, row) in range.rows().skip(1).enumerate() {
                let mut query = QueryBuilder::<MySql>::new(format!("UPDATE {table_sql} SET "));
                for (column_index, (excel_index, column)) in update_columns.iter().enumerate() {
                    if column_index > 0 {
                        query.push(", ");
                    }
                    query.push(quote_identifier(column).map_err(|error| error.to_string())?);
                    query.push(" = ");
                    push_import_value(&mut query, row.get(*excel_index).unwrap_or(&Data::Empty));
                }
                query.push(" WHERE ");
                for (key_index, (excel_index, column)) in validation.key_columns.iter().enumerate()
                {
                    if key_index > 0 {
                        query.push(" AND ");
                    }
                    query.push(quote_identifier(column).map_err(|error| error.to_string())?);
                    query.push(" = ");
                    push_import_value(&mut query, row.get(*excel_index).unwrap_or(&Data::Empty));
                }
                query
                    .build()
                    .execute(&mut *transaction)
                    .await
                    .map_err(|error| {
                        let column = database_error_column(&error)
                            .map(|column| format!(", columna '{column}'"))
                            .unwrap_or_default();
                        format!(
                            "La operación estricta fue revertida; fila {}, error{} ({}).",
                            index + 2,
                            column,
                            database_error_code(&error)
                        )
                    })?;
                rows_processed = index + 1;
                if rows_processed % batch_size == 0 {
                    emit_import_progress(
                        app_handle,
                        rows_processed,
                        validation.total_rows,
                        rows_processed,
                        0,
                        "Actualizando registros en transacción".into(),
                    );
                    tokio::task::yield_now().await;
                }
            }
        }
        _ => return Err("Operación estricta no compatible.".into()),
    }

    transaction
        .commit()
        .await
        .map_err(|_| "No se pudo confirmar la transacción estricta.".to_string())?;
    let summary = ImportSummary {
        total_processed: validation.total_rows,
        successful_rows: rows_processed,
        failed_rows: 0,
        skipped_rows: validation.total_rows.saturating_sub(rows_processed),
        error_count: 0,
        execution_time_ms: start.elapsed().as_millis() as u64,
        errors: Vec::new(),
    };
    emit_import_progress(
        app_handle,
        validation.total_rows,
        validation.total_rows,
        summary.successful_rows,
        0,
        "Importación estricta completada".into(),
    );
    Ok(summary)
}

async fn execute_strict_delete_batch(
    transaction: &mut sqlx::Transaction<'_, MySql>,
    table_sql: &str,
    key_columns: &[(usize, String)],
    rows: &[(usize, &[Data])],
) -> Result<(), String> {
    build_delete_query(table_sql, key_columns, rows)?
        .build()
        .execute(&mut **transaction)
        .await
        .map_err(|error| {
            let column = database_error_column(&error)
                .map(|column| format!(", columna '{column}'"))
                .unwrap_or_default();
            format!(
                "La operación estricta fue revertida; fila {}, error{} ({}).",
                rows.first().map(|(row, _)| *row).unwrap_or(0),
                column,
                database_error_code(&error)
            )
        })?;
    Ok(())
}

async fn import_tolerant_row_operations(
    req: ImportRequest,
    session: crate::db::state::ActiveSession,
    mut validation: ImportValidation,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<ImportSummary, String> {
    let start = Instant::now();
    if validation.errors.iter().any(|error| error.row_index <= 1) {
        return Ok(validation_summary(validation, 0, false));
    }
    let pool = session
        .backend
        .direct_pool()
        .cloned()
        .ok_or_else(|| "La importación requiere una conexión directa.".to_string())?;
    let table_sql = target_table_sql(&req)?;
    let mut workbook = open_workbook_auto(&req.file_path)
        .map_err(|error| format!("Error abriendo libro Excel: {error}"))?;
    let sheet = req
        .sheet_name
        .clone()
        .or_else(|| workbook.sheet_names().first().cloned())
        .ok_or_else(|| "El archivo Excel no contiene hojas.".to_string())?;
    let range = workbook
        .worksheet_range(&sheet)
        .map_err(|error| format!("Error leyendo hoja '{sheet}': {error}"))?;
    let batch_limit = req.batch_size.unwrap_or(500).clamp(1, 1000);
    let mapped_columns = validation.mapped_columns.clone();
    let key_columns = validation.key_columns.clone();
    let update_columns = mapped_columns
        .iter()
        .filter(|(_, column)| {
            !key_columns
                .iter()
                .any(|(_, key)| key.eq_ignore_ascii_case(column))
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut imported_rows = 0usize;
    let mut database_failures = 0usize;

    match &req.mode {
        ImportMode::Update { .. } => {
            if update_columns.is_empty() {
                return Err("No hay columnas actualizables fuera de la clave.".into());
            }
            for (index, row) in range.rows().skip(1).enumerate() {
                let row_number = index + 2;
                if validation.invalid_rows.contains(&row_number) {
                    continue;
                }
                let mut query = QueryBuilder::<MySql>::new(format!("UPDATE {table_sql} SET "));
                for (column_index, (excel_index, column)) in update_columns.iter().enumerate() {
                    if column_index > 0 {
                        query.push(", ");
                    }
                    query.push(quote_identifier(column).map_err(|error| error.to_string())?);
                    query.push(" = ");
                    push_import_value(&mut query, row.get(*excel_index).unwrap_or(&Data::Empty));
                }
                query.push(" WHERE ");
                push_key_conditions(&mut query, &key_columns, row)?;
                match query.build().execute(&pool).await {
                    Ok(_) => imported_rows += 1,
                    Err(error) => {
                        database_failures += 1;
                        record_database_row_error(
                            &mut validation,
                            row_number,
                            &error,
                            &mapped_columns,
                            row,
                        );
                    }
                }
                if (index + 1) % batch_limit == 0 {
                    emit_import_progress(
                        app_handle,
                        index + 1,
                        validation.total_rows,
                        imported_rows,
                        validation.invalid_rows.len(),
                        "Actualizando registros válidos".into(),
                    );
                    tokio::task::yield_now().await;
                }
            }
        }
        ImportMode::Delete { .. } => {
            let mut batch: Vec<(usize, &[Data])> = Vec::with_capacity(batch_limit);
            for (index, row) in range.rows().skip(1).enumerate() {
                let row_number = index + 2;
                if validation.invalid_rows.contains(&row_number) {
                    continue;
                }
                batch.push((row_number, row));
                if batch.len() >= batch_limit {
                    imported_rows += execute_tolerant_delete_batch(
                        &pool,
                        &table_sql,
                        &key_columns,
                        &mapped_columns,
                        &batch,
                        &mut validation,
                        &mut database_failures,
                    )
                    .await?;
                    batch.clear();
                    emit_import_progress(
                        app_handle,
                        index + 1,
                        validation.total_rows,
                        imported_rows,
                        validation.invalid_rows.len(),
                        "Eliminando registros válidos".into(),
                    );
                    tokio::task::yield_now().await;
                }
            }
            if !batch.is_empty() {
                imported_rows += execute_tolerant_delete_batch(
                    &pool,
                    &table_sql,
                    &key_columns,
                    &mapped_columns,
                    &batch,
                    &mut validation,
                    &mut database_failures,
                )
                .await?;
            }
        }
        _ => return Err("Modo de operación fila por fila no compatible.".into()),
    }

    let failed_rows = validation.invalid_rows.len().max(database_failures);
    let summary = ImportSummary {
        total_processed: validation.total_rows,
        successful_rows: imported_rows,
        failed_rows,
        skipped_rows: validation.total_rows.saturating_sub(imported_rows),
        error_count: validation.error_count,
        execution_time_ms: start.elapsed().as_millis() as u64,
        errors: validation.errors,
    };
    emit_import_progress(
        app_handle,
        summary.total_processed,
        summary.total_processed,
        summary.successful_rows,
        summary.failed_rows,
        "Importación completada".into(),
    );
    Ok(summary)
}

async fn execute_tolerant_delete_batch(
    pool: &MySqlPool,
    table_sql: &str,
    key_columns: &[(usize, String)],
    mapped_columns: &[(usize, String)],
    rows: &[(usize, &[Data])],
    validation: &mut ImportValidation,
    database_failures: &mut usize,
) -> Result<usize, String> {
    let mut query = build_delete_query(table_sql, key_columns, rows)?;
    match query.build().execute(pool).await {
        Ok(result) => Ok(result.rows_affected() as usize),
        Err(_) => {
            let mut deleted_rows = 0;
            for (row_number, row) in rows {
                let single_row = [(*row_number, *row)];
                match build_delete_query(table_sql, key_columns, &single_row)?
                    .build()
                    .execute(pool)
                    .await
                {
                    Ok(result) => deleted_rows += result.rows_affected() as usize,
                    Err(error) => {
                        *database_failures += 1;
                        record_database_row_error(
                            validation,
                            *row_number,
                            &error,
                            mapped_columns,
                            row,
                        );
                    }
                }
            }
            Ok(deleted_rows)
        }
    }
}

fn build_delete_query<'a>(
    table_sql: &str,
    key_columns: &[(usize, String)],
    rows: &'a [(usize, &'a [Data])],
) -> Result<QueryBuilder<'a, MySql>, String> {
    let mut query = QueryBuilder::<MySql>::new(format!("DELETE FROM {table_sql} WHERE "));
    for (row_index, (_, row)) in rows.iter().enumerate() {
        if row_index > 0 {
            query.push(" OR ");
        }
        query.push("(");
        push_key_conditions(&mut query, key_columns, row)?;
        query.push(")");
    }
    Ok(query)
}

fn push_key_conditions(
    query: &mut QueryBuilder<'_, MySql>,
    key_columns: &[(usize, String)],
    row: &[Data],
) -> Result<(), String> {
    for (index, (excel_index, column)) in key_columns.iter().enumerate() {
        if index > 0 {
            query.push(" AND ");
        }
        query.push(quote_identifier(column).map_err(|error| error.to_string())?);
        query.push(" = ");
        push_import_value(query, row.get(*excel_index).unwrap_or(&Data::Empty));
    }
    Ok(())
}

fn record_database_row_error(
    validation: &mut ImportValidation,
    row_number: usize,
    error: &sqlx::Error,
    mapped_columns: &[(usize, String)],
    row: &[Data],
) {
    let column = database_error_column(error);
    let value = column.as_ref().and_then(|column_name| {
        if is_sensitive_column(column_name) {
            return None;
        }
        let excel_index = mapped_columns
            .iter()
            .find(|(_, name)| name.eq_ignore_ascii_case(column_name))
            .map(|(index, _)| *index)?;
        Some(cell_key(row.get(excel_index).unwrap_or(&Data::Empty)))
            .filter(|value| !value.is_empty())
            .map(|value| value.chars().take(128).collect())
    });
    record_import_error(
        validation,
        row_number,
        column,
        value,
        format!(
            "El servidor rechazó la fila ({}).",
            database_error_code(error)
        ),
    );
}

async fn require_innodb_table(pool: &MySqlPool, req: &ImportRequest) -> Result<(), String> {
    let engine = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(ENGINE, '') FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(&req.database)
    .bind(&req.table)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        format!("No se pudo comprobar el motor transaccional de la tabla: {error}")
    })?;
    match engine {
        Some(engine) if engine.eq_ignore_ascii_case("InnoDB") => Ok(()),
        Some(_) => {
            Err("El modo estricto requiere una tabla InnoDB para garantizar rollback.".into())
        }
        None => Err("No se encontró la tabla de destino para la importación estricta.".into()),
    }
}

fn push_import_value(builder: &mut QueryBuilder<'_, MySql>, cell: &Data) {
    match cell {
        Data::Empty | Data::Error(_) => builder.push_bind(Option::<String>::None),
        Data::String(value) => {
            let value = value.trim();
            if value.is_empty() {
                builder.push_bind(Option::<String>::None)
            } else {
                builder.push_bind(value.to_string())
            }
        }
        Data::Float(value) if value.is_finite() => builder.push_bind(*value),
        Data::Float(_) => builder.push_bind(Option::<f64>::None),
        Data::Int(value) => builder.push_bind(*value),
        Data::Bool(value) => builder.push_bind(*value),
        Data::DateTime(value) => builder.push_bind(value.to_string()),
        Data::DateTimeIso(value) | Data::DurationIso(value) => builder.push_bind(value.clone()),
    };
}

async fn execute_import_batch(
    pool: &MySqlPool,
    req: &ImportRequest,
    table_sql: &str,
    mapped_columns: &[(usize, String)],
    rows: &[(usize, &[Data])],
    transaction: Option<&mut sqlx::Transaction<'_, MySql>>,
    imported_rows: &mut usize,
    database_failures: &mut usize,
    ignored_rows: &mut usize,
    validation: &mut ImportValidation,
) -> Result<(), String> {
    if let Some(transaction) = transaction {
        let result = build_insert_query(req, table_sql, mapped_columns, rows)?
            .build()
            .execute(&mut **transaction)
            .await
            .map_err(|error| {
                let column = database_error_column(&error)
                    .map(|column| format!(", columna '{column}'"))
                    .unwrap_or_default();
                format!(
                    "La importación estricta fue revertida; fila {}, el servidor rechazó un lote{} ({}).",
                    rows.first().map(|(row, _)| *row).unwrap_or(0),
                    column,
                    database_error_code(&error)
                )
            })?;
        count_import_result(
            req,
            rows.len(),
            result.rows_affected(),
            imported_rows,
            ignored_rows,
        );
        return Ok(());
    }

    let mut batch_transaction = pool
        .begin()
        .await
        .map_err(|error| format!("No se pudo iniciar la transacción del lote: {error}"))?;
    let batch_result = build_insert_query(req, table_sql, mapped_columns, rows)?
        .build()
        .execute(&mut *batch_transaction)
        .await;
    match batch_result {
        Ok(result) => {
            batch_transaction
                .commit()
                .await
                .map_err(|_| "No se pudo confirmar la transacción del lote.".to_string())?;
            count_import_result(
                req,
                rows.len(),
                result.rows_affected(),
                imported_rows,
                ignored_rows,
            );
        }
        Err(_) => {
            batch_transaction
                .rollback()
                .await
                .map_err(|_| "No se pudo revertir el lote inválido.".to_string())?;
            for (row_number, row) in rows {
                let single_row = [(*row_number, *row)];
                let mut row_transaction = pool.begin().await.map_err(|error| {
                    format!("No se pudo iniciar una transacción de fila: {error}")
                })?;
                match build_insert_query(req, table_sql, mapped_columns, &single_row)?
                    .build()
                    .execute(&mut *row_transaction)
                    .await
                {
                    Ok(result) => {
                        row_transaction
                            .commit()
                            .await
                            .map_err(|_| "No se pudo confirmar una fila válida.".to_string())?;
                        count_import_result(
                            req,
                            1,
                            result.rows_affected(),
                            imported_rows,
                            ignored_rows,
                        );
                    }
                    Err(error) => {
                        row_transaction
                            .rollback()
                            .await
                            .map_err(|_| "No se pudo revertir una fila inválida.".to_string())?;
                        *database_failures += 1;
                        let column = database_error_column(&error);
                        let value = column.as_ref().and_then(|column_name| {
                            if is_sensitive_column(column_name) {
                                return None;
                            }
                            let excel_index = mapped_columns
                                .iter()
                                .find(|(_, name)| name.eq_ignore_ascii_case(column_name))
                                .map(|(index, _)| *index)?;
                            Some(cell_key(row.get(excel_index).unwrap_or(&Data::Empty)))
                                .filter(|value| !value.is_empty())
                                .map(|value| value.chars().take(128).collect())
                        });
                        record_import_error(
                            validation,
                            *row_number,
                            column,
                            value,
                            format!(
                                "El servidor rechazó la fila ({}).",
                                database_error_code(&error)
                            ),
                        );
                    }
                }
            }
        }
    }
    Ok(())
}

fn build_insert_query<'a>(
    req: &ImportRequest,
    table_sql: &str,
    mapped_columns: &[(usize, String)],
    rows: &'a [(usize, &'a [Data])],
) -> Result<QueryBuilder<'a, MySql>, String> {
    let prefix = match req.mode {
        ImportMode::AppendWithoutUpdate => "INSERT IGNORE INTO",
        _ => "INSERT INTO",
    };
    let columns = mapped_columns
        .iter()
        .map(|(_, column)| quote_identifier(column).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    let mut builder = QueryBuilder::<MySql>::new(format!("{prefix} {table_sql} ({columns}) "));
    builder.push_values(rows.iter(), |mut row_builder, source| {
        let (_, values) = *source;
        for (column_index, (excel_index, _)) in mapped_columns.iter().enumerate() {
            if column_index > 0 {
                row_builder.push(", ");
            }
            let cell = values.get(*excel_index).unwrap_or(&Data::Empty);
            match cell {
                Data::Empty | Data::Error(_) => {
                    row_builder.push_bind(Option::<String>::None);
                }
                Data::String(value) => {
                    let value = value.trim();
                    if value.is_empty() {
                        row_builder.push_bind(Option::<String>::None);
                    } else {
                        row_builder.push_bind(value.to_string());
                    }
                }
                Data::Float(value) if value.is_finite() => {
                    row_builder.push_bind(*value);
                }
                Data::Float(_) => {
                    row_builder.push_bind(Option::<f64>::None);
                }
                Data::Int(value) => {
                    row_builder.push_bind(*value);
                }
                Data::Bool(value) => {
                    row_builder.push_bind(*value);
                }
                Data::DateTime(value) => {
                    row_builder.push_bind(value.to_string());
                }
                Data::DateTimeIso(value) | Data::DurationIso(value) => {
                    row_builder.push_bind(value.clone());
                }
            }
        }
    });
    if matches!(req.mode, ImportMode::AppendUpdate { .. }) {
        let updates = mapped_columns
            .iter()
            .map(|(_, column)| {
                let quoted = quote_identifier(column).map_err(|error| error.to_string())?;
                Ok(format!("{quoted} = VALUES({quoted})"))
            })
            .collect::<Result<Vec<_>, String>>()?
            .join(", ");
        builder.push(format!(" ON DUPLICATE KEY UPDATE {updates}"));
    }
    Ok(builder)
}

fn count_import_result(
    req: &ImportRequest,
    submitted: usize,
    affected_rows: u64,
    imported_rows: &mut usize,
    ignored_rows: &mut usize,
) {
    if matches!(req.mode, ImportMode::AppendWithoutUpdate) {
        let inserted = (affected_rows as usize).min(submitted);
        *imported_rows += inserted;
        *ignored_rows += submitted - inserted;
    } else {
        *imported_rows += submitted;
    }
}

fn database_error_code(error: &sqlx::Error) -> String {
    error
        .as_database_error()
        .and_then(|database_error| database_error.code())
        .map(|code| code.into_owned())
        .unwrap_or_else(|| "DB_ERROR".into())
}

fn database_error_column(error: &sqlx::Error) -> Option<String> {
    error
        .as_database_error()
        .and_then(|database_error| database_error_column_from_message(database_error.message()))
}

fn database_error_column_from_message(message: &str) -> Option<String> {
    let lowercase = message.to_ascii_lowercase();
    for marker in ["for column '", "column '"] {
        if let Some(start) = lowercase.find(marker) {
            let tail = &message[start + marker.len()..];
            let end = tail.find('\'')?;
            let column = &tail[..end];
            if !column.is_empty() && column.len() <= 256 {
                return Some(column.to_string());
            }
        }
    }
    None
}

fn estimated_row_bytes(row: &[Data], mappings: &[(usize, String)]) -> usize {
    mappings
        .iter()
        .filter_map(|(index, _)| row.get(*index))
        .map(|cell| match cell {
            Data::String(value) | Data::DateTimeIso(value) | Data::DurationIso(value) => {
                value.len()
            }
            _ => 16,
        })
        .sum()
}

fn emit_import_progress(
    app_handle: Option<&tauri::AppHandle>,
    current_row: usize,
    total_rows: usize,
    successful_rows: usize,
    failed_rows: usize,
    stage: String,
) {
    if let Some(app) = app_handle {
        let percentage = if total_rows == 0 {
            100.0
        } else {
            (current_row as f64 / total_rows as f64 * 100.0).clamp(0.0, 100.0)
        };
        let _ = app.emit(
            "excel-import-progress",
            ImportProgressEvent {
                current_row,
                total_rows,
                percentage,
                successful_rows,
                failed_rows,
                stage,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_xlsxwriter::Workbook;
    use sqlx::Execute;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_workbook_path() -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("pyrostudio-import-{timestamp}.xlsx"))
    }

    #[test]
    fn empty_workbook_preview_has_no_rows_or_headers() {
        let path = temp_workbook_path();
        let mut workbook = Workbook::new();
        workbook.add_worksheet();
        workbook.save(&path).unwrap();

        let preview = preview_excel(path.to_string_lossy().into_owned(), None).unwrap();
        let _ = std::fs::remove_file(path);
        assert_eq!(preview.total_rows, 0);
        assert!(preview.headers.is_empty());
        assert!(preview.preview_rows.is_empty());
    }

    #[test]
    fn preview_counts_ten_thousand_rows_without_copying_them_to_the_ui() {
        let path = temp_workbook_path();
        let mut workbook = Workbook::new();
        let sheet = workbook.add_worksheet();
        sheet.write_string(0, 0, "name").unwrap();
        for row in 1..=10_000 {
            sheet.write_string(row, 0, format!("row-{row}")).unwrap();
        }
        workbook.save(&path).unwrap();

        let preview = preview_excel(path.to_string_lossy().into_owned(), None).unwrap();
        let _ = std::fs::remove_file(path);
        assert_eq!(preview.total_rows, 10_000);
        assert_eq!(preview.preview_rows.len(), 50);
    }

    #[test]
    #[ignore = "performance check; generates 10k, 100k, and 1M-row XLSX fixtures"]
    fn large_excel_reader_datasets_scale_to_one_million_rows() {
        for row_count in [10_000u32, 100_000, 1_000_000] {
            let path = temp_workbook_path();
            let start = Instant::now();
            let mut workbook = Workbook::new();
            let sheet = workbook.add_worksheet_with_constant_memory();
            sheet.write_string(0, 0, "id").unwrap();
            for row in 1..=row_count {
                sheet.write_number(row, 0, row as f64).unwrap();
            }
            workbook.save(&path).unwrap();
            let preview = preview_excel(path.to_string_lossy().into_owned(), None).unwrap();
            eprintln!(
                "{row_count} input rows previewed in {} ms",
                start.elapsed().as_millis()
            );
            let _ = std::fs::remove_file(path);
            assert_eq!(preview.total_rows, row_count as usize);
            assert_eq!(preview.preview_rows.len(), 50);
        }
    }

    #[test]
    fn validates_numeric_types_nulls_and_unicode_values() {
        assert!(!is_incompatible_cell(&Data::Int(42), "INT"));
        assert!(!is_incompatible_cell(&Data::String("2.5".into()), "DOUBLE"));
        assert!(is_incompatible_cell(
            &Data::String("not a number".into()),
            "DECIMAL"
        ));
        assert_eq!(calamine_data_to_json(&Data::Empty), serde_json::Value::Null);
        assert_eq!(cell_key(&Data::String("東京".into())), "東京");
    }

    #[test]
    fn detects_duplicate_headers_and_composite_primary_keys() {
        assert_eq!(
            duplicate_headers(&["id".into(), "name".into(), "ID".into()]),
            vec!["ID"]
        );
        let key_columns = vec![(0, "tenant_id".into()), (1, "record_id".into())];
        let first = [Data::Int(4), Data::String("東京".into())];
        let duplicate = [Data::Int(4), Data::String("東京".into())];
        assert_eq!(
            import_row_key(&first, &key_columns).unwrap(),
            import_row_key(&duplicate, &key_columns).unwrap()
        );
        assert!(import_row_key(&[Data::Empty, Data::Int(2)], &key_columns).is_err());
    }

    #[test]
    fn new_table_type_validation_rejects_sql_fragments() {
        assert!(is_safe_column_type("DECIMAL(10,2)"));
        assert!(is_safe_column_type("BIGINT UNSIGNED"));
        assert!(!is_safe_column_type("INT, injected_column INT"));
        assert!(!is_safe_column_type("VARCHAR(255); DROP TABLE users"));
    }

    #[test]
    fn error_details_redact_secret_columns() {
        let mut validation = ImportValidation {
            total_rows: 1,
            invalid_rows: HashSet::new(),
            mapped_columns: Vec::new(),
            key_columns: Vec::new(),
            errors: Vec::new(),
            error_count: 0,
        };
        record_row_error(
            &mut validation,
            2,
            "api_token",
            &Data::String("do-not-display".into()),
            "invalid".into(),
        );
        assert_eq!(validation.errors[0].value, None);
        assert!(validation.invalid_rows.contains(&2));
    }

    #[test]
    fn extracts_column_name_without_copying_server_echoed_values() {
        assert_eq!(
            database_error_column_from_message(
                "Incorrect integer value 'sensitive' for column 'age' at row 1"
            ),
            Some("age".into())
        );
    }

    #[test]
    fn bounded_batch_query_binds_unicode_instead_of_interpolating_values() {
        let req = ImportRequest {
            file_path: String::new(),
            sheet_name: None,
            database: "app".into(),
            table: "users".into(),
            mappings: Vec::new(),
            mode: ImportMode::Append,
            batch_size: Some(500),
            new_table_config: None,
            error_strategy: ImportErrorStrategy::Strict,
            dry_run: false,
        };
        let data = [Data::String("東京".into())];
        let rows = [(2, data.as_slice())];
        let mut builder =
            build_insert_query(&req, "`app`.`users`", &[(0, "display_name".into())], &rows)
                .unwrap();
        let query = builder.build();
        assert!(query.sql().contains("?"));
        assert!(!query.sql().contains("東京"));
    }
}

pub async fn import_excel(
    req: ImportRequest,
    state: &DbState,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<ImportSummary, String> {
    let session = get_session(state).await?;
    let start = Instant::now();
    let validation = validate_import(&req, &session, app_handle).await?;
    if matches!(
        &req.mode,
        ImportMode::Update { .. } | ImportMode::Delete { .. }
    ) && validation.key_columns.is_empty()
    {
        return Err(
            "Update y Delete requieren mapear explícitamente una clave primaria; no se elegirá la primera columna.".into(),
        );
    }

    if req.dry_run {
        return Ok(validation_summary(
            validation,
            start.elapsed().as_millis() as u64,
            true,
        ));
    }

    let is_batched_mode = supports_batched_insert(&req.mode);
    let has_direct_connection = session.backend.direct_pool().is_some();
    if req.error_strategy == ImportErrorStrategy::Strict {
        let is_row_operation = matches!(
            &req.mode,
            ImportMode::Update { .. } | ImportMode::Delete { .. }
        );
        if !is_batched_mode && !is_row_operation {
            return Err("El modo estricto no admite este modo de importación.".into());
        }
        if !has_direct_connection {
            return Err(
                "El modo estricto requiere conexión SQLx directa por TCP o SSH para garantizar rollback.".into(),
            );
        }
        if is_row_operation {
            if req.new_table_config.is_some() {
                return Err("Update y Delete no pueden crear una tabla nueva.".into());
            }
            if validation.error_count > 0 {
                return Ok(validation_summary(validation, 0, false));
            }
            return import_strict_row_operations(req, session, validation, app_handle).await;
        }
        return import_batched(req, session, validation, app_handle).await;
    }
    if is_batched_mode && has_direct_connection {
        return import_batched(req, session, validation, app_handle).await;
    }
    if req.error_strategy == ImportErrorStrategy::Tolerant
        && has_direct_connection
        && matches!(
            &req.mode,
            ImportMode::Update { .. } | ImportMode::Delete { .. }
        )
    {
        return import_tolerant_row_operations(req, session, validation, app_handle).await;
    }
    if validation.error_count > 0 && !has_direct_connection {
        return Ok(validation_summary(
            validation,
            start.elapsed().as_millis() as u64,
            false,
        ));
    }

    let clean_db = req.database.replace('`', "``");
    let target_table_name = if let Some(ref new_tbl) = req.new_table_config {
        &new_tbl.table_name
    } else {
        &req.table
    };
    let clean_tbl = target_table_name.replace('`', "``");

    // 1. Create table if new table config is present
    if let Some(ref new_tbl) = req.new_table_config {
        if let Some(app) = app_handle {
            let _ = app.emit(
                "excel-import-progress",
                ImportProgressEvent {
                    current_row: 0,
                    total_rows: 0,
                    percentage: 0.0,
                    successful_rows: 0,
                    failed_rows: 0,
                    stage: "Creando estructura de tabla...".to_string(),
                },
            );
        }

        let mut col_defs = Vec::new();
        let mut pk_cols = Vec::new();

        for col in &new_tbl.columns {
            let clean_col = col.name.replace('`', "``");
            let null_clause = if col.is_nullable { "NULL" } else { "NOT NULL" };
            let auto_inc_clause = if col.auto_increment {
                "AUTO_INCREMENT"
            } else {
                ""
            };
            col_defs.push(format!(
                "`{clean_col}` {} {} {}",
                col.data_type, null_clause, auto_inc_clause
            ));
            if col.is_primary_key {
                pk_cols.push(format!("`{clean_col}`"));
            }
        }

        if !pk_cols.is_empty() {
            col_defs.push(format!("PRIMARY KEY ({})", pk_cols.join(", ")));
        }

        let engine = new_tbl.engine.as_deref().unwrap_or("InnoDB");
        let collation = new_tbl.collation.as_deref().unwrap_or("utf8mb4_unicode_ci");
        let charset = collation.split('_').next().unwrap_or("utf8mb4");

        let create_sql = format!(
            "CREATE TABLE `{clean_db}`.`{clean_tbl}` (\n  {}\n) ENGINE={} DEFAULT CHARSET={} COLLATE={};",
            col_defs.join(",\n  "),
            engine,
            charset,
            collation
        );

        execute_query_session(&session, &create_sql, Some(&req.database))
            .await
            .map_err(|e| format!("Error creando nueva tabla `{target_table_name}`: {e}"))?;
    }

    // 2. Mode: Copy / Replace -> Truncate table first
    if matches!(req.mode, ImportMode::Copy | ImportMode::Replace) {
        if let Some(app) = app_handle {
            let _ = app.emit(
                "excel-import-progress",
                ImportProgressEvent {
                    current_row: 0,
                    total_rows: 0,
                    percentage: 0.0,
                    successful_rows: 0,
                    failed_rows: 0,
                    stage: "Vaciando tabla de destino...".to_string(),
                },
            );
        }

        let truncate_query = format!("TRUNCATE TABLE `{clean_db}`.`{clean_tbl}`;");
        if let Err(_) = execute_query_session(&session, &truncate_query, Some(&req.database)).await
        {
            let delete_query = format!("DELETE FROM `{clean_db}`.`{clean_tbl}`;");
            execute_query_session(&session, &delete_query, Some(&req.database))
                .await
                .map_err(|e| format!("Error al vaciar la tabla antes de copiar: {e}"))?;
        }
    }

    // 3. Open workbook with Calamine
    let mut workbook = open_workbook_auto(&req.file_path)
        .map_err(|e| format!("Error abriendo libro Excel: {e}"))?;

    let sheets = workbook.sheet_names().to_vec();
    let selected_sheet = req
        .sheet_name
        .unwrap_or_else(|| sheets.first().cloned().unwrap_or_default());

    let range = workbook
        .worksheet_range(&selected_sheet)
        .map_err(|e| format!("Error leyendo hoja '{selected_sheet}': {e}"))?;

    let active_mappings: Vec<&ColumnMapping> = req
        .mappings
        .iter()
        .filter(|m| !m.ignored && !m.db_column.trim().is_empty())
        .collect();

    if active_mappings.is_empty() {
        return Err("No se especificó ninguna columna mapeada para importar.".into());
    }

    // Find indices in excel header
    let header_row = range
        .rows()
        .next()
        .ok_or_else(|| "Hoja Excel vacía sin fila de encabezados.".to_string())?;

    let header_names: Vec<String> = header_row
        .iter()
        .enumerate()
        .map(|(i, cell)| match cell {
            Data::String(s) => s.trim().to_string(),
            Data::Int(n) => n.to_string(),
            _ => format!("Columna_{}", i + 1),
        })
        .collect();

    let mut mapped_indices: Vec<(usize, &str)> = Vec::new();
    for m in &active_mappings {
        if let Some(idx) = header_names
            .iter()
            .position(|h| h.eq_ignore_ascii_case(&m.excel_column))
        {
            mapped_indices.push((idx, &m.db_column));
        }
    }

    if mapped_indices.is_empty() {
        return Err(
            "No se pudo hacer coincidir ninguna columna de Excel con las columnas mapeadas.".into(),
        );
    }

    let effective_key_indices: Vec<(usize, &str)> = validation
        .key_columns
        .iter()
        .filter_map(|(excel_index, db_column)| {
            mapped_indices
                .iter()
                .find(|(mapped_index, mapped_column)| {
                    mapped_index == excel_index && mapped_column.eq_ignore_ascii_case(db_column)
                })
                .copied()
        })
        .collect();

    let batch_size = req.batch_size.unwrap_or(500).clamp(50, 5000);
    let mut total_processed = 0;
    let mut successful_rows = 0;
    let mut failed_rows = 0;
    let mut errors: Vec<ImportErrorDetail> = Vec::new();

    let all_data_rows: Vec<_> = range.rows().skip(1).collect();
    let total_rows_count = all_data_rows.len();

    if let Some(app) = app_handle {
        let _ = app.emit(
            "excel-import-progress",
            ImportProgressEvent {
                current_row: 0,
                total_rows: total_rows_count,
                percentage: 0.0,
                successful_rows: 0,
                failed_rows: 0,
                stage: format!("Iniciando importación de {} filas...", total_rows_count),
            },
        );
    }

    let col_names_sql: Vec<String> = mapped_indices
        .iter()
        .map(|(_, db_col)| format!("`{}`", db_col.replace('`', "``")))
        .collect();
    let col_list_str = col_names_sql.join(", ");

    let chunks = all_data_rows.chunks(batch_size);

    for chunk in chunks {
        let chunk_len = chunk.len();

        match &req.mode {
            // Mode 1, 6 & Replace: Append / Copy / Replace
            ImportMode::Append | ImportMode::Copy | ImportMode::Replace => {
                let mut value_tuples = Vec::with_capacity(chunk_len);
                for row in chunk {
                    let mut row_vals = Vec::with_capacity(mapped_indices.len());
                    for (excel_idx, _) in &mapped_indices {
                        let cell = row.get(*excel_idx).unwrap_or(&Data::Empty);
                        row_vals.push(calamine_cell_to_sql(cell));
                    }
                    value_tuples.push(format!("({})", row_vals.join(", ")));
                }

                let insert_sql = format!(
                    "INSERT INTO `{clean_db}`.`{clean_tbl}` ({col_list_str}) VALUES {};",
                    value_tuples.join(",\n")
                );

                match execute_query_session(&session, &insert_sql, Some(&req.database)).await {
                    Ok(res) => {
                        successful_rows += if res.affected_rows > 0 {
                            res.affected_rows as usize
                        } else {
                            chunk_len
                        };
                    }
                    Err(batch_err) => {
                        for (c_idx, row) in chunk.iter().enumerate() {
                            let row_number = total_processed + c_idx + 2;
                            let mut row_vals = Vec::with_capacity(mapped_indices.len());
                            for (excel_idx, _) in &mapped_indices {
                                let cell = row.get(*excel_idx).unwrap_or(&Data::Empty);
                                row_vals.push(calamine_cell_to_sql(cell));
                            }
                            let single_sql = format!(
                                "INSERT INTO `{clean_db}`.`{clean_tbl}` ({col_list_str}) VALUES ({});",
                                row_vals.join(", ")
                            );
                            match execute_query_session(&session, &single_sql, Some(&req.database))
                                .await
                            {
                                Ok(_) => successful_rows += 1,
                                Err(row_err) => {
                                    failed_rows += 1;
                                    if errors.len() < 100 {
                                        errors.push(ImportErrorDetail {
                                            row_index: row_number,
                                            error_message: row_err.to_string(),
                                            column: None,
                                            value: None,
                                        });
                                    }
                                }
                            }
                        }
                        if failed_rows == 0 && errors.is_empty() {
                            errors.push(ImportErrorDetail {
                                row_index: total_processed + 2,
                                error_message: batch_err.to_string(),
                                column: None,
                                value: None,
                            });
                        }
                    }
                }
            }

            // Mode 4: Append without update (INSERT IGNORE)
            ImportMode::AppendWithoutUpdate => {
                let mut value_tuples = Vec::with_capacity(chunk_len);
                for row in chunk {
                    let mut row_vals = Vec::with_capacity(mapped_indices.len());
                    for (excel_idx, _) in &mapped_indices {
                        let cell = row.get(*excel_idx).unwrap_or(&Data::Empty);
                        row_vals.push(calamine_cell_to_sql(cell));
                    }
                    value_tuples.push(format!("({})", row_vals.join(", ")));
                }

                let insert_sql = format!(
                    "INSERT IGNORE INTO `{clean_db}`.`{clean_tbl}` ({col_list_str}) VALUES {};",
                    value_tuples.join(",\n")
                );

                match execute_query_session(&session, &insert_sql, Some(&req.database)).await {
                    Ok(res) => {
                        successful_rows += if res.affected_rows > 0 {
                            res.affected_rows as usize
                        } else {
                            chunk_len
                        };
                    }
                    Err(batch_err) => {
                        for (c_idx, row) in chunk.iter().enumerate() {
                            let row_number = total_processed + c_idx + 2;
                            let mut row_vals = Vec::with_capacity(mapped_indices.len());
                            for (excel_idx, _) in &mapped_indices {
                                let cell = row.get(*excel_idx).unwrap_or(&Data::Empty);
                                row_vals.push(calamine_cell_to_sql(cell));
                            }
                            let single_sql = format!(
                                "INSERT IGNORE INTO `{clean_db}`.`{clean_tbl}` ({col_list_str}) VALUES ({});",
                                row_vals.join(", ")
                            );
                            match execute_query_session(&session, &single_sql, Some(&req.database))
                                .await
                            {
                                Ok(_) => successful_rows += 1,
                                Err(row_err) => {
                                    failed_rows += 1;
                                    if errors.len() < 100 {
                                        errors.push(ImportErrorDetail {
                                            row_index: row_number,
                                            error_message: row_err.to_string(),
                                            column: None,
                                            value: None,
                                        });
                                    }
                                }
                            }
                        }
                        if failed_rows == 0 && errors.is_empty() {
                            errors.push(ImportErrorDetail {
                                row_index: total_processed + 2,
                                error_message: batch_err.to_string(),
                                column: None,
                                value: None,
                            });
                        }
                    }
                }
            }

            // Mode 3: Append / Update (ON DUPLICATE KEY UPDATE)
            ImportMode::AppendUpdate { .. } => {
                let mut value_tuples = Vec::with_capacity(chunk_len);
                for row in chunk {
                    let mut row_vals = Vec::with_capacity(mapped_indices.len());
                    for (excel_idx, _) in &mapped_indices {
                        let cell = row.get(*excel_idx).unwrap_or(&Data::Empty);
                        row_vals.push(calamine_cell_to_sql(cell));
                    }
                    value_tuples.push(format!("({})", row_vals.join(", ")));
                }

                let key_db_names: Vec<&str> =
                    effective_key_indices.iter().map(|(_, col)| *col).collect();
                let update_clauses: Vec<String> = mapped_indices
                    .iter()
                    .filter(|(_, db_col)| !key_db_names.contains(db_col))
                    .map(|(_, db_col)| {
                        let clean = db_col.replace('`', "``");
                        format!("`{clean}` = VALUES(`{clean}`)")
                    })
                    .collect();

                let update_part = if update_clauses.is_empty() {
                    let first_col = mapped_indices[0].1.replace('`', "``");
                    format!("`{first_col}` = VALUES(`{first_col}`)")
                } else {
                    update_clauses.join(", ")
                };

                let upsert_sql = format!(
                    "INSERT INTO `{clean_db}`.`{clean_tbl}` ({col_list_str}) VALUES {}\nON DUPLICATE KEY UPDATE {};",
                    value_tuples.join(",\n"),
                    update_part
                );

                match execute_query_session(&session, &upsert_sql, Some(&req.database)).await {
                    Ok(_) => {
                        successful_rows += chunk_len;
                    }
                    Err(batch_err) => {
                        for (c_idx, row) in chunk.iter().enumerate() {
                            let row_number = total_processed + c_idx + 2;
                            let mut row_vals = Vec::with_capacity(mapped_indices.len());
                            for (excel_idx, _) in &mapped_indices {
                                let cell = row.get(*excel_idx).unwrap_or(&Data::Empty);
                                row_vals.push(calamine_cell_to_sql(cell));
                            }
                            let single_sql = format!(
                                "INSERT INTO `{clean_db}`.`{clean_tbl}` ({col_list_str}) VALUES ({})\nON DUPLICATE KEY UPDATE {};",
                                row_vals.join(", "),
                                update_part
                            );
                            match execute_query_session(&session, &single_sql, Some(&req.database))
                                .await
                            {
                                Ok(_) => successful_rows += 1,
                                Err(row_err) => {
                                    failed_rows += 1;
                                    if errors.len() < 100 {
                                        errors.push(ImportErrorDetail {
                                            row_index: row_number,
                                            error_message: row_err.to_string(),
                                            column: None,
                                            value: None,
                                        });
                                    }
                                }
                            }
                        }
                        if failed_rows == 0 && errors.is_empty() {
                            errors.push(ImportErrorDetail {
                                row_index: total_processed + 2,
                                error_message: batch_err.to_string(),
                                column: None,
                                value: None,
                            });
                        }
                    }
                }
            }

            // Mode 2: Update existing records matching Key Column(s)
            ImportMode::Update { .. } => {
                let key_db_names: Vec<&str> =
                    effective_key_indices.iter().map(|(_, col)| *col).collect();

                for (c_idx, row) in chunk.iter().enumerate() {
                    let row_number = total_processed + c_idx + 2;
                    let mut where_conditions = Vec::new();
                    let mut has_null_key = false;

                    for (k_excel_idx, k_db_col) in &effective_key_indices {
                        let pk_cell = row.get(*k_excel_idx).unwrap_or(&Data::Empty);
                        let pk_sql = calamine_cell_to_sql(pk_cell);
                        if pk_sql == "NULL" {
                            has_null_key = true;
                            break;
                        }
                        where_conditions
                            .push(format!("`{}` = {pk_sql}", k_db_col.replace('`', "``")));
                    }

                    if has_null_key || where_conditions.is_empty() {
                        failed_rows += 1;
                        if errors.len() < 100 {
                            errors.push(ImportErrorDetail {
                                row_index: row_number,
                                error_message: "Valor de clave coincidente vacío o nulo".into(),
                                column: None,
                                value: None,
                            });
                        }
                        continue;
                    }

                    let set_clauses: Vec<String> = mapped_indices
                        .iter()
                        .filter(|(_, db_col)| !key_db_names.contains(db_col))
                        .map(|(excel_idx, db_col)| {
                            let cell = row.get(*excel_idx).unwrap_or(&Data::Empty);
                            let val_sql = calamine_cell_to_sql(cell);
                            format!("`{}` = {val_sql}", db_col.replace('`', "``"))
                        })
                        .collect();

                    if set_clauses.is_empty() {
                        successful_rows += 1;
                        continue;
                    }

                    let update_sql = format!(
                        "UPDATE `{clean_db}`.`{clean_tbl}` SET {} WHERE {};",
                        set_clauses.join(", "),
                        where_conditions.join(" AND ")
                    );

                    match execute_query_session(&session, &update_sql, Some(&req.database)).await {
                        Ok(_) => successful_rows += 1,
                        Err(e) => {
                            failed_rows += 1;
                            if errors.len() < 100 {
                                errors.push(ImportErrorDetail {
                                    row_index: row_number,
                                    error_message: e.to_string(),
                                    column: None,
                                    value: None,
                                });
                            }
                        }
                    }
                }
            }

            // Mode 5: Delete matching records
            ImportMode::Delete { .. } => {
                if effective_key_indices.len() == 1 {
                    let (pk_excel_idx, pk_db_col) = effective_key_indices[0];
                    let clean_pk_db = pk_db_col.replace('`', "``");
                    let mut pk_values = Vec::new();

                    for row in chunk {
                        let pk_cell = row.get(pk_excel_idx).unwrap_or(&Data::Empty);
                        let val_sql = calamine_cell_to_sql(pk_cell);
                        if val_sql != "NULL" {
                            pk_values.push(val_sql);
                        }
                    }

                    if !pk_values.is_empty() {
                        let delete_sql = format!(
                            "DELETE FROM `{clean_db}`.`{clean_tbl}` WHERE `{clean_pk_db}` IN ({});",
                            pk_values.join(", ")
                        );

                        match execute_query_session(&session, &delete_sql, Some(&req.database))
                            .await
                        {
                            Ok(res) => {
                                successful_rows += res.affected_rows as usize;
                            }
                            Err(e) => {
                                failed_rows += chunk_len;
                                if errors.len() < 100 {
                                    errors.push(ImportErrorDetail {
                                        row_index: total_processed + 2,
                                        error_message: e.to_string(),
                                        column: None,
                                        value: None,
                                    });
                                }
                            }
                        }
                    }
                } else {
                    // Composite key delete: WHERE (`k1` = v1 AND `k2` = v2) OR ...
                    let mut tuple_conditions = Vec::new();
                    for row in chunk {
                        let mut conds = Vec::new();
                        for (k_excel_idx, k_db_col) in &effective_key_indices {
                            let pk_cell = row.get(*k_excel_idx).unwrap_or(&Data::Empty);
                            let val_sql = calamine_cell_to_sql(pk_cell);
                            if val_sql != "NULL" {
                                conds
                                    .push(format!("`{}` = {val_sql}", k_db_col.replace('`', "``")));
                            }
                        }
                        if conds.len() == effective_key_indices.len() {
                            tuple_conditions.push(format!("({})", conds.join(" AND ")));
                        }
                    }

                    if !tuple_conditions.is_empty() {
                        let delete_sql = format!(
                            "DELETE FROM `{clean_db}`.`{clean_tbl}` WHERE {};",
                            tuple_conditions.join(" OR ")
                        );

                        match execute_query_session(&session, &delete_sql, Some(&req.database))
                            .await
                        {
                            Ok(res) => {
                                successful_rows += res.affected_rows as usize;
                            }
                            Err(e) => {
                                failed_rows += chunk_len;
                                if errors.len() < 100 {
                                    errors.push(ImportErrorDetail {
                                        row_index: total_processed + 2,
                                        error_message: e.to_string(),
                                        column: None,
                                        value: None,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        total_processed += chunk_len;

        let pct = if total_rows_count > 0 {
            ((total_processed as f64) / (total_rows_count as f64) * 100.0).clamp(0.0, 100.0)
        } else {
            100.0
        };

        if let Some(app) = app_handle {
            let _ = app.emit(
                "excel-import-progress",
                ImportProgressEvent {
                    current_row: total_processed,
                    total_rows: total_rows_count,
                    percentage: (pct * 10.0).round() / 10.0,
                    successful_rows,
                    failed_rows,
                    stage: format!(
                        "Importando filas ({}/{})",
                        total_processed, total_rows_count
                    ),
                },
            );
        }
    }

    let elapsed = start.elapsed().as_millis() as u64;

    if let Some(app) = app_handle {
        let _ = app.emit(
            "excel-import-progress",
            ImportProgressEvent {
                current_row: total_processed,
                total_rows: total_rows_count,
                percentage: 100.0,
                successful_rows,
                failed_rows,
                stage: "Importación completada".to_string(),
            },
        );
    }

    Ok(ImportSummary {
        total_processed,
        successful_rows,
        failed_rows,
        skipped_rows: failed_rows,
        error_count: failed_rows,
        execution_time_ms: elapsed,
        errors,
    })
}
