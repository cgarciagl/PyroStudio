use futures_util::StreamExt;
use rust_xlsxwriter::{Color, Format, FormatBorder, Workbook, Worksheet};
use std::path::PathBuf;
use std::time::Instant;

use super::models::{ExportProgressEvent, ExportRequest, ExportSummary};
use crate::db::backend::{DatabaseBackend, ExportCell, RowStreamItem};
use crate::db::service::get_session;
use crate::db::sql_utils::qualify_table;
use crate::db::DbState;
use tauri::Emitter;

const MAX_EXCEL_COLUMNS: usize = 16_384;
/// Excel sheets hold 1,048,576 rows; one is used by the header.
const MAX_EXCEL_DATA_ROWS: usize = 1_048_575;
const PROGRESS_INTERVAL_ROWS: usize = 1000;

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
            if !crate::db::safe_mode::returns_result_set(query) {
                return Err(
                    "La exportación de consultas solo permite consultas que devuelven filas (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN)."
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

    let mut rows = session
        .backend
        .stream_rows(&query_str, db_arg)
        .await
        .map_err(|error| error.to_string())?;
    let mut total_rows: usize = 0;
    let mut column_widths: Vec<f64> = Vec::new();

    while let Some(item) = rows.next().await {
        match item.map_err(|error| error.to_string())? {
            RowStreamItem::Columns(columns) => {
                column_widths = write_headers(worksheet, &columns, &header_format)?;
            }
            RowStreamItem::Row(cells) => {
                if total_rows >= MAX_EXCEL_DATA_ROWS {
                    return Err(
                        "La exportación excede el máximo de filas de una hoja Excel.".into(),
                    );
                }
                total_rows += 1;
                write_data_row(
                    worksheet,
                    total_rows as u32,
                    &cells,
                    &cell_format,
                    &mut column_widths,
                )?;
                if total_rows.is_multiple_of(PROGRESS_INTERVAL_ROWS) {
                    if super::CANCEL_EXCEL_OPERATION.load(std::sync::atomic::Ordering::Relaxed) {
                        return Err("Operación de exportación cancelada por el usuario.".into());
                    }
                    emit_export_progress(
                        app_handle,
                        total_rows,
                        "Consultando y escribiendo filas".into(),
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

/// Writes the header row and returns the initial width of each column.
fn write_headers(
    worksheet: &mut Worksheet,
    columns: &[String],
    header_format: &Format,
) -> Result<Vec<f64>, String> {
    if columns.len() > MAX_EXCEL_COLUMNS {
        return Err("La hoja Excel excede el máximo de 16.384 columnas.".into());
    }
    let mut widths = Vec::with_capacity(columns.len());
    for (index, name) in columns.iter().enumerate() {
        widths.push(text_column_width(name));
        worksheet
            .write_string_with_format(0, index as u16, name, header_format)
            .map_err(|e| format!("Error escribiendo cabecera: {e}"))?;
    }
    Ok(widths)
}

fn write_data_row(
    worksheet: &mut Worksheet,
    excel_row: u32,
    cells: &[ExportCell],
    cell_format: &Format,
    column_widths: &mut [f64],
) -> Result<(), String> {
    for (index, cell) in cells.iter().enumerate() {
        let column = index as u16;
        let written = match cell {
            ExportCell::Blank => worksheet.write_blank(excel_row, column, cell_format),
            ExportCell::Bool(flag) => worksheet.write_boolean(excel_row, column, *flag),
            ExportCell::Number(number) => worksheet.write_number(excel_row, column, *number),
            ExportCell::Text { value, autosize } => {
                if *autosize {
                    column_widths[index] = column_widths[index].max(text_column_width(value));
                }
                worksheet.write_string(excel_row, column, value)
            }
        };
        written.map_err(|error| format!("Error escribiendo celda Excel: {error}"))?;
    }
    Ok(())
}

fn text_column_width(text: &str) -> f64 {
    (text.chars().count() as f64 + 2.0).clamp(12.0, 40.0)
}

fn emit_export_progress(app_handle: Option<&tauri::AppHandle>, rows_written: usize, stage: String) {
    if let Some(app) = app_handle {
        let start = super::EXCEL_OP_START_MILLIS.load(std::sync::atomic::Ordering::Relaxed);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let elapsed_secs = if now > start {
            (now - start) as f64 / 1000.0
        } else {
            0.0
        };
        let rows_per_sec = if elapsed_secs > 0.05 && rows_written > 0 {
            (rows_written as f64 / elapsed_secs).round()
        } else {
            0.0
        };

        let event = ExportProgressEvent {
            rows_written,
            stage,
            rows_per_sec,
        };
        let _ = app.emit("excel-export-progress", &event);
        let _ = app.emit("excel-progress", &event);
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
