use futures_util::stream;
use futures_util::StreamExt;
use rust_xlsxwriter::{Color, ExcelDateTime, Format, FormatBorder, Workbook, Worksheet};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Instant;
use tokio::sync::mpsc;

use super::models::{ExportProgressEvent, ExportRequest, ExportSummary};
use crate::db::backend::{DatabaseBackend, EngineError, ExportCell, RowStream, RowStreamItem};
use crate::db::service::get_session;
use crate::db::sql_dump::{build_chunk_query_with_select, extract_key, is_binary_column_type};
use crate::db::sql_utils::qualify_table;
use crate::db::sql_utils::quote_ident_mysql;
use crate::db::state::SessionBackend;
use crate::db::DbState;
use tauri::Emitter;

const MAX_EXCEL_COLUMNS: usize = 16_384;
/// Excel sheets hold 1,048,576 rows; one is used by the header.
const MAX_EXCEL_DATA_ROWS: usize = 1_048_575;
const PROGRESS_INTERVAL_ROWS: usize = 1000;
/// Column widths come from the first rows of each sheet only: measuring every
/// cell of a multi-million-row export costs time and changes nothing visible.
const AUTOSIZE_SAMPLE_ROWS: usize = 1000;

pub const KEYSET_CHUNK_SIZE: usize = 10_000;
pub const KEYSET_STREAM_BUFFER: usize = 512;
pub const MAX_CHUNK_RETRIES: usize = 4;

/// Streams table rows chunk by chunk using primary key keyset pagination,
/// with automatic retry upon connection drops or timeouts to ensure resilient exports.
pub fn spawn_keyset_row_stream(
    backend: SessionBackend,
    database: Option<String>,
    table: String,
    pk_columns: Vec<String>,
) -> RowStream {
    let (sender, receiver) = mpsc::channel(KEYSET_STREAM_BUFFER);
    tokio::spawn(async move {
        let _slot = backend.acquire_background_slot().await;
        if let Err(error) =
            forward_keyset_rows(backend, database, table, pk_columns, sender.clone()).await
        {
            let _ = sender.send(Err(error)).await;
        }
    });
    stream::unfold(receiver, |mut receiver| async move {
        receiver.recv().await.map(|item| (item, receiver))
    })
    .boxed()
}

async fn forward_keyset_rows(
    backend: SessionBackend,
    database: Option<String>,
    table: String,
    pk_columns: Vec<String>,
    sender: mpsc::Sender<Result<RowStreamItem, EngineError>>,
) -> Result<(), EngineError> {
    let db_arg = database.as_deref();
    let qualified = qualify_table(db_arg, &table).map_err(|e| EngineError::new(e.to_string()))?;

    let columns_meta = crate::db::table::get_table_columns(&backend, db_arg.unwrap_or(""), &table)
        .await
        .unwrap_or_default();
    let pk_types: Vec<String> = pk_columns
        .iter()
        .map(|pk| {
            let pk_clean = pk.trim_matches(|ch| ch == '`' || ch == '"');
            columns_meta
                .iter()
                .find(|c| {
                    let c_clean = c.name.trim_matches(|ch| ch == '`' || ch == '"');
                    c_clean.eq_ignore_ascii_case(pk_clean)
                })
                .map(|c| {
                    if !c.data_type.is_empty() {
                        c.data_type.clone()
                    } else {
                        c.column_type.clone()
                    }
                })
                .unwrap_or_default()
        })
        .collect();
    let pk_type_refs: Vec<&str> = pk_types.iter().map(String::as_str).collect();
    let (select_list, hidden_count) = keyset_select_list(&pk_columns, &pk_type_refs);

    let mut last_key: Option<Vec<serde_json::Value>> = None;
    let mut columns_sent = false;

    loop {
        if super::CANCEL_EXCEL_OPERATION.load(Ordering::Relaxed) {
            return Err(EngineError::new(
                "Operación de exportación cancelada por el usuario.",
            ));
        }

        let query = build_chunk_query_with_select(
            &select_list,
            &qualified,
            &pk_columns,
            &pk_type_refs,
            0,
            last_key.as_deref(),
            KEYSET_CHUNK_SIZE,
            0,
        )
        .map_err(|e| EngineError::new(e.to_string()))?;

        let mut retries = 0;
        let chunk_res = loop {
            if super::CANCEL_EXCEL_OPERATION.load(Ordering::Relaxed) {
                return Err(EngineError::new(
                    "Operación de exportación cancelada por el usuario.",
                ));
            }

            match backend.execute_query(&query, db_arg).await {
                Ok(res) => break res,
                Err(err) => {
                    retries += 1;
                    if retries > MAX_CHUNK_RETRIES {
                        return Err(EngineError::new(format!(
                            "Fallo de conexión tras {MAX_CHUNK_RETRIES} reintentos en exportación keyset: {err}"
                        )));
                    }
                    tracing::warn!(
                        "Error en lote keyset de '{table}' (reintento {retries}/{MAX_CHUNK_RETRIES}): {err}. Reintentando..."
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(500 * retries as u64))
                        .await;
                }
            }
        };

        let visible = chunk_res.columns.len().saturating_sub(hidden_count);

        if !columns_sent {
            columns_sent = true;
            let cols = RowStreamItem::Columns(chunk_res.columns[..visible].to_vec());
            if sender.send(Ok(cols)).await.is_err() {
                return Ok(());
            }
        }

        let rows_count = chunk_res.rows.len();
        if rows_count == 0 {
            break;
        }

        let next_key = keyset_cursor_from_row(
            &chunk_res.columns,
            chunk_res.rows.last().unwrap(),
            &pk_columns,
            &pk_type_refs,
        )
        .map_err(|e| EngineError::new(e.to_string()))?;

        for row in chunk_res.rows {
            let cells = row
                .iter()
                .take(visible)
                .map(crate::db::backend::json_export_cell)
                .collect();
            if sender.send(Ok(RowStreamItem::Row(cells))).await.is_err() {
                return Ok(());
            }
        }

        last_key = Some(next_key);

        if rows_count < KEYSET_CHUNK_SIZE {
            break;
        }
    }

    Ok(())
}

/// Alias of the hidden `HEX(pk)` column appended for the binary key column at `index`.
fn hidden_pk_alias(index: usize) -> String {
    format!("__pyro_pk_hex_{index}")
}

/// Select list for keyset export: every visible column plus one hidden `HEX(pk)`
/// column per binary key column. The visible values come from `display_bytes`, which
/// returns plain text for binary data that happens to be valid UTF-8, so they cannot
/// be turned back into the exact bytes needed for the cursor. Returns the select
/// list and how many hidden columns were appended (always at the end).
pub fn keyset_select_list(pk_columns: &[String], pk_types: &[&str]) -> (String, usize) {
    let mut select = String::from("*");
    let mut hidden = 0;
    for (i, pk) in pk_columns.iter().enumerate() {
        if is_binary_column_type(pk_types.get(i).copied().unwrap_or("")) {
            let col = quote_ident_mysql(pk.trim_matches(|ch| ch == '`' || ch == '"'));
            select.push_str(&format!(
                ", HEX({col}) AS {}",
                quote_ident_mysql(&hidden_pk_alias(i))
            ));
            hidden += 1;
        }
    }
    (select, hidden)
}

/// Cursor values for the next chunk: binary key columns are read from their hidden
/// hexadecimal column (so `format_sql_value_typed` emits `0x…`); the rest from the row.
pub fn keyset_cursor_from_row(
    columns: &[String],
    row: &[serde_json::Value],
    pk_columns: &[String],
    pk_types: &[&str],
) -> Result<Vec<serde_json::Value>, crate::db::error::PyroError> {
    let mut key = extract_key(columns, row, pk_columns)?;
    for (i, value) in key.iter_mut().enumerate() {
        if !is_binary_column_type(pk_types.get(i).copied().unwrap_or("")) {
            continue;
        }
        let alias = hidden_pk_alias(i);
        let idx = columns.iter().position(|c| *c == alias).ok_or_else(|| {
            crate::db::error::PyroError::Database(format!(
                "Falta la columna auxiliar {alias} para la clave binaria."
            ))
        })?;
        *value = row.get(idx).cloned().unwrap_or(serde_json::Value::Null);
    }
    Ok(key)
}

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

    let is_table_export = req
        .query
        .as_deref()
        .map(|q| q.trim().is_empty())
        .unwrap_or(true);

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

    let pk_columns = if is_table_export {
        crate::db::table::get_table_primary_key(&session.backend, db_arg.unwrap_or(""), &req.table)
            .await
            .map(|pk| pk.columns)
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let rows: RowStream = if !pk_columns.is_empty() {
        spawn_keyset_row_stream(
            session.backend.clone(),
            db_arg.map(str::to_string),
            req.table.clone(),
            pk_columns,
        )
    } else {
        session
            .backend
            .stream_rows(&query_str, db_arg)
            .await
            .map_err(|error| error.to_string())?
    };

    let rows = match req.masking.as_ref().filter(|m| !m.rules.is_empty()) {
        None => rows,
        Some(_) if !is_table_export => {
            return Err(
                "El enmascaramiento solo está disponible al exportar una tabla completa.".into(),
            )
        }
        Some(masking) => {
            let seed = crate::db::masking::resolve_seed(masking).map_err(|e| e.to_string())?;
            let mut masker =
                crate::db::masking::Masker::new(masking, seed).map_err(|e| e.to_string())?;
            let database = db_arg.unwrap_or("");
            let backend_ref: &dyn DatabaseBackend = &session.backend;
            if let Ok(fks) = crate::db::introspect::introspector(backend_ref)
                .foreign_keys(backend_ref, database)
                .await
            {
                masker.propagate_foreign_keys(&fks);
            }
            let columns_meta =
                crate::db::table::get_table_columns(&session.backend, database, &req.table)
                    .await
                    .map_err(|e| e.to_string())?;
            let cols: Vec<(String, String)> = columns_meta
                .iter()
                .map(|c| {
                    let ty = if is_binary_column_type(&c.data_type) {
                        "binary".to_string()
                    } else if !c.column_type.is_empty() {
                        c.column_type.clone()
                    } else {
                        c.data_type.clone()
                    };
                    (c.name.clone(), ty)
                })
                .collect();
            let pk =
                crate::db::table::get_table_primary_key(&session.backend, database, &req.table)
                    .await
                    .map(|pk| pk.columns)
                    .unwrap_or_default();
            let plan = masker.column_plan(&req.table, &cols, &pk);
            let names = cols.into_iter().map(|(n, _)| n).collect();
            crate::db::masking::mask_row_stream(rows, masker, req.table.clone(), names, plan)
        }
    };

    if let Some(gzip) = csv_target(&target_path) {
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

    let mut rows = rows;
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

    #[tokio::test]
    async fn keyset_row_stream_streams_batches_and_handles_last_key() {
        use crate::db::sqlite::tests::TempDatabase;
        use crate::db::state::{SessionBackend, SessionTransport};
        use futures_util::StreamExt;

        let db = TempDatabase::with_schema(
            "CREATE TABLE items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            );
            INSERT INTO items (id, name) VALUES (1, 'uno');
            INSERT INTO items (id, name) VALUES (2, 'dos');
            INSERT INTO items (id, name) VALUES (3, 'tres');",
        )
        .await;

        let backend = SessionBackend {
            transport: SessionTransport::Sqlite(db.backend.clone()),
            read_only: false,
            audit_label: "test".into(),
        };

        let mut stream =
            super::spawn_keyset_row_stream(backend, None, "items".into(), vec!["id".into()]);

        let first = stream.next().await.unwrap().unwrap();
        assert_eq!(
            first,
            crate::db::backend::RowStreamItem::Columns(vec!["id".into(), "name".into()])
        );

        let row1 = stream.next().await.unwrap().unwrap();
        assert_eq!(
            row1,
            crate::db::backend::RowStreamItem::Row(vec![
                crate::db::backend::ExportCell::Number(1.0),
                crate::db::backend::ExportCell::Text {
                    value: "uno".into(),
                    autosize: true
                }
            ])
        );

        let row2 = stream.next().await.unwrap().unwrap();
        assert_eq!(
            row2,
            crate::db::backend::RowStreamItem::Row(vec![
                crate::db::backend::ExportCell::Number(2.0),
                crate::db::backend::ExportCell::Text {
                    value: "dos".into(),
                    autosize: true
                }
            ])
        );

        let row3 = stream.next().await.unwrap().unwrap();
        assert_eq!(
            row3,
            crate::db::backend::RowStreamItem::Row(vec![
                crate::db::backend::ExportCell::Number(3.0),
                crate::db::backend::ExportCell::Text {
                    value: "tres".into(),
                    autosize: true
                }
            ])
        );

        assert!(stream.next().await.is_none());
    }
}

#[cfg(test)]
mod keyset_binary_pk_tests {
    use super::*;
    use crate::db::sql_dump::build_chunk_query_with_select;
    use serde_json::json;

    #[test]
    fn select_list_adds_hidden_hex_only_for_binary_keys() {
        let pk = vec!["tenant".to_string(), "id".to_string()];
        let (sel, hidden) = keyset_select_list(&pk, &["int", "varbinary"]);
        assert_eq!(sel, "*, HEX(`id`) AS `__pyro_pk_hex_1`");
        assert_eq!(hidden, 1);
        let (sel, hidden) = keyset_select_list(&["id".to_string()], &["int"]);
        assert_eq!((sel.as_str(), hidden), ("*", 0));
    }

    #[test]
    fn utf8_binary_key_uses_hidden_hex_column() {
        // VARBINARY PK holding "user01": the visible value is plain text.
        let pk = vec!["id".to_string()];
        let types = ["varbinary"];
        let columns = vec!["id".into(), "name".into(), "__pyro_pk_hex_0".into()];
        let row = vec![json!("user01"), json!("Ana"), json!("757365723031")];
        let key = keyset_cursor_from_row(&columns, &row, &pk, &types).unwrap();
        let (sel, _) = keyset_select_list(&pk, &types);
        let q =
            build_chunk_query_with_select(&sel, "`t`", &pk, &types, 0, Some(&key), 10, 0).unwrap();
        assert!(q.contains("WHERE `id` > 0x757365723031"), "{q}");
    }

    #[test]
    fn hex_looking_text_is_not_reinterpreted() {
        // "cafe" stored as bytes must not become 0xCAFE.
        let pk = vec!["id".to_string()];
        let types = ["binary"];
        let columns = vec!["id".into(), "__pyro_pk_hex_0".into()];
        let row = vec![json!("cafe"), json!("63616665")];
        let key = keyset_cursor_from_row(&columns, &row, &pk, &types).unwrap();
        let q =
            build_chunk_query_with_select("*", "`t`", &pk, &types, 0, Some(&key), 10, 0).unwrap();
        assert!(q.contains("> 0x63616665"), "{q}");
        assert!(!q.to_lowercase().contains("0xcafe"), "{q}");
    }

    #[test]
    fn non_binary_keys_keep_visible_values() {
        let pk = vec!["code".to_string()];
        let types = ["varchar(20)"];
        let columns = vec!["code".into()];
        let row = vec![json!("0xAB")];
        let key = keyset_cursor_from_row(&columns, &row, &pk, &types).unwrap();
        assert_eq!(key, vec![json!("0xAB")]);
    }
}
