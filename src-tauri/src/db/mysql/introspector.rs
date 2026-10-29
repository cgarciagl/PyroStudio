//! MariaDB/MySQL catalog queries (`information_schema` and `SHOW`).

use futures_util::FutureExt;
use std::collections::HashMap;

use crate::db::backend::DatabaseBackend;
use crate::db::error::PyroError;
use crate::db::introspect::{IntrospectFuture, SchemaIntrospector};
use crate::db::models::{
    ColumnMetadata, DatabaseSchema, ForeignKeyMetadata, IndexColumn, IndexMetadata, PrimaryKey,
    TableMetadata, TriggerDetail, TriggerMetadata,
};
use crate::db::query::{value_to_i64, value_to_u64};
use crate::db::sql_utils::qualify_table;

pub struct MySqlIntrospector;

pub static MYSQL_INTROSPECTOR: MySqlIntrospector = MySqlIntrospector;

impl SchemaIntrospector for MySqlIntrospector {
    fn list_databases<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
    ) -> IntrospectFuture<'a, Vec<DatabaseSchema>> {
        list_databases(backend).boxed()
    }

    fn list_tables<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
    ) -> IntrospectFuture<'a, Vec<TableMetadata>> {
        list_tables(backend, database).boxed()
    }

    fn table_columns<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, Vec<ColumnMetadata>> {
        get_table_columns(backend, database, table).boxed()
    }

    fn primary_key<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, PrimaryKey> {
        get_table_primary_key(backend, database, table).boxed()
    }

    fn completion_schema<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
    ) -> IntrospectFuture<'a, HashMap<String, Vec<String>>> {
        get_database_completion_schema(backend, database).boxed()
    }

    fn list_indexes<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: &'a str,
    ) -> IntrospectFuture<'a, Vec<IndexMetadata>> {
        list_indexes(backend, database, table).boxed()
    }

    fn list_triggers<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        table: Option<&'a str>,
    ) -> IntrospectFuture<'a, Vec<TriggerMetadata>> {
        list_triggers(backend, database, table).boxed()
    }

    fn trigger_definition<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
        name: &'a str,
    ) -> IntrospectFuture<'a, TriggerDetail> {
        get_trigger_definition(backend, database, name).boxed()
    }

    fn foreign_keys<'a>(
        &self,
        backend: &'a dyn DatabaseBackend,
        database: &'a str,
    ) -> IntrospectFuture<'a, HashMap<String, Vec<ForeignKeyMetadata>>> {
        fetch_schema_foreign_keys(backend, database).boxed()
    }
}

/// Lists all databases and schemas with their approximate table counts.
async fn list_databases(backend: &dyn DatabaseBackend) -> Result<Vec<DatabaseSchema>, PyroError> {
    let sql = r#"
        SELECT 
            s.SCHEMA_NAME,
            COUNT(t.TABLE_NAME) AS tables_count
        FROM information_schema.SCHEMATA s
        LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
        GROUP BY s.SCHEMA_NAME
        ORDER BY s.SCHEMA_NAME
    "#;

    let res = backend.execute_query(sql, None).await?;
    let mut schemas = Vec::new();

    let name_idx = res
        .columns
        .iter()
        .position(|c| c.eq_ignore_ascii_case("SCHEMA_NAME"))
        .unwrap_or(0);
    let count_idx = res
        .columns
        .iter()
        .position(|c| c.eq_ignore_ascii_case("tables_count"))
        .unwrap_or(1);

    for row in res.rows {
        let name = row
            .get(name_idx)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let tables_count = row.get(count_idx).and_then(value_to_i64).unwrap_or(0);

        if !name.is_empty() {
            schemas.push(DatabaseSchema {
                name,
                tables_count: tables_count.max(0) as usize,
            });
        }
    }

    Ok(schemas)
}

/// Lists all tables in the specified database.
async fn list_tables(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<Vec<TableMetadata>, PyroError> {
    let clean_db = database.replace('\'', "''");
    let sql = format!(
        r#"
        SELECT 
            TABLE_NAME,
            TABLE_TYPE,
            ENGINE,
            TABLE_ROWS,
            DATA_LENGTH,
            TABLE_COLLATION,
            TABLE_COMMENT
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '{clean_db}'
        ORDER BY TABLE_TYPE ASC, TABLE_NAME ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut tables = Vec::new();

    for row in res.rows {
        let name = row
            .first()
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let table_type = row
            .get(1)
            .and_then(|v| v.as_str())
            .unwrap_or("BASE TABLE")
            .to_string();
        let engine = row.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());
        let rows_count = row.get(3).and_then(value_to_i64);
        let data_length = row.get(4).and_then(value_to_i64);
        let collation = row.get(5).and_then(|v| v.as_str()).map(|s| s.to_string());
        let comment = row.get(6).and_then(|v| v.as_str()).map(|s| s.to_string());

        if !name.is_empty() {
            tables.push(TableMetadata {
                name,
                table_type,
                engine,
                rows_count,
                data_length,
                collation,
                comment,
            });
        }
    }

    Ok(tables)
}

/// Retrieves all column details for a given table.
async fn get_table_columns(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnMetadata>, PyroError> {
    let clean_db = database.replace('\'', "''");
    let clean_tbl = table.replace('\'', "''");

    let sql = format!(
        r#"
        SELECT 
            COLUMN_NAME,
            ORDINAL_POSITION,
            COLUMN_DEFAULT,
            IS_NULLABLE,
            DATA_TYPE,
            COLUMN_TYPE,
            COLUMN_KEY,
            EXTRA,
            COLUMN_COMMENT,
            COLLATION_NAME,
            CHARACTER_SET_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = '{clean_db}' AND TABLE_NAME = '{clean_tbl}'
        ORDER BY ORDINAL_POSITION ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut columns = Vec::new();

    for row in res.rows {
        let name = row
            .first()
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let ordinal_position = row
            .get(1)
            .and_then(value_to_i64)
            .map(|n| n as i32)
            .unwrap_or(0);
        let column_default = row.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());
        let is_nullable = row
            .get(3)
            .and_then(|v| v.as_str())
            .map(|s| s.eq_ignore_ascii_case("YES"))
            .unwrap_or(false);
        let data_type = row
            .get(4)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let column_type = row
            .get(5)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let column_key = row
            .get(6)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let extra = row
            .get(7)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let comment = row
            .get(8)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let collation = row.get(9).and_then(|v| v.as_str()).map(|s| s.to_string());
        let character_set = row.get(10).and_then(|v| v.as_str()).map(|s| s.to_string());

        if !name.is_empty() {
            columns.push(ColumnMetadata {
                name,
                ordinal_position,
                column_default,
                is_nullable,
                data_type,
                column_type,
                column_key,
                extra,
                comment,
                collation,
                character_set,
            });
        }
    }

    Ok(columns)
}

/// Retrieves the ordered list of primary key columns for a table.
/// Returns empty if table has no primary key.
async fn get_table_primary_key(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<PrimaryKey, PyroError> {
    let clean_db = database.replace('\'', "''");
    let clean_tbl = table.replace('\'', "''");

    let sql = format!(
        r#"
        SELECT COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = '{clean_db}' 
          AND TABLE_NAME = '{clean_tbl}' 
          AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut columns = Vec::new();
    for row in res.rows {
        if let Some(col) = row.first().and_then(|v| v.as_str()) {
            if !col.is_empty() {
                columns.push(col.to_string());
            }
        }
    }

    Ok(PrimaryKey { columns })
}

/// Retrieves a mapping of all table names to their column names in a database for autocompletion.
async fn get_database_completion_schema(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<HashMap<String, Vec<String>>, PyroError> {
    let clean_db = database.replace('\'', "''");
    let sql = format!(
        r#"
        SELECT TABLE_NAME, COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = '{clean_db}'
        ORDER BY TABLE_NAME ASC, ORDINAL_POSITION ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();

    for row in res.rows {
        if let (Some(tbl), Some(col)) = (
            row.first().and_then(|v| v.as_str()),
            row.get(1).and_then(|v| v.as_str()),
        ) {
            map.entry(tbl.to_string())
                .or_default()
                .push(col.to_string());
        }
    }

    Ok(map)
}

/// Lists all indexes for a specific table.
async fn list_indexes(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Vec<IndexMetadata>, PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };
    let table_ref = qualify_table(db_arg, table)?;
    let sql = format!("SHOW INDEX FROM {table_ref}");

    let qr = backend.execute_query(&sql, db_arg).await?;

    let col_idx = |name: &str| -> usize {
        qr.columns
            .iter()
            .position(|c| c.eq_ignore_ascii_case(name))
            .unwrap_or(999)
    };

    let mut map: std::collections::BTreeMap<String, IndexMetadata> =
        std::collections::BTreeMap::new();

    for row in &qr.rows {
        let get_str = |i: usize| -> String {
            row.get(i)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        let get_i64 = |i: usize| -> Option<i64> { row.get(i).and_then(value_to_i64) };
        let get_u64 = |i: usize| -> u64 { row.get(i).and_then(value_to_u64).unwrap_or(1) };

        let key_name = get_str(col_idx("Key_name"));
        let non_unique: i64 = row
            .get(col_idx("Non_unique"))
            .and_then(value_to_i64)
            .unwrap_or(1);
        let is_unique = non_unique == 0;
        let is_primary = key_name == "PRIMARY";
        let index_type = get_str(col_idx("Index_type"));
        let seq = get_u64(col_idx("Seq_in_index")) as u32;
        let comment_str = get_str(col_idx("Index_comment"));

        let col = IndexColumn {
            seq_in_index: seq,
            column_name: get_str(col_idx("Column_name")),
            sub_part: get_i64(col_idx("Sub_part")),
            collation: {
                let c = get_str(col_idx("Collation"));
                if c.is_empty() {
                    None
                } else {
                    Some(c)
                }
            },
        };

        let entry = map
            .entry(key_name.clone())
            .or_insert_with(|| IndexMetadata {
                key_name,
                is_primary,
                is_unique,
                index_type,
                columns: vec![],
                comment: None,
            });
        entry.columns.push(col);
        if entry.comment.is_none() && !comment_str.is_empty() {
            entry.comment = Some(comment_str);
        }
    }

    let mut result: Vec<IndexMetadata> = map.into_values().collect();
    result.sort_by(|a, b| {
        if a.is_primary {
            return std::cmp::Ordering::Less;
        }
        if b.is_primary {
            return std::cmp::Ordering::Greater;
        }
        a.key_name.cmp(&b.key_name)
    });
    for idx in &mut result {
        idx.columns.sort_by_key(|c| c.seq_in_index);
    }

    Ok(result)
}

/// Lists all triggers for a database or table.
async fn list_triggers(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: Option<&str>,
) -> Result<Vec<TriggerMetadata>, PyroError> {
    let clean_db = database.replace('\'', "''");

    let table_filter = if let Some(tbl) = table {
        if !tbl.is_empty() {
            format!("AND EVENT_OBJECT_TABLE = '{}'", tbl.replace('\'', "''"))
        } else {
            "".to_string()
        }
    } else {
        "".to_string()
    };

    let sql = format!(
        r#"
        SELECT 
            TRIGGER_NAME,
            EVENT_OBJECT_TABLE,
            ACTION_TIMING,
            EVENT_MANIPULATION,
            DEFINER,
            DATE_FORMAT(CREATED, '%Y-%m-%d %H:%i:%s') AS CREATED
        FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = '{clean_db}' {table_filter}
        ORDER BY EVENT_OBJECT_TABLE ASC, TRIGGER_NAME ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut triggers = Vec::new();

    for row in res.rows {
        let name = row
            .first()
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let table_name = row
            .get(1)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let timing = row
            .get(2)
            .and_then(|v| v.as_str())
            .unwrap_or("BEFORE")
            .to_string();
        let event = row
            .get(3)
            .and_then(|v| v.as_str())
            .unwrap_or("INSERT")
            .to_string();
        let definer = row.get(4).and_then(|v| v.as_str()).map(|s| s.to_string());
        let created = row.get(5).and_then(|v| v.as_str()).map(|s| s.to_string());

        if !name.is_empty() {
            triggers.push(TriggerMetadata {
                name,
                table_name,
                timing,
                event,
                definer,
                created,
            });
        }
    }

    Ok(triggers)
}

/// Retrieves the DDL and configuration details of a trigger.
async fn get_trigger_definition(
    backend: &dyn DatabaseBackend,
    database: &str,
    name: &str,
) -> Result<TriggerDetail, PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };
    let trigger_ref = qualify_table(db_arg, name)?;

    let show_sql = format!("SHOW CREATE TRIGGER {trigger_ref}");
    let res = backend.execute_query(&show_sql, db_arg).await?;

    let mut ddl = String::new();
    let mut table_name = String::new();
    let mut timing = "BEFORE".to_string();
    let mut event = "INSERT".to_string();

    if let Some(row) = res.rows.first() {
        if let Some(s) = row.get(2).and_then(|v| v.as_str()) {
            ddl = s.to_string();
        } else if let Some(s) = row.get(1).and_then(|v| v.as_str()) {
            ddl = s.to_string();
        }
    }

    let esc_db = database.replace('\'', "''");
    let esc_name = name.replace('\'', "''");
    let meta_sql = format!(
        "SELECT EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = '{esc_db}' AND TRIGGER_NAME = '{esc_name}'"
    );
    if let Ok(meta_res) = backend.execute_query(&meta_sql, db_arg).await {
        if let Some(r) = meta_res.rows.first() {
            if let Some(tbl) = r.first().and_then(|v| v.as_str()) {
                table_name = tbl.to_string();
            }
            if let Some(tim) = r.get(1).and_then(|v| v.as_str()) {
                timing = tim.to_string();
            }
            if let Some(ev) = r.get(2).and_then(|v| v.as_str()) {
                event = ev.to_string();
            }
        }
    }

    Ok(TriggerDetail {
        name: name.to_string(),
        table_name,
        timing,
        event,
        ddl,
    })
}

/// Helper to fetch foreign key metadata for all tables in a schema
async fn fetch_schema_foreign_keys(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<HashMap<String, Vec<ForeignKeyMetadata>>, PyroError> {
    let clean_db = database.replace('\'', "''");
    let sql = format!(
        r#"
        SELECT 
            kcu.TABLE_NAME,
            kcu.CONSTRAINT_NAME,
            kcu.COLUMN_NAME,
            kcu.REFERENCED_TABLE_NAME,
            kcu.REFERENCED_COLUMN_NAME,
            rc.UPDATE_RULE,
            rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
         AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
        WHERE kcu.TABLE_SCHEMA = '{clean_db}'
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME
        "#
    );

    let mut result: HashMap<String, Vec<ForeignKeyMetadata>> = HashMap::new();

    if let Ok(res) = backend.execute_query(&sql, Some(database)).await {
        for row in res.rows {
            let tbl = row
                .first()
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let name = row
                .get(1)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let col = row
                .get(2)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let ref_tbl = row
                .get(3)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let ref_col = row
                .get(4)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let upd_rule = row
                .get(5)
                .and_then(|v| v.as_str())
                .unwrap_or("RESTRICT")
                .to_string();
            let del_rule = row
                .get(6)
                .and_then(|v| v.as_str())
                .unwrap_or("RESTRICT")
                .to_string();

            if !tbl.is_empty() && !name.is_empty() {
                result.entry(tbl).or_default().push(ForeignKeyMetadata {
                    name,
                    column_name: col,
                    referenced_table: ref_tbl,
                    referenced_column: ref_col,
                    update_rule: upd_rule,
                    delete_rule: del_rule,
                });
            }
        }
    }

    Ok(result)
}
