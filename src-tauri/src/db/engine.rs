use serde::{Deserialize, Serialize};

use super::dialect::{Dialect, MYSQL_DIALECT, SQLITE_DIALECT};
use super::introspect::SchemaIntrospector;
use super::mysql::introspector::MYSQL_INTROSPECTOR;
use super::sqlite::introspector::SQLITE_INTROSPECTOR;

/// Database engine of a connection, independent of the transport (direct
/// connection, SSH or HTTP tunnel). Profiles saved before SQLite support have
/// no engine and deserialize as MariaDB/MySQL.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbEngine {
    /// MariaDB and MySQL.
    #[default]
    #[serde(rename = "mysql")]
    MySql,
    Sqlite,
}

impl DbEngine {
    pub fn dialect(self) -> &'static dyn Dialect {
        match self {
            Self::MySql => &MYSQL_DIALECT,
            Self::Sqlite => &SQLITE_DIALECT,
        }
    }

    pub fn introspector(self) -> &'static dyn SchemaIntrospector {
        match self {
            Self::MySql => &MYSQL_INTROSPECTOR,
            Self::Sqlite => &SQLITE_INTROSPECTOR,
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::MySql => "MariaDB/MySQL",
            Self::Sqlite => "SQLite",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_frontend_names() {
        assert_eq!(
            serde_json::to_string(&DbEngine::MySql).unwrap(),
            "\"mysql\""
        );
        assert_eq!(
            serde_json::to_string(&DbEngine::Sqlite).unwrap(),
            "\"sqlite\""
        );
        assert_eq!(
            serde_json::from_str::<DbEngine>("\"sqlite\"").unwrap(),
            DbEngine::Sqlite
        );
    }
}
