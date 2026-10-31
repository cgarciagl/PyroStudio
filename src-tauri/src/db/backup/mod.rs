pub mod engine;
pub mod manifest;
pub mod restore;
pub mod verify;

pub use engine::{execute_backup, BackupOptions, BackupSummary};
pub use manifest::{
    BackupManifest, BackupStatus, BackupType, ChunkManifest, CompressionFormat, TableBackupManifest,
};
pub use restore::{
    execute_directory_restore, read_decompressed_chunk, DirectoryRestoreProgressEvent,
    DirectoryRestoreRequest, DirectoryRestoreSummary,
};
pub use verify::{calculate_file_sha256, verify_backup, BackupVerificationResult};

#[cfg(test)]
mod tests {
    use super::engine::save_manifest;
    use super::manifest::{
        BackupManifest, BackupType, ChunkManifest, CompressionFormat, TableBackupManifest,
    };
    use super::verify::{calculate_file_sha256, verify_backup, verify_chunk_decompression};
    use std::io::Write;

    #[test]
    fn test_manifest_roundtrip() {
        let mut manifest = BackupManifest::new(
            "backup-test-01".into(),
            BackupType::Full,
            CompressionFormat::Zstd,
            "10.11.8-MariaDB".into(),
            "shop_db".into(),
        );
        manifest.binlog_coordinates = Some("File: mysql-bin.000001, Position: 456".into());
        manifest.tables.push(TableBackupManifest {
            name: "users".into(),
            table_type: "BASE TABLE".into(),
            engine: Some("InnoDB".into()),
            is_transactional: true,
            schema_file: "schema/users.sql".into(),
            schema_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                .into(),
            total_rows: 100,
            total_uncompressed_bytes: 4096,
            total_compressed_bytes: 1024,
            chunks: vec![ChunkManifest {
                chunk_index: 1,
                file_name: "data/users.00001.sql.zst".into(),
                first_key: Some(vec![serde_json::json!(1)]),
                last_key: Some(vec![serde_json::json!(100)]),
                rows: 100,
                uncompressed_bytes: 4096,
                compressed_bytes: 1024,
                sha256: "aabbcc".into(),
                completed: true,
            }],
            completed: true,
            checksum: Some(123456789),
            is_differential_unchanged: false,
        });

        let json = serde_json::to_string(&manifest).expect("serialize");
        let parsed: BackupManifest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.backup_id, "backup-test-01");
        assert_eq!(parsed.tables.len(), 1);
        assert_eq!(parsed.tables[0].chunks.len(), 1);
        assert_eq!(parsed.tables[0].chunks[0].rows, 100);
    }

    #[test]
    fn test_zstd_compression_and_sha256_verification() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let file_path = temp_dir.path().join("test.sql.zst");

        let original_data = b"INSERT INTO `test` VALUES (1, 'hello world'), (2, 'pyro studio');\n";

        // Compress using zstd
        let file = std::fs::File::create(&file_path).expect("create");
        let mut encoder = zstd::Encoder::new(file, 3).expect("encoder");
        encoder.write_all(original_data).expect("write");
        encoder.finish().expect("finish");

        // Verify SHA256 is reproducible
        let sha1 = calculate_file_sha256(&file_path).expect("sha");
        let sha2 = calculate_file_sha256(&file_path).expect("sha");
        assert_eq!(sha1, sha2);
        assert_eq!(sha1.len(), 64);

        // Verify decompression byte count
        let bytes_decompressed =
            verify_chunk_decompression(&file_path, CompressionFormat::Zstd).expect("decompress");
        assert_eq!(bytes_decompressed, original_data.len() as u64);
    }

    #[test]
    fn test_verify_backup_detects_corrupted_files() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let base = temp_dir.path();
        std::fs::create_dir_all(base.join("schema")).expect("schema dir");
        std::fs::create_dir_all(base.join("data")).expect("data dir");

        let schema_file = base.join("schema/users.sql");
        std::fs::write(&schema_file, "CREATE TABLE users (id INT PRIMARY KEY);").expect("write");
        let schema_hash = calculate_file_sha256(&schema_file).expect("hash");

        let chunk_file = base.join("data/users.00001.sql.zst");
        let data = b"INSERT INTO users VALUES (1);";
        let f = std::fs::File::create(&chunk_file).expect("create");
        let mut enc = zstd::Encoder::new(f, 3).expect("enc");
        enc.write_all(data).expect("write");
        enc.finish().expect("finish");
        let chunk_hash = calculate_file_sha256(&chunk_file).expect("hash");

        let mut manifest = BackupManifest::new(
            "b1".into(),
            BackupType::Full,
            CompressionFormat::Zstd,
            "MariaDB".into(),
            "test_db".into(),
        );
        manifest.tables.push(TableBackupManifest {
            name: "users".into(),
            table_type: "BASE TABLE".into(),
            engine: Some("InnoDB".into()),
            is_transactional: true,
            schema_file: "schema/users.sql".into(),
            schema_sha256: schema_hash,
            total_rows: 1,
            total_uncompressed_bytes: data.len() as u64,
            total_compressed_bytes: 30,
            chunks: vec![ChunkManifest {
                chunk_index: 1,
                file_name: "data/users.00001.sql.zst".into(),
                first_key: None,
                last_key: None,
                rows: 1,
                uncompressed_bytes: data.len() as u64,
                compressed_bytes: 30,
                sha256: chunk_hash,
                completed: true,
            }],
            completed: true,
            checksum: None,
            is_differential_unchanged: false,
        });

        save_manifest(base, &manifest).expect("save manifest");

        // 1. Should be completely valid initially
        let res = verify_backup(base).expect("verify");
        assert!(res.valid);
        assert_eq!(res.verified_files, 2);
        assert!(res.corrupted_files.is_empty());

        // 2. Corrupt schema file by appending data
        std::fs::write(&schema_file, "ALTERED CONTENT").expect("corrupt");
        let res2 = verify_backup(base).expect("verify");
        assert!(!res2.valid);
        assert!(res2
            .corrupted_files
            .contains(&"schema/users.sql".to_string()));
    }

    #[tokio::test]
    async fn test_directory_restore_decompression_and_execution() {
        use super::restore::{execute_directory_restore, DirectoryRestoreRequest};
        use crate::db::backend::DatabaseBackend;
        use crate::db::engine::DbEngine;
        use crate::db::error::PyroError;
        use futures_util::future::BoxFuture;
        use futures_util::FutureExt;
        use std::sync::{Arc, Mutex};

        struct MockBackend {
            queries: Arc<Mutex<Vec<String>>>,
        }

        impl DatabaseBackend for MockBackend {
            fn engine(&self) -> DbEngine {
                DbEngine::MySql
            }
            fn execute_query<'a>(
                &'a self,
                sql: &'a str,
                _database: Option<&'a str>,
            ) -> BoxFuture<'a, Result<crate::db::models::QueryExecutionResult, PyroError>>
            {
                self.queries.lock().unwrap().push(sql.to_string());
                async move {
                    Ok(crate::db::models::QueryExecutionResult {
                        columns: vec![],
                        rows: vec![],
                        affected_rows: 1,
                        execution_time_ms: 1,
                        message: String::new(),
                        warning: None,
                    })
                }
                .boxed()
            }
            fn update_cell<'a>(
                &'a self,
                _req: &'a crate::db::models::CellUpdateRequest,
            ) -> BoxFuture<'a, Result<(), PyroError>> {
                async move { Ok(()) }.boxed()
            }
            fn delete_row<'a>(
                &'a self,
                _req: &'a crate::db::models::DeleteRowRequest,
            ) -> BoxFuture<'a, Result<(), PyroError>> {
                async move { Ok(()) }.boxed()
            }
            fn execute_transaction<'a>(
                &'a self,
                _statements: &'a [String],
                _database: Option<&'a str>,
            ) -> BoxFuture<'a, Result<usize, PyroError>> {
                async move { Ok(0) }.boxed()
            }
            fn close<'a>(&'a self) -> BoxFuture<'a, ()> {
                async move {}.boxed()
            }
        }

        let temp_dir = tempfile::tempdir().expect("tempdir");
        let base = temp_dir.path();
        std::fs::create_dir_all(base.join("schema")).expect("schema dir");
        std::fs::create_dir_all(base.join("data")).expect("data dir");

        let schema_file = base.join("schema/products.sql");
        let ddl = "CREATE TABLE `products` (`id` INT PRIMARY KEY, `name` VARCHAR(50));";
        std::fs::write(&schema_file, ddl).expect("write schema");

        let chunk_file = base.join("data/products.00001.sql.zst");
        let insert_sql = "INSERT INTO `products` VALUES (1, 'Pyro');\nINSERT INTO `products` VALUES (2, 'Studio');";
        let compressed = zstd::encode_all(insert_sql.as_bytes(), 3).expect("zstd");
        std::fs::write(&chunk_file, compressed).expect("write chunk");

        let mut manifest = BackupManifest::new(
            "test-restore-01".into(),
            BackupType::Full,
            CompressionFormat::Zstd,
            "10.11-MariaDB".into(),
            "shop".into(),
        );
        manifest.tables.push(TableBackupManifest {
            name: "products".into(),
            table_type: "BASE TABLE".into(),
            engine: Some("InnoDB".into()),
            is_transactional: true,
            schema_file: "schema/products.sql".into(),
            schema_sha256: "dummy".into(),
            total_rows: 2,
            total_uncompressed_bytes: insert_sql.len() as u64,
            total_compressed_bytes: 30,
            chunks: vec![ChunkManifest {
                chunk_index: 1,
                file_name: "data/products.00001.sql.zst".into(),
                first_key: None,
                last_key: None,
                rows: 2,
                uncompressed_bytes: insert_sql.len() as u64,
                compressed_bytes: 30,
                sha256: "dummy".into(),
                completed: true,
            }],
            completed: true,
            checksum: Some(999),
            is_differential_unchanged: false,
        });
        save_manifest(base, &manifest).expect("save manifest");

        let executed = Arc::new(Mutex::new(Vec::new()));
        let backend = MockBackend {
            queries: executed.clone(),
        };

        let req = DirectoryRestoreRequest {
            backup_dir: base.to_string_lossy().to_string(),
            target_database: "shop_restored".into(),
            create_database_if_not_exists: true,
            disable_foreign_keys: true,
            stop_on_error: true,
            base_backup_dir: None,
        };

        let summary = execute_directory_restore(&backend, None, req)
            .await
            .expect("restore");
        assert_eq!(summary.total_tables, 1);
        assert_eq!(summary.total_rows, 2);
        assert_eq!(summary.target_database, "shop_restored");

        let queries = executed.lock().unwrap();
        assert!(queries.iter().any(|q| q.contains("CREATE DATABASE")));
        assert!(queries
            .iter()
            .any(|q| q.contains("CREATE TABLE `products`")));
        assert!(queries
            .iter()
            .any(|q| q.contains("INSERT INTO `products` VALUES (1, 'Pyro')")));
        assert!(queries
            .iter()
            .any(|q| q.contains("INSERT INTO `products` VALUES (2, 'Studio')")));
    }
}
