//! Streaming export to CSV (`.csv`) and gzip-compressed CSV (`.csv.gz`): no row
//! limit and constant memory, for results too large for a spreadsheet. It can
//! optionally split the output into numbered parts (`name_part001.csv`, …).

use futures_util::StreamExt;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
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
    part_rows: Option<usize>,
    app_handle: Option<&tauri::AppHandle>,
    start: Instant,
) -> Result<ExportSummary, String> {
    let mut parts = PartWriter {
        base: target.to_path_buf(),
        gzip,
        split: part_rows.is_some(),
        written: Vec::new(),
        current: None,
    };
    let result = async {
        let mut header = String::new();
        let mut total_rows = 0usize;
        let mut rows_in_part = 0usize;
        let mut line = String::new();
        while let Some(item) = rows.next().await {
            line.clear();
            match item.map_err(|error| error.to_string())? {
                RowStreamItem::Columns(names) => {
                    let fields: Vec<String> = names.iter().map(|n| quote(n)).collect();
                    header = format!("{}\r\n", fields.join(","));
                    parts.open_next(&header)?;
                    continue;
                }
                RowStreamItem::Row(cells) => {
                    if part_rows.is_some_and(|limit| rows_in_part >= limit) {
                        parts.open_next(&header)?;
                        rows_in_part = 0;
                    }
                    csv_row(&cells, &mut line);
                    total_rows += 1;
                    rows_in_part += 1;
                }
            }
            line.push_str("\r\n");
            parts.write(line.as_bytes())?;

            if total_rows.is_multiple_of(PROGRESS_INTERVAL_ROWS) {
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
        if parts.current.is_none() {
            parts.open_next(&header)?;
        }
        parts.finish_current()?;
        Ok(total_rows)
    }
    .await;

    let total_rows = match result {
        Ok(rows) => rows,
        Err(error) => {
            parts.abort();
            return Err(error);
        }
    };
    let file_size_bytes = parts
        .written
        .iter()
        .map(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
        .sum();
    let first = parts
        .written
        .first()
        .cloned()
        .unwrap_or_else(|| target.to_path_buf());

    Ok(ExportSummary {
        file_path: first.to_string_lossy().to_string(),
        total_rows,
        execution_time_ms: start.elapsed().as_millis() as u64,
        file_size_bytes,
    })
}

/// Writes one file, or a numbered series when splitting. Each file is written
/// to `<name>.partial` and renamed when complete, so a failed or cancelled
/// export never leaves a truncated file with a final name.
struct PartWriter {
    base: PathBuf,
    gzip: bool,
    split: bool,
    /// Completed files, already renamed to their final names.
    written: Vec<PathBuf>,
    /// Open writer, its `.partial` path and its final path.
    current: Option<(Box<dyn Write + Send>, PathBuf, PathBuf)>,
}

impl PartWriter {
    /// Closes the current file (if any) and starts the next one with `header`.
    fn open_next(&mut self, header: &str) -> Result<(), String> {
        self.finish_current()?;
        let target = if self.split {
            part_path(&self.base, self.written.len() + 1)
        } else {
            self.base.clone()
        };
        let partial = partial_path(&target);
        let file =
            File::create(&partial).map_err(|e| format!("No se pudo crear el archivo CSV: {e}"))?;
        let mut out: Box<dyn Write + Send> = if self.gzip {
            Box::new(flate2::write::GzEncoder::new(
                BufWriter::new(file),
                flate2::Compression::default(),
            ))
        } else {
            let mut writer = BufWriter::new(file);
            writer.write_all(UTF8_BOM).map_err(write_error)?;
            Box::new(writer)
        };
        out.write_all(header.as_bytes()).map_err(write_error)?;
        self.current = Some((out, partial, target));
        Ok(())
    }

    fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.current.is_none() {
            self.open_next("")?;
        }
        let (out, _, _) = self.current.as_mut().expect("file just opened");
        out.write_all(bytes).map_err(write_error)
    }

    fn finish_current(&mut self) -> Result<(), String> {
        if let Some((mut out, partial, target)) = self.current.take() {
            out.flush().map_err(write_error)?;
            drop(out);
            std::fs::rename(&partial, &target)
                .map_err(|e| format!("No se pudo guardar el archivo CSV: {e}"))?;
            self.written.push(target);
        }
        Ok(())
    }

    /// Removes the unfinished file and the parts already completed.
    fn abort(&mut self) {
        if let Some((out, partial, _)) = self.current.take() {
            drop(out);
            let _ = std::fs::remove_file(partial);
        }
        for path in self.written.drain(..) {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// `datos.csv` → `datos_part001.csv`; `datos.csv.gz` → `datos_part001.csv.gz`.
fn part_path(base: &Path, index: usize) -> PathBuf {
    let name = base
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("export.csv");
    let suffix_len = if name.to_ascii_lowercase().ends_with(".csv.gz") {
        7
    } else {
        name.rfind('.').map(|i| name.len() - i).unwrap_or(0)
    };
    let (stem, suffix) = name.split_at(name.len() - suffix_len);
    base.with_file_name(format!("{stem}_part{index:03}{suffix}"))
}

fn partial_path(target: &Path) -> PathBuf {
    let mut name = target.as_os_str().to_owned();
    name.push(".partial");
    PathBuf::from(name)
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

    fn sample_rows() -> RowStream {
        use futures_util::stream;
        let items = vec![
            Ok(RowStreamItem::Columns(vec!["id".into(), "nombre".into()])),
            Ok(RowStreamItem::Row(vec![
                ExportCell::Number(1.0),
                ExportCell::unsized_text("Peña".into()),
            ])),
            Ok(RowStreamItem::Row(vec![
                ExportCell::Number(2.0),
                ExportCell::Blank,
            ])),
        ];
        stream::iter(items).boxed()
    }

    #[tokio::test]
    async fn writes_plain_and_gzip_files() {
        use std::io::Read;
        let dir = std::env::temp_dir().join(format!("pyro_csv_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let expected = "id,nombre\r\n1,Peña\r\n2,\r\n";

        let plain = dir.join("out.csv");
        let summary = export_csv(sample_rows(), &plain, false, None, None, Instant::now())
            .await
            .unwrap();
        assert_eq!(summary.total_rows, 2);
        let bytes = std::fs::read(&plain).unwrap();
        assert_eq!(&bytes[..3], UTF8_BOM);
        assert_eq!(std::str::from_utf8(&bytes[3..]).unwrap(), expected);

        let gz = dir.join("out.csv.gz");
        export_csv(sample_rows(), &gz, true, None, None, Instant::now())
            .await
            .unwrap();
        let mut text = String::new();
        flate2::read::GzDecoder::new(std::fs::File::open(&gz).unwrap())
            .read_to_string(&mut text)
            .unwrap();
        assert_eq!(text, expected);
        assert!(!dir.join("out.csv.gz.partial").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn names_numbered_parts() {
        assert_eq!(
            part_path(Path::new("/x/datos.csv"), 1),
            Path::new("/x/datos_part001.csv")
        );
        assert_eq!(
            part_path(Path::new("/x/datos.CSV.gz"), 12),
            Path::new("/x/datos_part012.CSV.gz")
        );
    }

    #[tokio::test]
    async fn splits_into_parts_with_header() {
        let dir = std::env::temp_dir().join(format!("pyro_csv_parts_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let base = dir.join("out.csv");
        let summary = export_csv(sample_rows(), &base, false, Some(1), None, Instant::now())
            .await
            .unwrap();
        assert_eq!(summary.total_rows, 2);
        assert!(summary.file_path.ends_with("out_part001.csv"));
        let read = |name: &str| {
            let bytes = std::fs::read(dir.join(name)).unwrap();
            String::from_utf8(bytes[3..].to_vec()).unwrap()
        };
        assert_eq!(read("out_part001.csv"), "id,nombre\r\n1,Peña\r\n");
        assert_eq!(read("out_part002.csv"), "id,nombre\r\n2,\r\n");
        assert!(!base.exists());
        assert!(!dir.join("out_part003.csv").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
