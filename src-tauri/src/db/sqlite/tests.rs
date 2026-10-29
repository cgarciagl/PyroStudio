//! Integration tests against real SQLite files in the temporary directory.

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use super::connect::{create_database_file, open_backend};
use super::SqliteBackend;
use crate::db::backend::DatabaseBackend;
use crate::db::index;
use crate::db::models::{
    CellUpdateRequest, CreateIndexRequest, DeleteRowRequest, PrimaryKeyCondition, TableDataRequest,
};
use crate::db::{database, table, trigger};

static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

/// Database file removed when the test ends.
pub struct TempDatabase {
    pub path: PathBuf,
    pub backend: SqliteBackend,
}

impl TempDatabase {
    pub async fn with_schema(schema: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "pyrostudio-sqlite-{}-{}.db",
            std::process::id(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_file(&path);
        create_database_file(path.to_str().unwrap()).await.unwrap();
        let (backend, _) = open_backend(path.to_str().unwrap()).await.unwrap();
        if !schema.is_empty() {
            backend.execute_query(schema, None).await.unwrap();
        }
        Self { path, backend }
    }

    pub async fn rows(&self, sql: &str) -> Vec<Vec<Value>> {
        self.backend.execute_query(sql, None).await.unwrap().rows
    }
}

impl Drop for TempDatabase {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn condition(column: &str, value: Value) -> PrimaryKeyCondition {
    PrimaryKeyCondition {
        column: column.into(),
        value,
    }
}

#[tokio::test]
async fn converts_every_storage_class_by_value() {
    let db = TempDatabase::with_schema("CREATE TABLE t (a, b, c, d, e)").await;
    db.rows("INSERT INTO t VALUES (42, 2.5, 'texto', x'00FF', NULL)")
        .await;
    db.rows("INSERT INTO t VALUES ('mixto', 7, 3, x'4869', 1.0)")
        .await;
    let rows = db.rows("SELECT a, b, c, d, e FROM t ORDER BY rowid").await;
    assert_eq!(
        rows[0],
        vec![
            json!(42),
            json!(2.5),
            json!("texto"),
            json!("0x00FF"),
            Value::Null
        ]
    );
    // Mixed affinity: each cell keeps its own storage class.
    assert_eq!(
        rows[1],
        vec![json!("mixto"), json!(7), json!(3), json!("Hi"), json!(1.0)]
    );
}

#[tokio::test]
async fn introspects_tables_columns_keys_indexes_foreign_keys_and_views() {
    let db = TempDatabase::with_schema(
        "CREATE TABLE customer (id INTEGER PRIMARY KEY, name VARCHAR(40) NOT NULL);
         CREATE TABLE line (order_id INTEGER, line_no INTEGER, customer_id INTEGER REFERENCES customer(id) ON DELETE CASCADE,
                            qty REAL DEFAULT 1, PRIMARY KEY (order_id, line_no));
         CREATE UNIQUE INDEX idx_line_customer ON line (customer_id, qty);
         CREATE VIEW big_lines AS SELECT * FROM line WHERE qty > 10;
         CREATE TRIGGER line_audit AFTER UPDATE ON line BEGIN SELECT 1; END;",
    )
    .await;
    let backend = &db.backend;

    let schemas = database::list_databases(backend).await.unwrap();
    assert_eq!(schemas[0].name, "main");
    assert_eq!(schemas[0].tables_count, 2);

    let tables = table::list_tables(backend, "main").await.unwrap();
    let kinds: Vec<_> = tables
        .iter()
        .map(|t| (t.name.as_str(), t.table_type.as_str()))
        .collect();
    assert_eq!(
        kinds,
        vec![
            ("customer", "BASE TABLE"),
            ("line", "BASE TABLE"),
            ("big_lines", "VIEW")
        ]
    );

    let columns = table::get_table_columns(backend, "main", "customer")
        .await
        .unwrap();
    assert_eq!(columns[0].extra, "auto_increment");
    assert_eq!(columns[1].column_type, "VARCHAR(40)");
    assert_eq!(columns[1].data_type, "varchar");
    assert!(!columns[1].is_nullable);

    let key = table::get_table_primary_key(backend, "main", "line")
        .await
        .unwrap();
    assert_eq!(key.columns, vec!["order_id", "line_no"]);

    let indexes = index::list_indexes(backend, "main", "line").await.unwrap();
    assert_eq!(indexes[0].key_name, "PRIMARY");
    assert_eq!(indexes[1].key_name, "idx_line_customer");
    assert!(indexes[1].is_unique);
    assert_eq!(indexes[1].columns.len(), 2);

    let foreign_keys = crate::db::diff::fetch_schema_foreign_keys(backend, "main")
        .await
        .unwrap();
    let line_fk = &foreign_keys["line"][0];
    assert_eq!(line_fk.referenced_table, "customer");
    assert_eq!(line_fk.delete_rule, "CASCADE");

    let triggers = trigger::list_triggers(backend, "main", Some("line"))
        .await
        .unwrap();
    assert_eq!(triggers[0].timing, "AFTER");
    assert_eq!(triggers[0].event, "UPDATE");

    let view_key = table::get_table_primary_key(backend, "main", "big_lines")
        .await
        .unwrap();
    assert!(view_key.columns.is_empty(), "views are not editable");
}

#[tokio::test]
async fn edits_rows_by_primary_key() {
    let db = TempDatabase::with_schema(
        "CREATE TABLE item (a INTEGER, b TEXT, v TEXT, PRIMARY KEY (a, b));
         INSERT INTO item VALUES (1, 'x', 'old'), (1, 'y', 'keep');",
    )
    .await;
    db.backend
        .update_cell(&CellUpdateRequest {
            database: "main".into(),
            table: "item".into(),
            primary_keys: vec![condition("a", json!(1)), condition("b", json!("x"))],
            column_name: "v".into(),
            new_value: json!("new"),
            primary_key_column: None,
            primary_key_value: None,
        })
        .await
        .unwrap();
    assert_eq!(
        db.rows("SELECT v FROM item ORDER BY b").await,
        vec![vec![json!("new")], vec![json!("keep")]]
    );

    db.backend
        .delete_row(&DeleteRowRequest {
            database: "main".into(),
            table: "item".into(),
            primary_keys: vec![condition("a", json!(1)), condition("b", json!("y"))],
        })
        .await
        .unwrap();
    assert_eq!(
        db.rows("SELECT count(*) FROM item").await,
        vec![vec![json!(1)]]
    );
}

#[tokio::test]
async fn tables_without_primary_key_are_edited_through_rowid() {
    let db = TempDatabase::with_schema(
        "CREATE TABLE note (body TEXT);
         INSERT INTO note VALUES ('same'), ('same');",
    )
    .await;
    let backend = &db.backend;
    let key = table::get_table_primary_key(backend, "main", "note")
        .await
        .unwrap();
    assert_eq!(key.columns, vec!["rowid"]);

    let page = table::query_table_data(
        backend,
        TableDataRequest {
            database: "main".into(),
            table: "note".into(),
            limit: 10,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(page.columns, vec!["rowid", "body"]);
    assert_eq!(page.total_rows, Some(2));
    let second_rowid = page.rows[1][0].clone();

    backend
        .update_cell(&CellUpdateRequest {
            database: "main".into(),
            table: "note".into(),
            primary_keys: vec![condition("rowid", second_rowid.clone())],
            column_name: "body".into(),
            new_value: json!("changed"),
            primary_key_column: None,
            primary_key_value: None,
        })
        .await
        .unwrap();
    backend
        .delete_row(&DeleteRowRequest {
            database: "main".into(),
            table: "note".into(),
            primary_keys: vec![condition("rowid", json!(1))],
        })
        .await
        .unwrap();
    assert_eq!(
        db.rows("SELECT rowid, body FROM note").await,
        vec![vec![second_rowid, json!("changed")]]
    );
}

#[tokio::test]
async fn shadowed_rowid_falls_back_to_another_alias() {
    let db = TempDatabase::with_schema("CREATE TABLE odd (rowid TEXT, v TEXT)").await;
    let key = table::get_table_primary_key(&db.backend, "main", "odd")
        .await
        .unwrap();
    assert_eq!(key.columns, vec!["_rowid_"]);
}

#[tokio::test]
async fn script_keeps_first_result_set_and_stops_at_failing_statement() {
    let db =
        TempDatabase::with_schema("CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (1);").await;
    let result = db
        .backend
        .execute_query(
            "SELECT v FROM t; SELECT * FROM missing; INSERT INTO t VALUES (2);",
            None,
        )
        .await
        .unwrap();
    assert_eq!(result.rows, vec![vec![json!(1)]]);
    assert!(result.warning.unwrap().contains("missing"));
    assert_eq!(
        db.rows("SELECT count(*) FROM t").await,
        vec![vec![json!(1)]]
    );

    let error = db
        .backend
        .execute_query(
            "INSERT INTO t VALUES (3); INSERT INTO missing VALUES (1); INSERT INTO t VALUES (4);",
            None,
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("missing"));
    assert_eq!(
        db.rows("SELECT v FROM t ORDER BY v").await,
        vec![vec![json!(1)], vec![json!(3)]],
        "statements after the failure must not run"
    );
}

#[tokio::test]
async fn transactions_roll_back_on_failure() {
    let db = TempDatabase::with_schema("CREATE TABLE t (v INTEGER UNIQUE)").await;
    let statements = vec![
        "INSERT INTO t VALUES (1)".to_string(),
        "INSERT INTO t VALUES (1)".to_string(),
    ];
    assert!(db
        .backend
        .execute_transaction(&statements, Some("main"))
        .await
        .is_err());
    assert_eq!(
        db.rows("SELECT count(*) FROM t").await,
        vec![vec![json!(0)]]
    );
}

#[tokio::test]
async fn creates_and_drops_indexes_with_sqlite_syntax() {
    let db = TempDatabase::with_schema("CREATE TABLE t (a INTEGER, b TEXT)").await;
    index::create_index(
        &db.backend,
        CreateIndexRequest {
            database: "main".into(),
            table: "t".into(),
            index_name: "idx_ab".into(),
            index_type: "UNIQUE".into(),
            columns: vec!["a".into(), "b".into()],
            comment: None,
        },
    )
    .await
    .unwrap();
    let indexes = index::list_indexes(&db.backend, "main", "t").await.unwrap();
    assert_eq!(indexes[0].key_name, "idx_ab");
    index::drop_index(&db.backend, "main", "t", "idx_ab")
        .await
        .unwrap();
    assert!(index::list_indexes(&db.backend, "main", "t")
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn cancel_interrupts_a_running_query() {
    let db = TempDatabase::with_schema("").await;
    let backend = db.backend.clone();
    let running = tokio::spawn(async move {
        backend
            .execute_query_cancellable(
                "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c",
                None,
                Some("q1"),
            )
            .await
    });
    let mut cancelled = false;
    for _ in 0..100 {
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        if db.backend.cancel_query("q1").await.unwrap() {
            cancelled = true;
            break;
        }
    }
    assert!(cancelled, "the query was registered for cancellation");
    let error = running.await.unwrap().unwrap_err();
    assert!(error.to_string().to_lowercase().contains("interrupt"));
}

#[tokio::test]
async fn inspector_reports_rows_and_stored_ddl() {
    let db = TempDatabase::with_schema(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);
         CREATE INDEX idx_v ON t (v);
         INSERT INTO t (v) VALUES ('a'), ('b');",
    )
    .await;
    let details = crate::db::inspector::get_table_inspector_details(&db.backend, "main", "t")
        .await
        .unwrap();
    assert_eq!(details.statistics.engine, "SQLite");
    assert_eq!(details.statistics.table_rows, 2);
    assert!(details.ddl.starts_with("CREATE TABLE t"));
    assert!(details.ddl.contains("CREATE INDEX idx_v ON t (v);"));
    assert_eq!(details.structure.len(), 2);
}
