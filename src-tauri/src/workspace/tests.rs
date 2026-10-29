use super::error::WorkspaceError;
use super::models::*;
use super::query_files::{self, parse_sql_file};
use super::repository::{self, *};
use super::service::WorkspaceManager;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// Self-cleaning temp directory (no extra dev-dependency needed).
struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("pyro-ws-test-{}", new_uuid().unwrap()));
        fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn setup() -> (TempDir, TempDir, WorkspaceManager) {
    let cfg = TempDir::new();
    let ws = TempDir::new();
    let mgr = WorkspaceManager::new(cfg.path().join("workspace.local.json"));
    mgr.create(ws.path(), "Prueba").unwrap();
    (cfg, ws, mgr)
}

fn full_connection(id: &str) -> Value {
    json!({
        "id": id,
        "name": "Producción",
        "host": "db.example.com",
        "port": 3306,
        "user": "app",
        "password": "TOP-SECRET-PWD",
        "credentialId": format!("cred-{id}"),
        "database": "school",
        "environment": "production",
        "colorTag": "#ff0000",
        "createdAt": 1700000000000u64,
        "lastConnectedAt": 1700000005000u64,
        "tls": { "enabled": true, "ca_cert_path": "/etc/ca.pem", "verify_certificate": true, "allow_insecure_tls": false },
        "ssh_tunnel": { "enabled": true, "ssh_host": "bastion", "ssh_port": 22, "ssh_user": "ops",
                        "remote_host": "127.0.0.1", "remote_port": 3306, "authentication": "private_key",
                        "private_key_path": "~/.ssh/id_ed25519", "private_key": "-----BEGIN KEY-----", "passphrase": "PP-SECRET" },
        "tunnel": { "enabled": true, "url": "https://x/tunnel.php", "http_user": "u",
                    "http_password": "HTTP-SECRET", "auth_token": "TOKEN-SECRET",
                    "tunnel_credential_id": format!("tunnel-cred-{id}"),
                    "token_credential_id": format!("tunnel-token-cred-{id}"),
                    "encode_base64": true, "timeout_seconds": 30, "max_response_bytes": 1000 },
        "futureField": { "keep": true }
    })
}

fn read_all_text(dir: &Path) -> String {
    let mut out = String::new();
    for e in fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            out.push_str(&read_all_text(&p));
        } else if let Ok(t) = fs::read_to_string(&p) {
            out.push_str(&t);
        }
    }
    out
}

// ─── Workspace lifecycle ─────────────────────────────────────────────────────

#[test]
fn create_and_open_workspace() {
    let (cfg, ws, mgr) = setup();
    let st = mgr.status();
    assert_eq!(st.availability, WorkspaceAvailability::Available);
    assert_eq!(st.name.as_deref(), Some("Prueba"));
    assert!(ws.path().join(MANIFEST_FILE).exists());
    assert!(ws.path().join(CONNECTIONS_DIR).is_dir());

    // A fresh manager (app restart) restores the active workspace from local config.
    let mgr2 = WorkspaceManager::new(cfg.path().join("workspace.local.json"));
    assert_eq!(mgr2.status().workspace_id, st.workspace_id);

    // Opening the same folder again is fine; creating over it is refused.
    assert!(mgr2.open(ws.path()).is_ok());
    assert!(matches!(
        mgr2.create(ws.path(), "x"),
        Err(WorkspaceError::AlreadyExists)
    ));
}

#[test]
fn local_mode_by_default_and_use_local() {
    let cfg = TempDir::new();
    let mgr = WorkspaceManager::new(cfg.path().join("c.json"));
    assert_eq!(mgr.status().availability, WorkspaceAvailability::Local);
    assert!(matches!(
        mgr.list_queries(),
        Err(WorkspaceError::NoActiveWorkspace)
    ));
    let (_c, _w, mgr) = setup();
    mgr.use_local().unwrap();
    assert_eq!(mgr.status().availability, WorkspaceAvailability::Local);
}

#[test]
fn rejects_invalid_manifest() {
    let ws = TempDir::new();
    fs::write(ws.path().join(MANIFEST_FILE), "{ not json").unwrap();
    assert!(matches!(
        repository::read_manifest(ws.path()),
        Err(WorkspaceError::InvalidManifest(_))
    ));
    fs::write(
        ws.path().join(MANIFEST_FILE),
        r#"{"formatVersion":1,"name":"x","createdAt":"y"}"#,
    )
    .unwrap();
    assert!(matches!(
        repository::read_manifest(ws.path()),
        Err(WorkspaceError::InvalidManifest(_))
    ));
    let empty = TempDir::new();
    assert!(matches!(
        repository::read_manifest(empty.path()),
        Err(WorkspaceError::NotAWorkspace)
    ));
}

#[test]
fn rejects_future_version_without_rewriting() {
    let cfg = TempDir::new();
    let ws = TempDir::new();
    let content = r#"{"formatVersion":99,"workspaceId":"abc","name":"Futuro","createdAt":"2030-01-01T00:00:00Z"}"#;
    fs::write(ws.path().join(MANIFEST_FILE), content).unwrap();
    let mgr = WorkspaceManager::new(cfg.path().join("c.json"));
    assert!(matches!(
        mgr.open(ws.path()),
        Err(WorkspaceError::IncompatibleVersion { found: 99, .. })
    ));
    assert_eq!(
        fs::read_to_string(ws.path().join(MANIFEST_FILE)).unwrap(),
        content
    );
}

#[test]
fn detects_unavailable_folder() {
    let (_cfg, ws, mgr) = setup();
    let id = mgr.status().workspace_id;
    fs::remove_dir_all(ws.path()).unwrap();
    let st = mgr.status();
    assert_eq!(st.availability, WorkspaceAvailability::Unavailable);
    assert_eq!(
        st.workspace_id, id,
        "keeps identity so the UI can offer relocation"
    );
    assert!(
        mgr.list_connections().is_err(),
        "never falls back to an empty list"
    );
    assert!(mgr.save_connection(&full_connection("c1")).is_err());
    assert!(!ws.path().exists(), "must not recreate an empty workspace");
}

#[test]
fn relocate_requires_same_workspace() {
    let (_cfg, ws, mgr) = setup();
    let other = TempDir::new();
    let mgr_other = WorkspaceManager::new(other.path().join("cfg.json"));
    let other_ws = TempDir::new();
    mgr_other.create(other_ws.path(), "Otro").unwrap();
    assert!(mgr.relocate(other_ws.path()).is_err());

    // Simulate the folder being moved.
    let moved = TempDir::new();
    let dest = moved.path().join("moved");
    fs::rename(ws.path(), &dest).unwrap();
    assert_eq!(
        mgr.status().availability,
        WorkspaceAvailability::Unavailable
    );
    assert_eq!(
        mgr.relocate(&dest).unwrap().availability,
        WorkspaceAvailability::Available
    );
}

#[test]
fn switching_workspaces_does_not_mix_resources() {
    let (_cfg, ws_a, mgr) = setup();
    mgr.save_connection(&full_connection("conn-a")).unwrap();
    let ws_b = TempDir::new();
    mgr.create(ws_b.path(), "B").unwrap();
    assert!(mgr.list_connections().unwrap().connections.is_empty());
    mgr.save_connection(&full_connection("conn-b")).unwrap();
    mgr.open(ws_a.path()).unwrap();
    let ids: Vec<_> = mgr
        .list_connections()
        .unwrap()
        .connections
        .iter()
        .map(|c| c["id"].clone())
        .collect();
    assert_eq!(ids, vec![json!("conn-a")]);
}

// ─── Connections ─────────────────────────────────────────────────────────────

#[test]
fn connection_roundtrip_preserves_options_and_strips_secrets() {
    let (_cfg, ws, mgr) = setup();
    let saved = mgr.save_connection(&full_connection("conn-1")).unwrap();
    let listed = mgr.list_connections().unwrap();
    assert_eq!(listed.connections.len(), 1);
    let c = &listed.connections[0];
    assert_eq!(c, &saved);
    assert_eq!(c["id"], "conn-1");
    assert_eq!(c["credentialId"], "cred-conn-1");
    assert_eq!(c["tls"]["ca_cert_path"], "/etc/ca.pem");
    assert_eq!(c["ssh_tunnel"]["private_key_path"], "~/.ssh/id_ed25519");
    assert_eq!(c["ssh_tunnel"]["authentication"], "private_key");
    assert_eq!(
        c["tunnel"]["token_credential_id"],
        "tunnel-token-cred-conn-1"
    );
    assert_eq!(c["tunnel"]["timeout_seconds"], 30);
    assert_eq!(c["futureField"]["keep"], true);
    assert!(c.get("password").is_none());
    assert!(c.get("lastConnectedAt").is_none());
    assert!(c["tunnel"].get("http_password").is_none());
    assert!(c["tunnel"].get("auth_token").is_none());
    assert!(c["ssh_tunnel"].get("passphrase").is_none());
    assert!(c["ssh_tunnel"].get("private_key").is_none());

    let all = read_all_text(ws.path());
    for secret in [
        "TOP-SECRET-PWD",
        "HTTP-SECRET",
        "TOKEN-SECRET",
        "PP-SECRET",
        "BEGIN KEY",
    ] {
        assert!(
            !all.contains(secret),
            "secret leaked to workspace: {secret}"
        );
    }
}

#[test]
fn hand_edited_connection_file_cannot_smuggle_secrets() {
    let (_cfg, ws, mgr) = setup();
    fs::write(
        ws.path().join(CONNECTIONS_DIR).join("x1.json"),
        r#"{"formatVersion":1,"connection":{"id":"x1","name":"n","host":"h","port":1,"user":"u","password":"p"}}"#,
    )
    .unwrap();
    let c = &mgr.list_connections().unwrap().connections[0];
    assert!(c.get("password").is_none());
}

#[test]
fn corrupt_connection_files_are_reported_not_deleted() {
    let (_cfg, ws, mgr) = setup();
    mgr.save_connection(&full_connection("ok")).unwrap();
    let bad = ws.path().join(CONNECTIONS_DIR).join("bad.json");
    fs::write(&bad, "{oops").unwrap();
    let l = mgr.list_connections().unwrap();
    assert_eq!(l.connections.len(), 1);
    assert_eq!(l.errors.len(), 1);
    assert!(bad.exists());
}

#[test]
fn credential_reference_is_logical_and_validated() {
    let mut c = full_connection("c2");
    c["credentialId"] = json!("../../master.key");
    let clean = sanitize_connection(&c).unwrap();
    assert!(clean.get("credentialId").is_none());
}

#[test]
fn delete_connection() {
    let (_cfg, _ws, mgr) = setup();
    mgr.save_connection(&full_connection("d1")).unwrap();
    mgr.delete_connection("d1").unwrap();
    assert!(mgr.list_connections().unwrap().connections.is_empty());
    assert!(matches!(
        mgr.delete_connection("d1"),
        Err(WorkspaceError::NotFound(_))
    ));
}

// ─── Queries ─────────────────────────────────────────────────────────────────

fn q(title: &str, category: &str, sql: &str) -> SaveQueryInput {
    SaveQueryInput {
        id: None,
        title: title.into(),
        category: category.into(),
        sql: sql.into(),
        description: Some("Resumen\nmultilínea \\ con barra".into()),
        connection_id: None,
        database: None,
        folder: None,
        created_at: None,
        updated_at: None,
        expected_hash: None,
        force: false,
    }
}

#[test]
fn query_saved_as_real_sql_file_with_metadata() {
    let (_cfg, ws, mgr) = setup();
    let sql = "SELECT periodo, COUNT(*) AS total\r\nFROM alumnos\n-- pyro-title: not header\nGROUP BY periodo;\n\n";
    let saved = mgr
        .save_query(&q("Estadísticas de alumnos", "Reportes", sql))
        .unwrap();
    assert_eq!(
        saved.rel_path,
        "queries/Reportes/Estadísticas de alumnos.sql"
    );
    let text = fs::read_to_string(
        ws.path()
            .join("queries/Reportes/Estadísticas de alumnos.sql"),
    )
    .unwrap();
    assert!(text.starts_with("-- pyro-id: "));
    assert!(text.ends_with(sql));

    let read = mgr.read_query(&saved.id).unwrap();
    assert_eq!(read.sql, sql, "SQL body preserved byte-for-byte");
    assert_eq!(read.title, "Estadísticas de alumnos");
    assert_eq!(read.category, "Reportes");
    assert_eq!(
        read.description.as_deref(),
        Some("Resumen\nmultilínea \\ con barra")
    );
}

#[test]
fn opens_sql_without_header() {
    let (_cfg, ws, mgr) = setup();
    let dir = ws.path().join("queries/mantenimiento");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("indices.sql"), "SHOW INDEX FROM t;").unwrap();
    fs::write(ws.path().join("snippets/diagnostico.sql"), "SELECT 1;").unwrap();
    let list = mgr.list_queries().unwrap();
    assert_eq!(list.queries.len(), 2);
    let idx = list.queries.iter().find(|x| x.title == "indices").unwrap();
    assert_eq!(idx.category, "mantenimiento");
    assert_eq!(idx.sql, "SHOW INDEX FROM t;");
    assert!(!idx.has_header);
    let snip = list
        .queries
        .iter()
        .find(|x| x.title == "diagnostico")
        .unwrap();
    assert_eq!(snip.category, "Snippets");
    // Stable id across reads.
    assert_eq!(
        mgr.list_queries()
            .unwrap()
            .queries
            .iter()
            .find(|x| x.title == "indices")
            .unwrap()
            .id,
        idx.id
    );
}

#[test]
fn header_parser_only_recognises_known_keys() {
    let p = parse_sql_file("-- pyro-id: a1\n-- pyro-evil: x\nSELECT 1;");
    assert_eq!(p.id.as_deref(), Some("a1"));
    assert_eq!(p.body, "-- pyro-evil: x\nSELECT 1;");
    let p = parse_sql_file("-- normal comment\nSELECT 1;");
    assert!(!p.has_header);
    assert_eq!(p.body, "-- normal comment\nSELECT 1;");
}

#[test]
fn rename_move_and_delete_query_keep_id() {
    let (_cfg, ws, mgr) = setup();
    let a = mgr.save_query(&q("Uno", "A", "SELECT 1;")).unwrap();
    let mut upd = q("Uno renombrado", "B", "SELECT 2;");
    upd.id = Some(a.id.clone());
    upd.expected_hash = Some(a.content_hash.clone());
    let b = mgr.save_query(&upd).unwrap();
    assert_eq!(b.id, a.id);
    assert_eq!(b.rel_path, "queries/B/Uno renombrado.sql");
    assert_eq!(b.created_at, a.created_at);
    assert!(!ws.path().join("queries/A/Uno.sql").exists());
    assert_eq!(mgr.list_queries().unwrap().queries.len(), 1);

    mgr.delete_query(&b.id, Some(&b.content_hash)).unwrap();
    assert!(mgr.list_queries().unwrap().queries.is_empty());
}

#[test]
fn duplicate_names_do_not_overwrite() {
    let (_cfg, ws, mgr) = setup();
    let a = mgr.save_query(&q("Mismo", "C", "SELECT 'a';")).unwrap();
    let b = mgr.save_query(&q("Mismo", "C", "SELECT 'b';")).unwrap();
    assert_ne!(a.rel_path, b.rel_path);
    assert_eq!(b.rel_path, "queries/C/Mismo (2).sql");
    assert!(fs::read_to_string(
        ws.path()
            .join(a.rel_path.replace('/', std::path::MAIN_SEPARATOR_STR))
    )
    .unwrap()
    .ends_with("SELECT 'a';"));
    // Renaming onto an existing name also picks a free name.
    let mut r = q("Mismo", "C", "SELECT 'b2';");
    r.id = Some(b.id.clone());
    r.expected_hash = Some(b.content_hash.clone());
    assert_eq!(
        mgr.save_query(&r).unwrap().rel_path,
        "queries/C/Mismo (2).sql"
    );
}

#[test]
fn malicious_titles_and_categories_stay_inside_workspace() {
    let (_cfg, ws, mgr) = setup();
    let s = mgr
        .save_query(&q("../../../etc/passwd", "..\\..\\Windows", "SELECT 1;"))
        .unwrap();
    assert!(s.rel_path.starts_with("queries/"));
    assert!(!s.rel_path.contains(".."));
    assert!(ws
        .path()
        .join(s.rel_path.replace('/', std::path::MAIN_SEPARATOR_STR))
        .exists());
    let s2 = mgr.save_query(&q("CON", "NUL", "SELECT 1;")).unwrap();
    assert_eq!(s2.rel_path, "queries/General/consulta.sql");
}

#[test]
fn rejects_malicious_ids() {
    for bad in [
        "../x", "a/b", "a\\b", "C:\\x", "/etc", "..", ".hidden", "", "a..b",
    ] {
        assert!(validate_id(bad).is_err(), "{bad} should be rejected");
    }
    assert!(validate_id("fav-preset-users").is_ok());
    let (_cfg, _ws, mgr) = setup();
    assert!(matches!(
        mgr.delete_connection("../workspace"),
        Err(WorkspaceError::InvalidId(_))
    ));
    let mut c = full_connection("x");
    c["id"] = json!("../../evil");
    assert!(mgr.save_connection(&c).is_err());
    let mut bad_q = q("t", "c", "s");
    bad_q.id = Some("..\\..\\evil".into());
    assert!(mgr.save_query(&bad_q).is_err());
}

#[test]
fn ensure_within_rejects_escape() {
    let ws = TempDir::new();
    assert!(ensure_within(ws.path(), &ws.path().join("queries").join("x.sql")).is_ok());
    assert!(ensure_within(ws.path(), &ws.path().join("..").join("x.sql")).is_err());
    let outside = TempDir::new();
    assert!(ensure_within(ws.path(), &outside.path().join("x.sql")).is_err());
    assert!(atomic_write(ws.path(), &outside.path().join("x.sql"), b"x").is_err());
    assert!(!outside.path().join("x.sql").exists());
}

#[cfg(unix)]
#[test]
fn symlinked_directory_cannot_redirect_writes() {
    let ws = TempDir::new();
    let outside = TempDir::new();
    std::os::unix::fs::symlink(outside.path(), ws.path().join("queries")).unwrap();
    assert!(atomic_write(ws.path(), &ws.path().join("queries").join("x.sql"), b"x").is_err());
    assert!(!outside.path().join("x.sql").exists());
}

#[test]
fn failed_write_keeps_previous_file() {
    let ws = TempDir::new();
    let target = ws.path().join("file.txt");
    atomic_write(ws.path(), &target, b"original").unwrap();
    // Target's parent is a file -> creating the temp file fails.
    let bad = ws.path().join("file.txt").join("child.txt");
    assert!(atomic_write(ws.path(), &bad, b"new").is_err());
    assert_eq!(fs::read(&target).unwrap(), b"original");
    let leftovers: Vec<_> = fs::read_dir(ws.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".pyrotmp"))
        .collect();
    assert!(leftovers.is_empty());
}

#[test]
fn detects_external_change_before_overwrite() {
    let (_cfg, ws, mgr) = setup();
    let a = mgr.save_query(&q("Externa", "X", "SELECT 1;")).unwrap();
    let path = ws.path().join("queries").join("X").join("Externa.sql");
    let external = fs::read_to_string(&path)
        .unwrap()
        .replace("SELECT 1;", "SELECT 'editado fuera';");
    fs::write(&path, &external).unwrap();

    let mut upd = q("Externa", "X", "SELECT 2;");
    upd.id = Some(a.id.clone());
    upd.expected_hash = Some(a.content_hash.clone());
    assert!(matches!(
        mgr.save_query(&upd),
        Err(WorkspaceError::Conflict(_))
    ));
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        external,
        "external edit preserved"
    );
    assert!(matches!(
        mgr.delete_query(&a.id, Some(&a.content_hash)),
        Err(WorkspaceError::Conflict(_))
    ));

    // Reload shows the external content; explicit force overwrites.
    assert_eq!(
        mgr.read_query(&a.id).unwrap().sql,
        "SELECT 'editado fuera';"
    );
    upd.force = true;
    assert_eq!(mgr.save_query(&upd).unwrap().sql, "SELECT 2;");
}

#[test]
fn duplicate_ids_from_sync_conflict_copies_are_reported() {
    let (_cfg, ws, mgr) = setup();
    let a = mgr.save_query(&q("Doble", "D", "SELECT 1;")).unwrap();
    let src = ws.path().join("queries/D/Doble.sql");
    let copy = ws.path().join("queries/D/Doble (conflicted copy).sql");
    fs::copy(&src, &copy).unwrap();
    let l = mgr.list_queries().unwrap();
    assert_eq!(l.queries.iter().filter(|x| x.id == a.id).count(), 1);
    assert_eq!(l.errors.len(), 1);
    assert!(copy.exists(), "conflict copies are never deleted");
}

#[test]
fn invalid_utf8_query_reported() {
    let (_cfg, ws, mgr) = setup();
    fs::write(ws.path().join("queries/bin.sql"), [0xff, 0xfe, 0x00]).unwrap();
    let l = mgr.list_queries().unwrap();
    assert!(l.queries.is_empty());
    assert_eq!(l.errors.len(), 1);
}

// ─── Migration ───────────────────────────────────────────────────────────────

fn legacy() -> LegacyImport {
    let mut fav = q("Procesos", "Diagnóstico", "SHOW FULL PROCESSLIST;");
    fav.id = Some("fav-123-abcde".into());
    fav.created_at = Some(1_600_000_000_000);
    fav.updated_at = Some(1_600_000_100_000);
    LegacyImport {
        connections: vec![full_connection("conn-legacy")],
        queries: vec![fav],
    }
}

#[test]
fn migration_imports_verifies_and_is_idempotent() {
    let (_cfg, ws, mgr) = setup();
    let data = legacy();
    let r1 = mgr.import_legacy(&data).unwrap();
    assert!(r1.verified);
    assert_eq!((r1.connections_written, r1.queries_written), (1, 1));

    let c = &mgr.list_connections().unwrap().connections[0];
    assert_eq!(c["tls"]["enabled"], true);
    assert_eq!(c["ssh_tunnel"]["ssh_host"], "bastion");
    assert_eq!(c["tunnel"]["url"], "https://x/tunnel.php");
    let qq = mgr.read_query("fav-123-abcde").unwrap();
    assert_eq!(qq.created_at, 1_600_000_000_000);
    assert_eq!(qq.updated_at, 1_600_000_100_000);
    assert!(!read_all_text(ws.path()).contains("TOP-SECRET-PWD"));

    // Second run (or retry after interruption): nothing duplicated.
    let r2 = mgr.import_legacy(&data).unwrap();
    assert!(r2.verified);
    assert_eq!((r2.connections_written, r2.queries_written), (0, 0));
    assert_eq!((r2.connections_skipped, r2.queries_skipped), (1, 1));
    assert_eq!(mgr.list_queries().unwrap().queries.len(), 1);
    assert_eq!(mgr.list_connections().unwrap().connections.len(), 1);
}

#[test]
fn migration_resumes_after_partial_run() {
    let (_cfg, _ws, mgr) = setup();
    let data = legacy();
    // Interrupted run: only the connection got written.
    mgr.save_connection(&data.connections[0]).unwrap();
    let r = mgr.import_legacy(&data).unwrap();
    assert!(r.verified);
    assert_eq!((r.connections_skipped, r.queries_written), (1, 1));
}

#[test]
fn migration_handles_incomplete_and_conflicting_data() {
    let (_cfg, _ws, mgr) = setup();
    let mut data = legacy();
    data.connections
        .push(json!({ "id": "broken", "name": "sin host" }));
    let mut no_id = q("Sin id", "", "SELECT 1;");
    no_id.id = None;
    data.queries.push(no_id);
    let r = mgr.import_legacy(&data).unwrap();
    assert!(
        !r.verified,
        "incomplete source must not be reported as fully migrated"
    );
    assert_eq!(r.invalid.len(), 2);
    assert_eq!((r.connections_written, r.queries_written), (1, 1));

    // Existing different content with same id -> conflict, not overwritten.
    let mut changed = legacy();
    changed.queries[0].sql = "SELECT 'otro';".into();
    let r = mgr.import_legacy(&changed).unwrap();
    assert_eq!(r.conflicts.len(), 1);
    assert_eq!(
        mgr.read_query("fav-123-abcde").unwrap().sql,
        "SHOW FULL PROCESSLIST;"
    );
}

#[test]
fn migration_input_is_not_mutated() {
    let (_cfg, _ws, mgr) = setup();
    let data = legacy();
    let before = data.connections.clone();
    mgr.import_legacy(&data).unwrap();
    assert_eq!(data.connections, before);
    assert_eq!(data.connections[0]["password"], "TOP-SECRET-PWD");
}

#[test]
fn incompatible_connection_file_version_reported() {
    let (_cfg, ws, mgr) = setup();
    fs::write(
        ws.path().join("connections/f.json"),
        r#"{"formatVersion":42,"connection":{}}"#,
    )
    .unwrap();
    let l = mgr.list_connections().unwrap();
    assert_eq!(l.errors.len(), 1);
    let _ = query_files::DEFAULT_CATEGORY;
}

#[test]
fn query_associated_to_connection_and_database() {
    let (_cfg, ws, mgr) = setup();
    mgr.save_connection(&full_connection("conn-uv")).unwrap();
    let mut input = q("Alumnos por carrera", "Reportes", "SELECT 1;");
    input.connection_id = Some("conn-uv".into());
    input.database = Some("nuevo_ingreso".into());
    let saved = mgr.save_query(&input).unwrap();
    // Folder uses the connection's display name ("Producción") and the database.
    assert_eq!(
        saved.rel_path,
        "queries/Producción/nuevo_ingreso/Alumnos por carrera.sql"
    );
    assert!(ws.path().join("queries/Producción/nuevo_ingreso").is_dir());
    let read = mgr.read_query(&saved.id).unwrap();
    assert_eq!(read.connection_id.as_deref(), Some("conn-uv"));
    assert_eq!(read.database.as_deref(), Some("nuevo_ingreso"));

    // Moving it to another database keeps the id and moves the file.
    let mut moved = input.clone();
    moved.id = Some(saved.id.clone());
    moved.database = Some("planea".into());
    moved.expected_hash = Some(read.content_hash.clone());
    let m = mgr.save_query(&moved).unwrap();
    assert_eq!(m.id, saved.id);
    assert_eq!(
        m.rel_path,
        "queries/Producción/planea/Alumnos por carrera.sql"
    );
    assert_eq!(mgr.list_queries().unwrap().queries.len(), 1);

    // Detaching returns it to the category folder.
    let mut detached = moved.clone();
    detached.connection_id = None;
    detached.database = None;
    detached.expected_hash = Some(m.content_hash.clone());
    let d = mgr.save_query(&detached).unwrap();
    assert_eq!(d.rel_path, "queries/Reportes/Alumnos por carrera.sql");
    assert!(d.connection_id.is_none());
}

#[test]
fn invalid_connection_reference_is_rejected() {
    let (_cfg, _ws, mgr) = setup();
    let mut input = q("x", "c", "SELECT 1;");
    input.connection_id = Some("../evil".into());
    input.database = Some("db".into());
    assert!(mgr.save_query(&input).is_err());
}

#[test]
fn query_folders_inside_a_database() {
    let (_cfg, ws, mgr) = setup();
    mgr.save_connection(&full_connection("conn-f")).unwrap();
    let mut input = q("Pendientes", "General", "SELECT 2;");
    input.connection_id = Some("conn-f".into());
    input.database = Some("modulopa".into());
    input.folder = Some("reportes".into());
    let s = mgr.save_query(&input).unwrap();
    assert_eq!(
        s.rel_path,
        "queries/Producción/modulopa/reportes/Pendientes.sql"
    );
    assert_eq!(
        mgr.read_query(&s.id).unwrap().folder.as_deref(),
        Some("reportes")
    );
    assert!(ws
        .path()
        .join("queries/Producción/modulopa/reportes")
        .is_dir());

    // Move back to the database root.
    let mut out = input.clone();
    out.id = Some(s.id.clone());
    out.folder = None;
    out.expected_hash = Some(mgr.read_query(&s.id).unwrap().content_hash);
    let m = mgr.save_query(&out).unwrap();
    assert_eq!(m.rel_path, "queries/Producción/modulopa/Pendientes.sql");
    assert!(m.folder.is_none());

    // A folder without a connection/database is ignored.
    let mut loose = q("Suelta", "Cat", "SELECT 3;");
    loose.folder = Some("x".into());
    assert_eq!(
        mgr.save_query(&loose).unwrap().rel_path,
        "queries/Cat/Suelta.sql"
    );
}

// ─── Object groups ───────────────────────────────────────────────────────────

fn groups_of(pairs: &[(&str, &str, &str, &[&str])]) -> super::groups::DatabaseGroups {
    let mut out = super::groups::DatabaseGroups::new();
    for (db, kind, folder, items) in pairs {
        out.entry(db.to_string())
            .or_default()
            .entry(kind.to_string())
            .or_default()
            .insert(
                folder.to_string(),
                items.iter().map(|s| s.to_string()).collect(),
            );
    }
    out
}

#[test]
fn object_groups_roundtrip_with_conflict_detection() {
    let (_cfg, ws, mgr) = setup();
    let empty = mgr.read_groups("conn-g").unwrap();
    assert!(empty.databases.is_empty());
    assert_eq!(empty.content_hash, "");

    let g = groups_of(&[
        (
            "modulopa",
            "tables",
            "rolado",
            &["mpa_bloques", " mpa_historico "],
        ),
        ("modulopa", "tables", "vacia", &[]),
    ]);
    let saved = mgr.save_groups("conn-g", &g, "").unwrap();
    assert!(ws.path().join("groups/conn-g.json").exists());
    let t = &saved.databases["modulopa"]["tables"];
    assert_eq!(
        t["rolado"],
        vec!["mpa_bloques".to_string(), "mpa_historico".to_string()]
    );
    assert!(t["vacia"].is_empty(), "empty folders are kept");

    // Stale hash -> conflict, file untouched.
    let other = groups_of(&[("modulopa", "tables", "x", &["a"])]);
    assert!(matches!(
        mgr.save_groups("conn-g", &other, ""),
        Err(WorkspaceError::Conflict(_))
    ));
    assert_eq!(mgr.read_groups("conn-g").unwrap(), saved);

    // Correct hash -> saved.
    let next = mgr
        .save_groups("conn-g", &other, &saved.content_hash)
        .unwrap();
    assert_eq!(
        next.databases["modulopa"]["tables"]["x"],
        vec!["a".to_string()]
    );
}

#[test]
fn object_groups_validation() {
    let (_cfg, _ws, mgr) = setup();
    assert!(mgr
        .save_groups("../evil", &super::groups::DatabaseGroups::new(), "")
        .is_err());
    let bad_kind = groups_of(&[("db", "users", "f", &["a"])]);
    assert!(mgr.save_groups("conn-v", &bad_kind, "").is_err());
    let bad_name = groups_of(&[("db", "tables", "", &["a"])]);
    assert!(mgr.save_groups("conn-v", &bad_name, "").is_err());
    // An object listed twice in a kind keeps the first occurrence only.
    let dup = groups_of(&[
        ("db", "tables", "a", &["t1"]),
        ("db", "tables", "b", &["t1", "t2"]),
    ]);
    let s = mgr.save_groups("conn-v", &dup, "").unwrap();
    assert_eq!(s.databases["db"]["tables"]["a"], vec!["t1".to_string()]);
    assert_eq!(s.databases["db"]["tables"]["b"], vec!["t2".to_string()]);
}
