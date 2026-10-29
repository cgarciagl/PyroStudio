use super::backend::DatabaseBackend;
use super::engine::DbEngine;
use super::error::PyroError;
use super::features::EngineFeature;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ServerEngineVariant {
    MariaDb,
    MySql,
    Sqlite,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerVersionInfo {
    pub raw_version: String,
    pub variant: ServerEngineVariant,
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub normalized_display: String,
    pub is_lts: bool,
}

impl ServerVersionInfo {
    pub fn parse(raw: &str) -> Self {
        let is_mariadb = raw.contains("MariaDB") || raw.contains("mariadb");
        let variant = if raw.to_ascii_lowercase().contains("sqlite") {
            ServerEngineVariant::Sqlite
        } else if is_mariadb {
            ServerEngineVariant::MariaDb
        } else if raw.contains("MySQL")
            || raw.contains("mysql")
            || raw.chars().next().is_some_and(|c| c.is_ascii_digit())
        {
            ServerEngineVariant::MySql
        } else {
            ServerEngineVariant::Unknown
        };

        // Extract version numbers like "10.11.6", "11.4.2", "8.0.35"
        let mut major = 0u32;
        let mut minor = 0u32;
        let mut patch = 0u32;

        let clean_str = raw.trim();
        // Look for pattern "X.Y.Z"
        let parts: Vec<&str> = clean_str
            .split(|c: char| !c.is_ascii_digit() && c != '.')
            .find(|seg| seg.contains('.'))
            .unwrap_or("")
            .split('.')
            .collect();

        if parts.len() >= 2 {
            major = parts[0].parse().unwrap_or(0);
            minor = parts[1].parse().unwrap_or(0);
            if parts.len() >= 3 {
                patch = parts[2].parse().unwrap_or(0);
            }
        }

        // Detect MariaDB LTS releases (e.g. 10.6, 10.11, 11.4)
        let is_lts = if variant == ServerEngineVariant::MariaDb {
            (major == 10 && (minor == 6 || minor == 11)) || (major == 11 && minor == 4)
        } else if variant == ServerEngineVariant::MySql {
            major == 8 && minor == 4
        } else {
            false
        };

        let variant_name = match variant {
            ServerEngineVariant::MariaDb => "MariaDB",
            ServerEngineVariant::MySql => "MySQL",
            ServerEngineVariant::Sqlite => "SQLite",
            ServerEngineVariant::Unknown => "Database",
        };

        let normalized_display = format!(
            "{variant_name} {major}.{minor}.{patch}{}",
            if is_lts { " (LTS)" } else { "" }
        );

        Self {
            raw_version: raw.to_string(),
            variant,
            major,
            minor,
            patch,
            normalized_display,
            is_lts,
        }
    }

    pub fn is_at_least(&self, major: u32, minor: u32, patch: u32) -> bool {
        if self.major > major {
            return true;
        }
        if self.major < major {
            return false;
        }
        if self.minor > minor {
            return true;
        }
        if self.minor < minor {
            return false;
        }
        self.patch >= patch
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", content = "detail")]
pub enum CapabilityAvailability {
    Compatible,
    UnsupportedVersion {
        min_version: String,
        current_version: String,
    },
    InsufficientPrivileges {
        required_privilege: String,
    },
    DisabledByConfig {
        variable_name: String,
        current_value: String,
        expected_value: String,
    },
    Unverified {
        reason: String,
    },
    /// The feature does not exist in this database engine.
    UnsupportedEngine {
        engine: String,
    },
}

impl CapabilityAvailability {
    pub fn is_available(&self) -> bool {
        matches!(self, Self::Compatible)
    }

    pub fn explanation(&self) -> String {
        match self {
            Self::Compatible => {
                "Funcionalidad totalmente compatible y disponible en este servidor.".into()
            }
            Self::UnsupportedVersion {
                min_version,
                current_version,
            } => {
                format!(
                    "Requiere al menos versión {min_version} (servidor actual: {current_version})."
                )
            }
            Self::InsufficientPrivileges { required_privilege } => {
                format!(
                    "El usuario conectado no tiene el privilegio requerido: {required_privilege}."
                )
            }
            Self::DisabledByConfig {
                variable_name,
                current_value,
                expected_value,
            } => {
                format!("Deshabilitado por configuración del servidor: {variable_name} está en '{current_value}' (se esperaba '{expected_value}').")
            }
            Self::Unverified { reason } => {
                format!("Estado no verificado: {reason}")
            }
            Self::UnsupportedEngine { engine } => format!("No disponible en {engine}."),
        }
    }

    pub fn resolution_hint(&self) -> Option<String> {
        match self {
            Self::Compatible => None,
            Self::UnsupportedVersion { min_version, .. } => Some(format!(
                "Actualiza el servidor MariaDB a la versión {min_version} o superior."
            )),
            Self::InsufficientPrivileges { required_privilege } => Some(format!(
                "Ejecuta 'GRANT {required_privilege} ON *.* TO ...' con un usuario administrador."
            )),
            Self::DisabledByConfig {
                variable_name,
                expected_value,
                ..
            } => Some(format!(
                "Ejecuta 'SET GLOBAL {variable_name} = {expected_value};' o configúralo en my.cnf."
            )),
            Self::Unverified { .. } => {
                Some("Verifica la conectividad y los permisos de usuario.".into())
            }
            Self::UnsupportedEngine { .. } => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: CapabilityAvailability,
    pub category: String, // "Diagnostics" | "Storage" | "AI & Vectors" | "Automation" | "Security"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerCapabilities {
    pub engine: DbEngine,
    /// Interface features available on `engine`.
    pub features: Vec<EngineFeature>,
    pub version: ServerVersionInfo,
    pub current_user: String,
    pub current_database: Option<String>,
    pub server_collation: Option<String>,
    pub server_charset: Option<String>,
    // Dedicated capabilities
    pub analyze_format_json: CapabilityItem,
    pub system_versioning: CapabilityItem,
    pub vector_search: CapabilityItem,
    pub scheduled_events: CapabilityItem,
    pub sequences: CapabilityItem,
    pub partitions: CapabilityItem,
    pub modern_collations: CapabilityItem,
    pub parsec_auth: CapabilityItem,
    pub items: Vec<CapabilityItem>,
}

impl ServerCapabilities {
    pub fn build(
        version_info: ServerVersionInfo,
        current_user: String,
        current_database: Option<String>,
        event_scheduler_val: Option<String>,
        server_collation: Option<String>,
        server_charset: Option<String>,
    ) -> Self {
        let is_maria = version_info.variant == ServerEngineVariant::MariaDb;
        let cur_ver = version_info.normalized_display.clone();

        // 1. ANALYZE FORMAT=JSON
        // MariaDB 10.1.0+ supports ANALYZE FORMAT=JSON
        let analyze_status = if is_maria {
            if version_info.is_at_least(10, 1, 0) {
                CapabilityAvailability::Compatible
            } else {
                CapabilityAvailability::UnsupportedVersion {
                    min_version: "MariaDB 10.1.0".into(),
                    current_version: cur_ver.clone(),
                }
            }
        } else if version_info.variant == ServerEngineVariant::MySql
            && version_info.is_at_least(8, 0, 18)
        {
            // MySQL 8.0.18+ supports EXPLAIN ANALYZE (FORMAT=TREE)
            CapabilityAvailability::Compatible
        } else {
            CapabilityAvailability::UnsupportedVersion {
                min_version: "MariaDB 10.1+ / MySQL 8.0.18+".into(),
                current_version: cur_ver.clone(),
            }
        };

        let analyze_format_json = CapabilityItem {
            id: "analyze_format_json".into(),
            name: "ANALYZE FORMAT=JSON (Ejecución y telemetría real)".into(),
            description: "Permite inspeccionar loops, filas reales leídas y discrepancias con el optimizador.".into(),
            status: analyze_status,
            category: "Diagnostics".into(),
        };

        // 2. System-Versioned Temporal Tables
        // MariaDB 10.3.0+
        let system_versioning_status = if is_maria {
            if version_info.is_at_least(10, 3, 0) {
                CapabilityAvailability::Compatible
            } else {
                CapabilityAvailability::UnsupportedVersion {
                    min_version: "MariaDB 10.3.0".into(),
                    current_version: cur_ver.clone(),
                }
            }
        } else {
            CapabilityAvailability::UnsupportedVersion {
                min_version: "MariaDB 10.3+ (Exclusivo MariaDB)".into(),
                current_version: cur_ver.clone(),
            }
        };

        let system_versioning = CapabilityItem {
            id: "system_versioning".into(),
            name: "Tablas con Versionado Temporal (System-Versioned)".into(),
            description: "Soporte nativo para cláusula FOR SYSTEM_TIME (AS OF, BETWEEN, ALL) e historial de datos.".into(),
            status: system_versioning_status,
            category: "Storage".into(),
        };

        // 3. Vector Data Types & Functions
        // MariaDB 11.7+ / 11.8+
        let vector_status = if is_maria {
            if version_info.is_at_least(11, 7, 0) {
                CapabilityAvailability::Compatible
            } else {
                CapabilityAvailability::UnsupportedVersion {
                    min_version: "MariaDB 11.7.0+".into(),
                    current_version: cur_ver.clone(),
                }
            }
        } else if version_info.variant == ServerEngineVariant::MySql
            && version_info.is_at_least(8, 4, 0)
        {
            CapabilityAvailability::Compatible
        } else {
            CapabilityAvailability::UnsupportedVersion {
                min_version: "MariaDB 11.7+ / MySQL 8.4+".into(),
                current_version: cur_ver.clone(),
            }
        };

        let vector_search = CapabilityItem {
            id: "vector_search".into(),
            name: "Tipos y Funciones Vectoriales (VECTOR, VEC_DISTANCE)".into(),
            description: "Almacenamiento de embeddings, cálculo de distancias euclidianas y cosenos vectoriales.".into(),
            status: vector_status,
            category: "AI & Vectors".into(),
        };

        // 4. Scheduled Events (Event Scheduler)
        let events_status = match event_scheduler_val.as_deref() {
            Some("ON") | Some("on") | Some("1") => CapabilityAvailability::Compatible,
            Some("DISABLED") | Some("disabled") => CapabilityAvailability::DisabledByConfig {
                variable_name: "event_scheduler".into(),
                current_value: "DISABLED".into(),
                expected_value: "ON".into(),
            },
            Some("OFF") | Some("off") | Some("0") => CapabilityAvailability::DisabledByConfig {
                variable_name: "event_scheduler".into(),
                current_value: "OFF".into(),
                expected_value: "ON".into(),
            },
            _ => {
                if version_info.is_at_least(5, 1, 0) {
                    CapabilityAvailability::Compatible
                } else {
                    CapabilityAvailability::UnsupportedVersion {
                        min_version: "MariaDB 5.1+".into(),
                        current_version: cur_ver.clone(),
                    }
                }
            }
        };

        let scheduled_events = CapabilityItem {
            id: "scheduled_events".into(),
            name: "Programador de Eventos (Event Scheduler)".into(),
            description: "Creación, programación y monitoreo de eventos recurrentes y diferidos en el servidor.".into(),
            status: events_status,
            category: "Automation".into(),
        };

        // 5. Sequences
        // MariaDB 10.3.0+
        let seq_status = if is_maria {
            if version_info.is_at_least(10, 3, 0) {
                CapabilityAvailability::Compatible
            } else {
                CapabilityAvailability::UnsupportedVersion {
                    min_version: "MariaDB 10.3.0".into(),
                    current_version: cur_ver.clone(),
                }
            }
        } else {
            CapabilityAvailability::UnsupportedVersion {
                min_version: "MariaDB 10.3+ (Exclusivo MariaDB)".into(),
                current_version: cur_ver.clone(),
            }
        };

        let sequences = CapabilityItem {
            id: "sequences".into(),
            name: "Secuencias MariaDB (CREATE SEQUENCE)".into(),
            description: "Generadores de números continuos independientes con control de ciclo, incremento y cache.".into(),
            status: seq_status,
            category: "Storage".into(),
        };

        // 6. Partitions
        let partitions_status = if version_info.is_at_least(5, 1, 0) {
            CapabilityAvailability::Compatible
        } else {
            CapabilityAvailability::UnsupportedVersion {
                min_version: "5.1.0".into(),
                current_version: cur_ver.clone(),
            }
        };

        let partitions = CapabilityItem {
            id: "partitions".into(),
            name: "Tablas Particionadas (RANGE, LIST, HASH, SYSTEM_TIME)".into(),
            description:
                "Inspección de rangos, límites y distribución de registros entre particiones."
                    .into(),
            status: partitions_status,
            category: "Storage".into(),
        };

        // 7. Modern Collations (UCA-1400)
        let collations_status = if is_maria {
            if version_info.is_at_least(11, 4, 0) {
                CapabilityAvailability::Compatible
            } else {
                CapabilityAvailability::UnsupportedVersion {
                    min_version: "MariaDB 11.4.0".into(),
                    current_version: cur_ver.clone(),
                }
            }
        } else if version_info.variant == ServerEngineVariant::MySql
            && version_info.is_at_least(8, 0, 0)
        {
            CapabilityAvailability::Compatible
        } else {
            CapabilityAvailability::UnsupportedVersion {
                min_version: "MariaDB 11.4+ / MySQL 8.0+".into(),
                current_version: cur_ver.clone(),
            }
        };

        let modern_collations = CapabilityItem {
            id: "modern_collations".into(),
            name: "Collation Unicode Moderna (UCA-1400 / utf8mb4)".into(),
            description: "Soporte para ordenamientos Unicode 14.0 (utf8mb4_uca1400_ai_ci) de alto rendimiento.".into(),
            status: collations_status,
            category: "Storage".into(),
        };

        // 8. PARSEC Auth
        let parsec_status = if is_maria {
            if version_info.is_at_least(11, 4, 0) {
                CapabilityAvailability::Compatible
            } else {
                CapabilityAvailability::UnsupportedVersion {
                    min_version: "MariaDB 11.4.0".into(),
                    current_version: cur_ver,
                }
            }
        } else {
            CapabilityAvailability::UnsupportedVersion {
                min_version: "MariaDB 11.4+ (Exclusivo MariaDB)".into(),
                current_version: cur_ver,
            }
        };

        let parsec_auth = CapabilityItem {
            id: "parsec_auth".into(),
            name: "Autenticación Endurecida PARSEC".into(),
            description: "Esquema moderno de autenticación criptográfica resistente a ataques de diccionario.".into(),
            status: parsec_status,
            category: "Security".into(),
        };

        let items = vec![
            analyze_format_json.clone(),
            system_versioning.clone(),
            vector_search.clone(),
            scheduled_events.clone(),
            sequences.clone(),
            partitions.clone(),
            modern_collations.clone(),
            parsec_auth.clone(),
        ];

        Self {
            engine: DbEngine::MySql,
            features: EngineFeature::supported_by(DbEngine::MySql),
            version: version_info,
            current_user,
            current_database,
            server_collation,
            server_charset,
            analyze_format_json,
            system_versioning,
            vector_search,
            scheduled_events,
            sequences,
            partitions,
            modern_collations,
            parsec_auth,
            items,
        }
    }
}

impl ServerCapabilities {
    /// SQLite has none of the server features: every item reports it.
    pub fn sqlite(version_info: ServerVersionInfo, current_user: String) -> Self {
        let mut capabilities = Self::build(
            version_info,
            current_user,
            Some("main".into()),
            None,
            None,
            None,
        );
        capabilities.engine = DbEngine::Sqlite;
        capabilities.features = EngineFeature::supported_by(DbEngine::Sqlite);
        let unsupported = CapabilityAvailability::UnsupportedEngine {
            engine: DbEngine::Sqlite.display_name().into(),
        };
        let dedicated = [
            &mut capabilities.analyze_format_json,
            &mut capabilities.system_versioning,
            &mut capabilities.vector_search,
            &mut capabilities.scheduled_events,
            &mut capabilities.sequences,
            &mut capabilities.partitions,
            &mut capabilities.modern_collations,
            &mut capabilities.parsec_auth,
        ];
        for item in dedicated.into_iter().chain(capabilities.items.iter_mut()) {
            item.status = unsupported.clone();
        }
        capabilities
    }
}

/// Discovers server capabilities by executing introspection queries on the active backend.
pub async fn detect_server_capabilities(
    backend: &dyn DatabaseBackend,
) -> Result<ServerCapabilities, PyroError> {
    match backend.engine() {
        DbEngine::MySql => detect_mysql_capabilities(backend).await,
        DbEngine::Sqlite => detect_sqlite_capabilities(backend).await,
    }
}

async fn detect_sqlite_capabilities(
    backend: &dyn DatabaseBackend,
) -> Result<ServerCapabilities, PyroError> {
    let result = backend
        .execute_query("SELECT sqlite_version()", None)
        .await?;
    let version = result
        .rows
        .first()
        .and_then(|row| row.first())
        .and_then(|value| value.as_str())
        .unwrap_or("3");
    Ok(ServerCapabilities::sqlite(
        ServerVersionInfo::parse(&format!("SQLite {version}")),
        String::new(),
    ))
}

async fn detect_mysql_capabilities(
    backend: &dyn DatabaseBackend,
) -> Result<ServerCapabilities, PyroError> {
    // 1. Fetch Version and Identity
    let base_sql = "SELECT VERSION() AS ver, USER() AS usr, DATABASE() AS cur_db;";
    let base_res = backend.execute_query(base_sql, None).await?;
    let row = base_res
        .rows
        .first()
        .ok_or_else(|| PyroError::Database("No se pudo obtener información del servidor".into()))?;

    let raw_ver = row.first().and_then(|v| v.as_str()).unwrap_or("Unknown");
    let current_user = row
        .get(1)
        .and_then(|v| v.as_str())
        .unwrap_or("root")
        .to_string();
    let current_database = row.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());

    let version_info = ServerVersionInfo::parse(raw_ver);

    // 2. Fetch server variables gracefully (event_scheduler, collations)
    let vars_sql = "SELECT @@event_scheduler AS ev_sched, @@collation_server AS coll, @@character_set_server AS charset;";
    let (event_scheduler_val, server_collation, server_charset) =
        if let Ok(vars_res) = backend.execute_query(vars_sql, None).await {
            if let Some(vrow) = vars_res.rows.first() {
                let ev = vrow
                    .first()
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_uppercase());
                let cl = vrow.get(1).and_then(|v| v.as_str()).map(|s| s.to_string());
                let cs = vrow.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());
                (ev, cl, cs)
            } else {
                (None, None, None)
            }
        } else {
            (None, None, None)
        };

    Ok(ServerCapabilities::build(
        version_info,
        current_user,
        current_database,
        event_scheduler_val,
        server_collation,
        server_charset,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_reports_its_version_and_no_server_features() {
        let version = ServerVersionInfo::parse("SQLite 3.46.1");
        assert_eq!(version.variant, ServerEngineVariant::Sqlite);
        assert_eq!(version.normalized_display, "SQLite 3.46.1");
        let caps = ServerCapabilities::sqlite(version, String::new());
        assert_eq!(caps.engine, DbEngine::Sqlite);
        assert!(caps.items.iter().all(|item| !item.status.is_available()));
        assert!(!caps.sequences.status.is_available());
        assert_eq!(caps.features, vec![EngineFeature::FileBackup]);
    }

    #[test]
    fn test_parse_mariadb_10_11() {
        let v = ServerVersionInfo::parse("10.11.6-MariaDB-1:10.11.6+maria~ubu2204");
        assert_eq!(v.variant, ServerEngineVariant::MariaDb);
        assert_eq!(v.major, 10);
        assert_eq!(v.minor, 11);
        assert_eq!(v.patch, 6);
        assert!(v.is_lts);
        assert!(v.is_at_least(10, 3, 0));
        assert!(v.is_at_least(10, 11, 0));
        assert!(!v.is_at_least(11, 4, 0));

        let caps = ServerCapabilities::build(
            v,
            "admin@localhost".into(),
            Some("app_db".into()),
            Some("ON".into()),
            None,
            None,
        );
        assert!(caps.analyze_format_json.status.is_available());
        assert!(caps.system_versioning.status.is_available());
        assert!(caps.sequences.status.is_available());
        assert!(caps.scheduled_events.status.is_available());
        assert!(!caps.vector_search.status.is_available()); // Vector is 11.7+
        assert!(!caps.modern_collations.status.is_available()); // UCA-1400 is 11.4+
    }

    #[test]
    fn test_parse_mariadb_11_4() {
        let v = ServerVersionInfo::parse("11.4.2-MariaDB-log");
        assert_eq!(v.variant, ServerEngineVariant::MariaDb);
        assert_eq!(v.major, 11);
        assert_eq!(v.minor, 4);
        assert_eq!(v.patch, 2);
        assert!(v.is_lts);

        let caps = ServerCapabilities::build(
            v,
            "root@localhost".into(),
            None,
            Some("OFF".into()),
            None,
            None,
        );
        assert!(caps.analyze_format_json.status.is_available());
        assert!(caps.system_versioning.status.is_available());
        assert!(caps.sequences.status.is_available());
        assert!(caps.modern_collations.status.is_available());
        assert!(caps.parsec_auth.status.is_available());
        // Disabled by config test:
        match caps.scheduled_events.status {
            CapabilityAvailability::DisabledByConfig {
                variable_name,
                current_value,
                ..
            } => {
                assert_eq!(variable_name, "event_scheduler");
                assert_eq!(current_value, "OFF");
            }
            _ => panic!("Expected DisabledByConfig"),
        }
    }

    #[test]
    fn test_parse_mariadb_11_8() {
        let v = ServerVersionInfo::parse("11.8.0-MariaDB");
        assert_eq!(v.variant, ServerEngineVariant::MariaDb);
        assert_eq!(v.major, 11);
        assert_eq!(v.minor, 8);
        assert_eq!(v.patch, 0);

        let caps = ServerCapabilities::build(
            v,
            "admin@localhost".into(),
            None,
            Some("ON".into()),
            None,
            None,
        );
        assert!(caps.analyze_format_json.status.is_available());
        assert!(caps.system_versioning.status.is_available());
        assert!(caps.vector_search.status.is_available()); // 11.8 has Vector preview
        assert!(caps.modern_collations.status.is_available());
        assert!(caps.parsec_auth.status.is_available());
    }

    #[test]
    fn test_parse_mysql_8() {
        let v = ServerVersionInfo::parse("8.0.35");
        assert_eq!(v.variant, ServerEngineVariant::MySql);
        assert_eq!(v.major, 8);
        assert_eq!(v.minor, 0);
        assert_eq!(v.patch, 35);

        let caps = ServerCapabilities::build(
            v,
            "app@localhost".into(),
            None,
            Some("ON".into()),
            None,
            None,
        );
        // Sequences are MariaDB exclusive
        assert!(!caps.sequences.status.is_available());
        // System versioning is MariaDB exclusive
        assert!(!caps.system_versioning.status.is_available());
        // ANALYZE is supported (MySQL 8.0.18+)
        assert!(caps.analyze_format_json.status.is_available());
    }
    #[test]
    fn test_capability_availability_serialization_matches_frontend_contract() {
        let compatible = CapabilityAvailability::Compatible;
        let json_compat = serde_json::to_value(&compatible).unwrap();
        assert_eq!(json_compat, serde_json::json!({ "status": "Compatible" }));

        let unsupported = CapabilityAvailability::UnsupportedVersion {
            min_version: "10.1".into(),
            current_version: "5.7".into(),
        };
        let json_unsup = serde_json::to_value(&unsupported).unwrap();
        assert_eq!(
            json_unsup,
            serde_json::json!({
                "status": "UnsupportedVersion",
                "detail": {
                    "min_version": "10.1",
                    "current_version": "5.7"
                }
            })
        );
    }
}
