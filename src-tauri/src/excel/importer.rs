use std::time::Instant;
use calamine::{open_workbook_auto, Data, Reader};
use tauri::Emitter;

use super::models::{
    ColumnMapping, ExcelPreviewData, ImportErrorDetail, ImportMode, ImportProgressEvent,
    ImportRequest, ImportSummary,
};
use crate::db::service::{execute_query_session, get_session};
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
        Data::Bool(b) => if *b { "1".to_string() } else { "0".to_string() },
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
    let mut workbook = open_workbook_auto(&file_path)
        .map_err(|e| format!("Error al abrir archivo Excel: {e}"))?;

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

pub async fn import_excel(
    req: ImportRequest,
    state: &DbState,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<ImportSummary, String> {
    let session = get_session(state).await?;
    let start = Instant::now();

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
            let auto_inc_clause = if col.auto_increment { "AUTO_INCREMENT" } else { "" };
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
        if let Err(_) = execute_query_session(&session, &truncate_query, Some(&req.database)).await {
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
        if let Some(idx) = header_names.iter().position(|h| h.eq_ignore_ascii_case(&m.excel_column)) {
            mapped_indices.push((idx, &m.db_column));
        }
    }

    if mapped_indices.is_empty() {
        return Err("No se pudo hacer coincidir ninguna columna de Excel con las columnas mapeadas.".into());
    }

    // Multi-column Matching Keys definition from mappings where `is_key == true`
    let key_mapped_indices: Vec<(usize, &str)> = active_mappings
        .iter()
        .filter(|m| m.is_key)
        .filter_map(|m| {
            header_names
                .iter()
                .position(|h| h.eq_ignore_ascii_case(&m.excel_column))
                .map(|idx| (idx, m.db_column.as_str()))
        })
        .collect();

    // Fallback if no is_key column was toggled
    let effective_key_indices: Vec<(usize, &str)> = if !key_mapped_indices.is_empty() {
        key_mapped_indices
    } else {
        match &req.mode {
            ImportMode::Update { primary_key_db, primary_key_excel }
            | ImportMode::AppendUpdate { primary_key_db, primary_key_excel }
            | ImportMode::Delete { primary_key_db, primary_key_excel } => {
                if let (Some(pk_db), Some(pk_excel)) = (primary_key_db, primary_key_excel) {
                    if let Some(idx) = header_names.iter().position(|h| h.eq_ignore_ascii_case(pk_excel)) {
                        vec![(idx, pk_db.as_str())]
                    } else if let Some(m) = mapped_indices.iter().find(|(_, db_col)| *db_col == pk_db.as_str()) {
                        vec![*m]
                    } else {
                        vec![mapped_indices[0]]
                    }
                } else if let Some(pk_db) = primary_key_db {
                    if let Some(m) = mapped_indices.iter().find(|(_, db_col)| *db_col == pk_db.as_str()) {
                        vec![*m]
                    } else {
                        vec![mapped_indices[0]]
                    }
                } else {
                    vec![mapped_indices[0]]
                }
            }
            _ => vec![mapped_indices[0]],
        }
    };

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
                        successful_rows += if res.affected_rows > 0 { res.affected_rows as usize } else { chunk_len };
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
                            match execute_query_session(&session, &single_sql, Some(&req.database)).await {
                                Ok(_) => successful_rows += 1,
                                Err(row_err) => {
                                    failed_rows += 1;
                                    if errors.len() < 100 {
                                        errors.push(ImportErrorDetail {
                                            row_index: row_number,
                                            error_message: row_err,
                                        });
                                    }
                                }
                            }
                        }
                        if failed_rows == 0 && errors.is_empty() {
                            errors.push(ImportErrorDetail {
                                row_index: total_processed + 2,
                                error_message: batch_err,
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
                        successful_rows += if res.affected_rows > 0 { res.affected_rows as usize } else { chunk_len };
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
                            match execute_query_session(&session, &single_sql, Some(&req.database)).await {
                                Ok(_) => successful_rows += 1,
                                Err(row_err) => {
                                    failed_rows += 1;
                                    if errors.len() < 100 {
                                        errors.push(ImportErrorDetail {
                                            row_index: row_number,
                                            error_message: row_err,
                                        });
                                    }
                                }
                            }
                        }
                        if failed_rows == 0 && errors.is_empty() {
                            errors.push(ImportErrorDetail {
                                row_index: total_processed + 2,
                                error_message: batch_err,
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

                let key_db_names: Vec<&str> = effective_key_indices.iter().map(|(_, col)| *col).collect();
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
                            match execute_query_session(&session, &single_sql, Some(&req.database)).await {
                                Ok(_) => successful_rows += 1,
                                Err(row_err) => {
                                    failed_rows += 1;
                                    if errors.len() < 100 {
                                        errors.push(ImportErrorDetail {
                                            row_index: row_number,
                                            error_message: row_err,
                                        });
                                    }
                                }
                            }
                        }
                        if failed_rows == 0 && errors.is_empty() {
                            errors.push(ImportErrorDetail {
                                row_index: total_processed + 2,
                                error_message: batch_err,
                            });
                        }
                    }
                }
            }

            // Mode 2: Update existing records matching Key Column(s)
            ImportMode::Update { .. } => {
                let key_db_names: Vec<&str> = effective_key_indices.iter().map(|(_, col)| *col).collect();

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
                        where_conditions.push(format!("`{}` = {pk_sql}", k_db_col.replace('`', "``")));
                    }

                    if has_null_key || where_conditions.is_empty() {
                        failed_rows += 1;
                        if errors.len() < 100 {
                            errors.push(ImportErrorDetail {
                                row_index: row_number,
                                error_message: "Valor de clave coincidente vacío o nulo".into(),
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
                                    error_message: e,
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

                        match execute_query_session(&session, &delete_sql, Some(&req.database)).await {
                            Ok(res) => {
                                successful_rows += res.affected_rows as usize;
                            }
                            Err(e) => {
                                failed_rows += chunk_len;
                                if errors.len() < 100 {
                                    errors.push(ImportErrorDetail {
                                        row_index: total_processed + 2,
                                        error_message: e,
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
                                conds.push(format!("`{}` = {val_sql}", k_db_col.replace('`', "``")));
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

                        match execute_query_session(&session, &delete_sql, Some(&req.database)).await {
                            Ok(res) => {
                                successful_rows += res.affected_rows as usize;
                            }
                            Err(e) => {
                                failed_rows += chunk_len;
                                if errors.len() < 100 {
                                    errors.push(ImportErrorDetail {
                                        row_index: total_processed + 2,
                                        error_message: e,
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
                    stage: format!("Importando filas ({}/{})", total_processed, total_rows_count),
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
        execution_time_ms: elapsed,
        errors,
    })
}
