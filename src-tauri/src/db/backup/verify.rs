use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;

use super::manifest::{BackupManifest, CompressionFormat};
use crate::db::error::PyroError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupVerificationResult {
    pub valid: bool,
    pub total_files: usize,
    pub verified_files: usize,
    pub corrupted_files: Vec<String>,
    pub errors: Vec<String>,
}

pub fn calculate_file_sha256(path: &Path) -> Result<String, PyroError> {
    let mut file = File::open(path)
        .map_err(|e| PyroError::Io(format!("No se pudo abrir el archivo '{path:?}': {e}")))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|e| PyroError::Io(format!("Error leyendo el archivo '{path:?}': {e}")))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn verify_chunk_decompression(
    path: &Path,
    compression: CompressionFormat,
) -> Result<u64, PyroError> {
    let file = File::open(path)
        .map_err(|e| PyroError::Io(format!("No se pudo abrir el chunk '{path:?}': {e}")))?;

    let mut count = 0u64;
    let mut buffer = [0u8; 64 * 1024];

    match compression {
        CompressionFormat::Zstd => {
            let mut decoder = zstd::Decoder::new(file).map_err(|e| {
                PyroError::Io(format!(
                    "Error inicializando descompresión zstd para '{path:?}': {e}"
                ))
            })?;
            loop {
                let n = decoder
                    .read(&mut buffer)
                    .map_err(|e| PyroError::Io(format!("Chunk zstd corrupto '{path:?}': {e}")))?;
                if n == 0 {
                    break;
                }
                count += n as u64;
            }
        }
        CompressionFormat::Gzip => {
            let mut decoder = flate2::read::GzDecoder::new(file);
            loop {
                let n = decoder
                    .read(&mut buffer)
                    .map_err(|e| PyroError::Io(format!("Chunk gzip corrupto '{path:?}': {e}")))?;
                if n == 0 {
                    break;
                }
                count += n as u64;
            }
        }
        CompressionFormat::None => {
            let mut reader = file;
            loop {
                let n = reader
                    .read(&mut buffer)
                    .map_err(|e| PyroError::Io(format!("Error leyendo chunk '{path:?}': {e}")))?;
                if n == 0 {
                    break;
                }
                count += n as u64;
            }
        }
    }
    Ok(count)
}

pub fn verify_backup(backup_dir: &Path) -> Result<BackupVerificationResult, PyroError> {
    let manifest_path = backup_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Err(PyroError::InvalidOperation(format!(
            "No se encontró el archivo de manifiesto en '{backup_dir:?}'."
        )));
    }

    let manifest_content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| PyroError::Io(format!("No se pudo leer el manifiesto: {e}")))?;

    let manifest: BackupManifest = serde_json::from_str(&manifest_content).map_err(|e| {
        PyroError::InvalidOperation(format!("El archivo de manifiesto es inválido: {e}"))
    })?;

    let mut total_files = 0usize;
    let mut verified_files = 0usize;
    let mut corrupted_files = Vec::new();
    let mut errors = Vec::new();

    // 1. Verify schema files
    for table in &manifest.tables {
        if !table.schema_file.is_empty() {
            total_files += 1;
            let schema_path = backup_dir.join(&table.schema_file);
            if !schema_path.exists() {
                corrupted_files.push(table.schema_file.clone());
                errors.push(format!(
                    "Falta el archivo de esquema '{}'.",
                    table.schema_file
                ));
                continue;
            }
            match calculate_file_sha256(&schema_path) {
                Ok(hash) => {
                    if hash.eq_ignore_ascii_case(&table.schema_sha256) {
                        verified_files += 1;
                    } else {
                        corrupted_files.push(table.schema_file.clone());
                        errors.push(format!(
                            "Checksum SHA-256 no coincide en esquema '{}' (esperado: {}, real: {}).",
                            table.schema_file, table.schema_sha256, hash
                        ));
                    }
                }
                Err(err) => {
                    corrupted_files.push(table.schema_file.clone());
                    errors.push(format!(
                        "Error verificando esquema '{}': {err}",
                        table.schema_file
                    ));
                }
            }
        }

        // 2. Verify data chunks
        for chunk in &table.chunks {
            total_files += 1;
            let chunk_path = backup_dir.join(&chunk.file_name);
            if !chunk_path.exists() {
                corrupted_files.push(chunk.file_name.clone());
                errors.push(format!("Falta el archivo de chunk '{}'.", chunk.file_name));
                continue;
            }

            match calculate_file_sha256(&chunk_path) {
                Ok(hash) => {
                    if hash.eq_ignore_ascii_case(&chunk.sha256) {
                        // Check decompressibility
                        match verify_chunk_decompression(&chunk_path, manifest.compression) {
                            Ok(_) => verified_files += 1,
                            Err(e) => {
                                corrupted_files.push(chunk.file_name.clone());
                                errors.push(format!(
                                    "Error de descompresión en '{}': {e}",
                                    chunk.file_name
                                ));
                            }
                        }
                    } else {
                        corrupted_files.push(chunk.file_name.clone());
                        errors.push(format!(
                            "Checksum SHA-256 no coincide en chunk '{}' (esperado: {}, real: {}).",
                            chunk.file_name, chunk.sha256, hash
                        ));
                    }
                }
                Err(err) => {
                    corrupted_files.push(chunk.file_name.clone());
                    errors.push(format!(
                        "Error verificando chunk '{}': {err}",
                        chunk.file_name
                    ));
                }
            }
        }
    }

    Ok(BackupVerificationResult {
        valid: corrupted_files.is_empty(),
        total_files,
        verified_files,
        corrupted_files,
        errors,
    })
}
