use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::DatabaseSchema;

/// Lists all databases and schemas with their approximate table counts.
pub async fn list_databases(
    backend: &dyn DatabaseBackend,
) -> Result<Vec<DatabaseSchema>, PyroError> {
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
        let tables_count = row
            .get(count_idx)
            .and_then(|v| {
                if let Some(n) = v.as_i64() {
                    Some(n)
                } else if let Some(s) = v.as_str() {
                    s.parse::<i64>().ok()
                } else {
                    None
                }
            })
            .unwrap_or(0);

        if !name.is_empty() {
            schemas.push(DatabaseSchema {
                name,
                tables_count: tables_count.max(0) as usize,
            });
        }
    }

    Ok(schemas)
}
