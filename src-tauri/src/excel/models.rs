use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExcelPreviewData {
    pub file_path: String,
    pub sheets: Vec<String>,
    pub selected_sheet: String,
    pub headers: Vec<String>,
    pub preview_rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMapping {
    pub excel_column: String,
    pub db_column: String,
    pub ignored: bool,
    #[serde(default)]
    pub is_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewTableColumnDef {
    pub name: String,
    pub data_type: String,
    pub is_primary_key: bool,
    pub is_nullable: bool,
    pub auto_increment: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewTableConfig {
    pub table_name: String,
    pub engine: Option<String>,
    pub collation: Option<String>,
    pub columns: Vec<NewTableColumnDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "config")]
pub enum ImportMode {
    Append,
    Update {
        primary_key_db: Option<String>,
        primary_key_excel: Option<String>,
    },
    AppendUpdate {
        primary_key_db: Option<String>,
        primary_key_excel: Option<String>,
    },
    AppendWithoutUpdate,
    Delete {
        primary_key_db: Option<String>,
        primary_key_excel: Option<String>,
    },
    Copy,
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportRequest {
    pub file_path: String,
    pub sheet_name: Option<String>,
    pub database: String,
    pub table: String,
    pub mappings: Vec<ColumnMapping>,
    pub mode: ImportMode,
    pub batch_size: Option<usize>,
    pub new_table_config: Option<NewTableConfig>,
    #[serde(default)]
    pub error_strategy: ImportErrorStrategy,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportErrorDetail {
    pub row_index: usize,
    pub error_message: String,
    #[serde(default)]
    pub column: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportErrorStrategy {
    Strict,
    #[default]
    Tolerant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProgressEvent {
    pub current_row: usize,
    pub total_rows: usize,
    pub percentage: f64,
    pub successful_rows: usize,
    pub failed_rows: usize,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSummary {
    pub total_processed: usize,
    pub successful_rows: usize,
    pub failed_rows: usize,
    #[serde(default)]
    pub skipped_rows: usize,
    #[serde(default)]
    pub error_count: usize,
    pub execution_time_ms: u64,
    pub errors: Vec<ImportErrorDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportRequest {
    pub database: String,
    pub table: String,
    #[serde(alias = "filePath")]
    pub file_path: Option<String>,
    pub query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSummary {
    #[serde(alias = "filePath")]
    pub file_path: String,
    #[serde(alias = "totalRows")]
    pub total_rows: usize,
    #[serde(alias = "executionTimeMs")]
    pub execution_time_ms: u64,
    #[serde(alias = "fileSizeBytes")]
    pub file_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportProgressEvent {
    pub rows_written: usize,
    pub stage: String,
}
