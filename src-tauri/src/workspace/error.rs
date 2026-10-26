use serde::{Serialize, Serializer};
use thiserror::Error;

/// Structured, recoverable workspace errors.
///
/// Errors cross the IPC boundary as `"[CODE] message"` strings so the frontend can
/// branch on the code without parsing localized text. Messages NEVER include secrets
/// and avoid absolute paths unless strictly necessary for recovery.
#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("No hay un workspace de carpeta activo.")]
    NoActiveWorkspace,

    #[error("La carpeta del workspace no está disponible (desconectada, movida o sin permisos).")]
    Unavailable,

    #[error("El manifiesto del workspace no es válido: {0}")]
    InvalidManifest(String),

    #[error("El workspace usa la versión de formato {found}, pero esta versión de PyroStudio solo admite hasta la {supported}. Actualice PyroStudio; el workspace no se ha modificado.")]
    IncompatibleVersion { found: u32, supported: u32 },

    #[error("La carpeta seleccionada ya contiene un workspace de PyroStudio.")]
    AlreadyExists,

    #[error(
        "La carpeta seleccionada no contiene un workspace de PyroStudio (falta workspace.json)."
    )]
    NotAWorkspace,

    #[error("Identificador no válido: {0}")]
    InvalidId(String),

    #[error("Ruta no permitida fuera del workspace.")]
    PathEscape,

    #[error("El recurso no existe: {0}")]
    NotFound(String),

    #[error("El archivo cambió en disco desde que se abrió ({0}). Recargue o guarde una copia.")]
    Conflict(String),

    #[error("Ya existe un archivo con ese nombre: {0}")]
    Duplicate(String),

    #[error("Datos no válidos: {0}")]
    InvalidData(String),

    #[error("Error de E/S en el workspace: {0}")]
    Io(String),
}

impl WorkspaceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NoActiveWorkspace => "WS_NO_ACTIVE",
            Self::Unavailable => "WS_UNAVAILABLE",
            Self::InvalidManifest(_) => "WS_INVALID_MANIFEST",
            Self::IncompatibleVersion { .. } => "WS_INCOMPATIBLE",
            Self::AlreadyExists => "WS_ALREADY_EXISTS",
            Self::NotAWorkspace => "WS_NOT_A_WORKSPACE",
            Self::InvalidId(_) => "WS_INVALID_ID",
            Self::PathEscape => "WS_PATH_ESCAPE",
            Self::NotFound(_) => "WS_NOT_FOUND",
            Self::Conflict(_) => "WS_CONFLICT",
            Self::Duplicate(_) => "WS_DUPLICATE",
            Self::InvalidData(_) => "WS_INVALID_DATA",
            Self::Io(_) => "WS_IO",
        }
    }
}

impl From<std::io::Error> for WorkspaceError {
    fn from(e: std::io::Error) -> Self {
        use std::io::ErrorKind;
        match e.kind() {
            ErrorKind::PermissionDenied => {
                Self::Io("permiso denegado al acceder a la carpeta del workspace".into())
            }
            ErrorKind::NotFound => Self::Io("archivo o carpeta no encontrados".into()),
            _ => Self::Io(e.kind().to_string()),
        }
    }
}

impl From<serde_json::Error> for WorkspaceError {
    fn from(e: serde_json::Error) -> Self {
        Self::InvalidData(format!("JSON no válido (línea {})", e.line()))
    }
}

impl Serialize for WorkspaceError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!("[{}] {}", self.code(), self))
    }
}

pub type WsResult<T> = Result<T, WorkspaceError>;
