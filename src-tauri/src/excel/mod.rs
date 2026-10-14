pub mod exporter;
pub mod importer;
pub mod models;

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
        .unwrap_or_else(|| "Seleccionar archivo Excel para importar".to_string());

    let file = rfd::AsyncFileDialog::new()
        .add_filter("Excel Spreadsheet (*.xlsx, *.xls)", &["xlsx", "xls"])
        .set_title(&custom_title)
        .pick_file()
        .await;

    Ok(file.map(|f| f.path().to_string_lossy().to_string()))
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
        .set_file_name(&file_name)
        .set_title("Guardar archivo Excel exportado")
        .save_file()
        .await;

    Ok(file.map(|f| f.path().to_string_lossy().to_string()))
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
    importer::import_excel(req, &state, Some(&app)).await
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
    exporter::export_to_excel(req, &state, Some(&app)).await
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
    let start = std::time::Instant::now();
    exporter::export_dataset_to_excel(columns, rows, file_path, start)
}
