use std::time::Instant;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow};
use sqlx::{Column, MySqlPool, Row, TypeInfo, ValueRef};

use super::models::{
    CellUpdateRequest, ColumnMetadata, ConnectionConfig, ConnectionStatus, CreateIndexRequest,
    DatabaseSchema, IndexColumn, IndexMetadata, QueryExecutionResult, RoutineDetail,
    RoutineMetadata, RoutineParam, ServerInfo, TableDataResult, TableMetadata, TriggerDetail,
    TriggerMetadata,
};
use super::state::{ActiveSession, DbState, SessionBackend};
use super::tunnel::TunnelClient;

pub fn build_connect_options(config: &ConnectionConfig) -> MySqlConnectOptions {
    let mut opts = MySqlConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .username(&config.user);

    if let Some(ref pwd) = config.password {
        if !pwd.is_empty() {
            opts = opts.password(pwd);
        }
    }

    if let Some(ref db) = config.database {
        if !db.trim().is_empty() {
            opts = opts.database(db.trim());
        }
    }

    opts
}

pub async fn test_connection(config: ConnectionConfig) -> Result<ServerInfo, String> {
    if let Some(ref tunnel_cfg) = config.tunnel {
        if tunnel_cfg.enabled && !tunnel_cfg.url.trim().is_empty() {
            let client = TunnelClient::new(config.clone(), tunnel_cfg.clone());
            return client.test_connection().await;
        }
    }

    let opts = build_connect_options(&config);
    let start = Instant::now();

    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect_with(opts)
        .await
        .map_err(|e| format!("Error conectando a MariaDB/MySQL: {e}"))?;

    let elapsed = start.elapsed().as_millis() as u64;

    let row = sqlx::query("SELECT VERSION() AS ver, USER() AS usr, DATABASE() AS cur_db")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Error obteniendo metadatos del servidor: {e}"))?;

    let version: String = row.try_get("ver").unwrap_or_else(|_| "Desconocido".into());
    let current_user: String = row.try_get("usr").unwrap_or_else(|_| config.user.clone());
    let current_database: Option<String> = row.try_get("cur_db").ok();

    pool.close().await;

    Ok(ServerInfo {
        version,
        current_user,
        current_database,
        ping_ms: elapsed,
    })
}

pub async fn connect(config: ConnectionConfig, state: &DbState) -> Result<ServerInfo, String> {
    if let Some(ref tunnel_cfg) = config.tunnel {
        if tunnel_cfg.enabled && !tunnel_cfg.url.trim().is_empty() {
            let client = TunnelClient::new(config.clone(), tunnel_cfg.clone());
            let server_info = client.test_connection().await?;

            let mut session_guard = state.session.write().await;
            if let Some(old_session) = session_guard.take() {
                if let SessionBackend::Direct(ref pool) = old_session.backend {
                    pool.close().await;
                }
            }

            *session_guard = Some(ActiveSession {
                backend: SessionBackend::Tunnel(client),
                config,
                server_info: server_info.clone(),
            });

            return Ok(server_info);
        }
    }

    let opts = build_connect_options(&config);
    let start = Instant::now();

    let pool = MySqlPoolOptions::new()
        .max_connections(10)
        .min_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(8))
        .connect_with(opts)
        .await
        .map_err(|e| format!("Error conectando a MariaDB: {e}"))?;

    let elapsed = start.elapsed().as_millis() as u64;

    let row = sqlx::query("SELECT VERSION() AS ver, USER() AS usr, DATABASE() AS cur_db")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Error consultando información del servidor: {e}"))?;

    let version: String = row.try_get("ver").unwrap_or_else(|_| "Desconocido".into());
    let current_user: String = row.try_get("usr").unwrap_or_else(|_| config.user.clone());
    let current_database: Option<String> = row.try_get("cur_db").ok();

    let server_info = ServerInfo {
        version,
        current_user,
        current_database,
        ping_ms: elapsed,
    };

    let mut session_guard = state.session.write().await;
    if let Some(old_session) = session_guard.take() {
        if let SessionBackend::Direct(ref p) = old_session.backend {
            p.close().await;
        }
    }

    *session_guard = Some(ActiveSession {
        backend: SessionBackend::Direct(pool),
        config,
        server_info: server_info.clone(),
    });

    Ok(server_info)
}

pub async fn disconnect(state: &DbState) -> Result<(), String> {
    let mut session_guard = state.session.write().await;
    if let Some(session) = session_guard.take() {
        if let SessionBackend::Direct(ref pool) = session.backend {
            pool.close().await;
        }
    }
    Ok(())
}

pub async fn get_connection_status(state: &DbState) -> Result<ConnectionStatus, String> {
    let session_guard = state.session.read().await;
    match &*session_guard {
        Some(session) => Ok(ConnectionStatus {
            is_connected: true,
            config: Some(session.config.clone()),
            server_info: Some(session.server_info.clone()),
        }),
        None => Ok(ConnectionStatus {
            is_connected: false,
            config: None,
            server_info: None,
        }),
    }
}

pub async fn get_session(state: &DbState) -> Result<ActiveSession, String> {
    let session_guard = state.session.read().await;
    match &*session_guard {
        Some(session) => Ok(session.clone()),
        None => Err("No hay una sesión activa de base de datos. Por favor conéctate primero.".into()),
    }
}

pub async fn get_pool(state: &DbState) -> Result<MySqlPool, String> {
    let session_guard = state.session.read().await;
    match &*session_guard {
        Some(session) => match &session.backend {
            SessionBackend::Direct(pool) => Ok(pool.clone()),
            SessionBackend::Tunnel(_) => Err("Operación directa de pool no soportada mediante Túnel HTTP".into()),
        },
        None => Err("No hay una sesión activa de base de datos. Por favor conéctate primero.".into()),
    }
}

// Convert MySqlRow values to JSON
pub fn row_to_json(row: &MySqlRow) -> Vec<serde_json::Value> {
    let mut row_values = Vec::new();
    let num_cols = row.columns().len();

    for i in 0..num_cols {
        let is_null = row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true);
        if is_null {
            row_values.push(serde_json::Value::Null);
            continue;
        }

        let type_name = row.columns()[i].type_info().name();

        let val = match type_name {
            "BOOLEAN" | "TINYINT(1)" => {
                if let Ok(b) = row.try_get::<bool, _>(i) {
                    serde_json::Value::Bool(b)
                } else if let Ok(n) = row.try_get::<i8, _>(i) {
                    serde_json::Value::Bool(n != 0)
                } else {
                    serde_json::Value::Null
                }
            }
            "TINYINT" => {
                if let Ok(n) = row.try_get::<i8, _>(i) {
                    serde_json::Value::Number(n.into())
                } else if let Ok(n) = row.try_get::<u8, _>(i) {
                    serde_json::Value::Number(n.into())
                } else {
                    serde_json::Value::Null
                }
            }
            "SMALLINT" => {
                if let Ok(n) = row.try_get::<i16, _>(i) {
                    serde_json::Value::Number(n.into())
                } else if let Ok(n) = row.try_get::<u16, _>(i) {
                    serde_json::Value::Number(n.into())
                } else {
                    serde_json::Value::Null
                }
            }
            "INT" | "MEDIUMINT" => {
                if let Ok(n) = row.try_get::<i32, _>(i) {
                    serde_json::Value::Number(n.into())
                } else if let Ok(n) = row.try_get::<u32, _>(i) {
                    serde_json::Value::Number(n.into())
                } else {
                    serde_json::Value::Null
                }
            }
            "BIGINT" => {
                if let Ok(n) = row.try_get::<i64, _>(i) {
                    serde_json::Value::Number(n.into())
                } else if let Ok(n) = row.try_get::<u64, _>(i) {
                    serde_json::Value::Number(n.into())
                } else {
                    serde_json::Value::Null
                }
            }
            "FLOAT" => {
                if let Ok(f) = row.try_get::<f32, _>(i) {
                    serde_json::Number::from_f64(f as f64)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null)
                } else {
                    serde_json::Value::Null
                }
            }
            "DOUBLE" => {
                if let Ok(f) = row.try_get::<f64, _>(i) {
                    serde_json::Number::from_f64(f)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null)
                } else {
                    serde_json::Value::Null
                }
            }
            "DECIMAL" => {
                if let Ok(d) = row.try_get::<sqlx::types::BigDecimal, _>(i) {
                    serde_json::Value::String(d.to_string())
                } else if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::Value::String(s)
                } else {
                    serde_json::Value::Null
                }
            }
            "DATETIME" | "TIMESTAMP" => {
                if let Ok(d) = row.try_get::<chrono::NaiveDateTime, _>(i) {
                    serde_json::Value::String(d.to_string())
                } else if let Ok(d) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) {
                    serde_json::Value::String(d.to_rfc3339())
                } else if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::Value::String(s)
                } else {
                    serde_json::Value::Null
                }
            }
            "DATE" => {
                if let Ok(d) = row.try_get::<chrono::NaiveDate, _>(i) {
                    serde_json::Value::String(d.to_string())
                } else if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::Value::String(s)
                } else {
                    serde_json::Value::Null
                }
            }
            "TIME" => {
                if let Ok(d) = row.try_get::<chrono::NaiveTime, _>(i) {
                    serde_json::Value::String(d.to_string())
                } else if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::Value::String(s)
                } else {
                    serde_json::Value::Null
                }
            }
            "JSON" => {
                if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::from_str(&s).unwrap_or(serde_json::Value::String(s))
                } else {
                    serde_json::Value::Null
                }
            }
            _ => {
                if let Ok(s) = row.try_get::<String, _>(i) {
                    serde_json::Value::String(s)
                } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(i) {
                    match String::from_utf8(bytes.clone()) {
                        Ok(valid_str) => serde_json::Value::String(valid_str),
                        Err(_) => {
                            let hex: String = bytes.iter().map(|b| format!("{b:02X}")).collect();
                            serde_json::Value::String(format!("0x{hex}"))
                        }
                    }
                } else {
                    serde_json::Value::Null
                }
            }
        };

        row_values.push(val);
    }

    row_values
}

// Executes a query on the active session (whether Direct SQLx or HTTP Tunnel)
pub async fn execute_query_session(
    session: &ActiveSession,
    sql: &str,
    database: Option<&str>,
) -> Result<QueryExecutionResult, String> {
    match &session.backend {
        SessionBackend::Tunnel(tunnel_client) => {
            tunnel_client.execute_query(sql, database).await
        }
        SessionBackend::Direct(pool) => {
            let start = Instant::now();

            if let Some(db) = database {
                if !db.trim().is_empty() {
                    let clean = db.replace('`', "``");
                    let _ = sqlx::query(&format!("USE `{clean}`")).execute(pool).await;
                }
            }

            let trimmed = sql.trim();
            let upper = trimmed.to_uppercase();
            if upper.starts_with("SELECT")
                || upper.starts_with("SHOW")
                || upper.starts_with("DESCRIBE")
                || upper.starts_with("EXPLAIN")
            {
                let rows = sqlx::query(sql)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| format!("Error en consulta SQL: {e}"))?;

                let elapsed = start.elapsed().as_millis() as u64;

                let columns = if let Some(first) = rows.first() {
                    first.columns().iter().map(|c| c.name().to_string()).collect()
                } else {
                    vec![]
                };

                let json_rows: Vec<Vec<serde_json::Value>> = rows.iter().map(row_to_json).collect();
                let count = json_rows.len() as u64;

                Ok(QueryExecutionResult {
                    columns,
                    rows: json_rows,
                    affected_rows: count,
                    execution_time_ms: elapsed,
                    message: format!("{count} fila(s) retornada(s) en {elapsed} ms"),
                })
            } else {
                let result = sqlx::query(sql)
                    .execute(pool)
                    .await
                    .map_err(|e| format!("Error de ejecución: {e}"))?;

                let elapsed = start.elapsed().as_millis() as u64;
                let affected = result.rows_affected();

                Ok(QueryExecutionResult {
                    columns: vec![],
                    rows: vec![],
                    affected_rows: affected,
                    execution_time_ms: elapsed,
                    message: format!(
                        "Sentencia ejecutada con éxito. {affected} fila(s) afectada(s) en {elapsed} ms"
                    ),
                })
            }
        }
    }
}

pub async fn list_databases(state: &DbState) -> Result<Vec<DatabaseSchema>, String> {
    let session = get_session(state).await?;
    let sql = r#"
        SELECT 
            s.SCHEMA_NAME,
            COUNT(t.TABLE_NAME) AS tables_count
        FROM information_schema.SCHEMATA s
        LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
        GROUP BY s.SCHEMA_NAME
        ORDER BY s.SCHEMA_NAME
    "#;

    let res = execute_query_session(&session, sql, None).await?;
    let mut schemas = Vec::new();

    let name_idx = res.columns.iter().position(|c| c.eq_ignore_ascii_case("SCHEMA_NAME")).unwrap_or(0);
    let count_idx = res.columns.iter().position(|c| c.eq_ignore_ascii_case("tables_count")).unwrap_or(1);

    for row in res.rows {
        let name = row.get(name_idx).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let tables_count = row.get(count_idx).and_then(|v| {
            if let Some(n) = v.as_i64() {
                Some(n)
            } else if let Some(s) = v.as_str() {
                s.parse::<i64>().ok()
            } else {
                None
            }
        }).unwrap_or(0);

        if !name.is_empty() {
            schemas.push(DatabaseSchema {
                name,
                tables_count: tables_count.max(0) as usize,
            });
        }
    }

    Ok(schemas)
}

pub async fn list_tables(database: String, state: &DbState) -> Result<Vec<TableMetadata>, String> {
    let session = get_session(state).await?;
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

    let res = execute_query_session(&session, &sql, Some(&database)).await?;
    let mut tables = Vec::new();

    for row in res.rows {
        let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let table_type = row.get(1).and_then(|v| v.as_str()).unwrap_or("BASE TABLE").to_string();
        let engine = row.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());
        let rows_count = row.get(3).and_then(|v| {
            if let Some(n) = v.as_i64() {
                Some(n)
            } else if let Some(s) = v.as_str() {
                s.parse::<i64>().ok()
            } else {
                None
            }
        });
        let data_length = row.get(4).and_then(|v| {
            if let Some(n) = v.as_i64() {
                Some(n)
            } else if let Some(s) = v.as_str() {
                s.parse::<i64>().ok()
            } else {
                None
            }
        });
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

pub async fn get_table_columns(
    database: String,
    table: String,
    state: &DbState,
) -> Result<Vec<ColumnMetadata>, String> {
    let session = get_session(state).await?;
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

    let res = execute_query_session(&session, &sql, Some(&database)).await?;
    let mut columns = Vec::new();

    for row in res.rows {
        let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let ordinal_position = row.get(1).and_then(|v| {
            if let Some(n) = v.as_i64() {
                Some(n as i32)
            } else if let Some(s) = v.as_str() {
                s.parse::<i32>().ok()
            } else {
                None
            }
        }).unwrap_or(0);
        let column_default = row.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());
        let is_nullable = row.get(3).and_then(|v| v.as_str()).map(|s| s.eq_ignore_ascii_case("YES")).unwrap_or(false);
        let data_type = row.get(4).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let column_type = row.get(5).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let column_key = row.get(6).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let extra = row.get(7).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let comment = row.get(8).and_then(|v| v.as_str()).unwrap_or_default().to_string();
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

pub async fn query_table_data(
    database: String,
    table: String,
    limit: u32,
    offset: u32,
    state: &DbState,
) -> Result<TableDataResult, String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('`', "``");
    let clean_tbl = table.replace('`', "``");

    let count_query = format!("SELECT COUNT(*) AS total FROM `{clean_db}`.`{clean_tbl}`");
    let total_rows = match execute_query_session(&session, &count_query, Some(&database)).await {
        Ok(res) => res.rows.first().and_then(|r| {
            r.first().and_then(|v| {
                if let Some(n) = v.as_i64() {
                    Some(n)
                } else if let Some(s) = v.as_str() {
                    s.parse::<i64>().ok()
                } else {
                    None
                }
            })
        }),
        Err(_) => None,
    };

    let query_str =
        format!("SELECT * FROM `{clean_db}`.`{clean_tbl}` LIMIT {limit} OFFSET {offset}");
    let query_res = execute_query_session(&session, &query_str, Some(&database)).await?;

    let column_types = query_res.columns.iter().map(|_| "VARCHAR".to_string()).collect();

    Ok(TableDataResult {
        columns: query_res.columns,
        column_types,
        rows: query_res.rows,
        total_rows,
        execution_time_ms: query_res.execution_time_ms,
        limit,
        offset,
    })
}

pub async fn update_cell(req: CellUpdateRequest, state: &DbState) -> Result<(), String> {
    let session = get_session(state).await?;

    let table_ref = if req.database.trim().is_empty() {
        format!("`{}`", req.table.replace('`', "``"))
    } else {
        format!("`{}`.`{}`", req.database.replace('`', "``"), req.table.replace('`', "``"))
    };
    let clean_col = req.column_name.replace('`', "``");
    let clean_pk = req.primary_key_column.replace('`', "``");

    let val_sql = match &req.new_value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::String(s) => {
            if s.eq_ignore_ascii_case("NULL") {
                "NULL".to_string()
            } else {
                format!("'{}'", s.replace('\'', "''"))
            }
        }
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => if *b { "1".to_string() } else { "0".to_string() },
        other => format!("'{}'", other.to_string().replace('\'', "''")),
    };

    let pk_sql = match &req.primary_key_value {
        serde_json::Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => if *b { "1".to_string() } else { "0".to_string() },
        other => format!("'{}'", other.to_string().replace('\'', "''")),
    };

    let query_str = format!(
        "UPDATE {table_ref} SET `{clean_col}` = {val_sql} WHERE `{clean_pk}` = {pk_sql}"
    );

    let db_arg = if req.database.trim().is_empty() { None } else { Some(req.database.as_str()) };
    execute_query_session(&session, &query_str, db_arg).await?;
    Ok(())
}

pub async fn execute_query(
    sql: String,
    database: Option<String>,
    state: &DbState,
) -> Result<QueryExecutionResult, String> {
    let session = get_session(state).await?;
    execute_query_session(&session, &sql, database.as_deref()).await
}

// ----------------------------------------------------------------------------
// ROUTINES & TRIGGERS METHODS
// ----------------------------------------------------------------------------

pub async fn list_routines(
    database: String,
    routine_type: Option<String>,
    state: &DbState,
) -> Result<Vec<RoutineMetadata>, String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('\'', "''");

    let type_filter = if let Some(ref t) = routine_type {
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

    let res = execute_query_session(&session, &sql, Some(&database)).await?;
    let mut routines = Vec::new();

    for row in res.rows {
        let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let r_type = row.get(1).and_then(|v| v.as_str()).unwrap_or("PROCEDURE").to_string();
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

pub async fn get_routine_definition(
    database: String,
    name: String,
    routine_type: String,
    state: &DbState,
) -> Result<RoutineDetail, String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('`', "``");
    let clean_name = name.replace('`', "``");

    let is_proc = routine_type.eq_ignore_ascii_case("PROCEDURE");
    let show_sql = if is_proc {
        format!("SHOW CREATE PROCEDURE `{clean_db}`.`{clean_name}`")
    } else {
        format!("SHOW CREATE FUNCTION `{clean_db}`.`{clean_name}`")
    };

    let show_res = execute_query_session(&session, &show_sql, Some(&database)).await?;
    let mut ddl = String::new();

    if let Some(first_row) = show_res.rows.first() {
        // Find column index containing "Create Procedure" or "Create Function" or index 2
        if let Some(val) = first_row.get(2).and_then(|v| v.as_str()) {
            ddl = val.to_string();
        } else if let Some(val) = first_row.get(1).and_then(|v| v.as_str()) {
            ddl = val.to_string();
        }
    }

    // Query parameters from information_schema.PARAMETERS
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

    let params_res = execute_query_session(&session, &params_sql, Some(&database)).await.unwrap_or_else(|_| QueryExecutionResult {
        columns: vec![],
        rows: vec![],
        affected_rows: 0,
        execution_time_ms: 0,
        message: "".into(),
    });

    let mut params = Vec::new();
    let mut return_type = None;

    for p_row in params_res.rows {
        let mode = p_row.get(0).and_then(|v| v.as_str()).unwrap_or("IN").to_string();
        let p_name = p_row.get(1).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let p_type = p_row.get(2).and_then(|v| v.as_str()).unwrap_or_default().to_string();

        if p_name.is_empty() {
            // Function return value
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
        name,
        routine_type,
        ddl,
        params,
        return_type,
        comment: None,
    })
}

pub async fn list_triggers(
    database: String,
    table: Option<String>,
    state: &DbState,
) -> Result<Vec<TriggerMetadata>, String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('\'', "''");

    let table_filter = if let Some(ref tbl) = table {
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

    let res = execute_query_session(&session, &sql, Some(&database)).await?;
    let mut triggers = Vec::new();

    for row in res.rows {
        let name = row.get(0).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let table_name = row.get(1).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let timing = row.get(2).and_then(|v| v.as_str()).unwrap_or("BEFORE").to_string();
        let event = row.get(3).and_then(|v| v.as_str()).unwrap_or("INSERT").to_string();
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

pub async fn get_trigger_definition(
    database: String,
    name: String,
    state: &DbState,
) -> Result<TriggerDetail, String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('`', "``");
    let clean_name = name.replace('`', "``");

    let show_sql = format!("SHOW CREATE TRIGGER `{clean_db}`.`{clean_name}`");
    let res = execute_query_session(&session, &show_sql, Some(&database)).await?;

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

    // Get trigger metadata
    let esc_db = database.replace('\'', "''");
    let esc_name = name.replace('\'', "''");
    let meta_sql = format!(
        "SELECT EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = '{esc_db}' AND TRIGGER_NAME = '{esc_name}'"
    );
    if let Ok(meta_res) = execute_query_session(&session, &meta_sql, Some(&database)).await {
        if let Some(r) = meta_res.rows.first() {
            if let Some(tbl) = r.get(0).and_then(|v| v.as_str()) {
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
        name,
        table_name,
        timing,
        event,
        ddl,
    })
}

pub async fn drop_routine(
    database: String,
    name: String,
    routine_type: String,
    state: &DbState,
) -> Result<(), String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('`', "``");
    let clean_name = name.replace('`', "``");
    let r_type = if routine_type.eq_ignore_ascii_case("FUNCTION") {
        "FUNCTION"
    } else {
        "PROCEDURE"
    };

    let sql = format!("DROP {r_type} IF EXISTS `{clean_db}`.`{clean_name}`");
    execute_query_session(&session, &sql, Some(&database)).await?;
    Ok(())
}

pub async fn drop_trigger(
    database: String,
    name: String,
    state: &DbState,
) -> Result<(), String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('`', "``");
    let clean_name = name.replace('`', "``");

    let sql = format!("DROP TRIGGER IF EXISTS `{clean_db}`.`{clean_name}`");
    execute_query_session(&session, &sql, Some(&database)).await?;
    Ok(())
}

pub async fn save_routine(
    database: String,
    old_name: Option<String>,
    routine_type: String,
    ddl: String,
    state: &DbState,
) -> Result<(), String> {
    let session = get_session(state).await?;

    if let Some(ref name) = old_name {
        if !name.trim().is_empty() {
            let clean_db = database.replace('`', "``");
            let clean_name = name.trim().replace('`', "``");
            let r_type = if routine_type.eq_ignore_ascii_case("FUNCTION") {
                "FUNCTION"
            } else {
                "PROCEDURE"
            };
            let drop_sql = format!("DROP {r_type} IF EXISTS `{clean_db}`.`{clean_name}`");
            execute_query_session(&session, &drop_sql, Some(&database)).await?;
        }
    }

    execute_query_session(&session, &ddl, Some(&database)).await?;
    Ok(())
}

pub async fn save_trigger(
    database: String,
    old_name: Option<String>,
    ddl: String,
    state: &DbState,
) -> Result<(), String> {
    let session = get_session(state).await?;

    if let Some(ref name) = old_name {
        if !name.trim().is_empty() {
            let clean_db = database.replace('`', "``");
            let clean_name = name.trim().replace('`', "``");
            let drop_sql = format!("DROP TRIGGER IF EXISTS `{clean_db}`.`{clean_name}`");
            execute_query_session(&session, &drop_sql, Some(&database)).await?;
        }
    }

    execute_query_session(&session, &ddl, Some(&database)).await?;
    Ok(())
}

pub async fn execute_routine(
    database: String,
    name: String,
    routine_type: String,
    params: Vec<serde_json::Value>,
    state: &DbState,
) -> Result<QueryExecutionResult, String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('`', "``");
    let clean_name = name.replace('`', "``");

    let formatted_args: Vec<String> = params
        .into_iter()
        .map(|v| match v {
            serde_json::Value::Null => "NULL".to_string(),
            serde_json::Value::String(s) => format!("'{}'", s.replace('\'', "''")),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::Bool(b) => if b { "1".to_string() } else { "0".to_string() },
            other => format!("'{}'", other.to_string().replace('\'', "''")),
        })
        .collect();

    let args_str = formatted_args.join(", ");

    let sql = if routine_type.eq_ignore_ascii_case("FUNCTION") {
        format!("SELECT `{clean_db}`.`{clean_name}`({args_str}) AS `Resultado`")
    } else {
        format!("CALL `{clean_db}`.`{clean_name}`({args_str})")
    };

    execute_query_session(&session, &sql, Some(&database)).await
}

pub async fn drop_table(
    database: String,
    table: String,
    state: &DbState,
) -> Result<(), String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('`', "``");
    let clean_tbl = table.replace('`', "``");
    let sql = format!("DROP TABLE `{clean_db}`.`{clean_tbl}`;");
    execute_query_session(&session, &sql, Some(&database)).await?;
    Ok(())
}

pub async fn truncate_table(
    database: String,
    table: String,
    state: &DbState,
) -> Result<(), String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('`', "``");
    let clean_tbl = table.replace('`', "``");
    let sql = format!("TRUNCATE TABLE `{clean_db}`.`{clean_tbl}`;");
    execute_query_session(&session, &sql, Some(&database)).await?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Index management
// ─────────────────────────────────────────────────────────────────────────────

/// Returns all indexes for a given table, grouped by key name.
/// Works with both Direct pool and HTTP Tunnel backends.
pub async fn list_indexes(
    database: String,
    table: String,
    state: &DbState,
) -> Result<Vec<IndexMetadata>, String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('`', "``");
    let clean_tbl = table.replace('`', "``");
    let sql = format!("SHOW INDEX FROM `{clean_db}`.`{clean_tbl}`");

    // Use execute_query_session — works transparently with Direct pool and HTTP Tunnel
    let qr = execute_query_session(&session, &sql, Some(&database)).await?;

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
                if c.is_empty() { None } else { Some(c) }
            },
        };

        let entry = map.entry(key_name.clone()).or_insert_with(|| IndexMetadata {
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

    // Sort PRIMARY first, then alphabetically by key name
    let mut result: Vec<IndexMetadata> = map.into_values().collect();
    result.sort_by(|a, b| {
        if a.is_primary { return std::cmp::Ordering::Less; }
        if b.is_primary { return std::cmp::Ordering::Greater; }
        a.key_name.cmp(&b.key_name)
    });
    for idx in &mut result {
        idx.columns.sort_by_key(|c| c.seq_in_index);
    }

    Ok(result)
}

/// Creates a new index on a table. Drops any existing non-PRIMARY index with the same name first.

pub async fn create_index(req: CreateIndexRequest, state: &DbState) -> Result<(), String> {
    let session = get_session(state).await?;
    let clean_db = req.database.replace('`', "``");
    let clean_tbl = req.table.replace('`', "``");
    let clean_name = req.index_name.replace('`', "``");

    if req.columns.is_empty() {
        return Err("Debes especificar al menos una columna para el índice.".into());
    }

    // Build column list
    let col_list: String = req
        .columns
        .iter()
        .map(|c| format!("`{}`", c.replace('`', "``")))
        .collect::<Vec<_>>()
        .join(", ");

    // Determine keyword
    let keyword = match req.index_type.to_uppercase().as_str() {
        "UNIQUE" => "UNIQUE INDEX",
        "FULLTEXT" => "FULLTEXT INDEX",
        "SPATIAL" => "SPATIAL INDEX",
        _ => "INDEX",
    };

    // Comment clause
    let comment_clause = if let Some(ref c) = req.comment {
        if !c.is_empty() {
            format!(" COMMENT '{}'", c.replace('\'', "\\'"))
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let sql = format!(
        "ALTER TABLE `{clean_db}`.`{clean_tbl}` ADD {keyword} `{clean_name}` ({col_list}){comment_clause};"
    );

    execute_query_session(&session, &sql, Some(&req.database)).await?;
    Ok(())
}

/// Drops an index from a table. PRIMARY KEY is dropped with DROP PRIMARY KEY.
pub async fn drop_index(
    database: String,
    table: String,
    index_name: String,
    state: &DbState,
) -> Result<(), String> {
    let session = get_session(state).await?;
    let clean_db = database.replace('`', "``");
    let clean_tbl = table.replace('`', "``");

    let sql = if index_name == "PRIMARY" {
        format!("ALTER TABLE `{clean_db}`.`{clean_tbl}` DROP PRIMARY KEY;")
    } else {
        let clean_idx = index_name.replace('`', "``");
        format!("ALTER TABLE `{clean_db}`.`{clean_tbl}` DROP INDEX `{clean_idx}`;")
    };

    execute_query_session(&session, &sql, Some(&database)).await?;
    Ok(())
}
