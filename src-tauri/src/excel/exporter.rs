use std::path::PathBuf;
use std::time::Instant;
use rust_xlsxwriter::{Color, Format, FormatBorder, Workbook};

use super::models::{ExportRequest, ExportSummary};
use crate::db::service::{execute_query_session, get_session};
use crate::db::DbState;

pub async fn export_to_excel(
    req: ExportRequest,
    state: &DbState,
) -> Result<ExportSummary, String> {
    let session = get_session(state).await?;
    let start = Instant::now();

    let clean_db = req.database.replace('`', "``");
    let clean_tbl = req.table.replace('`', "``");

    let query_str = if let Some(ref q) = req.query {
        q.clone()
    } else {
        format!("SELECT * FROM `{clean_db}`.`{clean_tbl}`")
    };

    let query_result = execute_query_session(&session, &query_str, Some(&req.database)).await?;

    let filename = if let Some(path) = req.file_path {
        path
    } else {
        let default_name = format!(
            "{}_{}.xlsx",
            req.table,
            chrono::Local::now().format("%Y%m%d_%H%M%S")
        );
        if let Some(download_dir) = dirs::download_dir() {
            download_dir.join(default_name).to_string_lossy().to_string()
        } else {
            default_name
        }
    };

    export_dataset_to_excel(query_result.columns, query_result.rows, filename, start)
}

pub fn export_dataset_to_excel(
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
    file_path: String,
    start_time: Instant,
) -> Result<ExportSummary, String> {
    let target_path = PathBuf::from(&file_path);
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

    // Freeze panes on the first row (headers stay visible while scrolling)
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

    // Auto-fit column widths
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
