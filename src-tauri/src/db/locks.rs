use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use super::backend::DatabaseBackend;
use super::capabilities::{ServerEngineVariant, ServerVersionInfo};
use super::engine::DbEngine;
use super::error::PyroError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KillThreadMode {
    Query,
    Connection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockWaitEdge {
    pub waiting_thread_id: u64,
    pub blocking_thread_id: u64,
    pub waiting_trx_id: Option<String>,
    pub blocking_trx_id: Option<String>,
    pub lock_mode: Option<String>,
    pub lock_type: Option<String>,
    pub locked_table: Option<String>,
    pub locked_index: Option<String>,
    pub wait_duration_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveTransactionEntry {
    pub thread_id: u64,
    pub trx_id: Option<String>,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub process_state: Option<String>,
    pub trx_state: Option<String>,
    pub isolation_level: Option<String>,
    pub duration_seconds: u64,
    pub rows_locked: u64,
    pub rows_modified: u64,
    pub lock_structs: u64,
    pub lock_mode: Option<String>,
    pub lock_type: Option<String>,
    pub locked_table: Option<String>,
    pub locked_index: Option<String>,
    pub sql_text: String,
    pub blocking_thread_id: Option<u64>,
    pub waiting_count: usize,
    pub is_root_blocker: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockTreeNode {
    pub thread_id: u64,
    pub trx_id: Option<String>,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub trx_state: Option<String>,
    pub process_state: Option<String>,
    pub isolation_level: Option<String>,
    pub duration_seconds: u64,
    pub rows_locked: u64,
    pub rows_modified: u64,
    pub lock_mode: Option<String>,
    pub lock_type: Option<String>,
    pub locked_table: Option<String>,
    pub locked_index: Option<String>,
    pub sql_text: String,
    pub is_root_blocker: bool,
    pub blocking_thread_id: Option<u64>,
    /// Additional threads this one is also waiting on (it is shown under `blocking_thread_id` only).
    #[serde(default)]
    pub other_blocking_thread_ids: Vec<u64>,
    pub has_cycle: bool,
    pub children: Vec<LockTreeNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SqliteLockInfo {
    pub journal_mode: String,
    pub busy_timeout_ms: i64,
    pub locking_mode: String,
    pub wal_autocheckpoint: Option<i64>,
    pub write_lock_active: bool,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocksAndTransactionsReport {
    pub engine_label: String,
    pub detection_source: String,
    pub current_connection_id: Option<u64>,
    pub total_active_transactions: usize,
    pub total_blocked_threads: usize,
    pub root_blockers_count: usize,
    pub lock_tree: Vec<LockTreeNode>,
    pub transactions: Vec<ActiveTransactionEntry>,
    pub wait_edges: Vec<LockWaitEdge>,
    pub sqlite_info: Option<SqliteLockInfo>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ProcessRow {
    pub thread_id: u64,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub time_seconds: u64,
    pub state: Option<String>,
    pub info: String,
}

#[derive(Debug, Clone, Default)]
pub struct TrxRow {
    pub trx_id: String,
    pub trx_state: String,
    pub thread_id: u64,
    pub trx_query: String,
    pub duration_seconds: u64,
    pub rows_locked: u64,
    pub rows_modified: u64,
    pub lock_structs: u64,
    pub isolation_level: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockQueryStrategy {
    MySql8PerformanceSchema,
    LegacyInformationSchema,
    SqlitePragma,
}

pub fn select_lock_query_strategy(
    engine: DbEngine,
    version: &ServerVersionInfo,
) -> LockQueryStrategy {
    if engine == DbEngine::Sqlite || version.variant == ServerEngineVariant::Sqlite {
        return LockQueryStrategy::SqlitePragma;
    }
    if version.variant == ServerEngineVariant::MySql && version.is_at_least(8, 0, 0) {
        LockQueryStrategy::MySql8PerformanceSchema
    } else {
        LockQueryStrategy::LegacyInformationSchema
    }
}

pub fn build_kill_sql(thread_id: u64, mode: KillThreadMode) -> Result<String, PyroError> {
    if thread_id == 0 {
        return Err(PyroError::InvalidOperation(
            "El ID de hilo debe ser mayor que 0.".into(),
        ));
    }
    Ok(match mode {
        KillThreadMode::Query => format!("KILL QUERY {thread_id}"),
        KillThreadMode::Connection => format!("KILL {thread_id}"),
    })
}

fn value_to_u64(v: &serde_json::Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_i64().and_then(|n| u64::try_from(n).ok()))
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<u64>().ok()))
}

fn value_to_i64(v: &serde_json::Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_u64().and_then(|n| i64::try_from(n).ok()))
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
}

fn non_empty_string(v: &serde_json::Value) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub async fn get_active_locks_and_transactions(
    backend: &dyn DatabaseBackend,
) -> Result<LocksAndTransactionsReport, PyroError> {
    if backend.engine() == DbEngine::Sqlite {
        return inspect_sqlite_locks(backend).await;
    }

    let mut warnings = Vec::new();
    let mut version_raw = String::from("MySQL");
    let mut current_connection_id: Option<u64> = None;

    if let Ok(res) = backend
        .execute_query("SELECT VERSION(), CONNECTION_ID()", None)
        .await
    {
        if let Some(row) = res.rows.first() {
            if let Some(v) = row.first().and_then(non_empty_string) {
                version_raw = v;
            }
            current_connection_id = row.get(1).and_then(value_to_u64);
        }
    }

    let version = ServerVersionInfo::parse(&version_raw);
    let strategy = select_lock_query_strategy(backend.engine(), &version);

    // 1. Fetch processlist for thread metadata (user, host, db, SQL info)
    let mut processes: HashMap<u64, ProcessRow> = HashMap::new();
    let process_sql = r#"
        SELECT
            ID,
            COALESCE(USER, ''),
            COALESCE(HOST, ''),
            COALESCE(DB, ''),
            COALESCE(COMMAND, ''),
            COALESCE(TIME, 0),
            COALESCE(STATE, ''),
            COALESCE(INFO, '')
        FROM information_schema.PROCESSLIST
    "#;
    match backend.execute_query(process_sql, None).await {
        Ok(res) => {
            for row in res.rows {
                if let Some(id) = row.first().and_then(value_to_u64) {
                    processes.insert(
                        id,
                        ProcessRow {
                            thread_id: id,
                            user: row.get(1).and_then(non_empty_string).unwrap_or_default(),
                            host: row.get(2).and_then(non_empty_string).unwrap_or_default(),
                            db: row.get(3).and_then(non_empty_string),
                            command: row.get(4).and_then(non_empty_string).unwrap_or_default(),
                            time_seconds: row.get(5).and_then(value_to_u64).unwrap_or(0),
                            state: row.get(6).and_then(non_empty_string),
                            info: row.get(7).and_then(non_empty_string).unwrap_or_default(),
                        },
                    );
                }
            }
        }
        Err(err) => {
            warnings.push(format!(
                "No se pudo consultar information_schema.PROCESSLIST: {err}"
            ));
        }
    }

    // 2. Fetch active InnoDB transactions
    let mut trx_rows: Vec<TrxRow> = Vec::new();
    let trx_sql = r#"
        SELECT
            trx_id,
            COALESCE(trx_state, ''),
            trx_mysql_thread_id,
            COALESCE(trx_query, ''),
            GREATEST(0, COALESCE(TIMESTAMPDIFF(SECOND, trx_started, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', 'SYSTEM')), 0)),
            COALESCE(trx_rows_locked, 0),
            COALESCE(trx_rows_modified, 0),
            COALESCE(trx_lock_structs, 0),
            COALESCE(trx_isolation_level, '')
        FROM information_schema.innodb_trx
        ORDER BY trx_started ASC
    "#;
    match backend.execute_query(trx_sql, None).await {
        Ok(res) => {
            for row in res.rows {
                if let Some(thread_id) = row.get(2).and_then(value_to_u64) {
                    trx_rows.push(TrxRow {
                        trx_id: row.first().and_then(non_empty_string).unwrap_or_default(),
                        trx_state: row.get(1).and_then(non_empty_string).unwrap_or_default(),
                        thread_id,
                        trx_query: row.get(3).and_then(non_empty_string).unwrap_or_default(),
                        duration_seconds: row.get(4).and_then(value_to_u64).unwrap_or(0),
                        rows_locked: row.get(5).and_then(value_to_u64).unwrap_or(0),
                        rows_modified: row.get(6).and_then(value_to_u64).unwrap_or(0),
                        lock_structs: row.get(7).and_then(value_to_u64).unwrap_or(0),
                        isolation_level: row.get(8).and_then(non_empty_string),
                    });
                }
            }
        }
        Err(err) => {
            warnings.push(format!(
                "No se pudo consultar information_schema.innodb_trx (requiere privilegio PROCESS): {err}"
            ));
        }
    }

    // 3. Fetch lock wait edges adaptively by engine/version
    let (wait_edges, detection_source) = match strategy {
        LockQueryStrategy::MySql8PerformanceSchema => {
            let pfs_sql = r#"
                SELECT
                    r_trx.trx_mysql_thread_id AS waiting_thread_id,
                    b_trx.trx_mysql_thread_id AS blocking_thread_id,
                    CAST(w.REQUESTING_ENGINE_TRANSACTION_ID AS CHAR) AS waiting_trx_id,
                    CAST(w.BLOCKING_ENGINE_TRANSACTION_ID AS CHAR) AS blocking_trx_id,
                    COALESCE(rl.LOCK_MODE, ''),
                    COALESCE(rl.LOCK_TYPE, ''),
                    COALESCE(CONCAT(rl.OBJECT_SCHEMA, '.', rl.OBJECT_NAME), COALESCE(rl.OBJECT_NAME, '')),
                    COALESCE(rl.INDEX_NAME, ''),
                    GREATEST(0, COALESCE(TIMESTAMPDIFF(SECOND, r_trx.trx_wait_started, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', 'SYSTEM')), 0))
                FROM performance_schema.data_lock_waits w
                LEFT JOIN performance_schema.data_locks rl
                    ON w.REQUESTING_ENGINE_LOCK_ID = rl.ENGINE_LOCK_ID
                LEFT JOIN information_schema.innodb_trx r_trx
                    ON CAST(w.REQUESTING_ENGINE_TRANSACTION_ID AS CHAR) = CAST(r_trx.trx_id AS CHAR)
                LEFT JOIN information_schema.innodb_trx b_trx
                    ON CAST(w.BLOCKING_ENGINE_TRANSACTION_ID AS CHAR) = CAST(b_trx.trx_id AS CHAR)
            "#;
            match backend.execute_query(pfs_sql, None).await {
                Ok(res) => (
                    parse_wait_edges(&res.rows),
                    "performance_schema.data_lock_waits + innodb_trx".to_string(),
                ),
                Err(pfs_err) => {
                    warnings.push(format!(
                        "performance_schema.data_lock_waits no disponible ({pfs_err}); intentando sys.innodb_lock_waits."
                    ));
                    let sys_sql = r#"
                        SELECT
                            waiting_pid,
                            blocking_pid,
                            CAST(waiting_trx_id AS CHAR),
                            CAST(blocking_trx_id AS CHAR),
                            COALESCE(waiting_lock_mode, ''),
                            '',
                            COALESCE(locked_table, ''),
                            COALESCE(locked_index, ''),
                            GREATEST(0, COALESCE(TIMESTAMPDIFF(SECOND, wait_started, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', 'SYSTEM')), 0))
                        FROM sys.innodb_lock_waits
                    "#;
                    match backend.execute_query(sys_sql, None).await {
                        Ok(res) => (
                            parse_wait_edges(&res.rows),
                            "sys.innodb_lock_waits + innodb_trx".to_string(),
                        ),
                        Err(sys_err) => {
                            warnings
                                .push(format!("sys.innodb_lock_waits no disponible: {sys_err}"));
                            (Vec::new(), "information_schema.innodb_trx".to_string())
                        }
                    }
                }
            }
        }
        LockQueryStrategy::LegacyInformationSchema => {
            let legacy_sql = r#"
                SELECT
                    r_trx.trx_mysql_thread_id AS waiting_thread_id,
                    b_trx.trx_mysql_thread_id AS blocking_thread_id,
                    CAST(w.requesting_trx_id AS CHAR) AS waiting_trx_id,
                    CAST(w.blocking_trx_id AS CHAR) AS blocking_trx_id,
                    COALESCE(l.lock_mode, ''),
                    COALESCE(l.lock_type, ''),
                    COALESCE(l.lock_table, ''),
                    COALESCE(l.lock_index, ''),
                    GREATEST(0, COALESCE(TIMESTAMPDIFF(SECOND, r_trx.trx_wait_started, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', 'SYSTEM')), 0))
                FROM information_schema.innodb_lock_waits w
                LEFT JOIN information_schema.innodb_locks l
                    ON w.requested_lock_id = l.lock_id
                LEFT JOIN information_schema.innodb_trx r_trx
                    ON w.requesting_trx_id = r_trx.trx_id
                LEFT JOIN information_schema.innodb_trx b_trx
                    ON w.blocking_trx_id = b_trx.trx_id
            "#;
            match backend.execute_query(legacy_sql, None).await {
                Ok(res) => (
                    parse_wait_edges(&res.rows),
                    "information_schema.innodb_lock_waits + innodb_trx".to_string(),
                ),
                Err(err) => {
                    warnings.push(format!(
                        "innodb_lock_waits no disponible en este servidor ({err}); mostrando transacciones activas de innodb_trx."
                    ));
                    (Vec::new(), "information_schema.innodb_trx".to_string())
                }
            }
        }
        LockQueryStrategy::SqlitePragma => unreachable!("handled above"),
    };

    let (lock_tree, transactions, total_blocked_threads, root_blockers_count) =
        build_lock_graph(&trx_rows, &processes, &wait_edges);

    Ok(LocksAndTransactionsReport {
        engine_label: version.normalized_display,
        detection_source,
        current_connection_id,
        total_active_transactions: transactions.len(),
        total_blocked_threads,
        root_blockers_count,
        lock_tree,
        transactions,
        wait_edges,
        sqlite_info: None,
        warnings,
    })
}

fn parse_wait_edges(rows: &[Vec<serde_json::Value>]) -> Vec<LockWaitEdge> {
    let mut edges = Vec::new();
    let mut seen: HashSet<(u64, u64)> = HashSet::new();

    for row in rows {
        let Some(waiting_thread_id) = row.first().and_then(value_to_u64) else {
            continue;
        };
        let Some(blocking_thread_id) = row.get(1).and_then(value_to_u64) else {
            continue;
        };
        if waiting_thread_id == 0
            || blocking_thread_id == 0
            || waiting_thread_id == blocking_thread_id
        {
            continue;
        }
        if !seen.insert((waiting_thread_id, blocking_thread_id)) {
            continue;
        }
        edges.push(LockWaitEdge {
            waiting_thread_id,
            blocking_thread_id,
            waiting_trx_id: row.get(2).and_then(non_empty_string),
            blocking_trx_id: row.get(3).and_then(non_empty_string),
            lock_mode: row.get(4).and_then(non_empty_string),
            lock_type: row.get(5).and_then(non_empty_string),
            locked_table: row.get(6).and_then(non_empty_string),
            locked_index: row.get(7).and_then(non_empty_string),
            wait_duration_seconds: row.get(8).and_then(value_to_u64).unwrap_or(0),
        });
    }

    edges
}

/// Pure graph builder that maps active transactions, process metadata, and wait edges
/// into a cycle-safe forest of root blockers and waiting victims.
pub fn build_lock_graph(
    trx_rows: &[TrxRow],
    processes: &HashMap<u64, ProcessRow>,
    wait_edges: &[LockWaitEdge],
) -> (Vec<LockTreeNode>, Vec<ActiveTransactionEntry>, usize, usize) {
    let mut trx_by_thread: BTreeMap<u64, &TrxRow> = BTreeMap::new();
    for trx in trx_rows {
        trx_by_thread.entry(trx.thread_id).or_insert(trx);
    }

    let mut all_threads: BTreeSet<u64> = BTreeSet::new();
    for trx in trx_rows {
        all_threads.insert(trx.thread_id);
    }
    for edge in wait_edges {
        all_threads.insert(edge.waiting_thread_id);
        all_threads.insert(edge.blocking_thread_id);
    }

    // All blockers of each waiting thread, and all waiters of each blocker.
    let mut edges_by_waiter: HashMap<u64, Vec<&LockWaitEdge>> = HashMap::new();
    let mut blockers_to_waiters: HashMap<u64, Vec<u64>> = HashMap::new();
    for edge in wait_edges {
        if edge.waiting_thread_id == edge.blocking_thread_id {
            continue;
        }
        edges_by_waiter
            .entry(edge.waiting_thread_id)
            .or_default()
            .push(edge);
        blockers_to_waiters
            .entry(edge.blocking_thread_id)
            .or_default()
            .push(edge.waiting_thread_id);
    }
    for waiters in blockers_to_waiters.values_mut() {
        waiters.sort_unstable();
        waiters.dedup();
    }

    // A thread can wait on several blockers at once (e.g. queued behind another waiter on the
    // same row). It must appear only once in the tree, under a single *primary* blocker:
    // prefer a blocker that is itself waiting (keeps the chain A -> B -> C instead of a fan),
    // then the lowest thread id for stable output. The rest are reported as secondary blockers.
    let mut blocked_by: HashMap<u64, &LockWaitEdge> = HashMap::new();
    let mut other_blockers: HashMap<u64, Vec<u64>> = HashMap::new();
    for (waiter, edges) in &edges_by_waiter {
        let primary = edges
            .iter()
            .min_by_key(|e| {
                (
                    !edges_by_waiter.contains_key(&e.blocking_thread_id),
                    e.blocking_thread_id,
                )
            })
            .copied()
            .expect("edges_by_waiter entries are never empty");
        blocked_by.insert(*waiter, primary);
        let mut others: Vec<u64> = edges
            .iter()
            .map(|e| e.blocking_thread_id)
            .filter(|b| *b != primary.blocking_thread_id)
            .collect();
        others.sort_unstable();
        others.dedup();
        other_blockers.insert(*waiter, others);
    }

    // Tree edges: blocker -> waiters for which it is the primary blocker.
    let mut tree_children: HashMap<u64, Vec<u64>> = HashMap::new();
    for (waiter, edge) in &blocked_by {
        tree_children
            .entry(edge.blocking_thread_id)
            .or_default()
            .push(*waiter);
    }
    for waiters in tree_children.values_mut() {
        waiters.sort_unstable();
    }

    // Identify root blockers: threads that block at least one waiter and are not themselves blocked.
    // If a pure cycle exists where every blocker in the component is also blocked, pick the lowest thread_id
    // in that component as a synthetic root so the cycle is still visible and never loops infinitely.
    let mut root_blockers: Vec<u64> = tree_children
        .keys()
        .copied()
        .filter(|tid| !blocked_by.contains_key(tid))
        .collect();
    root_blockers.sort_unstable();

    let mut covered: HashSet<u64> = HashSet::new();
    let mut lock_tree: Vec<LockTreeNode> = Vec::new();

    for root_id in &root_blockers {
        let mut path = HashSet::new();
        let node = build_node_recursive(
            *root_id,
            true,
            &trx_by_thread,
            processes,
            &blocked_by,
            &tree_children,
            &other_blockers,
            &mut path,
            &mut covered,
        );
        lock_tree.push(node);
    }

    // Handle any remaining cycle components not reachable from an unblocked root
    let mut remaining_blockers: Vec<u64> = tree_children
        .keys()
        .copied()
        .filter(|tid| !covered.contains(tid))
        .collect();
    remaining_blockers.sort_unstable();
    for tid in remaining_blockers {
        if covered.contains(&tid) {
            continue;
        }
        let mut path = HashSet::new();
        let node = build_node_recursive(
            tid,
            true,
            &trx_by_thread,
            processes,
            &blocked_by,
            &tree_children,
            &other_blockers,
            &mut path,
            &mut covered,
        );
        lock_tree.push(node);
    }

    // Sort root blockers: most waiting descendants first, then longest duration
    lock_tree.sort_by(|a, b| {
        count_descendants(b)
            .cmp(&count_descendants(a))
            .then_with(|| b.duration_seconds.cmp(&a.duration_seconds))
            .then_with(|| a.thread_id.cmp(&b.thread_id))
    });

    let root_set: HashSet<u64> = lock_tree.iter().map(|n| n.thread_id).collect();
    let total_blocked_threads = blocked_by.len();
    let root_blockers_count = lock_tree.len();

    let mut transactions: Vec<ActiveTransactionEntry> = all_threads
        .into_iter()
        .map(|tid| {
            let trx = trx_by_thread.get(&tid).copied();
            let proc_row = processes.get(&tid);
            let wait_edge = blocked_by.get(&tid).copied();
            let waiting_count = blockers_to_waiters.get(&tid).map_or(0, Vec::len);

            let sql_text = trx
                .map(|t| t.trx_query.clone())
                .filter(|s| !s.is_empty())
                .or_else(|| proc_row.map(|p| p.info.clone()).filter(|s| !s.is_empty()))
                .unwrap_or_default();

            let duration_seconds = trx
                .map(|t| t.duration_seconds)
                .filter(|&d| d > 0)
                .or_else(|| proc_row.map(|p| p.time_seconds))
                .unwrap_or(0);

            ActiveTransactionEntry {
                thread_id: tid,
                trx_id: trx
                    .map(|t| t.trx_id.clone())
                    .or_else(|| wait_edge.and_then(|e| e.waiting_trx_id.clone())),
                user: proc_row
                    .map(|p| p.user.clone())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "desconocido".to_string()),
                host: proc_row.map(|p| p.host.clone()).unwrap_or_default(),
                db: proc_row.and_then(|p| p.db.clone()),
                command: proc_row
                    .map(|p| p.command.clone())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "Query".to_string()),
                process_state: proc_row.and_then(|p| p.state.clone()),
                trx_state: trx.map(|t| t.trx_state.clone()).filter(|s| !s.is_empty()),
                isolation_level: trx.and_then(|t| t.isolation_level.clone()),
                duration_seconds,
                rows_locked: trx.map_or(0, |t| t.rows_locked),
                rows_modified: trx.map_or(0, |t| t.rows_modified),
                lock_structs: trx.map_or(0, |t| t.lock_structs),
                lock_mode: wait_edge.and_then(|e| e.lock_mode.clone()),
                lock_type: wait_edge.and_then(|e| e.lock_type.clone()),
                locked_table: wait_edge.and_then(|e| e.locked_table.clone()),
                locked_index: wait_edge.and_then(|e| e.locked_index.clone()),
                sql_text,
                blocking_thread_id: wait_edge.map(|e| e.blocking_thread_id),
                waiting_count,
                is_root_blocker: root_set.contains(&tid),
            }
        })
        .collect();

    transactions.sort_by(|a, b| {
        b.duration_seconds
            .cmp(&a.duration_seconds)
            .then_with(|| b.waiting_count.cmp(&a.waiting_count))
            .then_with(|| a.thread_id.cmp(&b.thread_id))
    });

    (
        lock_tree,
        transactions,
        total_blocked_threads,
        root_blockers_count,
    )
}

#[allow(clippy::too_many_arguments)]
fn build_node_recursive(
    thread_id: u64,
    is_root_blocker: bool,
    trx_by_thread: &BTreeMap<u64, &TrxRow>,
    processes: &HashMap<u64, ProcessRow>,
    blocked_by: &HashMap<u64, &LockWaitEdge>,
    tree_children: &HashMap<u64, Vec<u64>>,
    other_blockers: &HashMap<u64, Vec<u64>>,
    path_visited: &mut HashSet<u64>,
    covered: &mut HashSet<u64>,
) -> LockTreeNode {
    covered.insert(thread_id);
    path_visited.insert(thread_id);

    let trx = trx_by_thread.get(&thread_id).copied();
    let proc_row = processes.get(&thread_id);
    let wait_edge = blocked_by.get(&thread_id).copied();

    let sql_text = trx
        .map(|t| t.trx_query.clone())
        .filter(|s| !s.is_empty())
        .or_else(|| proc_row.map(|p| p.info.clone()).filter(|s| !s.is_empty()))
        .unwrap_or_default();

    let duration_seconds = trx
        .map(|t| t.duration_seconds)
        .filter(|&d| d > 0)
        .or_else(|| proc_row.map(|p| p.time_seconds))
        .unwrap_or(0);

    let mut has_cycle = false;
    let mut children = Vec::new();
    if let Some(waiters) = tree_children.get(&thread_id) {
        for &child_id in waiters {
            if path_visited.contains(&child_id) {
                has_cycle = true;
                continue;
            }
            let child_node = build_node_recursive(
                child_id,
                false,
                trx_by_thread,
                processes,
                blocked_by,
                tree_children,
                other_blockers,
                path_visited,
                covered,
            );
            children.push(child_node);
        }
    }

    path_visited.remove(&thread_id);

    LockTreeNode {
        thread_id,
        trx_id: trx
            .map(|t| t.trx_id.clone())
            .or_else(|| wait_edge.and_then(|e| e.waiting_trx_id.clone())),
        user: proc_row
            .map(|p| p.user.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "desconocido".to_string()),
        host: proc_row.map(|p| p.host.clone()).unwrap_or_default(),
        db: proc_row.and_then(|p| p.db.clone()),
        trx_state: trx.map(|t| t.trx_state.clone()).filter(|s| !s.is_empty()),
        process_state: proc_row.and_then(|p| p.state.clone()),
        isolation_level: trx.and_then(|t| t.isolation_level.clone()),
        duration_seconds,
        rows_locked: trx.map_or(0, |t| t.rows_locked),
        rows_modified: trx.map_or(0, |t| t.rows_modified),
        lock_mode: wait_edge.and_then(|e| e.lock_mode.clone()),
        lock_type: wait_edge.and_then(|e| e.lock_type.clone()),
        locked_table: wait_edge.and_then(|e| e.locked_table.clone()),
        locked_index: wait_edge.and_then(|e| e.locked_index.clone()),
        sql_text,
        is_root_blocker,
        blocking_thread_id: wait_edge.map(|e| e.blocking_thread_id),
        other_blocking_thread_ids: other_blockers.get(&thread_id).cloned().unwrap_or_default(),
        has_cycle,
        children,
    }
}

fn count_descendants(node: &LockTreeNode) -> usize {
    node.children.iter().map(|c| 1 + count_descendants(c)).sum()
}

async fn inspect_sqlite_locks(
    backend: &dyn DatabaseBackend,
) -> Result<LocksAndTransactionsReport, PyroError> {
    let journal_mode = query_single_string(backend, "PRAGMA journal_mode;")
        .await
        .unwrap_or_else(|| "unknown".into());
    let busy_timeout_ms = query_single_i64(backend, "PRAGMA busy_timeout;")
        .await
        .unwrap_or(0);
    let locking_mode = query_single_string(backend, "PRAGMA locking_mode;")
        .await
        .unwrap_or_else(|| "NORMAL".into());
    let wal_autocheckpoint = query_single_i64(backend, "PRAGMA wal_autocheckpoint;").await;

    // Non-destructive write-lock probe on a single connection: if BEGIN IMMEDIATE fails with BUSY/locked,
    // another connection holds a write lock.
    let write_lock_active = match backend
        .execute_batch(&["BEGIN IMMEDIATE;", "ROLLBACK;"], None)
        .await
    {
        Ok(_) => false,
        Err(err) => {
            let msg = err.to_string().to_ascii_lowercase();
            msg.contains("locked") || msg.contains("busy")
        }
    };

    let note = if write_lock_active {
        "Se detectó un bloqueo de escritura activo en el archivo SQLite por otro proceso o conexión."
            .to_string()
    } else if journal_mode.eq_ignore_ascii_case("wal") {
        "SQLite opera en modo WAL: las lecturas concurrentes no bloquean escrituras.".to_string()
    } else {
        "SQLite usa bloqueo a nivel de archivo; considera habilitar PRAGMA journal_mode = WAL para mejor concurrencia."
            .to_string()
    };

    Ok(LocksAndTransactionsReport {
        engine_label: "SQLite".to_string(),
        detection_source: "PRAGMA journal_mode / busy_timeout / locking_mode".to_string(),
        current_connection_id: None,
        total_active_transactions: usize::from(write_lock_active),
        total_blocked_threads: 0,
        root_blockers_count: usize::from(write_lock_active),
        lock_tree: Vec::new(),
        transactions: Vec::new(),
        wait_edges: Vec::new(),
        sqlite_info: Some(SqliteLockInfo {
            journal_mode,
            busy_timeout_ms,
            locking_mode,
            wal_autocheckpoint,
            write_lock_active,
            note,
        }),
        warnings: Vec::new(),
    })
}

async fn query_single_string(backend: &dyn DatabaseBackend, sql: &str) -> Option<String> {
    let res = backend.execute_query(sql, None).await.ok()?;
    res.rows.first()?.first().and_then(non_empty_string)
}

async fn query_single_i64(backend: &dyn DatabaseBackend, sql: &str) -> Option<i64> {
    let res = backend.execute_query(sql, None).await.ok()?;
    res.rows.first()?.first().and_then(value_to_i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_strategy_by_engine_and_version() {
        let mysql8 = ServerVersionInfo::parse("8.0.36");
        assert_eq!(
            select_lock_query_strategy(DbEngine::MySql, &mysql8),
            LockQueryStrategy::MySql8PerformanceSchema
        );

        let mysql57 = ServerVersionInfo::parse("5.7.44");
        assert_eq!(
            select_lock_query_strategy(DbEngine::MySql, &mysql57),
            LockQueryStrategy::LegacyInformationSchema
        );

        let mariadb = ServerVersionInfo::parse("10.11.6-MariaDB");
        assert_eq!(
            select_lock_query_strategy(DbEngine::MySql, &mariadb),
            LockQueryStrategy::LegacyInformationSchema
        );

        let sqlite = ServerVersionInfo::parse("SQLite 3.45.0");
        assert_eq!(
            select_lock_query_strategy(DbEngine::Sqlite, &sqlite),
            LockQueryStrategy::SqlitePragma
        );
    }

    #[test]
    fn builds_dependency_tree_with_root_and_chain() {
        let trx_rows = vec![
            TrxRow {
                trx_id: "100".into(),
                trx_state: "RUNNING".into(),
                thread_id: 10,
                trx_query: "UPDATE orders SET status = 'paid'".into(),
                duration_seconds: 45,
                rows_locked: 12,
                rows_modified: 1,
                lock_structs: 3,
                isolation_level: Some("REPEATABLE READ".into()),
            },
            TrxRow {
                trx_id: "101".into(),
                trx_state: "LOCK WAIT".into(),
                thread_id: 20,
                trx_query: "UPDATE orders SET total = 99 WHERE id = 5".into(),
                duration_seconds: 20,
                rows_locked: 1,
                rows_modified: 0,
                lock_structs: 2,
                isolation_level: Some("REPEATABLE READ".into()),
            },
            TrxRow {
                trx_id: "102".into(),
                trx_state: "LOCK WAIT".into(),
                thread_id: 30,
                trx_query: "DELETE FROM orders WHERE id = 5".into(),
                duration_seconds: 10,
                rows_locked: 0,
                rows_modified: 0,
                lock_structs: 1,
                isolation_level: Some("REPEATABLE READ".into()),
            },
        ];

        let mut processes = HashMap::new();
        processes.insert(
            10,
            ProcessRow {
                thread_id: 10,
                user: "app".into(),
                host: "10.0.0.1".into(),
                db: Some("shop".into()),
                command: "Sleep".into(),
                time_seconds: 45,
                state: None,
                info: String::new(),
            },
        );
        processes.insert(
            20,
            ProcessRow {
                thread_id: 20,
                user: "worker".into(),
                host: "10.0.0.2".into(),
                db: Some("shop".into()),
                command: "Query".into(),
                time_seconds: 20,
                state: Some("updating".into()),
                info: "UPDATE orders SET total = 99 WHERE id = 5".into(),
            },
        );

        let edges = vec![
            LockWaitEdge {
                waiting_thread_id: 20,
                blocking_thread_id: 10,
                waiting_trx_id: Some("101".into()),
                blocking_trx_id: Some("100".into()),
                lock_mode: Some("X".into()),
                lock_type: Some("RECORD".into()),
                locked_table: Some("shop.orders".into()),
                locked_index: Some("PRIMARY".into()),
                wait_duration_seconds: 20,
            },
            LockWaitEdge {
                waiting_thread_id: 30,
                blocking_thread_id: 20,
                waiting_trx_id: Some("102".into()),
                blocking_trx_id: Some("101".into()),
                lock_mode: Some("X".into()),
                lock_type: Some("RECORD".into()),
                locked_table: Some("shop.orders".into()),
                locked_index: Some("PRIMARY".into()),
                wait_duration_seconds: 10,
            },
        ];

        let (tree, tx_list, blocked_count, root_count) =
            build_lock_graph(&trx_rows, &processes, &edges);

        assert_eq!(root_count, 1);
        assert_eq!(blocked_count, 2);
        assert_eq!(tx_list.len(), 3);
        assert_eq!(tree[0].thread_id, 10);
        assert!(tree[0].is_root_blocker);
        assert_eq!(tree[0].children.len(), 1);
        assert_eq!(tree[0].children[0].thread_id, 20);
        assert_eq!(tree[0].children[0].children[0].thread_id, 30);
    }

    #[test]
    fn handles_deadlock_cycle_without_infinite_recursion() {
        let edges = vec![
            LockWaitEdge {
                waiting_thread_id: 1,
                blocking_thread_id: 2,
                waiting_trx_id: None,
                blocking_trx_id: None,
                lock_mode: Some("X".into()),
                lock_type: Some("RECORD".into()),
                locked_table: Some("db.t".into()),
                locked_index: None,
                wait_duration_seconds: 5,
            },
            LockWaitEdge {
                waiting_thread_id: 2,
                blocking_thread_id: 1,
                waiting_trx_id: None,
                blocking_trx_id: None,
                lock_mode: Some("X".into()),
                lock_type: Some("RECORD".into()),
                locked_table: Some("db.t".into()),
                locked_index: None,
                wait_duration_seconds: 5,
            },
        ];

        let (tree, tx_list, blocked_count, root_count) =
            build_lock_graph(&[], &HashMap::new(), &edges);

        assert_eq!(root_count, 1);
        assert_eq!(blocked_count, 2);
        assert_eq!(tx_list.len(), 2);
        assert_eq!(tree[0].thread_id, 1);
        assert_eq!(tree[0].children.len(), 1);
        assert_eq!(tree[0].children[0].thread_id, 2);
        assert!(tree[0].children[0].has_cycle);
        assert!(tree[0].children[0].children.is_empty());
    }

    #[test]
    fn waiter_with_several_blockers_appears_once_under_its_chain() {
        // Thread 30 is queued behind both the root (10) and another waiter (20) on the same row,
        // which is what InnoDB reports for a second waiter. It must not be rendered twice.
        let edge = |waiting: u64, blocking: u64| LockWaitEdge {
            waiting_thread_id: waiting,
            blocking_thread_id: blocking,
            waiting_trx_id: None,
            blocking_trx_id: None,
            lock_mode: Some("X".into()),
            lock_type: Some("RECORD".into()),
            locked_table: Some("shop.orders".into()),
            locked_index: Some("PRIMARY".into()),
            wait_duration_seconds: 5,
        };
        let edges = vec![edge(20, 10), edge(30, 10), edge(30, 20)];

        let (tree, _, blocked_count, root_count) = build_lock_graph(&[], &HashMap::new(), &edges);

        assert_eq!(root_count, 1);
        assert_eq!(blocked_count, 2);
        assert_eq!(tree[0].thread_id, 10);
        assert_eq!(
            tree[0].children.len(),
            1,
            "30 must not also hang directly from 10"
        );
        let middle = &tree[0].children[0];
        assert_eq!(middle.thread_id, 20);
        assert_eq!(middle.children.len(), 1);
        let leaf = &middle.children[0];
        assert_eq!(leaf.thread_id, 30);
        assert_eq!(leaf.blocking_thread_id, Some(20));
        assert_eq!(leaf.other_blocking_thread_ids, vec![10]);
        assert_eq!(count_descendants(&tree[0]), 2);
    }

    #[test]
    fn builds_kill_sql_safely() {
        assert_eq!(
            build_kill_sql(42, KillThreadMode::Query).unwrap(),
            "KILL QUERY 42"
        );
        assert_eq!(
            build_kill_sql(42, KillThreadMode::Connection).unwrap(),
            "KILL 42"
        );
        assert!(build_kill_sql(0, KillThreadMode::Query).is_err());
    }
}
