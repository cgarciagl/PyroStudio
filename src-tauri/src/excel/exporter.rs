use futures_util::StreamExt;
use rust_xlsxwriter::{Color, ExcelDateTime, Format, FormatBorder, Workbook, Worksheet};
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
/// Column widths come from the first rows of each sheet only: measuring every
/// cell of a multi-million-row export costs time and changes nothing visible.
const AUTOSIZE_SAMPLE_ROWS: usize = 1000;

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
    if let Some(gzip) = csv_target(&target_path) {
        let rows = session
            .backend
            .stream_rows(&query_str, db_arg)
            .await
            .map_err(|error| error.to_string())?;
        return super::csv_export::export_csv(
            rows,
            &target_path,
            gzip,
            req.csv_part_rows.filter(|n| *n > 0),
            app_handle,
            start,
        )
        .await;
    }
    let mut workbook = Workbook::new();
    let mut worksheet = workbook.add_worksheet_with_constant_memory();

    // Professional header format: Bold, dark slate background, white text, thin borders
    let header_format = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x1E2433))
        .set_font_color(Color::RGB(0xFFFFFF))
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(0x3B4252));

    // Dates and datetimes are written as real Excel dates so they sort and filter.
    let formats = CellFormats {
        date: Format::new().set_num_format("yyyy-mm-dd"),
        datetime: Format::new().set_num_format("yyyy-mm-dd hh:mm:ss"),
    };

    let mut rows = session
        .backend
        .stream_rows(&query_str, db_arg)
        .await
        .map_err(|error| error.to_string())?;
    let mut total_rows: usize = 0;
    let mut sheet_rows: usize = 0;
    let mut sheet_count: usize = 1;
    let mut columns: Vec<String> = Vec::new();
    let mut column_widths: Vec<f64> = Vec::new();

    while let Some(item) = rows.next().await {
        match item.map_err(|error| error.to_string())? {
            RowStreamItem::Columns(names) => {
                column_widths = start_sheet(worksheet, 1, &names, &header_format)?;
                columns = names;
            }
            RowStreamItem::Row(cells) => {
                // A full sheet continues on a new one instead of failing.
                if sheet_rows >= MAX_EXCEL_DATA_ROWS {
                    apply_column_widths(worksheet, &column_widths)?;
                    sheet_count += 1;
                    worksheet = workbook.add_worksheet_with_constant_memory();
                    column_widths = start_sheet(worksheet, sheet_count, &columns, &header_format)?;
                    sheet_rows = 0;
                }
                total_rows += 1;
                sheet_rows += 1;
                let widths = (sheet_rows <= AUTOSIZE_SAMPLE_ROWS).then_some(&mut column_widths[..]);
                write_data_row(worksheet, sheet_rows as u32, &cells, &formats, widths)?;
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

    apply_column_widths(worksheet, &column_widths)?;
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

/// `Some(gzip)` when the chosen file is a CSV (`.csv`) or compressed CSV (`.gz`).
fn csv_target(path: &std::path::Path) -> Option<bool> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "csv" => Some(false),
        "gz" => Some(true),
        _ => None,
    }
}

/// Names the sheet, freezes the header row and writes it; returns the
/// initial width of each column.
fn start_sheet(
    worksheet: &mut Worksheet,
    sheet_number: usize,
    columns: &[String],
    header_format: &Format,
) -> Result<Vec<f64>, String> {
    worksheet
        .set_name(sheet_name(sheet_number))
        .map_err(|e| format!("Error nombrando la hoja: {e}"))?;
    worksheet
        .set_freeze_panes(1, 0)
        .map_err(|e| format!("Error fijando panel de cabecera: {e}"))?;
    write_headers(worksheet, columns, header_format)
}

fn sheet_name(sheet_number: usize) -> String {
    format!("Datos {sheet_number}")
}

fn apply_column_widths(worksheet: &mut Worksheet, widths: &[f64]) -> Result<(), String> {
    for (column, width) in widths.iter().enumerate() {
        worksheet
            .set_column_width(column as u16, *width)
            .map_err(|error| format!("Error configurando ancho de columna: {error}"))?;
    }
    Ok(())
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

struct CellFormats {
    date: Format,
    datetime: Format,
}

/// `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS[.fff]` as written by the database; zero
/// dates (`0000-00-00`) and anything else stay text.
fn parse_sql_datetime(text: &str) -> Option<(ExcelDateTime, bool)> {
    let b = text.as_bytes();
    let digits = |range: std::ops::Range<usize>| b[range].iter().all(u8::is_ascii_digit);
    let is_date = b.len() >= 10
        && digits(0..4)
        && b[4] == b'-'
        && digits(5..7)
        && b[7] == b'-'
        && digits(8..10);
    if !is_date || text.starts_with("0000") {
        return None;
    }
    match b.len() {
        10 => ExcelDateTime::parse_from_str(text).ok().map(|d| (d, false)),
        19.. if (b[10] == b' ' || b[10] == b'T')
            && digits(11..13)
            && b[13] == b':'
            && digits(14..16)
            && b[16] == b':'
            && digits(17..19) =>
        {
            ExcelDateTime::parse_from_str(&text.replacen('T', " ", 1))
                .ok()
                .map(|d| (d, true))
        }
        _ => None,
    }
}

/// `column_widths` is `None` once the sheet is past its autosize sample.
fn write_data_row(
    worksheet: &mut Worksheet,
    excel_row: u32,
    cells: &[ExportCell],
    formats: &CellFormats,
    mut column_widths: Option<&mut [f64]>,
) -> Result<(), String> {
    for (index, cell) in cells.iter().enumerate() {
        let column = index as u16;
        let written = match cell {
            // Empty cells are simply not written: no per-cell format to store.
            ExportCell::Blank => continue,
            ExportCell::Bool(flag) => worksheet.write_boolean(excel_row, column, *flag),
            ExportCell::Number(number) => worksheet.write_number(excel_row, column, *number),
            ExportCell::Text { value, autosize } => {
                if let Some(widths) = column_widths.as_deref_mut() {
                    if *autosize {
                        widths[index] = widths[index].max(text_column_width(value));
                    }
                }
                match parse_sql_datetime(value) {
                    Some((date, has_time)) => {
                        let format = if has_time {
                            &formats.datetime
                        } else {
                            &formats.date
                        };
                        worksheet.write_datetime_with_format(excel_row, column, &date, format)
                    }
                    None => worksheet.write_string(excel_row, column, value),
                }
            }
        };
        written.map_err(|error| format!("Error escribiendo celda Excel: {error}"))?;
    }
    Ok(())
}

fn text_column_width(text: &str) -> f64 {
    (text.chars().count() as f64 + 2.0).clamp(12.0, 40.0)
}

pub(super) fn emit_export_progress(
    app_handle: Option<&tauri::AppHandle>,
    rows_written: usize,
    stage: String,
) {
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

#[cfg(test)]
mod light_export_tests {
    use super::parse_sql_datetime;

    #[test]
    fn recognizes_sql_dates_and_datetimes_only() {
        assert_eq!(parse_sql_datetime("2024-02-29").map(|d| d.1), Some(false));
        assert_eq!(
            parse_sql_datetime("2024-02-29 13:45:10").map(|d| d.1),
            Some(true)
        );
        assert_eq!(
            parse_sql_datetime("2024-02-29T13:45:10.250").map(|d| d.1),
            Some(true)
        );
        assert!(parse_sql_datetime("0000-00-00").is_none());
        assert!(parse_sql_datetime("2024-13-01").is_none());
        assert!(parse_sql_datetime("2024-02-29 extra").is_none());
        assert!(parse_sql_datetime("12345").is_none());
        assert!(parse_sql_datetime("ABC-01-01x").is_none());
    }
}
