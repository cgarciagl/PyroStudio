//! Idempotent import of legacy (localStorage) connections and favorites into a
//! folder workspace. Source data is never modified here; the frontend keeps it
//! until the report comes back `verified`.
//!
//! Re-running is safe: identical items are skipped, items whose id already exists
//! with different content are reported as conflicts and never overwritten.

use super::error::{WorkspaceError, WsResult};
use super::models::*;
use super::query_files;
use super::repository::{self, validate_id};
use std::path::Path;

fn same_query(a: &WorkspaceQuery, b: &SaveQueryInput) -> bool {
    let norm_cat = |c: &str| match c.trim() {
        "" => query_files::DEFAULT_CATEGORY.to_string(),
        c => c.to_string(),
    };
    a.title == b.title.trim()
        && a.category == norm_cat(&b.category)
        && a.sql == b.sql
        && a.description.as_deref().unwrap_or("").trim()
            == b.description.as_deref().unwrap_or("").trim()
}

pub fn import_legacy(root: &Path, data: &LegacyImport) -> WsResult<MigrationReport> {
    let mut report = MigrationReport::default();
    let mut expected_conn_ids = Vec::new();
    let mut expected_queries = Vec::new();

    // ── Connections ──
    let existing = repository::list_connections(root)?;
    for conn in &data.connections {
        let clean = match repository::sanitize_connection(conn) {
            Ok(c) => c,
            Err(e) => {
                let id = conn.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                report.invalid.push(format!("conexión {id}: {e}"));
                continue;
            }
        };
        let id = clean["id"].as_str().unwrap_or_default().to_string();
        let clean_value = serde_json::Value::Object(clean.clone());
        match existing.connections.iter().find(|c| c["id"] == clean["id"]) {
            Some(current) if *current == clean_value => {
                report.connections_skipped += 1;
                expected_conn_ids.push((id, clean_value));
            }
            Some(_) => report.conflicts.push(format!("conexión {id}")),
            None => {
                repository::save_connection(root, &clean_value)?;
                report.connections_written += 1;
                expected_conn_ids.push((id, clean_value));
            }
        }
    }

    // ── Queries ──
    for q in &data.queries {
        let Some(id) = q.id.as_deref() else {
            report
                .invalid
                .push(format!("consulta '{}': sin id", q.title));
            continue;
        };
        if validate_id(id).is_err() || q.title.trim().is_empty() {
            report
                .invalid
                .push(format!("consulta '{}': id o título inválido", q.title));
            continue;
        }
        match query_files::find_query(root, id) {
            Ok(current) if same_query(&current, q) => {
                report.queries_skipped += 1;
                expected_queries.push(q.clone());
            }
            Ok(_) => report.conflicts.push(format!("consulta {id}")),
            Err(WorkspaceError::NotFound(_)) => {
                let mut input = q.clone();
                input.expected_hash = None;
                input.force = false;
                query_files::save_query(root, &input)?;
                report.queries_written += 1;
                expected_queries.push(q.clone());
            }
            Err(e) => return Err(e),
        }
    }

    // ── Verification: re-read everything from disk ──
    let on_disk_conns = repository::list_connections(root)?;
    let conns_ok = expected_conn_ids.iter().all(|(id, value)| {
        on_disk_conns
            .connections
            .iter()
            .any(|c| c["id"].as_str() == Some(id) && c == value)
    });
    let on_disk_queries = query_files::list_queries(root)?;
    let queries_ok = expected_queries.iter().all(|q| {
        on_disk_queries
            .queries
            .iter()
            .any(|d| Some(d.id.as_str()) == q.id.as_deref() && same_query(d, q))
    });
    report.verified = conns_ok && queries_ok && report.invalid.is_empty();
    Ok(report)
}
