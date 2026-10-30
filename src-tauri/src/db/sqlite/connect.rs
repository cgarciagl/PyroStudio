use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;
use std::time::{Duration, Instant};

use super::backend::SqliteBackend;
use crate::db::error::PyroError;
use crate::db::models::ServerInfo;

/// Extensions offered by the file dialogs.
pub const SQLITE_FILE_EXTENSIONS: [&str; 4] = ["db", "sqlite", "sqlite3", "db3"];

/// Waiting time when another process holds the database lock.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// One connection keeps `ATTACH`, temporary tables and `PRAGMA`s consistent
/// across editor queries, as in the `sqlite3` shell.
const POOL_CONNECTIONS: u32 = 1;

/// Long statements hold the only connection; others wait this long for it.
const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(30);

/// Opens an existing database file for an interactive session.
/// `read_only` sets `PRAGMA query_only` on every connection: SQLite itself then
/// rejects writes, as a second barrier behind the `read_only` module.
pub async fn open_backend(
    file_path: &str,
    read_only: bool,
) -> Result<(SqliteBackend, ServerInfo), PyroError> {
    let start = Instant::now();
    let pool = open_pool_with(file_path, false, read_only).await?;
    let server_info = server_info(&pool, file_path, start).await?;
    Ok((SqliteBackend::new(pool, file_path.to_string()), server_info))
}

/// Validates that the file opens as a database, without keeping it open.
pub async fn probe_file(file_path: &str) -> Result<ServerInfo, PyroError> {
    let start = Instant::now();
    let pool = open_pool(file_path, false).await?;
    let server_info = server_info(&pool, file_path, start).await;
    pool.close().await;
    server_info
}

/// Creates a new, empty database file. Never overwrites an existing file.
pub async fn create_database_file(file_path: &str) -> Result<(), PyroError> {
    if Path::new(file_path).exists() {
        return Err(PyroError::InvalidOperation(format!(
            "El archivo '{file_path}' ya existe; ábrelo en lugar de crearlo."
        )));
    }
    let pool = open_pool(file_path, true).await?;
    // The file is materialized by the first write.
    sqlx::query("PRAGMA user_version = 0")
        .execute(&pool)
        .await
        .map_err(|error| PyroError::Database(format!("Error creando la base SQLite: {error}")))?;
    pool.close().await;
    Ok(())
}

async fn open_pool(file_path: &str, create: bool) -> Result<SqlitePool, PyroError> {
    open_pool_with(file_path, create, false).await
}

async fn open_pool_with(
    file_path: &str,
    create: bool,
    read_only: bool,
) -> Result<SqlitePool, PyroError> {
    let file_path = file_path.trim();
    if file_path.is_empty() {
        return Err(PyroError::InvalidOperation(
            "Selecciona el archivo de la base de datos SQLite.".into(),
        ));
    }
    if !create && !Path::new(file_path).is_file() {
        return Err(PyroError::Connection(format!(
            "No se encontró el archivo SQLite '{file_path}'."
        )));
    }
    let options = SqliteConnectOptions::new()
        .filename(file_path)
        .create_if_missing(create)
        .foreign_keys(true)
        .busy_timeout(BUSY_TIMEOUT)
        .pragma("query_only", if read_only { "ON" } else { "OFF" });
    SqlitePoolOptions::new()
        .max_connections(POOL_CONNECTIONS)
        .acquire_timeout(ACQUIRE_TIMEOUT)
        .connect_with(options)
        .await
        .map_err(|error| PyroError::Connection(format!("Error abriendo la base SQLite: {error}")))
}

async fn server_info(
    pool: &SqlitePool,
    file_path: &str,
    start: Instant,
) -> Result<ServerInfo, PyroError> {
    // Reading the catalog rejects files that are not SQLite databases.
    let version: String = sqlx::query_scalar(
        "SELECT sqlite_version() WHERE (SELECT count(*) FROM sqlite_master) >= 0",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| {
        PyroError::Database(format!(
            "El archivo no es una base de datos SQLite válida: {error}"
        ))
    })?;
    Ok(ServerInfo {
        version: format!("SQLite {version}"),
        current_user: file_name(file_path),
        current_database: Some("main".into()),
        ping_ms: start.elapsed().as_millis() as u64,
        warnings: Vec::new(),
    })
}

pub fn file_name(file_path: &str) -> String {
    Path::new(file_path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_path.to_string())
}
