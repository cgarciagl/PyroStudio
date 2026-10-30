//! Streaming export to CSV (`.csv`) and gzip-compressed CSV (`.csv.gz`): no row
//! limit and constant memory, for results too large for a spreadsheet.

use futures_util::StreamExt;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::time::Instant;

use super::exporter::emit_export_progress;
use super::models::ExportSummary;
use crate::db::backend::{ExportCell, RowStream, RowStreamItem};

const PROGRESS_INTERVAL_ROWS: usize = 1000;
/// Lets Excel detect UTF-8 when the plain CSV is opened by double click.
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

pub async fn export_csv(
    mut rows: RowStream,
    target: &Path,
    gzip: bool,
    app_handle: Option<&tauri::AppHandle>,
    start: Instant,
) -> Result<ExportSummary, String> {
    // Written next to the target and renamed at the end, so a failed or
    // cancelled export never leaves a truncated file with the final name.
    let partial = target.with_extension(format!(
        "{}.partial",
        target.extension().and_then(|e| e.to_str()).unwrap_or("csv")
    ));
    let result = async {
        let file =
            File::create(&partial).map_err(|e| format!("No se pudo crear el archivo CSV: {e}"))?;
        let mut out: Box<dyn Write + Send> = if gzip {
            Box::new(flate2::write::GzEncoder::new(
                BufWriter::new(file),
                flate2::Compression::default(),
            ))
        } else {
            let mut writer = BufWriter::new(file);
            writer.write_all(UTF8_BOM).map_err(write_error)?;
            Box::new(writer)
        };

        let mut total_rows = 0usize;
        let mut line = String::new();
        while let Some(item) = rows.next().await {
            line.clear();
            match item.map_err(|error| error.to_string())? {
                RowStreamItem::Columns(names) => {
                    let fields: Vec<String> = names.iter().map(|n| quote(n)).collect();
                    line.push_str(&fields.join(","));
                }
                RowStreamItem::Row(cells) => {
                    csv_row(&cells, &mut line);
                    total_rows += 1;
                }
            }
            line.push_str("\r\n");
            out.write_all(line.as_bytes()).map_err(write_error)?;

            if total_rows > 0 && total_rows.is_multiple_of(PROGRESS_INTERVAL_ROWS) {
                if super::CANCEL_EXCEL_OPERATION.load(std::sync::atomic::Ordering::Relaxed) {
                    return Err("Operación de exportación cancelada por el usuario.".to_string());
                }
                emit_export_progress(
                    app_handle,
                    total_rows,
                    "Consultando y escribiendo filas".into(),
                );
                tokio::task::yield_now().await;
            }
        }
        out.flush().map_err(write_error)?;
        drop(out);
        Ok(total_rows)
    }
    .await;

    let total_rows = match result {
        Ok(rows) => rows,
        Err(error) => {
            let _ = std::fs::remove_file(&partial);
            return Err(error);
        }
    };
    std::fs::rename(&partial, target)
        .map_err(|e| format!("No se pudo guardar el archivo CSV: {e}"))?;
    let file_size_bytes = std::fs::metadata(target).map(|m| m.len()).unwrap_or(0);

    Ok(ExportSummary {
        file_path: target.to_string_lossy().to_string(),
        total_rows,
        execution_time_ms: start.elapsed().as_millis() as u64,
        file_size_bytes,
    })
}

fn write_error(error: std::io::Error) -> String {
    format!("Error escribiendo el archivo CSV: {error}")
}

/// Appends one row (RFC 4180, comma separated) without the line ending.
fn csv_row(cells: &[ExportCell], line: &mut String) {
    for (index, cell) in cells.iter().enumerate() {
        if index > 0 {
            line.push(',');
        }
        match cell {
            ExportCell::Blank => {}
            ExportCell::Bool(value) => line.push_str(if *value { "1" } else { "0" }),
            ExportCell::Number(value) => line.push_str(&value.to_string()),
            ExportCell::Text { value, .. } => line.push_str(&quote(value)),
        }
    }
}

/// Quotes a field only when it needs it (separator, quote or line break).
fn quote(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_rfc4180_rows() {
        let mut line = String::new();
        csv_row(
            &[
                ExportCell::Number(5.0),
                ExportCell::Number(1.5),
                ExportCell::Blank,
                ExportCell::Bool(true),
                ExportCell::unsized_text("a,\"b\"\nc".into()),
                ExportCell::unsized_text("plain".into()),
            ],
            &mut line,
        );
        assert_eq!(line, "5,1.5,,1,\"a,\"\"b\"\"\nc\",plain");
    }
}
