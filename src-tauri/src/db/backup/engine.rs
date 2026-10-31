use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use super::manifest::{
    BackupManifest, BackupStatus, BackupType, ChunkManifest, CompressionFormat, TableBackupManifest,
};
use super::verify::calculate_file_sha256;
use crate::db::backend::{DatabaseBackend, PinnedSession};
use crate::db::engine::DbEngine;
use crate::db::error::PyroError;
use crate::db::routine::list_routines;
use crate::db::sql_dump::{build_chunk_query, extract_key, format_sql_value};
use crate::db::sql_utils::qualify_table;
use crate::db::table::{get_table_primary_key, list_tables};
use crate::db::trigger::list_triggers;
use futures_util::future::BoxFuture;
use futures_util::FutureExt;
use serde::{Deserialize, Serialize};

/// Custom writer that calculates SHA-256 and counts total bytes written.
struct CountingHashWriter<W: Write> {
    inner: W,
    hasher: Sha256,
    bytes_written: u64,
}

impl<W: Write> CountingHashWriter<W> {
    fn new(inner: W) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
            bytes_written: 0,
        }
    }

    fn finalize(self) -> (String, u64) {
        let hash = format!("{:x}", self.hasher.finalize());
        (hash, self.bytes_written)
    }
}

impl<W: Write> Write for CountingHashWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.hasher.update(&buf[..n]);
        self.bytes_written += n as u64;
        Ok(n)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

/// Dynamic compressor for writing chunk streams to disk.
enum ChunkEncoder {
    Zstd(zstd::Encoder<'static, CountingHashWriter<BufWriter<File>>>),
    Gzip(flate2::write::GzEncoder<CountingHashWriter<BufWriter<File>>>),
    Plain(CountingHashWriter<BufWriter<File>>),
}

impl ChunkEncoder {
    fn create(path: &Path, compression: CompressionFormat) -> Result<Self, PyroError> {
        let file = File::create(path)
            .map_err(|e| PyroError::Io(format!("No se pudo crear el archivo '{path:?}': {e}")))?;
        let counting = CountingHashWriter::new(BufWriter::with_capacity(128 * 1024, file));

        match compression {
            CompressionFormat::Zstd => {
                let encoder = zstd::Encoder::new(counting, 3)
                    .map_err(|e| PyroError::Io(format!("Error iniciando compresor zstd: {e}")))?;
                Ok(Self::Zstd(encoder))
            }
            CompressionFormat::Gzip => {
                let encoder =
                    flate2::write::GzEncoder::new(counting, flate2::Compression::default());
                Ok(Self::Gzip(encoder))
            }
            CompressionFormat::None => Ok(Self::Plain(counting)),
        }
    }

    fn write_all(&mut self, buf: &[u8]) -> Result<(), PyroError> {
        match self {
            Self::Zstd(enc) => enc
                .write_all(buf)
                .map_err(|e| PyroError::Io(format!("Error escribiendo chunk zstd: {e}")))?,
            Self::Gzip(enc) => enc
                .write_all(buf)
                .map_err(|e| PyroError::Io(format!("Error escribiendo chunk gzip: {e}")))?,
            Self::Plain(enc) => enc
                .write_all(buf)
                .map_err(|e| PyroError::Io(format!("Error escribiendo chunk: {e}")))?,
        }
        Ok(())
    }

    fn finish(self) -> Result<(String, u64), PyroError> {
        match self {
            Self::Zstd(enc) => {
                let counting = enc.finish().map_err(|e| {
                    PyroError::Io(format!("Error finalizando compresión zstd: {e}"))
                })?;
                Ok(counting.finalize())
            }
            Self::Gzip(enc) => {
                let counting = enc.finish().map_err(|e| {
                    PyroError::Io(format!("Error finalizando compresión gzip: {e}"))
                })?;
                Ok(counting.finalize())
            }
            Self::Plain(mut enc) => {
                enc.flush()
                    .map_err(|e| PyroError::Io(format!("Error vaciando buffer del chunk: {e}")))?;
                Ok(enc.finalize())
            }
        }
    }
}

/// Dedicated connection wrapper for snapshot queries.
struct DedicatedBackend<'a> {
    session: tokio::sync::Mutex<&'a mut dyn PinnedSession>,
    engine: DbEngine,
}

impl<'a> DatabaseBackend for DedicatedBackend<'a> {
    fn engine(&self) -> DbEngine {
        self.engine
    }

    fn execute_query<'b>(
        &'b self,
        sql: &'b str,
        database: Option<&'b str>,
    ) -> BoxFuture<'b, Result<crate::db::models::QueryExecutionResult, PyroError>> {
        async move {
            let mut session = self.session.lock().await;
            session.query(sql, database).await
        }
        .boxed()
    }

    fn update_cell<'b>(
        &'b self,
        _req: &'b crate::db::models::CellUpdateRequest,
    ) -> BoxFuture<'b, Result<(), PyroError>> {
        async move {
            Err(PyroError::ReadOnlyConnection(
                "Operación no permitida durante el backup.".into(),
            ))
        }
        .boxed()
    }

    fn delete_row<'b>(
        &'b self,
        _req: &'b crate::db::models::DeleteRowRequest,
    ) -> BoxFuture<'b, Result<(), PyroError>> {
        async move {
            Err(PyroError::ReadOnlyConnection(
                "Operación no permitida durante el backup.".into(),
            ))
        }
        .boxed()
    }

    fn execute_transaction<'b>(
        &'b self,
        _statements: &'b [String],
        _database: Option<&'b str>,
    ) -> BoxFuture<'b, Result<usize, PyroError>> {
        async move {
            Err(PyroError::ReadOnlyConnection(
                "Operación no permitida durante el backup.".into(),
            ))
        }
        .boxed()
    }

    fn close<'b>(&'b self) -> BoxFuture<'b, ()> {
        async move {}.boxed()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupOptions {
    pub database: String,
    pub tables: Option<Vec<String>>,
    pub output_dir: PathBuf,
    pub compression: CompressionFormat,
    /// Maximum uncompressed bytes before splitting into a new chunk file (default 64MB).
    pub chunk_size_bytes: Option<u64>,
    pub include_routines: bool,
    pub include_triggers: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSummary {
    pub backup_id: String,
    pub directory: String,
    pub database: String,
    pub total_tables: usize,
    pub total_views: usize,
    pub total_rows: u64,
    pub total_uncompressed_bytes: u64,
    pub total_compressed_bytes: u64,
    pub duration_ms: u64,
    pub binlog_coordinates: Option<String>,
    pub warnings: Vec<String>,
    pub manifest_file: String,
}

/// Atomically writes `manifest.json` using a temporary file.
pub fn save_manifest(dir: &Path, manifest: &BackupManifest) -> Result<(), PyroError> {
    let tmp_path = dir.join("manifest.json.tmp");
    let final_path = dir.join("manifest.json");

    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| PyroError::InvalidOperation(format!("Error serializando manifiesto: {e}")))?;

    std::fs::write(&tmp_path, json)
        .map_err(|e| PyroError::Io(format!("No se pudo escribir el manifiesto temporal: {e}")))?;

    std::fs::rename(&tmp_path, &final_path).map_err(|e| {
        PyroError::Io(format!(
            "No se pudo reemplazar el archivo 'manifest.json': {e}"
        ))
    })?;

    Ok(())
}

/// Executes a high-performance, structured, consistent backup into `options.output_dir`.
pub async fn execute_backup(
    backend: &dyn DatabaseBackend,
    options: BackupOptions,
) -> Result<BackupSummary, PyroError> {
    let start_time = Instant::now();
    let database = &options.database;
    let target_dir = &options.output_dir;

    std::fs::create_dir_all(target_dir).map_err(|e| {
        PyroError::Io(format!(
            "No se pudo crear el directorio de backup '{target_dir:?}': {e}"
        ))
    })?;

    let schema_dir = target_dir.join("schema");
    let data_dir = target_dir.join("data");
    std::fs::create_dir_all(&schema_dir)
        .map_err(|e| PyroError::Io(format!("No se pudo crear '{schema_dir:?}': {e}")))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| PyroError::Io(format!("No se pudo crear '{data_dir:?}': {e}")))?;

    // Check for an existing in-progress manifest to support resume
    let manifest_path = target_dir.join("manifest.json");
    let mut manifest = if manifest_path.exists() {
        let content = std::fs::read_to_string(&manifest_path).unwrap_or_default();
        serde_json::from_str::<BackupManifest>(&content).unwrap_or_else(|_| {
            let id = format!("backup-{}", chrono::Utc::now().format("%Y%m%dT%H%M%S"));
            BackupManifest::new(
                id,
                BackupType::Full,
                options.compression,
                "Unknown".to_string(),
                database.clone(),
            )
        })
    } else {
        let id = format!("backup-{}", chrono::Utc::now().format("%Y%m%dT%H%M%S"));
        BackupManifest::new(
            id,
            BackupType::Full,
            options.compression,
            "Unknown".to_string(),
            database.clone(),
        )
    };

    manifest.compression = options.compression;
    manifest.status = BackupStatus::InProgress;
    save_manifest(target_dir, &manifest)?;

    // Open dedicated snapshot session
    let mut snapshot_session = backend.open_snapshot_session().await.ok();
    let dedicated;
    let dump_backend: &dyn DatabaseBackend = if let Some(ref mut session) = snapshot_session {
        dedicated = DedicatedBackend {
            session: tokio::sync::Mutex::new(session.as_mut()),
            engine: backend.engine(),
        };
        &dedicated
    } else {
        backend
    };

    // Query server version
    if let Ok(res) = dump_backend.execute_query("SELECT VERSION()", None).await {
        if let Some(v) = res
            .rows
            .first()
            .and_then(|r| r.first())
            .and_then(|val| val.as_str())
        {
            manifest.server_version = v.to_string();
        }
    }

    // Coordinates
    if let Ok(res) = dump_backend.execute_query("SHOW MASTER STATUS", None).await {
        if let Some(row) = res.rows.first() {
            let file = row.first().and_then(|v| v.as_str());
            let pos = row.get(1).and_then(|v| {
                if let Some(n) = v.as_i64() {
                    Some(n.to_string())
                } else if let Some(n) = v.as_u64() {
                    Some(n.to_string())
                } else {
                    v.as_str().map(|s| s.to_string())
                }
            });
            if let (Some(f), Some(p)) = (file, pos) {
                manifest.binlog_coordinates = Some(format!("File: {f}, Position: {p}"));
            }
            if let Some(gtid) = row.get(4).and_then(|v| v.as_str()) {
                if !gtid.trim().is_empty() {
                    manifest.gtid = Some(gtid.trim().to_string());
                }
            }
        }
    }

    // List all tables
    let all_tables = list_tables(dump_backend, database).await?;
    let target_tables: Vec<_> = if let Some(ref sel) = options.tables {
        if sel.is_empty() {
            all_tables
        } else {
            all_tables
                .into_iter()
                .filter(|t| sel.iter().any(|s| s.eq_ignore_ascii_case(&t.name)))
                .collect()
        }
    } else {
        all_tables
    };

    let base_tables: Vec<_> = target_tables
        .iter()
        .filter(|t| t.table_type != "VIEW")
        .collect();
    let views: Vec<_> = target_tables
        .iter()
        .filter(|t| t.table_type == "VIEW")
        .collect();

    manifest.total_tables = base_tables.len();
    manifest.total_views = views.len();

    // Check non-transactional engines
    let clean_db = database.replace('\'', "''");
    let non_tx_query = format!(
        "SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = '{clean_db}' AND ENGINE IN ('MyISAM', 'Aria', 'MEMORY', 'CSV')"
    );
    if let Ok(res) = dump_backend
        .execute_query(&non_tx_query, Some(database))
        .await
    {
        for row in res.rows {
            if let (Some(t_name), Some(eng)) = (
                row.first().and_then(|v| v.as_str()),
                row.get(1).and_then(|v| v.as_str()),
            ) {
                if base_tables
                    .iter()
                    .any(|t| t.name.eq_ignore_ascii_case(t_name))
                {
                    manifest.non_transactional_tables.push(t_name.to_string());
                    manifest.warnings.push(format!(
                        "Tabla '{t_name}' usa motor {eng} (no transaccional)."
                    ));
                }
            }
        }
    }

    // 1. Export Views, Routines, Triggers
    if !views.is_empty() {
        let views_file = "schema/views.sql";
        let mut views_sql = String::from("-- PyroStudio Views Dump\n\n");
        for v in &views {
            let qualified = qualify_table(Some(database), &v.name)?;
            if let Ok(res) = dump_backend
                .execute_query(&format!("SHOW CREATE VIEW {qualified}"), Some(database))
                .await
            {
                if let Some(ddl) = res
                    .rows
                    .first()
                    .and_then(|r| r.get(1))
                    .and_then(|val| val.as_str())
                {
                    views_sql.push_str(&format!("DROP VIEW IF EXISTS `{}`;\n", v.name));
                    views_sql.push_str(ddl);
                    views_sql.push_str(";\n\n");
                }
            }
        }
        std::fs::write(target_dir.join(views_file), views_sql)
            .map_err(|e| PyroError::Io(format!("Error guardando vistas: {e}")))?;
        manifest.views_file = Some(views_file.to_string());
    }

    if options.include_routines {
        let routines = list_routines(dump_backend, database, None)
            .await
            .unwrap_or_default();
        if !routines.is_empty() {
            let routines_file = "schema/routines.sql";
            let mut routines_sql = String::from("-- PyroStudio Stored Routines Dump\n\n");
            for r in routines {
                let show_sql =
                    format!("SHOW CREATE {} `{}`.`{}`", r.routine_type, database, r.name);
                if let Ok(res) = dump_backend.execute_query(&show_sql, Some(database)).await {
                    if let Some(ddl) = res
                        .rows
                        .first()
                        .and_then(|row| row.get(2))
                        .and_then(|v| v.as_str())
                    {
                        routines_sql.push_str(&format!(
                            "DROP {} IF EXISTS `{}`;\nDELIMITER ;;\n",
                            r.routine_type, r.name
                        ));
                        routines_sql.push_str(ddl);
                        routines_sql.push_str(" ;;\nDELIMITER ;\n\n");
                    }
                }
            }
            std::fs::write(target_dir.join(routines_file), routines_sql)
                .map_err(|e| PyroError::Io(format!("Error guardando rutinas: {e}")))?;
            manifest.routines_file = Some(routines_file.to_string());
        }
    }

    if options.include_triggers {
        let triggers = list_triggers(dump_backend, database, None)
            .await
            .unwrap_or_default();
        if !triggers.is_empty() {
            let triggers_file = "schema/triggers.sql";
            let mut triggers_sql = String::from("-- PyroStudio Triggers Dump\n\n");
            for tr in triggers {
                let show_sql = format!("SHOW CREATE TRIGGER `{database}`.`{}`", tr.name);
                if let Ok(res) = dump_backend.execute_query(&show_sql, Some(database)).await {
                    if let Some(ddl) = res
                        .rows
                        .first()
                        .and_then(|row| row.get(2))
                        .and_then(|v| v.as_str())
                    {
                        triggers_sql.push_str(&format!(
                            "DROP TRIGGER IF EXISTS `{}`;\nDELIMITER ;;\n",
                            tr.name
                        ));
                        triggers_sql.push_str(ddl);
                        triggers_sql.push_str(" ;;\nDELIMITER ;\n\n");
                    }
                }
            }
            std::fs::write(target_dir.join(triggers_file), triggers_sql)
                .map_err(|e| PyroError::Io(format!("Error guardando disparadores: {e}")))?;
            manifest.triggers_file = Some(triggers_file.to_string());
        }
    }

    let chunk_limit_bytes = options.chunk_size_bytes.unwrap_or(64 * 1024 * 1024);
    let ext = options.compression.extension();

    // 2. Export each Base Table
    for tbl in base_tables {
        let qualified = qualify_table(Some(database), &tbl.name)?;

        // Find or create table entry in manifest
        let table_idx = match manifest
            .tables
            .iter()
            .position(|t| t.name.eq_ignore_ascii_case(&tbl.name))
        {
            Some(idx) => idx,
            None => {
                let schema_file = format!("schema/{}.sql", tbl.name);
                let ddl_sql = format!("SHOW CREATE TABLE {qualified}");
                let ddl = match dump_backend.execute_query(&ddl_sql, Some(database)).await {
                    Ok(res) => res
                        .rows
                        .first()
                        .and_then(|row| row.get(1))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_default(),
                    Err(e) => {
                        return Err(PyroError::Database(format!(
                            "No se pudo obtener la estructura de `{}`: {e}",
                            tbl.name
                        )));
                    }
                };
                let full_schema = format!("DROP TABLE IF EXISTS `{}`;\n{ddl};\n", tbl.name);
                let schema_path = target_dir.join(&schema_file);
                std::fs::write(&schema_path, full_schema).map_err(|e| {
                    PyroError::Io(format!("Error guardando esquema de '{}': {e}", tbl.name))
                })?;
                let schema_sha256 = calculate_file_sha256(&schema_path)?;

                let entry = TableBackupManifest {
                    name: tbl.name.clone(),
                    table_type: tbl.table_type.clone(),
                    engine: None,
                    is_transactional: !manifest
                        .non_transactional_tables
                        .iter()
                        .any(|t| t.eq_ignore_ascii_case(&tbl.name)),
                    schema_file,
                    schema_sha256,
                    total_rows: 0,
                    total_uncompressed_bytes: 0,
                    total_compressed_bytes: 0,
                    chunks: Vec::new(),
                    completed: false,
                };
                manifest.tables.push(entry);
                manifest.tables.len() - 1
            }
        };

        if manifest.tables[table_idx].completed {
            continue; // Table already finished in a previous run
        }

        // Columns for INSERT
        let cols_sql = format!(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '{clean_db}' AND TABLE_NAME = '{}' ORDER BY ORDINAL_POSITION ASC",
            tbl.name.replace('\'', "''")
        );
        let col_names =
            if let Ok(c_res) = dump_backend.execute_query(&cols_sql, Some(database)).await {
                c_res
                    .rows
                    .into_iter()
                    .filter_map(|r| r.first().and_then(|v| v.as_str().map(|s| format!("`{s}`"))))
                    .collect::<Vec<_>>()
            } else {
                Vec::new()
            };
        let cols_clause = if !col_names.is_empty() {
            format!(" ({})", col_names.join(", "))
        } else {
            String::new()
        };

        let pk_columns = get_table_primary_key(dump_backend, database, &tbl.name)
            .await?
            .columns;

        // Resume state from existing chunks
        let mut chunk_index = manifest.tables[table_idx].chunks.len() + 1;
        let mut last_key = manifest.tables[table_idx]
            .chunks
            .last()
            .and_then(|c| c.last_key.clone());
        let mut offset = manifest.tables[table_idx]
            .chunks
            .iter()
            .map(|c| c.rows as usize)
            .sum::<usize>();

        let query_batch_size = 2000;
        let mut current_encoder: Option<ChunkEncoder> = None;
        let mut current_chunk_rows = 0u64;
        let mut current_uncompressed_bytes = 0u64;
        let mut first_key: Option<Vec<serde_json::Value>> = None;
        let mut chunk_filename = String::new();
        let mut chunk_partial_path = PathBuf::new();
        let mut chunk_final_path = PathBuf::new();

        loop {
            let fetch_sql = build_chunk_query(
                &qualified,
                &pk_columns,
                col_names.len(),
                last_key.as_deref(),
                query_batch_size,
                offset,
            )?;

            let chunk_res = dump_backend
                .execute_query(&fetch_sql, Some(database))
                .await
                .map_err(|e| {
                    PyroError::Database(format!(
                        "Error leyendo datos de `{}` (fila {offset}): {e}",
                        tbl.name
                    ))
                })?;

            let rows_count = chunk_res.rows.len();
            if rows_count == 0 {
                // Done with table
                if let Some(encoder) = current_encoder.take() {
                    let (sha256, compressed_bytes) = encoder.finish()?;
                    std::fs::rename(&chunk_partial_path, &chunk_final_path).map_err(|e| {
                        PyroError::Io(format!(
                            "No se pudo renombrar chunk '{chunk_final_path:?}': {e}"
                        ))
                    })?;

                    manifest.tables[table_idx].chunks.push(ChunkManifest {
                        chunk_index,
                        file_name: chunk_filename,
                        first_key,
                        last_key: last_key.clone(),
                        rows: current_chunk_rows,
                        uncompressed_bytes: current_uncompressed_bytes,
                        compressed_bytes,
                        sha256,
                        completed: true,
                    });
                    manifest.tables[table_idx].total_rows += current_chunk_rows;
                    manifest.tables[table_idx].total_uncompressed_bytes +=
                        current_uncompressed_bytes;
                    manifest.tables[table_idx].total_compressed_bytes += compressed_bytes;
                    manifest.total_rows += current_chunk_rows;
                    manifest.total_uncompressed_bytes += current_uncompressed_bytes;
                    manifest.total_compressed_bytes += compressed_bytes;
                    save_manifest(target_dir, &manifest)?;
                }
                break;
            }

            // Extract last key
            if !pk_columns.is_empty() {
                if let Some(first_row) = chunk_res.rows.first() {
                    if first_key.is_none() {
                        first_key = Some(extract_key(&chunk_res.columns, first_row, &pk_columns)?);
                    }
                }
                if let Some(last_row) = chunk_res.rows.last() {
                    last_key = Some(extract_key(&chunk_res.columns, last_row, &pk_columns)?);
                }
            } else {
                offset += rows_count;
            }

            // Open chunk encoder if not open
            if current_encoder.is_none() {
                chunk_filename = format!("data/{}.{:05}.{ext}", tbl.name, chunk_index);
                chunk_final_path = target_dir.join(&chunk_filename);
                chunk_partial_path = target_dir.join(format!("{}.partial", chunk_filename));
                let mut encoder = ChunkEncoder::create(&chunk_partial_path, options.compression)?;

                // Chunk header
                let header = format!(
                    "-- Table: `{}` (Chunk {:05})\nLOCK TABLES `{}` WRITE;\n/*!40000 ALTER TABLE `{}` DISABLE KEYS */;\n",
                    tbl.name, chunk_index, tbl.name, tbl.name
                );
                encoder.write_all(header.as_bytes())?;
                current_uncompressed_bytes += header.len() as u64;
                current_encoder = Some(encoder);
                current_chunk_rows = 0;
            }

            // Build multi-row INSERTs in batches of 250 rows
            let mut insert_buffer = String::with_capacity(32 * 1024);
            let mut in_batch = 0usize;

            for row in chunk_res.rows {
                if in_batch == 0 {
                    insert_buffer
                        .push_str(&format!("INSERT INTO `{}`{cols_clause} VALUES\n", tbl.name));
                } else {
                    insert_buffer.push_str(",\n");
                }

                let values: Vec<String> = row.iter().map(format_sql_value).collect();
                insert_buffer.push('(');
                insert_buffer.push_str(&values.join(", "));
                insert_buffer.push(')');

                in_batch += 1;
                current_chunk_rows += 1;

                if in_batch >= 250 {
                    insert_buffer.push_str(";\n");
                    if let Some(ref mut enc) = current_encoder {
                        enc.write_all(insert_buffer.as_bytes())?;
                        current_uncompressed_bytes += insert_buffer.len() as u64;
                    }
                    insert_buffer.clear();
                    in_batch = 0;
                }
            }

            if in_batch > 0 {
                insert_buffer.push_str(";\n");
                if let Some(ref mut enc) = current_encoder {
                    enc.write_all(insert_buffer.as_bytes())?;
                    current_uncompressed_bytes += insert_buffer.len() as u64;
                }
                insert_buffer.clear();
            }

            // Check if current chunk exceeded chunk_limit_bytes
            if current_uncompressed_bytes >= chunk_limit_bytes {
                let footer = format!(
                    "/*!40000 ALTER TABLE `{}` ENABLE KEYS */;\nUNLOCK TABLES;\n",
                    tbl.name
                );
                if let Some(mut enc) = current_encoder.take() {
                    enc.write_all(footer.as_bytes())?;
                    current_uncompressed_bytes += footer.len() as u64;
                    let (sha256, compressed_bytes) = enc.finish()?;
                    std::fs::rename(&chunk_partial_path, &chunk_final_path).map_err(|e| {
                        PyroError::Io(format!(
                            "No se pudo renombrar chunk '{chunk_final_path:?}': {e}"
                        ))
                    })?;

                    manifest.tables[table_idx].chunks.push(ChunkManifest {
                        chunk_index,
                        file_name: chunk_filename.clone(),
                        first_key: first_key.take(),
                        last_key: last_key.clone(),
                        rows: current_chunk_rows,
                        uncompressed_bytes: current_uncompressed_bytes,
                        compressed_bytes,
                        sha256,
                        completed: true,
                    });
                    manifest.tables[table_idx].total_rows += current_chunk_rows;
                    manifest.tables[table_idx].total_uncompressed_bytes +=
                        current_uncompressed_bytes;
                    manifest.tables[table_idx].total_compressed_bytes += compressed_bytes;
                    manifest.total_rows += current_chunk_rows;
                    manifest.total_uncompressed_bytes += current_uncompressed_bytes;
                    manifest.total_compressed_bytes += compressed_bytes;
                    save_manifest(target_dir, &manifest)?;

                    chunk_index += 1;
                    current_chunk_rows = 0;
                    current_uncompressed_bytes = 0;
                }
            }
        }

        manifest.tables[table_idx].completed = true;
        save_manifest(target_dir, &manifest)?;
    }

    // Finish backup
    manifest.status = BackupStatus::Completed;
    manifest.completed_at = Some(chrono::Utc::now().to_rfc3339());
    manifest.duration_ms = start_time.elapsed().as_millis() as u64;
    save_manifest(target_dir, &manifest)?;

    if let Some(session) = snapshot_session {
        session.release().await;
    }

    Ok(BackupSummary {
        backup_id: manifest.backup_id,
        directory: target_dir.to_string_lossy().to_string(),
        database: manifest.database,
        total_tables: manifest.total_tables,
        total_views: manifest.total_views,
        total_rows: manifest.total_rows,
        total_uncompressed_bytes: manifest.total_uncompressed_bytes,
        total_compressed_bytes: manifest.total_compressed_bytes,
        duration_ms: manifest.duration_ms,
        binlog_coordinates: manifest.binlog_coordinates,
        warnings: manifest.warnings,
        manifest_file: target_dir
            .join("manifest.json")
            .to_string_lossy()
            .to_string(),
    })
}
