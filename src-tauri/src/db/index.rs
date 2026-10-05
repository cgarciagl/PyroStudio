use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{CreateIndexRequest, IndexColumn, IndexMetadata};
use super::sql_utils::{qualify_table, quote_identifier};

/// Lists all indexes for a specific table.
pub async fn list_indexes(
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
        let get_i64 = |i: usize| -> Option<i64> { row.get(i).and_then(|v| v.as_i64()) };
        let get_u64 = |i: usize| -> u64 { row.get(i).and_then(|v| v.as_u64()).unwrap_or(1) };

        let key_name = get_str(col_idx("Key_name"));
        let non_unique: i64 = row
            .get(col_idx("Non_unique"))
            .and_then(|v| v.as_i64())
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

/// Creates a new index on a table.
pub async fn create_index(
    backend: &dyn DatabaseBackend,
    req: CreateIndexRequest,
) -> Result<(), PyroError> {
    let db_arg = if req.database.trim().is_empty() {
        None
    } else {
        Some(req.database.as_str())
    };
    let table_ref = qualify_table(db_arg, &req.table)?;
    let clean_name = quote_identifier(&req.index_name)?;

    if req.columns.is_empty() {
        return Err(PyroError::InvalidOperation(
            "Debes especificar al menos una columna para el índice.".into(),
        ));
    }

    let mut col_parts = Vec::new();
    for c in &req.columns {
        col_parts.push(quote_identifier(c)?);
    }
    let col_list = col_parts.join(", ");

    let keyword = match req.index_type.to_uppercase().as_str() {
        "UNIQUE" => "UNIQUE INDEX",
        "FULLTEXT" => "FULLTEXT INDEX",
        "SPATIAL" => "SPATIAL INDEX",
        _ => "INDEX",
    };

    let comment_clause = if let Some(ref c) = req.comment {
        if !c.is_empty() {
            format!(" COMMENT '{}'", c.replace('\'', "''"))
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let sql =
        format!("ALTER TABLE {table_ref} ADD {keyword} {clean_name} ({col_list}){comment_clause};");

    backend.execute_query(&sql, db_arg).await?;
    Ok(())
}

/// Drops an index by name or PRIMARY key.
pub async fn drop_index(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
    index_name: &str,
) -> Result<(), PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };
    let table_ref = qualify_table(db_arg, table)?;

    let sql = if index_name == "PRIMARY" {
        format!("ALTER TABLE {table_ref} DROP PRIMARY KEY;")
    } else {
        let clean_idx = quote_identifier(index_name)?;
        format!("ALTER TABLE {table_ref} DROP INDEX {clean_idx};")
    };

    backend.execute_query(&sql, db_arg).await?;
    Ok(())
}
