//! Application log: one file per day in `<app data>/PyroStudio/logs/`, the last
//! `KEEP_FILES` days kept. The level can change at runtime from Preferences.
//! Never log passwords, tokens or full connection strings.

use std::path::PathBuf;
use std::sync::OnceLock;

use tracing::level_filters::LevelFilter;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, reload, Registry};

const KEEP_FILES: usize = 14;
const FILE_PREFIX: &str = "pyrostudio";
const FILE_SUFFIX: &str = "log";

type LevelHandle = reload::Handle<LevelFilter, Registry>;

/// Keeps the background writer alive (dropping it would lose buffered lines).
static GUARD: OnceLock<WorkerGuard> = OnceLock::new();
static LEVEL: OnceLock<LevelHandle> = OnceLock::new();

pub fn log_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PyroStudio")
        .join("logs")
}

/// `"error" | "warn" | "info" | "debug" | "trace" | "off"`; anything else is `None`.
pub fn parse_level(level: &str) -> Option<LevelFilter> {
    match level.trim().to_ascii_lowercase().as_str() {
        "off" => Some(LevelFilter::OFF),
        "error" => Some(LevelFilter::ERROR),
        "warn" => Some(LevelFilter::WARN),
        "info" => Some(LevelFilter::INFO),
        "debug" => Some(LevelFilter::DEBUG),
        "trace" => Some(LevelFilter::TRACE),
        _ => None,
    }
}

/// Starts file logging; failures only disable logging, never the app.
pub fn init() {
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(FILE_PREFIX)
        .filename_suffix(FILE_SUFFIX)
        .max_log_files(KEEP_FILES)
        .build(log_dir());
    let appender = match appender {
        Ok(appender) => appender,
        Err(error) => {
            eprintln!("No se pudo abrir la carpeta de logs: {error}");
            return;
        }
    };
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let (level, handle) = reload::Layer::new(LevelFilter::INFO);
    let file_layer = fmt::layer()
        .with_writer(writer)
        .with_ansi(false)
        .with_target(true);
    if tracing_subscriber::registry()
        .with(level)
        .with(file_layer)
        .try_init()
        .is_err()
    {
        return; // Already initialised (tests).
    }
    let _ = GUARD.set(guard);
    let _ = LEVEL.set(handle);

    // Panics end up in the log too, not only on a console nobody sees.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!(target: "panic", "{info}");
        default_hook(info);
    }));

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        os = std::env::consts::OS,
        "PyroStudio iniciado"
    );
}

#[tauri::command]
pub fn set_log_level(level: String) -> Result<(), String> {
    let filter = parse_level(&level).ok_or_else(|| format!("Nivel de log no válido: {level}"))?;
    if let Some(handle) = LEVEL.get() {
        handle
            .modify(|current| *current = filter)
            .map_err(|error| error.to_string())?;
        tracing::info!(%level, "nivel de log cambiado");
    }
    Ok(())
}

/// Last `max_lines` lines of today's (or the newest) log file, for the diagnostics panel.
#[tauri::command]
pub fn read_recent_log(max_lines: Option<usize>) -> Result<Vec<String>, String> {
    let max_lines = max_lines.unwrap_or(200).min(2000);
    let newest = std::fs::read_dir(log_dir())
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with(FILE_PREFIX))
        .max_by_key(|e| e.file_name());
    let Some(entry) = newest else {
        return Ok(Vec::new());
    };
    let text = std::fs::read_to_string(entry.path()).map_err(|error| error.to_string())?;
    let lines: Vec<String> = text.lines().map(str::to_string).collect();
    Ok(lines[lines.len().saturating_sub(max_lines)..].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_levels() {
        assert_eq!(parse_level(" WARN "), Some(LevelFilter::WARN));
        assert_eq!(parse_level("off"), Some(LevelFilter::OFF));
        assert_eq!(parse_level("verbose"), None);
    }
}
