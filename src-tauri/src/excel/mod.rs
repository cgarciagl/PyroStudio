mod csv_export;
pub mod exporter;
pub mod importer;
pub mod models;
pub mod source;

use crate::db::DbState;
pub use models::*;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn pick_excel_file(
    dialog_title: Option<String>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let custom_title = dialog_title
        .or(title)
        .unwrap_or_else(|| "Seleccionar archivo para importar (Excel, CSV o JSON)".to_string());

    let file = rfd::AsyncFileDialog::new()
        .add_filter(
            "Datos (*.xlsx, *.xls, *.csv, *.tsv, *.txt, *.json, *.jsonl)",
            &[
                "xlsx", "xls", "csv", "tsv", "txt", "json", "jsonl", "ndjson",
            ],
        )
        .add_filter("Excel (*.xlsx, *.xls)", &["xlsx", "xls"])
        .add_filter("CSV / TSV (*.csv, *.tsv, *.txt)", &["csv", "tsv", "txt"])
        .add_filter("JSON (*.json, *.jsonl)", &["json", "jsonl", "ndjson"])
        .set_title(&custom_title)
        .pick_file()
        .await;

    Ok(file.map(|f| crate::file_grants::grant(f.path())))
}

#[tauri::command]
pub async fn save_excel_dialog(
    default_name: Option<String>,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let raw_name = default_name
        .or(default_filename)
        .unwrap_or_else(|| "export.xlsx".to_string());

    let file_name = if raw_name.trim().is_empty() {
        "export.xlsx".to_string()
    } else {
        raw_name
    };

    let file = rfd::AsyncFileDialog::new()
        .add_filter("Excel Spreadsheet (*.xlsx)", &["xlsx"])
        .add_filter("CSV (*.csv)", &["csv"])
        .add_filter("CSV comprimido (*.csv.gz)", &["gz"])
        .set_file_name(&file_name)
        .set_title("Guardar archivo Excel exportado")
        .save_file()
        .await;

    Ok(file.map(|f| crate::file_grants::grant(f.path())))
}

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

pub static CANCEL_EXCEL_OPERATION: AtomicBool = AtomicBool::new(false);
pub static EXCEL_OP_START_MILLIS: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn cancel_excel_operation() -> Result<bool, String> {
    CANCEL_EXCEL_OPERATION.store(true, Ordering::Relaxed);
    Ok(true)
}

#[tauri::command]
pub async fn preview_excel_file(
    file_path: String,
    sheet_name: Option<String>,
) -> Result<ExcelPreviewData, String> {
    crate::file_grants::require(&file_path)?;
    importer::preview_excel(file_path, sheet_name)
}

#[tauri::command]
pub async fn import_excel_file(
    app: AppHandle,
    req: ImportRequest,
    state: State<'_, DbState>,
) -> Result<ImportSummary, String> {
    CANCEL_EXCEL_OPERATION.store(false, Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    EXCEL_OP_START_MILLIS.store(now, Ordering::Relaxed);
    crate::file_grants::require(&req.file_path)?;
    let result = importer::import_excel(req, &state, Some(&app)).await;
    log_outcome("Importación", result.as_ref().map(|s| s.successful_rows));
    result
}

#[tauri::command]
pub async fn export_excel_file(
    app: AppHandle,
    req: ExportRequest,
    state: State<'_, DbState>,
) -> Result<ExportSummary, String> {
    CANCEL_EXCEL_OPERATION.store(false, Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    EXCEL_OP_START_MILLIS.store(now, Ordering::Relaxed);
    if let Some(path) = &req.file_path {
        crate::file_grants::require(path)?;
    }
    let result = exporter::export_to_excel(req, &state, Some(&app)).await;
    log_outcome("Exportación", result.as_ref().map(|s| s.total_rows));
    result
}

/// One log line per import/export: rows on success, the error otherwise.
fn log_outcome(operation: &str, result: Result<usize, &String>) {
    match result {
        Ok(rows) => tracing::info!(rows, "{operation} terminada"),
        Err(error) => tracing::warn!("{operation} fallida: {error}"),
    }
}

#[tauri::command]
pub async fn export_dataset_file(
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
    file_path: String,
) -> Result<ExportSummary, String> {
    if rows.len() > crate::db::query::DEFAULT_MAX_INTERACTIVE_ROWS {
        return Err(
            "La exportación de datos entregados por React está limitada a 5.000 filas; usa exportación SQL del lado de Rust para conjuntos mayores.".into(),
        );
    }
    if columns.len() > 16_384 {
        return Err("El archivo Excel excede el máximo de 16.384 columnas.".into());
    }
    crate::file_grants::require(&file_path)?;
    let start = std::time::Instant::now();
    exporter::export_dataset_to_excel(columns, rows, file_path, start)
}
