use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{QueryExecutionResult, RoutineDetail, RoutineMetadata, RoutineParam};
use super::query::json_value_to_sql_literal;
use super::sql_utils::qualify_table;

/// Lists all stored procedures and functions in the specified database.
pub async fn list_routines(
    backend: &dyn DatabaseBackend,
    database: &str,
    routine_type: Option<&str>,
) -> Result<Vec<RoutineMetadata>, PyroError> {
    let clean_db = database.replace('\'', "''");

    let type_filter = if let Some(t) = routine_type {
        if !t.is_empty() {
            format!("AND ROUTINE_TYPE = '{}'", t.replace('\'', "''"))
        } else {
            "".to_string()
        }
    } else {
        "".to_string()
    };

    let sql = format!(
        r#"
        SELECT 
            ROUTINE_NAME,
            ROUTINE_TYPE,
            DTD_IDENTIFIER,
            DEFINER,
            DATE_FORMAT(CREATED, '%Y-%m-%d %H:%i:%s') AS CREATED,
            DATE_FORMAT(LAST_ALTERED, '%Y-%m-%d %H:%i:%s') AS LAST_ALTERED,
            SECURITY_TYPE,
            ROUTINE_COMMENT
        FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = '{clean_db}' {type_filter}
        ORDER BY ROUTINE_TYPE ASC, ROUTINE_NAME ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut routines = Vec::new();

    for row in res.rows {
        let name = row
            .get(0)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let r_type = row
            .get(1)
            .and_then(|v| v.as_str())
            .unwrap_or("PROCEDURE")
            .to_string();
        let data_type = row.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());
        let definer = row.get(3).and_then(|v| v.as_str()).map(|s| s.to_string());
        let created = row.get(4).and_then(|v| v.as_str()).map(|s| s.to_string());
        let last_altered = row.get(5).and_then(|v| v.as_str()).map(|s| s.to_string());
        let security_type = row.get(6).and_then(|v| v.as_str()).map(|s| s.to_string());
        let comment = row.get(7).and_then(|v| v.as_str()).map(|s| s.to_string());

        if !name.is_empty() {
            routines.push(RoutineMetadata {
                name,
                routine_type: r_type,
                data_type,
                definer,
                created,
                last_altered,
                security_type,
                comment,
            });
        }
    }

    Ok(routines)
}

/// Retrieves the DDL and parameter metadata for a stored procedure or function.
pub async fn get_routine_definition(
    backend: &dyn DatabaseBackend,
    database: &str,
    name: &str,
    routine_type: &str,
) -> Result<RoutineDetail, PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };
    let routine_ref = qualify_table(db_arg, name)?;

    let is_proc = routine_type.eq_ignore_ascii_case("PROCEDURE");
    let show_sql = if is_proc {
        format!("SHOW CREATE PROCEDURE {routine_ref}")
    } else {
        format!("SHOW CREATE FUNCTION {routine_ref}")
    };

    let show_res = backend.execute_query(&show_sql, db_arg).await?;
    let mut ddl = String::new();

    if let Some(first_row) = show_res.rows.first() {
        if let Some(val) = first_row.get(2).and_then(|v| v.as_str()) {
            ddl = val.to_string();
        } else if let Some(val) = first_row.get(1).and_then(|v| v.as_str()) {
            ddl = val.to_string();
        }
    }

    let esc_db = database.replace('\'', "''");
    let esc_name = name.replace('\'', "''");
    let esc_type = routine_type.replace('\'', "''");

    let params_sql = format!(
        r#"
        SELECT 
            PARAMETER_MODE,
            PARAMETER_NAME,
            DTD_IDENTIFIER
        FROM information_schema.PARAMETERS
        WHERE SPECIFIC_SCHEMA = '{esc_db}' AND SPECIFIC_NAME = '{esc_name}' AND ROUTINE_TYPE = '{esc_type}'
        ORDER BY ORDINAL_POSITION ASC
        "#
    );

    let params_res = backend
        .execute_query(&params_sql, db_arg)
        .await
        .unwrap_or_else(|_| QueryExecutionResult {
            columns: vec![],
            rows: vec![],
            affected_rows: 0,
            execution_time_ms: 0,
            message: "".into(),
        });

    let mut params = Vec::new();
    let mut return_type = None;

    for p_row in params_res.rows {
        let mode = p_row
            .get(0)
            .and_then(|v| v.as_str())
            .unwrap_or("IN")
            .to_string();
        let p_name = p_row
            .get(1)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let p_type = p_row
            .get(2)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        if p_name.is_empty() {
            return_type = Some(p_type);
        } else {
            params.push(RoutineParam {
                mode,
                name: p_name,
                data_type: p_type,
            });
        }
    }

    Ok(RoutineDetail {
        name: name.to_string(),
        routine_type: routine_type.to_string(),
        ddl,
        params,
        return_type,
        comment: None,
    })
}

/// Drops a stored procedure or function.
pub async fn drop_routine(
    backend: &dyn DatabaseBackend,
    database: &str,
    name: &str,
    routine_type: &str,
) -> Result<(), PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };
    let routine_ref = qualify_table(db_arg, name)?;
    let r_type = if routine_type.eq_ignore_ascii_case("FUNCTION") {
        "FUNCTION"
    } else {
        "PROCEDURE"
    };

    let sql = format!("DROP {r_type} IF EXISTS {routine_ref}");
    backend.execute_query(&sql, db_arg).await?;
    Ok(())
}

/// Saves a stored procedure or function, replacing the old routine if renamed.
pub async fn save_routine(
    backend: &dyn DatabaseBackend,
    database: &str,
    old_name: Option<&str>,
    routine_type: &str,
    ddl: &str,
) -> Result<(), PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };

    if let Some(name) = old_name {
        if !name.trim().is_empty() {
            let old_ref = qualify_table(db_arg, name.trim())?;
            let r_type = if routine_type.eq_ignore_ascii_case("FUNCTION") {
                "FUNCTION"
            } else {
                "PROCEDURE"
            };
            let drop_sql = format!("DROP {r_type} IF EXISTS {old_ref}");
            backend.execute_query(&drop_sql, db_arg).await?;
        }
    }

    backend.execute_query(ddl, db_arg).await?;
    Ok(())
}

/// Executes a stored procedure (CALL) or function (SELECT).
pub async fn execute_routine(
    backend: &dyn DatabaseBackend,
    database: &str,
    name: &str,
    routine_type: &str,
    params: &[serde_json::Value],
) -> Result<QueryExecutionResult, PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };
    let routine_ref = qualify_table(db_arg, name)?;

    let formatted_args: Vec<String> = params.iter().map(json_value_to_sql_literal).collect();
    let args_str = formatted_args.join(", ");

    let sql = if routine_type.eq_ignore_ascii_case("FUNCTION") {
        format!("SELECT {routine_ref}({args_str}) AS `Resultado`")
    } else {
        format!("CALL {routine_ref}({args_str})")
    };

    backend.execute_query(&sql, db_arg).await
}
