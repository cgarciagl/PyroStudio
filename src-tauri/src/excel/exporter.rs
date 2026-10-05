use rust_xlsxwriter::{Color, Format, FormatBorder, Workbook};
use sqlx::{Column, Row, TypeInfo, ValueRef};
use std::path::PathBuf;
use std::time::Instant;

use super::models::{ExportRequest, ExportSummary};
use crate::db::backend::DatabaseBackend;
use crate::db::service::get_session;
use crate::db::sql_utils::{qualify_table, quote_identifier};
use crate::db::state::SessionBackend;
use crate::db::DbState;

pub async fn export_to_excel(req: ExportRequest, state: &DbState) -> Result<ExportSummary, String> {
    let session = get_session(state).await.map_err(|e| e.to_string())?;
    let start = Instant::now();

    let db_arg = if req.database.trim().is_empty() {
        None
    } else {
        Some(req.database.as_str())
    };

    let table_ref = qualify_table(db_arg, &req.table).map_err(|e| e.to_string())?;

    let query_str = if let Some(ref q) = req.query {
        q.clone()
    } else {
        format!("SELECT * FROM {table_ref}")
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
    let worksheet = workbook.add_worksheet();

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

    match &session.backend {
        SessionBackend::Direct(direct_backend) => {
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
                    for (col_idx, col) in row.columns().iter().enumerate() {
                        worksheet
                            .write_string_with_format(0, col_idx as u16, col.name(), &header_format)
                            .map_err(|e| format!("Error escribiendo cabecera: {e}"))?;
                    }
                    headers_written = true;
                }

                total_rows += 1;
                let excel_row = total_rows as u32;

                for (col_idx, col) in row.columns().iter().enumerate() {
                    let col_num = col_idx as u16;
                    let is_null = row
                        .try_get_raw(col_idx)
                        .map(|v| v.is_null())
                        .unwrap_or(true);

                    if is_null {
                        let _ = worksheet.write_blank(excel_row, col_num, &cell_format);
                        continue;
                    }

                    let type_name = col.type_info().name();
                    match type_name {
                        "BOOLEAN" | "TINYINT(1)" => {
                            if let Ok(b) = row.try_get::<bool, _>(col_idx) {
                                let _ = worksheet.write_boolean(excel_row, col_num, b);
                            } else {
                                let _ = worksheet.write_blank(excel_row, col_num, &cell_format);
                            }
                        }
                        "TINYINT" | "SMALLINT" | "INT" | "MEDIUMINT" | "BIGINT" => {
                            if let Ok(n) = row.try_get::<i64, _>(col_idx) {
                                let _ = worksheet.write_number(excel_row, col_num, n as f64);
                            } else if let Ok(u) = row.try_get::<u64, _>(col_idx) {
                                let _ = worksheet.write_number(excel_row, col_num, u as f64);
                            } else {
                                let _ = worksheet.write_blank(excel_row, col_num, &cell_format);
                            }
                        }
                        "FLOAT" | "DOUBLE" => {
                            if let Ok(f) = row.try_get::<f64, _>(col_idx) {
                                let _ = worksheet.write_number(excel_row, col_num, f);
                            } else {
                                let _ = worksheet.write_blank(excel_row, col_num, &cell_format);
                            }
                        }
                        _ => {
                            if let Ok(s) = row.try_get::<String, _>(col_idx) {
                                let _ = worksheet.write_string(excel_row, col_num, &s);
                            } else {
                                let _ = worksheet.write_blank(excel_row, col_num, &cell_format);
                            }
                        }
                    }
                }
            }
        }
        SessionBackend::Tunnel(tunnel_backend) => {
            let res = tunnel_backend
                .execute_query(&query_str, db_arg)
                .await
                .map_err(|e| e.to_string())?;

            for (col_idx, col_name) in res.columns.iter().enumerate() {
                worksheet
                    .write_string_with_format(0, col_idx as u16, col_name, &header_format)
                    .map_err(|e| format!("Error escribiendo cabecera: {e}"))?;
            }

            for (row_idx, row) in res.rows.iter().enumerate() {
                total_rows += 1;
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
        }
    }

    worksheet.autofit();
    workbook
        .save(&target_path)
        .map_err(|e| format!("Error guardando archivo Excel en disco: {e}"))?;

    let file_size = std::fs::metadata(&target_path)
        .map(|m| m.len())
        .unwrap_or(0);

    let elapsed = start.elapsed().as_millis() as u64;

    Ok(ExportSummary {
        file_path: target_path.to_string_lossy().to_string(),
        total_rows,
        execution_time_ms: elapsed,
        file_size_bytes: file_size,
    })
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
