use serde::{Deserialize, Serialize};

use super::engine::DbEngine;

/// Parts of the interface that only exist for some engines. The frontend hides
/// what the connected engine does not list instead of checking engine names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineFeature {
    /// Server metrics panel (QPS, buffer pool, connections).
    Dashboard,
    HealthMonitor,
    SlowQueryAnalyzer,
    ProcessList,
    IndexAdvisor,
    SchemaDiff,
    /// OPTIMIZE / ANALYZE / CHECK / REPAIR.
    TableMaintenance,
    /// Logical `.sql` dump and restore.
    SqlDump,
    /// Copy of the database file (`VACUUM INTO`).
    FileBackup,
    Routines,
    Events,
    Sequences,
    Partitions,
    SystemVersioning,
    Users,
    /// CREATE / DROP DATABASE.
    DatabaseManagement,
    /// Storage engine, collation and size columns of the tables overview.
    TableStorageDetails,
    DatabaseAgent,
    DatabaseReports,
    /// EXPLAIN that also runs the statement (ANALYZE FORMAT=JSON).
    AnalyzeExecution,
    /// Per-table storage engine (InnoDB, Aria…).
    StorageEngines,
    /// Character sets and collations on tables and columns.
    Collations,
    /// COMMENT on tables and columns.
    Comments,
    /// FIRST / AFTER when adding a column.
    ColumnPosition,
}

impl EngineFeature {
    /// Features available on `engine`.
    pub fn supported_by(engine: DbEngine) -> Vec<Self> {
        use EngineFeature::*;
        match engine {
            DbEngine::MySql => vec![
                Dashboard,
                HealthMonitor,
                SlowQueryAnalyzer,
                ProcessList,
                IndexAdvisor,
                SchemaDiff,
                TableMaintenance,
                SqlDump,
                Routines,
                Events,
                Sequences,
                Partitions,
                SystemVersioning,
                Users,
                DatabaseManagement,
                TableStorageDetails,
                DatabaseAgent,
                DatabaseReports,
                AnalyzeExecution,
                StorageEngines,
                Collations,
                Comments,
                ColumnPosition,
            ],
            DbEngine::Sqlite => vec![FileBackup],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_hides_server_only_features() {
        let sqlite = EngineFeature::supported_by(DbEngine::Sqlite);
        assert!(sqlite.contains(&EngineFeature::FileBackup));
        assert!(!sqlite.contains(&EngineFeature::Routines));
        assert!(!EngineFeature::supported_by(DbEngine::MySql).contains(&EngineFeature::FileBackup));
        assert_eq!(
            serde_json::to_string(&EngineFeature::SlowQueryAnalyzer).unwrap(),
            "\"slowQueryAnalyzer\""
        );
    }
}
