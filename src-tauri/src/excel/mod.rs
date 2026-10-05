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
    importer::import_excel(req, &state, Some(&app)).await
}

#[tauri::command]
pub async fn export_excel_file(
    req: ExportRequest,
    state: State<'_, DbState>,
) -> Result<ExportSummary, String> {
    exporter::export_to_excel(req, &state).await
}

#[tauri::command]
pub async fn export_dataset_file(
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
    file_path: String,
) -> Result<ExportSummary, String> {
    let start = std::time::Instant::now();
    exporter::export_dataset_to_excel(columns, rows, file_path, start)
}
