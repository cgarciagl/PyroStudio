use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum PyroError {
    #[error("Error de base de datos: {0}")]
    Database(String),

    #[error("Error de conexión: {0}")]
    Connection(String),

    #[error("Error de entrada/salida (IO): {0}")]
    Io(String),

    #[error("Error en túnel HTTP: {0}")]
    Tunnel(String),

    #[error("Error en motor Excel: {0}")]
    Excel(String),

    #[error("Identificador SQL inválido: {0}")]
    InvalidIdentifier(String),

    #[error("No hay una sesión activa de base de datos. Por favor conéctate primero.")]
    NotConnected,

    #[error("Esta tabla no tiene una clave primaria. La edición y eliminación de registros está deshabilitada para evitar modificaciones ambiguas.")]
    NoPrimaryKey,

    #[error("Error en almacén seguro de credenciales (Vault): {0}")]
    Vault(String),

    #[error("Operación no válida: {0}")]
    InvalidOperation(String),
}

impl From<sqlx::Error> for PyroError {
    fn from(err: sqlx::Error) -> Self {
        // Sanitize error string to prevent leaking sensitive connection details
        PyroError::Database(err.to_string())
    }
}

impl From<std::io::Error> for PyroError {
    fn from(err: std::io::Error) -> Self {
        PyroError::Io(err.to_string())
    }
}

impl From<PyroError> for String {
    fn from(err: PyroError) -> Self {
        err.to_string()
    }
}

impl Serialize for PyroError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
