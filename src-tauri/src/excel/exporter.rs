use rust_xlsxwriter::{Color, Format, FormatBorder, Workbook};
use sqlx::{Column, Row, TypeInfo, ValueRef};
use std::path::PathBuf;
use std::time::Instant;

use super::models::{ExportProgressEvent, ExportRequest, ExportSummary};
use crate::db::backend::DatabaseBackend;
use crate::db::service::get_session;
use crate::db::sql_utils::{qualify_table, quote_identifier};
use crate::db::state::SessionBackend;
use crate::db::DbState;
use tauri::Emitter;

pub async fn export_to_excel(
    req: ExportRequest,
    state: &DbState,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<ExportSummary, String> {
    let session = get_session(state).await.map_err(|e| e.to_string())?;
    let start = Instant::now();

    let db_arg = if req.database.trim().is_empty() {
        None
    } else {
        Some(req.database.as_str())
    };

    let query_str = match req
        .query
        .as_deref()
        .filter(|query| !query.trim().is_empty())
    {
        Some(query) => {
            let cleaned = crate::db::safe_mode::clean_sql_statement(query);
            let first_token = cleaned
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .trim_matches(|character: char| !character.is_ascii_alphabetic())
                .to_ascii_uppercase();
            if !matches!(
                first_token.as_str(),
                "SELECT" | "SHOW" | "DESCRIBE" | "EXPLAIN"
            ) {
                return Err(
                    "La exportación de consultas solo permite SELECT, SHOW, DESCRIBE y EXPLAIN."
                        .into(),
                );
            }
            query.to_string()
        }
        None => {
            let table_ref = qualify_table(db_arg, &req.table).map_err(|error| error.to_string())?;
            format!("SELECT * FROM {table_ref}")
        }
    };

    let filename = if let Some(path) = req.file_path {
        path
    } else {
        let default_name = format!(
            "{}_{}.xlsx",
            req.table,
            chrono::Local::now().format("%Y%m%d_%H%M%S")
        );
        if let Some(download_dir) = dirs::download_dir() {
            download_dir
                .join(default_name)
                .to_string_lossy()
                .to_string()
        } else {
            default_name
        }
    };

    let mut target_path = PathBuf::from(&filename);
    if target_path.extension().is_none() {
        target_path.set_extension("xlsx");
    }
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet_with_constant_memory();

    // Professional header format: Bold, dark slate background, white text, thin borders
    let header_format = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x1E2433))
        .set_font_color(Color::RGB(0xFFFFFF))
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(0x3B4252));

    // Freeze panes on the first row
    worksheet
        .set_freeze_panes(1, 0)
        .map_err(|e| format!("Error fijando panel de cabecera: {e}"))?;

    // Standard border format for data rows
    let cell_format = Format::new()
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(0xCBD5E1));

    let mut total_rows: usize = 0;
    let mut column_widths: Vec<f64> = Vec::new();

    match &session.backend {
        SessionBackend::Direct(direct_backend)
        | SessionBackend::Ssh {
            backend: direct_backend,
            ..
        } => {
            use futures_util::StreamExt;
            let mut conn = direct_backend
                .pool()
                .acquire()
                .await
                .map_err(|e| format!("Error adquiriendo conexión para exportación: {e}"))?;

            if let Some(db) = db_arg {
                let quoted_db = quote_identifier(db).map_err(|e| e.to_string())?;
                sqlx::query(&format!("USE {quoted_db}"))
                    .execute(&mut *conn)
                    .await
                    .map_err(|e| format!("Error cambiando base de datos para exportar: {e}"))?;
            }

            let mut stream = sqlx::query(&query_str).fetch(&mut *conn);
            let mut headers_written = false;

            while let Some(row_result) = stream.next().await {
                let row = row_result.map_err(|e| format!("Error leyendo fila de consulta: {e}"))?;

                if !headers_written {
                    if row.columns().len() > 16_384 {
                        return Err("La hoja Excel excede el máximo de 16.384 columnas.".into());
                    }
                    column_widths = vec![12.0; row.columns().len()];
                    for (col_idx, col) in row.columns().iter().enumerate() {
                        column_widths[col_idx] =
                            (col.name().chars().count() as f64 + 2.0).clamp(12.0, 40.0);
                        worksheet
                            .write_string_with_format(0, col_idx as u16, col.name(), &header_format)
                            .map_err(|e| format!("Error escribiendo cabecera: {e}"))?;
                    }
                    headers_written = true;
                }

                if total_rows >= 1_048_575 {
                    return Err(
                        "La exportación excede el máximo de filas de una hoja Excel.".into(),
                    );
                }
                total_rows += 1;
                let excel_row = total_rows as u32;

                for (col_idx, col) in row.columns().iter().enumerate() {
                    let col_num = col_idx as u16;
                    let is_null = row
                        .try_get_raw(col_idx)
                        .map_err(|error| {
                            format!("Error leyendo columna '{}': {error}", col.name())
                        })?
                        .is_null();

                    if is_null {
                        worksheet
                            .write_blank(excel_row, col_num, &cell_format)
                            .map_err(|error| format!("Error escribiendo celda Excel: {error}"))?;
                        continue;
                    }

                    let type_name = col.type_info().name();
                    match type_name {
                        "BOOLEAN" | "TINYINT(1)" => {
                            if let Ok(b) = row.try_get::<bool, _>(col_idx) {
                                worksheet.write_boolean(excel_row, col_num, b).map_err(
                                    |error| format!("Error escribiendo celda Excel: {error}"),
                                )?;
                            } else {
                                write_cell_as_text(worksheet, excel_row, col_num, &row, col_idx)?;
                            }
                        }
                        "TINYINT" | "SMALLINT" | "INT" | "MEDIUMINT" | "BIGINT" => {
                            if let Ok(n) = row.try_get::<i64, _>(col_idx) {
                                if n.unsigned_abs() > 999_999_999_999_999 {
                                    write_cell_as_text(
                                        worksheet, excel_row, col_num, &row, col_idx,
                                    )?;
                                } else {
                                    worksheet
                                        .write_number(excel_row, col_num, n as f64)
                                        .map_err(|error| {
                                            format!("Error escribiendo celda Excel: {error}")
                                        })?;
                                }
                            } else if let Ok(u) = row.try_get::<u64, _>(col_idx) {
                                if u > 999_999_999_999_999 {
                                    write_cell_as_text(
                                        worksheet, excel_row, col_num, &row, col_idx,
                                    )?;
                                } else {
                                    worksheet
                                        .write_number(excel_row, col_num, u as f64)
                                        .map_err(|error| {
                                            format!("Error escribiendo celda Excel: {error}")
                                        })?;
                                }
                            } else {
                                write_cell_as_text(worksheet, excel_row, col_num, &row, col_idx)?;
                            }
                        }
                        "FLOAT" | "DOUBLE" => {
                            if let Ok(f) = row.try_get::<f64, _>(col_idx) {
                                worksheet
                                    .write_number(excel_row, col_num, f)
                                    .map_err(|error| {
                                        format!("Error escribiendo celda Excel: {error}")
                                    })?;
                            } else {
                                write_cell_as_text(worksheet, excel_row, col_num, &row, col_idx)?;
                            }
                        }
                        _ => {
                            if let Ok(s) = row.try_get::<String, _>(col_idx) {
                                column_widths[col_idx] = column_widths[col_idx]
                                    .max((s.chars().count() as f64 + 2.0).clamp(12.0, 40.0));
                                worksheet.write_string(excel_row, col_num, &s).map_err(
                                    |error| format!("Error escribiendo celda Excel: {error}"),
                                )?;
                            } else {
                                write_cell_as_text(worksheet, excel_row, col_num, &row, col_idx)?;
                            }
                        }
                    }
                }
                if total_rows % 1000 == 0 {
                    emit_export_progress(
                        app_handle,
                        total_rows,
                        "Consultando y escribiendo filas".into(),
                    );
                    tokio::task::yield_now().await;
                }
            }
        }
        SessionBackend::Tunnel(tunnel_backend) => {
            let res = tunnel_backend
                .execute_query(&query_str, db_arg)
                .await
                .map_err(|e| e.to_string())?;

            for (col_idx, col_name) in res.columns.iter().enumerate() {
                if col_idx >= 16_384 {
                    return Err("La hoja Excel excede el máximo de 16.384 columnas.".into());
                }
                if column_widths.len() <= col_idx {
                    column_widths.push(12.0);
                }
                column_widths[col_idx] = (col_name.chars().count() as f64 + 2.0).clamp(12.0, 40.0);
                worksheet
                    .write_string_with_format(0, col_idx as u16, col_name, &header_format)
                    .map_err(|e| format!("Error escribiendo cabecera: {e}"))?;
            }

            for (row_idx, row) in res.rows.iter().enumerate() {
                if total_rows >= 1_048_575 {
                    return Err(
                        "La exportación excede el máximo de filas de una hoja Excel.".into(),
                    );
                }
                total_rows += 1;
                let excel_row = (row_idx + 1) as u32;

                for (col_idx, val) in row.iter().enumerate() {
                    let col_num = col_idx as u16;
                    match val {
                        serde_json::Value::Null => {
                            worksheet
                                .write_blank(excel_row, col_num, &cell_format)
                                .map_err(|error| {
                                    format!("Error escribiendo celda Excel: {error}")
                                })?;
                        }
                        serde_json::Value::Bool(b) => {
                            worksheet
                                .write_boolean(excel_row, col_num, *b)
                                .map_err(|error| {
                                    format!("Error escribiendo celda Excel: {error}")
                                })?;
                        }
                        serde_json::Value::Number(n) => {
                            if let Some(i) = n.as_i64() {
                                worksheet
                                    .write_number(excel_row, col_num, i as f64)
                                    .map_err(|error| {
                                        format!("Error escribiendo celda Excel: {error}")
                                    })?;
                            } else if let Some(f) = n.as_f64() {
                                worksheet
                                    .write_number(excel_row, col_num, f)
                                    .map_err(|error| {
                                        format!("Error escribiendo celda Excel: {error}")
                                    })?;
                            } else {
                                worksheet
                                    .write_string(excel_row, col_num, n.to_string())
                                    .map_err(|error| {
                                        format!("Error escribiendo celda Excel: {error}")
                                    })?;
                            }
                        }
                        serde_json::Value::String(s) => {
                            column_widths[col_idx] = column_widths[col_idx]
                                .max((s.chars().count() as f64 + 2.0).clamp(12.0, 40.0));
                            worksheet
                                .write_string(excel_row, col_num, s)
                                .map_err(|error| {
                                    format!("Error escribiendo celda Excel: {error}")
                                })?;
                        }
                        other => {
                            worksheet
                                .write_string(excel_row, col_num, other.to_string())
                                .map_err(|error| {
                                    format!("Error escribiendo celda Excel: {error}")
                                })?;
                        }
                    }
                }
                if total_rows % 1000 == 0 {
                    emit_export_progress(
                        app_handle,
                        total_rows,
                        "Escribiendo filas del túnel".into(),
                    );
                    tokio::task::yield_now().await;
                }
            }
        }
    }

    for (column, width) in column_widths.iter().enumerate() {
        worksheet
            .set_column_width(column as u16, *width)
            .map_err(|error| format!("Error configurando ancho de columna: {error}"))?;
    }
    emit_export_progress(app_handle, total_rows, "Guardando archivo Excel".into());
    workbook
        .save(&target_path)
        .map_err(|e| format!("Error guardando archivo Excel en disco: {e}"))?;

    let file_size = std::fs::metadata(&target_path)
        .map_err(|error| format!("No se pudo consultar el archivo Excel guardado: {error}"))?
        .len();

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(ExportSummary {
        file_path: target_path.to_string_lossy().to_string(),
        total_rows,
        execution_time_ms: elapsed,
        file_size_bytes: file_size,
    })
}

fn write_cell_as_text(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    column: u16,
    source: &sqlx::mysql::MySqlRow,
    source_column: usize,
) -> Result<(), String> {
    let value = source
        .try_get::<Vec<u8>, _>(source_column)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .or_else(|_| source.try_get::<String, _>(source_column))
        .map_err(|_| "No se pudo convertir un valor SQL al formato Excel.".to_string())?;
    worksheet
        .write_string(row, column, value)
        .map_err(|error| format!("Error escribiendo celda Excel: {error}"))?;
    Ok(())
}

fn emit_export_progress(app_handle: Option<&tauri::AppHandle>, rows_written: usize, stage: String) {
    if let Some(app) = app_handle {
        let _ = app.emit(
            "excel-export-progress",
            ExportProgressEvent {
                rows_written,
                stage,
            },
        );
    }
}

pub fn export_dataset_to_excel(
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
    file_path: String,
    start_time: Instant,
) -> Result<ExportSummary, String> {
    let mut target_path = PathBuf::from(&file_path);
    if target_path.extension().is_none() {
        target_path.set_extension("xlsx");
    }
    let total_rows = rows.len();

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();

    // Professional header format: Bold, slate dark background, white text, thin borders
    let header_format = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x1E2433))
        .set_font_color(Color::RGB(0xFFFFFF))
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(0x3B4252));

    // Freeze panes on the first row
    worksheet
        .set_freeze_panes(1, 0)
        .map_err(|e| format!("Error fijando panel de cabecera: {e}"))?;

    // Write headers
    for (col_idx, col_name) in columns.iter().enumerate() {
        worksheet
            .write_string_with_format(0, col_idx as u16, col_name, &header_format)
            .map_err(|e| format!("Error escribiendo celda de cabecera: {e}"))?;
    }

    // Standard border format for data rows
    let cell_format = Format::new()
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(0xCBD5E1));

    // Write data rows
    for (row_idx, row) in rows.iter().enumerate() {
        let excel_row = (row_idx + 1) as u32;

        for (col_idx, val) in row.iter().enumerate() {
            let col_num = col_idx as u16;

            match val {
                serde_json::Value::Null => {
                    let _ = worksheet.write_blank(excel_row, col_num, &cell_format);
                }
                serde_json::Value::Bool(b) => {
                    let _ = worksheet.write_boolean(excel_row, col_num, *b);
                }
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        let _ = worksheet.write_number(excel_row, col_num, i as f64);
                    } else if let Some(f) = n.as_f64() {
                        let _ = worksheet.write_number(excel_row, col_num, f);
                    } else {
                        let _ = worksheet.write_string(excel_row, col_num, n.to_string());
                    }
                }
                serde_json::Value::String(s) => {
                    let _ = worksheet.write_string(excel_row, col_num, s);
                }
                other => {
                    let _ = worksheet.write_string(excel_row, col_num, other.to_string());
                }
            }
        }
    }

    worksheet.autofit();

    workbook
        .save(&target_path)
        .map_err(|e| format!("Error guardando archivo Excel en disco: {e}"))?;

    let file_size = std::fs::metadata(&target_path)
        .map(|m| m.len())
        .unwrap_or(0);

    let elapsed = start_time.elapsed().as_millis() as u64;

    Ok(ExportSummary {
        file_path: target_path.to_string_lossy().to_string(),
        total_rows,
        execution_time_ms: elapsed,
        file_size_bytes: file_size,
    })
}
