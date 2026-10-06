use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{
    DatabaseDashboardInfo, DatabaseTablesOverview, HealthIssue, HealthReport, HealthReportSummary,
    HealthSeverity, PerformanceDigestEntry, RunningProcessEntry, ServerPerformanceSummary,
    ServerSlowQueriesReport, SlowLogEntry, TableDetailedStats, TableSizeSummary,
};
use std::collections::HashMap;

/// Helper to parse key-value pairs from `SHOW GLOBAL STATUS` or `SHOW GLOBAL VARIABLES`
async fn fetch_key_value_map(backend: &dyn DatabaseBackend, sql: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Ok(res) = backend.execute_query(sql, None).await {
        for row in res.rows {
            if row.len() >= 2 {
                let key = row[0].as_str().unwrap_or_default().to_uppercase();
                let val = match &row[1] {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::Bool(b) => b.to_string(),
                    _ => row[1].to_string(),
                };
                map.insert(key, val);
            }
        }
    }
    map
}

/// Gathers comprehensive database dashboard statistics.
pub async fn get_database_dashboard(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<DatabaseDashboardInfo, PyroError> {
    let clean_db = database.replace('\'', "''");

    // 1. Tables and Views metrics
    let tables_sql = format!(
        r#"
        SELECT 
            TABLE_NAME,
            TABLE_TYPE,
            ENGINE,
            COALESCE(TABLE_ROWS, 0) AS TABLE_ROWS,
            COALESCE(DATA_LENGTH, 0) AS DATA_LENGTH,
            COALESCE(INDEX_LENGTH, 0) AS INDEX_LENGTH
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '{clean_db}'
        ORDER BY (COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) DESC
        "#
    );

    let tables_res = backend.execute_query(&tables_sql, Some(database)).await?;
    let mut tables_count = 0;
    let mut views_count = 0;
    let mut total_data_bytes: i64 = 0;
    let mut total_index_bytes: i64 = 0;
    let mut estimated_total_rows: i64 = 0;
    let mut top_tables = Vec::new();

    for row in tables_res.rows {
        let name = row
            .get(0)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let table_type = row.get(1).and_then(|v| v.as_str()).unwrap_or("BASE TABLE");
        let rows_cnt = row
            .get(3)
            .and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
            })
            .unwrap_or(0);
        let data_len = row
            .get(4)
            .and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
            })
            .unwrap_or(0);
        let idx_len = row
            .get(5)
            .and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
            })
            .unwrap_or(0);

        if table_type == "VIEW" {
            views_count += 1;
        } else {
            tables_count += 1;
            total_data_bytes += data_len;
            total_index_bytes += idx_len;
            estimated_total_rows += rows_cnt;

            if top_tables.len() < 10 {
                top_tables.push(TableSizeSummary {
                    name,
                    rows_count: rows_cnt,
                    data_bytes: data_len,
                    index_bytes: idx_len,
                    total_bytes: data_len + idx_len,
                });
            }
        }
    }

    // 2. Routines count
    let routines_sql = format!(
        "SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = '{clean_db}'"
    );
    let routines_count = if let Ok(res) = backend.execute_query(&routines_sql, Some(database)).await
    {
        res.rows
            .first()
            .and_then(|r| r.first())
            .and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
            })
            .unwrap_or(0) as usize
    } else {
        0
    };

    // 3. Triggers count
    let triggers_sql = format!(
        "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = '{clean_db}'"
    );
    let triggers_count = if let Ok(res) = backend.execute_query(&triggers_sql, Some(database)).await
    {
        res.rows
            .first()
            .and_then(|r| r.first())
            .and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
            })
            .unwrap_or(0) as usize
    } else {
        0
    };

    // 4. Server Performance Summary
    let status_map = fetch_key_value_map(backend, "SHOW GLOBAL STATUS").await;
    let vars_map = fetch_key_value_map(backend, "SHOW GLOBAL VARIABLES").await;

    let server_summary = if !status_map.is_empty() || !vars_map.is_empty() {
        let uptime = status_map
            .get("UPTIME")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(1);
        let max_conn = vars_map
            .get("MAX_CONNECTIONS")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(151);
        let threads_conn = status_map
            .get("THREADS_CONNECTED")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(1);
        let threads_run = status_map
            .get("THREADS_RUNNING")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(1);
        let curr_conn = status_map
            .get("CONNECTIONS")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let queries_tot = status_map
            .get("QUERIES")
            .or_else(|| status_map.get("QUESTIONS"))
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let slow_q = status_map
            .get("SLOW_QUERIES")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let open_tbls = status_map
            .get("OPEN_TABLES")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let buf_bytes = vars_map
            .get("INNODB_BUFFER_POOL_SIZE")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        let read_reqs = status_map
            .get("INNODB_BUFFER_POOL_READ_REQUESTS")
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        let reads = status_map
            .get("INNODB_BUFFER_POOL_READS")
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        let hit_rate = if read_reqs > 0.0 {
            ((1.0 - (reads / read_reqs)) * 100.0).clamp(0.0, 100.0)
        } else {
            100.0
        };

        let qps = if uptime > 0 {
            (queries_tot as f64) / (uptime as f64)
        } else {
            0.0
        };

        let version = vars_map
            .get("VERSION")
            .cloned()
            .unwrap_or_else(|| "MariaDB/MySQL".to_string());

        Some(ServerPerformanceSummary {
            version,
            uptime_seconds: uptime,
            current_connections: curr_conn,
            max_connections: max_conn,
            threads_running: threads_run,
            threads_connected: threads_conn,
            innodb_buffer_pool_bytes: buf_bytes,
            innodb_buffer_pool_hit_rate: (hit_rate * 100.0).round() / 100.0,
            queries_total: queries_tot,
            slow_queries: slow_q,
            open_tables: open_tbls,
            qps: (qps * 100.0).round() / 100.0,
        })
    } else {
        None
    };

    Ok(DatabaseDashboardInfo {
        database_name: database.to_string(),
        tables_count,
        views_count,
        routines_count,
        triggers_count,
        total_data_bytes,
        total_index_bytes,
        estimated_total_rows,
        top_tables_by_size: top_tables,
        server_summary,
    })
}

/// Runs extensive health diagnostics on the database and instance.
pub async fn get_health_report(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<HealthReport, PyroError> {
    let clean_db = database.replace('\'', "''");
    let status_map = fetch_key_value_map(backend, "SHOW GLOBAL STATUS").await;
    let vars_map = fetch_key_value_map(backend, "SHOW GLOBAL VARIABLES").await;

    let mut issues = Vec::new();
    let uptime = status_map
        .get("UPTIME")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(1);
    let version = vars_map
        .get("VERSION")
        .cloned()
        .unwrap_or_else(|| "MariaDB/MySQL".to_string());

    // 1. Connections Health Check
    let max_conn = vars_map
        .get("MAX_CONNECTIONS")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(151);
    let threads_conn = status_map
        .get("THREADS_CONNECTED")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let threads_run = status_map
        .get("THREADS_RUNNING")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let conn_usage_pct = (threads_conn as f64 / max_conn as f64) * 100.0;

    if conn_usage_pct >= 90.0 {
        issues.push(HealthIssue {
            id: "conn-usage-critical".to_string(),
            category: "Connections".to_string(),
            severity: HealthSeverity::Critical,
            title: "Uso Crítico del Pool de Conexiones".to_string(),
            description: format!(
                "El servidor está utilizando {threads_conn} de {max_conn} conexiones permitidas ({conn_usage_pct:.1}%)."
            ),
            metric_name: Some("threads_connected / max_connections".to_string()),
            metric_value: Some(format!("{conn_usage_pct:.1}%")),
            threshold: Some(">= 90%".to_string()),
            suggestion: Some(
                "Aumentar 'max_connections' o verificar fugas de conexiones y consultas colgadas.".to_string(),
            ),
        });
    } else if conn_usage_pct >= 75.0 {
        issues.push(HealthIssue {
            id: "conn-usage-warning".to_string(),
            category: "Connections".to_string(),
            severity: HealthSeverity::Warning,
            title: "Elevado Uso de Conexiones".to_string(),
            description: format!(
                "Conexiones activas ({threads_conn}) representan el {conn_usage_pct:.1}% del límite ({max_conn})."
            ),
            metric_name: Some("threads_connected".to_string()),
            metric_value: Some(format!("{threads_conn}")),
            threshold: Some(">= 75%".to_string()),
            suggestion: Some("Supervisar el tamaño del pool de conexiones de la aplicación.".to_string()),
        });
    } else {
        issues.push(HealthIssue {
            id: "conn-usage-ok".to_string(),
            category: "Connections".to_string(),
            severity: HealthSeverity::Information,
            title: "Conexiones Saludables".to_string(),
            description: format!(
                "Conexiones activas: {threads_conn} de {max_conn} ({conn_usage_pct:.1}% de capacidad)."
            ),
            metric_name: Some("threads_connected".to_string()),
            metric_value: Some(format!("{threads_conn}")),
            threshold: Some("< 75%".to_string()),
            suggestion: None,
        });
    }

    if threads_run > 20 {
        issues.push(HealthIssue {
            id: "threads-running-high".to_string(),
            category: "Connections".to_string(),
            severity: HealthSeverity::Warning,
            title: "Hilos en Ejecución Simultánea Elevados".to_string(),
            description: format!(
                "Hay {threads_run} hilos ejecutando consultas concurrentemente en CPU."
            ),
            metric_name: Some("threads_running".to_string()),
            metric_value: Some(threads_run.to_string()),
            threshold: Some("> 20".to_string()),
            suggestion: Some(
                "Verificar contención en consultas lentas o bloqueos de tablas.".to_string(),
            ),
        });
    }

    // 2. Buffer Pool & Cache Health Check
    let read_reqs = status_map
        .get("INNODB_BUFFER_POOL_READ_REQUESTS")
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    let reads = status_map
        .get("INNODB_BUFFER_POOL_READS")
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    if read_reqs > 1000.0 {
        let hit_rate = ((1.0 - (reads / read_reqs)) * 100.0).clamp(0.0, 100.0);
        if hit_rate < 85.0 {
            issues.push(HealthIssue {
                id: "buffer-hit-rate-critical".to_string(),
                category: "MemoryBuffer".to_string(),
                severity: HealthSeverity::Critical,
                title: "Baja Tasa de Acierto en InnoDB Buffer Pool".to_string(),
                description: format!(
                    "La tasa de acierto en caché es de solo {hit_rate:.2}%. La base de datos está leyendo excesivamente desde disco."
                ),
                metric_name: Some("innodb_buffer_pool_hit_rate".to_string()),
                metric_value: Some(format!("{hit_rate:.2}%")),
                threshold: Some("< 85%".to_string()),
                suggestion: Some(
                    "Incrementar 'innodb_buffer_pool_size' para permitir que el conjunto de datos de trabajo resida en memoria RAM.".to_string(),
                ),
            });
        } else if hit_rate < 95.0 {
            issues.push(HealthIssue {
                id: "buffer-hit-rate-warning".to_string(),
                category: "MemoryBuffer".to_string(),
                severity: HealthSeverity::Warning,
                title: "Tasa de Acierto en Búfer Subóptima".to_string(),
                description: format!("La tasa de acierto en el Buffer Pool es de {hit_rate:.2}%."),
                metric_name: Some("innodb_buffer_pool_hit_rate".to_string()),
                metric_value: Some(format!("{hit_rate:.2}%")),
                threshold: Some("< 95%".to_string()),
                suggestion: Some(
                    "Revisar consultas que realizan escaneos completos de tablas grandes."
                        .to_string(),
                ),
            });
        } else {
            issues.push(HealthIssue {
                id: "buffer-hit-rate-ok".to_string(),
                category: "MemoryBuffer".to_string(),
                severity: HealthSeverity::Information,
                title: "Excelente Rendimiento de Memoria Caché".to_string(),
                description: format!("Tasa de acierto del Buffer Pool en {hit_rate:.2}% (servido directamente desde RAM)."),
                metric_name: Some("innodb_buffer_pool_hit_rate".to_string()),
                metric_value: Some(format!("{hit_rate:.2}%")),
                threshold: Some(">= 95%".to_string()),
                suggestion: None,
            });
        }
    }

    // 3. Tables & Storage Integrity Check
    // Check tables without Primary Key
    let no_pk_sql = format!(
        r#"
        SELECT t.TABLE_NAME
        FROM information_schema.TABLES t
        LEFT JOIN information_schema.TABLE_CONSTRAINTS tc 
            ON t.TABLE_SCHEMA = tc.TABLE_SCHEMA 
            AND t.TABLE_NAME = tc.TABLE_NAME 
            AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        WHERE t.TABLE_SCHEMA = '{clean_db}' 
            AND t.TABLE_TYPE = 'BASE TABLE' 
            AND tc.CONSTRAINT_NAME IS NULL
        "#
    );

    if let Ok(res) = backend.execute_query(&no_pk_sql, Some(database)).await {
        let tables_without_pk: Vec<String> = res
            .rows
            .iter()
            .filter_map(|r| r.first().and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect();
        if !tables_without_pk.is_empty() {
            let names = tables_without_pk.join(", ");
            issues.push(HealthIssue {
                id: "tables-no-pk".to_string(),
                category: "TablesStorage".to_string(),
                severity: HealthSeverity::Warning,
                title: format!("{} Tabla(s) sin Clave Primaria", tables_without_pk.len()),
                description: format!("Las siguientes tablas no tienen Primary Key definida: {names}."),
                metric_name: Some("tables_without_primary_key".to_string()),
                metric_value: Some(tables_without_pk.len().to_string()),
                threshold: Some("0".to_string()),
                suggestion: Some(
                    "Definir una clave primaria en cada tabla para garantizar integridad, optimizar búsquedas y permitir replicación eficiente.".to_string(),
                ),
            });
        }
    }

    // Check fragmented tables (DATA_FREE > 20% of DATA_LENGTH and DATA_FREE > 10MB)
    let frag_sql = format!(
        r#"
        SELECT TABLE_NAME, DATA_LENGTH, DATA_FREE
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '{clean_db}' 
            AND TABLE_TYPE = 'BASE TABLE'
            AND DATA_FREE > 10485760
            AND DATA_FREE > (DATA_LENGTH * 0.2)
        "#
    );
    if let Ok(res) = backend.execute_query(&frag_sql, Some(database)).await {
        let frag_tables: Vec<String> = res
            .rows
            .iter()
            .filter_map(|r| r.first().and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect();
        if !frag_tables.is_empty() {
            let names = frag_tables.join(", ");
            issues.push(HealthIssue {
                id: "tables-fragmented".to_string(),
                category: "TablesStorage".to_string(),
                severity: HealthSeverity::Warning,
                title: format!(
                    "{} Tabla(s) con Fragmentación de Espacio",
                    frag_tables.len()
                ),
                description: format!("Tablas con alto espacio libre no reclamado (>20%): {names}."),
                metric_name: Some("fragmented_tables_count".to_string()),
                metric_value: Some(frag_tables.len().to_string()),
                threshold: Some("0".to_string()),
                suggestion: Some(
                    "Ejecutar 'OPTIMIZE TABLE' para desfragmentar páginas de datos e índices."
                        .to_string(),
                ),
            });
        }
    }

    // 4. Temporary Tables on Disk vs RAM
    let tmp_disk = status_map
        .get("CREATED_TMP_DISK_TABLES")
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    let tmp_total = status_map
        .get("CREATED_TMP_TABLES")
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    if tmp_total > 50.0 {
        let disk_ratio = (tmp_disk / tmp_total) * 100.0;
        if disk_ratio > 30.0 {
            issues.push(HealthIssue {
                id: "tmp-tables-disk-high".to_string(),
                category: "SlowQueriesErrors".to_string(),
                severity: HealthSeverity::Warning,
                title: "Alto Porcentaje de Tablas Temporales en Disco".to_string(),
                description: format!(
                    "El {disk_ratio:.1}% de las tablas temporales ({tmp_disk:.0} de {tmp_total:.0}) se escribieron a disco por exceder 'tmp_table_size' o contener columnas BLOB/TEXT."
                ),
                metric_name: Some("tmp_disk_tables_ratio".to_string()),
                metric_value: Some(format!("{disk_ratio:.1}%")),
                threshold: Some("< 25%".to_string()),
                suggestion: Some(
                    "Incrementar 'tmp_table_size' y 'max_heap_table_size', u optimizar consultas que usen GROUP BY / DISTINCT sobre campos de texto largos.".to_string(),
                ),
            });
        }
    }

    // 5. Slow Queries Ratio
    let queries_tot = status_map
        .get("QUERIES")
        .or_else(|| status_map.get("QUESTIONS"))
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let slow_queries = status_map
        .get("SLOW_QUERIES")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    if queries_tot > 500 && slow_queries > 0 {
        let slow_ratio = (slow_queries as f64 / queries_tot as f64) * 100.0;
        if slow_ratio > 2.0 {
            issues.push(HealthIssue {
                id: "slow-queries-high".to_string(),
                category: "SlowQueriesErrors".to_string(),
                severity: HealthSeverity::Warning,
                title: "Proporción Elevada de Consultas Lentas".to_string(),
                description: format!(
                    "{slow_queries} consultas lentas registradas ({slow_ratio:.2}% del total de consultas)."
                ),
                metric_name: Some("slow_queries_ratio".to_string()),
                metric_value: Some(format!("{slow_ratio:.2}%")),
                threshold: Some("< 1.0%".to_string()),
                suggestion: Some(
                    "Utilizar el analizador de consultas lentas de PyroStudio para agregar los índices recomendados.".to_string(),
                ),
            });
        }
    }

    // 6. Locks and Contention
    let lock_waited = status_map
        .get("TABLE_LOCKS_WAITED")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let row_lock_waits = status_map
        .get("INNODB_ROW_LOCK_WAITS")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    if lock_waited > 50 || row_lock_waits > 100 {
        issues.push(HealthIssue {
            id: "locks-waited-warning".to_string(),
            category: "LocksContention".to_string(),
            severity: HealthSeverity::Warning,
            title: "Contención de Bloqueos Detectada".to_string(),
            description: format!(
                "Se han registrado {lock_waited} esperas de bloqueo de tabla y {row_lock_waits} esperas de bloqueo de fila InnoDB."
            ),
            metric_name: Some("innodb_row_lock_waits".to_string()),
            metric_value: Some(row_lock_waits.to_string()),
            threshold: Some("< 100".to_string()),
            suggestion: Some(
                "Revisar transacciones largas no confirmadas y optimizar índices para reducir el tiempo de retención de bloqueos.".to_string(),
            ),
        });
    }

    // General Uptime info
    let days = uptime / 86400;
    let hours = (uptime % 86400) / 3600;
    issues.push(HealthIssue {
        id: "server-uptime-info".to_string(),
        category: "General".to_string(),
        severity: HealthSeverity::Information,
        title: "Disponibilidad del Servidor (Uptime)".to_string(),
        description: format!(
            "El servidor ha estado operativo durante {days} día(s), {hours} hora(s)."
        ),
        metric_name: Some("uptime_seconds".to_string()),
        metric_value: Some(format!("{uptime}s")),
        threshold: None,
        suggestion: None,
    });

    let mut critical_count = 0;
    let mut warning_count = 0;
    let mut info_count = 0;

    for issue in &issues {
        match issue.severity {
            HealthSeverity::Critical => critical_count += 1,
            HealthSeverity::Warning => warning_count += 1,
            HealthSeverity::Information => info_count += 1,
        }
    }

    // Calculate score out of 100 (deduct 25 for critical, 8 for warning)
    let score =
        (100i32 - (critical_count as i32 * 25) - (warning_count as i32 * 8)).clamp(0, 100) as u32;

    Ok(HealthReport {
        database_name: database.to_string(),
        server_version: version,
        uptime_seconds: uptime,
        overall_score: score,
        issues,
        summary: HealthReportSummary {
            critical_count,
            warning_count,
            info_count,
        },
    })
}

/// Gathers server recorded slow queries, performance_schema statement digest, active slow processes, and slow query log status.
pub async fn get_server_slow_queries(
    backend: &dyn DatabaseBackend,
    database: Option<&str>,
) -> Result<ServerSlowQueriesReport, PyroError> {
    let slow_vars = fetch_key_value_map(
        backend,
        "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('slow_query_log', 'long_query_time', 'log_output', 'slow_query_log_file', 'log_queries_not_using_indexes')",
    )
    .await;

    let is_slow_log_enabled = slow_vars
        .get("SLOW_QUERY_LOG")
        .map(|v| v.eq_ignore_ascii_case("ON") || v == "1")
        .unwrap_or(false);

    let log_output = slow_vars
        .get("LOG_OUTPUT")
        .cloned()
        .unwrap_or_else(|| "FILE".to_string());

    let long_query_time = slow_vars
        .get("LONG_QUERY_TIME")
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(10.0);

    let slow_log_file = slow_vars.get("SLOW_QUERY_LOG_FILE").cloned();

    let log_queries_not_using_indexes = slow_vars
        .get("LOG_QUERIES_NOT_USING_INDEXES")
        .map(|v| v.eq_ignore_ascii_case("ON") || v == "1")
        .unwrap_or(false);

    // Global slow queries counter
    let status_map = fetch_key_value_map(backend, "SHOW GLOBAL STATUS LIKE 'Slow_queries'").await;
    let total_server_slow_queries_count = status_map
        .get("SLOW_QUERIES")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

    // 1. Try to fetch from mysql.slow_log if available
    let mut slow_log_entries = Vec::new();
    let slow_log_sql = if let Some(db) = database {
        let clean_db = db.replace('\'', "''");
        format!(
            r#"
            SELECT 
                COALESCE(DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s'), CAST(start_time AS CHAR)) as start_time_str,
                COALESCE(user_host, '') as user_host,
                TIME_TO_SEC(query_time) as query_sec,
                TIME_TO_SEC(lock_time) as lock_sec,
                COALESCE(rows_sent, 0) as rows_sent,
                COALESCE(rows_examined, 0) as rows_examined,
                COALESCE(db, '') as db_name,
                COALESCE(CONVERT(sql_text USING utf8mb4), CAST(sql_text AS CHAR)) as sql_text
            FROM mysql.slow_log
            WHERE db = '{clean_db}' OR db IS NULL OR db = ''
            ORDER BY start_time DESC
            LIMIT 100
            "#
        )
    } else {
        r#"
        SELECT 
            COALESCE(DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s'), CAST(start_time AS CHAR)) as start_time_str,
            COALESCE(user_host, '') as user_host,
            TIME_TO_SEC(query_time) as query_sec,
            TIME_TO_SEC(lock_time) as lock_sec,
            COALESCE(rows_sent, 0) as rows_sent,
            COALESCE(rows_examined, 0) as rows_examined,
            COALESCE(db, '') as db_name,
            COALESCE(CONVERT(sql_text USING utf8mb4), CAST(sql_text AS CHAR)) as sql_text
        FROM mysql.slow_log
        ORDER BY start_time DESC
        LIMIT 100
        "#
        .to_string()
    };

    if let Ok(res) = backend.execute_query(&slow_log_sql, None).await {
        for row in res.rows {
            if row.len() >= 8 {
                let start_time = row[0].as_str().unwrap_or_default().to_string();
                let user_host = row[1].as_str().unwrap_or_default().to_string();
                let query_time_seconds = row[2]
                    .as_f64()
                    .or_else(|| row[2].as_str().and_then(|s| s.parse::<f64>().ok()))
                    .unwrap_or(0.0);
                let lock_time_seconds = row[3]
                    .as_f64()
                    .or_else(|| row[3].as_str().and_then(|s| s.parse::<f64>().ok()))
                    .unwrap_or(0.0);
                let rows_sent = row[4]
                    .as_i64()
                    .or_else(|| row[4].as_str().and_then(|s| s.parse::<i64>().ok()))
                    .unwrap_or(0);
                let rows_examined = row[5]
                    .as_i64()
                    .or_else(|| row[5].as_str().and_then(|s| s.parse::<i64>().ok()))
                    .unwrap_or(0);
                let db_str = row[6].as_str().unwrap_or_default().to_string();
                let sql_text = row[7].as_str().unwrap_or_default().to_string();

                if !sql_text.trim().is_empty() {
                    slow_log_entries.push(SlowLogEntry {
                        start_time,
                        user_host,
                        query_time_seconds,
                        lock_time_seconds,
                        rows_sent,
                        rows_examined,
                        database: if db_str.is_empty() {
                            None
                        } else {
                            Some(db_str)
                        },
                        sql_text,
                    });
                }
            }
        }
    }

    // 2. Try to fetch from performance_schema.events_statements_summary_by_digest
    let mut performance_digest_entries = Vec::new();
    let digest_sql = if let Some(db) = database {
        let clean_db = db.replace('\'', "''");
        format!(
            r#"
            SELECT 
                SCHEMA_NAME,
                DIGEST_TEXT,
                COUNT_STAR,
                ROUND(SUM_TIMER_WAIT / 1000000000000, 4) AS sum_sec,
                ROUND(AVG_TIMER_WAIT / 1000000000000, 4) AS avg_sec,
                ROUND(MAX_TIMER_WAIT / 1000000000000, 4) AS max_sec,
                SUM_ROWS_EXAMINED,
                SUM_ROWS_SENT,
                SUM_NO_INDEX_USED,
                COALESCE(CAST(FIRST_SEEN AS CHAR), ''),
                COALESCE(CAST(LAST_SEEN AS CHAR), '')
            FROM performance_schema.events_statements_summary_by_digest
            WHERE DIGEST_TEXT IS NOT NULL 
              AND (SCHEMA_NAME = '{clean_db}' OR SCHEMA_NAME IS NULL)
              AND (SCHEMA_NAME NOT IN ('performance_schema', 'information_schema', 'mysql') OR SCHEMA_NAME IS NULL)
            ORDER BY SUM_TIMER_WAIT DESC
            LIMIT 100
            "#
        )
    } else {
        r#"
        SELECT 
            SCHEMA_NAME,
            DIGEST_TEXT,
            COUNT_STAR,
            ROUND(SUM_TIMER_WAIT / 1000000000000, 4) AS sum_sec,
            ROUND(AVG_TIMER_WAIT / 1000000000000, 4) AS avg_sec,
            ROUND(MAX_TIMER_WAIT / 1000000000000, 4) AS max_sec,
            SUM_ROWS_EXAMINED,
            SUM_ROWS_SENT,
            SUM_NO_INDEX_USED,
            COALESCE(CAST(FIRST_SEEN AS CHAR), ''),
            COALESCE(CAST(LAST_SEEN AS CHAR), '')
        FROM performance_schema.events_statements_summary_by_digest
        WHERE DIGEST_TEXT IS NOT NULL 
          AND (SCHEMA_NAME NOT IN ('performance_schema', 'information_schema', 'mysql') OR SCHEMA_NAME IS NULL)
        ORDER BY SUM_TIMER_WAIT DESC
        LIMIT 100
        "#
        .to_string()
    };

    if let Ok(res) = backend.execute_query(&digest_sql, None).await {
        for row in res.rows {
            if row.len() >= 11 {
                let schema_name = row[0].as_str().map(|s| s.to_string());
                let digest_text = row[1].as_str().unwrap_or_default().to_string();
                let exec_count = row[2]
                    .as_u64()
                    .or_else(|| row[2].as_str().and_then(|s| s.parse::<u64>().ok()))
                    .unwrap_or(0);
                let sum_timer_wait_sec = row[3]
                    .as_f64()
                    .or_else(|| row[3].as_str().and_then(|s| s.parse::<f64>().ok()))
                    .unwrap_or(0.0);
                let avg_timer_wait_sec = row[4]
                    .as_f64()
                    .or_else(|| row[4].as_str().and_then(|s| s.parse::<f64>().ok()))
                    .unwrap_or(0.0);
                let max_timer_wait_sec = row[5]
                    .as_f64()
                    .or_else(|| row[5].as_str().and_then(|s| s.parse::<f64>().ok()))
                    .unwrap_or(0.0);
                let sum_rows_examined = row[6]
                    .as_u64()
                    .or_else(|| row[6].as_str().and_then(|s| s.parse::<u64>().ok()))
                    .unwrap_or(0);
                let sum_rows_sent = row[7]
                    .as_u64()
                    .or_else(|| row[7].as_str().and_then(|s| s.parse::<u64>().ok()))
                    .unwrap_or(0);
                let sum_no_index_used = row[8]
                    .as_u64()
                    .or_else(|| row[8].as_str().and_then(|s| s.parse::<u64>().ok()))
                    .unwrap_or(0);
                let first_seen = row[9]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                let last_seen = row[10]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());

                if !digest_text.trim().is_empty() {
                    performance_digest_entries.push(PerformanceDigestEntry {
                        schema_name,
                        digest_text,
                        exec_count,
                        sum_timer_wait_sec,
                        avg_timer_wait_sec,
                        max_timer_wait_sec,
                        sum_rows_examined,
                        sum_rows_sent,
                        sum_no_index_used,
                        first_seen,
                        last_seen,
                    });
                }
            }
        }
    }

    // 3. Fetch currently active running queries
    let mut running_queries = Vec::new();
    let process_sql = r#"
        SELECT 
            ID,
            USER,
            HOST,
            COALESCE(DB, ''),
            COMMAND,
            COALESCE(TIME, 0),
            COALESCE(STATE, ''),
            COALESCE(INFO, '')
        FROM information_schema.PROCESSLIST
        WHERE COMMAND != 'Sleep' AND INFO IS NOT NULL AND INFO != ''
        ORDER BY TIME DESC
        LIMIT 50
    "#;

    if let Ok(res) = backend.execute_query(process_sql, None).await {
        for row in res.rows {
            if row.len() >= 8 {
                let id = row[0]
                    .as_u64()
                    .or_else(|| row[0].as_str().and_then(|s| s.parse::<u64>().ok()))
                    .unwrap_or(0);
                let user = row[1].as_str().unwrap_or_default().to_string();
                let host = row[2].as_str().unwrap_or_default().to_string();
                let db_str = row[3].as_str().unwrap_or_default().to_string();
                let command = row[4].as_str().unwrap_or_default().to_string();
                let time_seconds = row[5]
                    .as_u64()
                    .or_else(|| row[5].as_str().and_then(|s| s.parse::<u64>().ok()))
                    .unwrap_or(0);
                let state_str = row[6].as_str().unwrap_or_default().to_string();
                let info = row[7].as_str().unwrap_or_default().to_string();

                if !info.trim().is_empty() {
                    running_queries.push(RunningProcessEntry {
                        id,
                        user,
                        host,
                        db: if db_str.is_empty() {
                            None
                        } else {
                            Some(db_str)
                        },
                        command,
                        time_seconds,
                        state: if state_str.is_empty() {
                            None
                        } else {
                            Some(state_str)
                        },
                        info,
                    });
                }
            }
        }
    }

    Ok(ServerSlowQueriesReport {
        is_slow_log_enabled,
        log_output,
        long_query_time,
        slow_log_file,
        log_queries_not_using_indexes,
        slow_log_entries,
        performance_digest_entries,
        running_queries,
        total_server_slow_queries_count,
    })
}

/// Gathers full statistics for all tables in a specific database.
pub async fn get_database_tables_overview(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<DatabaseTablesOverview, PyroError> {
    let clean_db = database.replace('\'', "''");
    let sql = format!(
        r#"
        SELECT 
            TABLE_NAME,
            TABLE_TYPE,
            ENGINE,
            COALESCE(TABLE_ROWS, 0) AS TABLE_ROWS,
            COALESCE(DATA_LENGTH, 0) AS DATA_LENGTH,
            COALESCE(INDEX_LENGTH, 0) AS INDEX_LENGTH,
            COALESCE(DATA_FREE, 0) AS DATA_FREE,
            AUTO_INCREMENT,
            TABLE_COLLATION,
            COALESCE(CAST(CREATE_TIME AS CHAR), '') AS CREATE_TIME,
            COALESCE(CAST(UPDATE_TIME AS CHAR), '') AS UPDATE_TIME,
            COALESCE(TABLE_COMMENT, '') AS TABLE_COMMENT
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '{clean_db}'
        ORDER BY TABLE_NAME ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut tables = Vec::new();
    let mut tables_count = 0;
    let mut views_count = 0;
    let mut total_rows: i64 = 0;
    let mut total_data_bytes: i64 = 0;
    let mut total_index_bytes: i64 = 0;
    let mut total_free_bytes: i64 = 0;

    for row in res.rows {
        if row.len() >= 12 {
            let name = row[0].as_str().unwrap_or_default().to_string();
            let table_type = row[1].as_str().unwrap_or("BASE TABLE").to_string();
            let engine = row[2].as_str().map(|s| s.to_string());
            let rows_cnt = row[3]
                .as_i64()
                .or_else(|| row[3].as_str().and_then(|s| s.parse::<i64>().ok()))
                .unwrap_or(0);
            let data_len = row[4]
                .as_i64()
                .or_else(|| row[4].as_str().and_then(|s| s.parse::<i64>().ok()))
                .unwrap_or(0);
            let idx_len = row[5]
                .as_i64()
                .or_else(|| row[5].as_str().and_then(|s| s.parse::<i64>().ok()))
                .unwrap_or(0);
            let data_free = row[6]
                .as_i64()
                .or_else(|| row[6].as_str().and_then(|s| s.parse::<i64>().ok()))
                .unwrap_or(0);
            let auto_inc = row[7]
                .as_i64()
                .or_else(|| row[7].as_str().and_then(|s| s.parse::<i64>().ok()));
            let collation = row[8].as_str().map(|s| s.to_string());
            let create_time = row[9]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let update_time = row[10]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let comment = row[11]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());

            let total = data_len + idx_len;

            if table_type == "VIEW" {
                views_count += 1;
            } else {
                tables_count += 1;
                total_rows += rows_cnt;
                total_data_bytes += data_len;
                total_index_bytes += idx_len;
                total_free_bytes += data_free;
            }

            tables.push(TableDetailedStats {
                name,
                table_type,
                engine,
                rows_count: rows_cnt,
                data_bytes: data_len,
                index_bytes: idx_len,
                total_bytes: total,
                data_free_bytes: data_free,
                auto_increment: auto_inc,
                collation,
                create_time,
                update_time,
                comment,
            });
        }
    }

    Ok(DatabaseTablesOverview {
        database_name: database.to_string(),
        tables_count,
        views_count,
        total_rows,
        total_data_bytes,
        total_index_bytes,
        total_bytes: total_data_bytes + total_index_bytes,
        total_free_bytes,
        tables,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_severity_serialization() {
        let issue = HealthIssue {
            id: "test-1".to_string(),
            category: "General".to_string(),
            severity: HealthSeverity::Critical,
            title: "Test Critical".to_string(),
            description: "Test description".to_string(),
            metric_name: None,
            metric_value: None,
            threshold: None,
            suggestion: None,
        };
        let serialized = serde_json::to_string(&issue).unwrap();
        assert!(serialized.contains("Critical"));
    }
}
