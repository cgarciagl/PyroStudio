//! Server accounts, roles and privileges (MySQL / MariaDB).
//!
//! Reading: accounts come from `mysql.user`; privileges are parsed from
//! `SHOW GRANTS`, which both engines produce in the same format whatever their
//! grant tables look like. Writing: the frontend sends the *desired* state of an
//! account and the backend diffs it against the live one, so the generated
//! `CREATE/ALTER/DROP USER`, `GRANT` and `REVOKE` statements are idempotent
//! (planning again after applying yields nothing). Every name and privilege is
//! validated and quoted here; nothing from the frontend is spliced verbatim.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{DatabaseUserMetadata, UserPrivilegeInfo};
use super::sql_utils::{escape_sql_string, quote_ident_mysql, sql_string_literal};

/// Shown instead of a password in every statement the frontend sees.
pub const PASSWORD_MASK: &str = "'********'";

const ALL_PRIVILEGES: &str = "ALL PRIVILEGES";
const GRANT_OPTION: &str = "GRANT OPTION";
const AUTH_PLUGINS: &[&str] = &[
    "mysql_native_password",
    "caching_sha2_password",
    "sha256_password",
    "ed25519",
];

// ─── Model ───────────────────────────────────────────────────────────────────

/// Object a privilege applies to.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PrivilegeScope {
    Global,
    Database { database: String },
    Table { database: String, table: String },
}

/// Privileges held on one scope. `ALL PRIVILEGES` is kept as a single entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeGrant {
    pub scope: PrivilegeScope,
    pub privileges: Vec<String>,
    pub with_grant_option: bool,
}

/// A role granted to an account (`host` is absent for MariaDB roles).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RoleRef {
    pub name: String,
    #[serde(default)]
    pub host: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TlsRequirement {
    #[default]
    None,
    Ssl,
    X509,
    /// `SPECIFIED` (issuer/subject/cipher): shown, never rewritten.
    Specified,
}

/// Password lifetime: server default, never expires, or every N days.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PasswordExpiry {
    #[default]
    Default,
    Never,
    Interval {
        days: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct AccountAttributes {
    pub plugin: Option<String>,
    pub account_locked: bool,
    pub password_expired: bool,
    pub password_expiry: PasswordExpiry,
    pub tls: TlsRequirement,
    pub max_queries_per_hour: u64,
    pub max_updates_per_hour: u64,
    pub max_connections_per_hour: u64,
    pub max_user_connections: u64,
}

/// Everything the manager shows for one account.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserPermissions {
    pub user: String,
    pub host: String,
    pub attributes: AccountAttributes,
    pub grants: Vec<ScopeGrant>,
    pub roles: Vec<RoleRef>,
    /// Grants the matrix does not edit (column, routine, proxy…), kept as text.
    pub unmanaged_grants: Vec<String>,
    pub raw_grants: Vec<String>,
}

/// Credentials of an account to create. The password travels frontend → Rust
/// only; it is never sent back and never shown in the SQL preview.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewAccount {
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub plugin: Option<String>,
}

/// Desired state of an account.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserChangeRequest {
    pub user: String,
    pub host: String,
    /// Present when the account must be created.
    #[serde(default)]
    pub create: Option<NewAccount>,
    /// New password for an existing account.
    #[serde(default)]
    pub new_password: Option<String>,
    pub attributes: AccountAttributes,
    pub grants: Vec<ScopeGrant>,
    pub roles: Vec<RoleRef>,
}

/// One generated statement: `sql` runs, `display_sql` is shown and confirmed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedStatement {
    pub sql: String,
    pub display_sql: String,
}

impl PlannedStatement {
    fn plain(sql: String) -> Self {
        Self {
            display_sql: sql.clone(),
            sql,
        }
    }
}

/// Text the user confirms (and the confirmation token is bound to).
pub fn preview_script(plan: &[PlannedStatement]) -> String {
    plan.iter()
        .map(|s| format!("{};", s.display_sql))
        .collect::<Vec<_>>()
        .join("\n")
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/// Lists server users and their authentication plugins and lock statuses.
pub async fn list_database_users(
    backend: &dyn DatabaseBackend,
) -> Result<Vec<DatabaseUserMetadata>, PyroError> {
    let res = backend
        .execute_query("SELECT * FROM mysql.user ORDER BY User ASC, Host ASC", None)
        .await?;
    let mut users = Vec::new();
    for row in &res.rows {
        let get = |name: &str| column(&res.columns, row, name);
        let user = get("User").and_then(as_text).unwrap_or_default();
        let host = get("Host").and_then(as_text).unwrap_or_default();
        if user.is_empty() {
            continue;
        }
        users.push(DatabaseUserMetadata {
            user,
            host,
            plugin: get("plugin").and_then(as_text).filter(|p| !p.is_empty()),
            account_locked: get("account_locked").is_some_and(as_flag),
            password_expired: get("password_expired").is_some_and(as_flag),
        });
    }
    Ok(users)
}

/// Retrieves the effective grants of a user.
pub async fn get_user_grants(
    backend: &dyn DatabaseBackend,
    user: &str,
    host: &str,
) -> Result<UserPrivilegeInfo, PyroError> {
    let clean_user = sql_string_literal(backend.engine().dialect(), user);
    let clean_host = sql_string_literal(backend.engine().dialect(), host);
    let sql = format!("SHOW GRANTS FOR {clean_user}@{clean_host};");

    let res = backend.execute_query(&sql, None).await?;
    let grants = res
        .rows
        .iter()
        .filter_map(|r| r.first().and_then(|v| v.as_str()).map(str::to_string))
        .collect();

    Ok(UserPrivilegeInfo {
        user: user.to_string(),
        host: host.to_string(),
        grants,
    })
}

/// Attributes and parsed privileges of an account.
pub async fn get_user_permissions(
    backend: &dyn DatabaseBackend,
    user: &str,
    host: &str,
) -> Result<UserPermissions, PyroError> {
    validate_account(user, host)?;
    let sql = format!(
        "SELECT * FROM mysql.user WHERE User = '{}' AND Host = '{}'",
        escape_sql_string(user),
        escape_sql_string(host)
    );
    let res = backend.execute_query(&sql, None).await?;
    let row = res.rows.first().ok_or_else(|| {
        PyroError::InvalidOperation(format!("La cuenta '{user}'@'{host}' no existe."))
    })?;
    let attributes = parse_attributes(&res.columns, row);
    let raw = get_user_grants(backend, user, host).await?.grants;
    Ok(build_permissions(user, host, attributes, raw))
}

fn build_permissions(
    user: &str,
    host: &str,
    attributes: AccountAttributes,
    raw_grants: Vec<String>,
) -> UserPermissions {
    let mut grants: Vec<ScopeGrant> = Vec::new();
    let mut roles = Vec::new();
    let mut unmanaged = Vec::new();
    for line in &raw_grants {
        match parse_grant_line(line) {
            Some(ParsedGrant::Privileges(g)) => merge_grant(&mut grants, g),
            Some(ParsedGrant::Roles(r)) => roles.extend(r),
            None => unmanaged.push(line.clone()),
        }
    }
    grants.retain(|g| !g.privileges.is_empty() || g.with_grant_option);
    grants.sort_by(|a, b| a.scope.cmp(&b.scope));
    UserPermissions {
        user: user.to_string(),
        host: host.to_string(),
        attributes,
        grants,
        roles,
        unmanaged_grants: unmanaged,
        raw_grants,
    }
}

fn merge_grant(grants: &mut Vec<ScopeGrant>, g: ScopeGrant) {
    if let Some(existing) = grants.iter_mut().find(|e| e.scope == g.scope) {
        for p in g.privileges {
            if !existing.privileges.contains(&p) {
                existing.privileges.push(p);
            }
        }
        existing.with_grant_option |= g.with_grant_option;
    } else {
        grants.push(g);
    }
}

fn column<'a>(
    columns: &[String],
    row: &'a [serde_json::Value],
    name: &str,
) -> Option<&'a serde_json::Value> {
    let idx = columns.iter().position(|c| c.eq_ignore_ascii_case(name))?;
    row.get(idx).filter(|v| !v.is_null())
}

fn as_text(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn as_flag(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        serde_json::Value::String(s) => s.eq_ignore_ascii_case("Y"),
        _ => false,
    }
}

fn as_u64(v: &serde_json::Value) -> Option<u64> {
    match v {
        serde_json::Value::Number(n) => n.as_u64(),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn parse_attributes(columns: &[String], row: &[serde_json::Value]) -> AccountAttributes {
    let get = |name: &str| column(columns, row, name);
    let limit = |name: &str| get(name).and_then(as_u64).unwrap_or(0);
    let tls = match get("ssl_type")
        .and_then(as_text)
        .unwrap_or_default()
        .to_ascii_uppercase()
        .as_str()
    {
        "ANY" => TlsRequirement::Ssl,
        "X509" => TlsRequirement::X509,
        "SPECIFIED" => TlsRequirement::Specified,
        _ => TlsRequirement::None,
    };
    let password_expiry = match get("password_lifetime").and_then(as_u64) {
        None => PasswordExpiry::Default,
        Some(0) => PasswordExpiry::Never,
        Some(days) => PasswordExpiry::Interval { days: days as u32 },
    };
    AccountAttributes {
        plugin: get("plugin").and_then(as_text).filter(|p| !p.is_empty()),
        account_locked: get("account_locked").is_some_and(as_flag),
        password_expired: get("password_expired").is_some_and(as_flag),
        password_expiry,
        tls,
        max_queries_per_hour: limit("max_questions"),
        max_updates_per_hour: limit("max_updates"),
        max_connections_per_hour: limit("max_connections"),
        max_user_connections: limit("max_user_connections"),
    }
}

// ─── SHOW GRANTS parsing ─────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
enum ParsedGrant {
    Privileges(ScopeGrant),
    Roles(Vec<RoleRef>),
}

/// Splits `s` on `sep` (ASCII, case-insensitive) outside quotes and parentheses.
fn find_top_level(s: &str, needle: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let upper = s.to_ascii_uppercase();
    let needle = needle.to_ascii_uppercase();
    let mut depth = 0i32;
    let mut quote: Option<u8> = None;
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = quote {
            if b == b'\\' && q != b'`' {
                i += 1;
            } else if b == q {
                quote = None;
            }
        } else {
            match b {
                b'\'' | b'"' | b'`' => quote = Some(b),
                b'(' => depth += 1,
                b')' => depth -= 1,
                _ if depth == 0 && upper[i..].starts_with(&needle) => return Some(i),
                _ => {}
            }
        }
        i += 1;
    }
    None
}

fn split_top_level(s: &str, sep: char) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut quote: Option<char> = None;
    for ch in s.chars() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None => match ch {
                '\'' | '"' | '`' => quote = Some(ch),
                '(' => depth += 1,
                ')' => depth -= 1,
                c if c == sep && depth == 0 => {
                    parts.push(current.trim().to_string());
                    current.clear();
                    continue;
                }
                _ => {}
            },
        }
        current.push(ch);
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

/// Removes one level of backtick/quote quoting (`` `a``b` `` → ``a`b``).
fn unquote(s: &str) -> String {
    let s = s.trim();
    let mut chars = s.chars();
    match chars.next() {
        Some(q @ ('`' | '\'' | '"')) if s.len() >= 2 && s.ends_with(q) => {
            let inner = &s[1..s.len() - 1];
            let doubled = format!("{q}{q}");
            let unescaped = inner.replace(&doubled, &q.to_string());
            if q == '`' {
                unescaped
            } else {
                unescaped.replace("\\'", "'").replace("\\\\", "\\")
            }
        }
        _ => s.to_string(),
    }
}

/// Splits `a.b` at the dot that is outside backticks.
fn split_object(object: &str) -> Option<(String, String)> {
    let mut in_tick = false;
    for (i, ch) in object.char_indices() {
        match ch {
            '`' => in_tick = !in_tick,
            '.' if !in_tick => return Some((object[..i].to_string(), object[i + 1..].to_string())),
            _ => {}
        }
    }
    None
}

fn parse_role(text: &str) -> Option<RoleRef> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let at = find_top_level(text, "@");
    let (name, host) = match at {
        Some(i) => (unquote(&text[..i]), Some(unquote(&text[i + 1..]))),
        None => (unquote(text), None),
    };
    (!name.is_empty()).then_some(RoleRef { name, host })
}

fn parse_grant_line(line: &str) -> Option<ParsedGrant> {
    let line = line.trim().trim_end_matches(';');
    let body = line
        .get(..6)
        .filter(|p| p.eq_ignore_ascii_case("GRANT "))
        .map(|_| &line[6..])?;
    let to = find_top_level(body, " TO ")?;
    let Some(on) = find_top_level(&body[..to], " ON ") else {
        // `GRANT role1, role2 TO user`
        let roles: Vec<RoleRef> = split_top_level(&body[..to], ',')
            .iter()
            .filter_map(|r| parse_role(r))
            .collect();
        return (!roles.is_empty()).then_some(ParsedGrant::Roles(roles));
    };
    let privileges_text = body[..on].trim();
    let object = body[on + 4..to].trim();
    let tail = body[to..].to_ascii_uppercase();

    let first_word = object.split_whitespace().next().unwrap_or("");
    if ["PROCEDURE", "FUNCTION", "PACKAGE"]
        .iter()
        .any(|w| first_word.eq_ignore_ascii_case(w))
        || object.eq_ignore_ascii_case("''@''")
    {
        return None;
    }
    let mut privileges = Vec::new();
    for p in split_top_level(privileges_text, ',') {
        let p = p.split_whitespace().collect::<Vec<_>>().join(" ");
        let upper = p.to_ascii_uppercase();
        // Column-level and proxy grants stay unmanaged.
        if upper.contains('(') || upper == "PROXY" {
            return None;
        }
        if upper == "USAGE" {
            continue;
        }
        privileges.push(if upper == "ALL" {
            ALL_PRIVILEGES.into()
        } else {
            upper
        });
    }
    let (db, table) = split_object(object)?;
    let scope = match (unquote(&db).as_str(), unquote(&table).as_str()) {
        ("*", "*") => PrivilegeScope::Global,
        (d, "*") => PrivilegeScope::Database {
            database: d.to_string(),
        },
        (d, t) => PrivilegeScope::Table {
            database: d.to_string(),
            table: t.to_string(),
        },
    };
    Some(ParsedGrant::Privileges(ScopeGrant {
        scope,
        privileges,
        with_grant_option: tail.contains("WITH GRANT OPTION"),
    }))
}

// ─── Validation & quoting ────────────────────────────────────────────────────

fn validate_account(user: &str, host: &str) -> Result<(), PyroError> {
    let bad = |s: &str| s.chars().any(|c| c.is_control());
    if user.trim().is_empty() || user.chars().count() > 80 || bad(user) {
        return Err(PyroError::InvalidOperation(
            "Nombre de usuario no válido (1-80 caracteres, sin caracteres de control).".into(),
        ));
    }
    if host.trim().is_empty() || host.chars().count() > 255 || bad(host) {
        return Err(PyroError::InvalidOperation(
            "Host no válido (por ejemplo: %, localhost, 10.0.0.%).".into(),
        ));
    }
    Ok(())
}

fn account(user: &str, host: &str) -> String {
    format!(
        "'{}'@'{}'",
        escape_sql_string(user),
        escape_sql_string(host)
    )
}

fn role_sql(role: &RoleRef) -> Result<String, PyroError> {
    validate_account(&role.name, role.host.as_deref().unwrap_or("%"))?;
    Ok(match &role.host {
        Some(h) => account(&role.name, h),
        None => format!("'{}'", escape_sql_string(&role.name)),
    })
}

/// Privilege names are keywords: only letters, digits, `_` and single spaces.
fn validate_privilege(p: &str) -> Result<String, PyroError> {
    let normalized = p.split_whitespace().collect::<Vec<_>>().join(" ");
    let upper = normalized.to_ascii_uppercase();
    let ok = !upper.is_empty()
        && upper.len() <= 64
        && upper
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_' || c == ' ');
    if ok {
        Ok(upper)
    } else {
        Err(PyroError::InvalidOperation(format!(
            "Privilegio no válido: {p}"
        )))
    }
}

fn scope_sql(scope: &PrivilegeScope) -> Result<String, PyroError> {
    let name = |s: &str| -> Result<String, PyroError> {
        if s.is_empty() || s.chars().count() > 64 || s.chars().any(|c| c.is_control()) {
            return Err(PyroError::InvalidOperation(format!(
                "Nombre de objeto no válido: {s}"
            )));
        }
        Ok(quote_ident_mysql(s))
    };
    Ok(match scope {
        PrivilegeScope::Global => "*.*".into(),
        PrivilegeScope::Database { database } => format!("{}.*", name(database)?),
        PrivilegeScope::Table { database, table } => {
            format!("{}.{}", name(database)?, name(table)?)
        }
    })
}

fn password_clause(
    is_mariadb: bool,
    plugin: Option<&str>,
    password: &str,
) -> Result<(String, String), PyroError> {
    let literal = format!("'{}'", escape_sql_string(password));
    let plugin = match plugin.map(str::trim).filter(|p| !p.is_empty()) {
        None => None,
        Some(p) if AUTH_PLUGINS.contains(&p) => Some(p),
        Some(p) => {
            return Err(PyroError::InvalidOperation(format!(
                "Plugin de autenticación no soportado: {p}"
            )))
        }
    };
    let make = |secret: &str| match plugin {
        Some(p) if is_mariadb => format!("IDENTIFIED VIA {p} USING PASSWORD({secret})"),
        Some(p) => format!("IDENTIFIED WITH {p} BY {secret}"),
        None => format!("IDENTIFIED BY {secret}"),
    };
    Ok((make(&literal), make(PASSWORD_MASK)))
}

// ─── Planning ────────────────────────────────────────────────────────────────

fn normalized_grants(
    grants: &[ScopeGrant],
) -> Result<Vec<(PrivilegeScope, BTreeSet<String>, bool)>, PyroError> {
    let mut out: Vec<(PrivilegeScope, BTreeSet<String>, bool)> = Vec::new();
    for g in grants {
        scope_sql(&g.scope)?;
        let mut set = BTreeSet::new();
        for p in &g.privileges {
            let p = validate_privilege(p)?;
            match p.as_str() {
                "USAGE" => {}
                GRANT_OPTION => {}
                "ALL" => {
                    set.insert(ALL_PRIVILEGES.to_string());
                }
                _ => {
                    set.insert(p);
                }
            }
        }
        let grant_option = g.with_grant_option
            || g.privileges
                .iter()
                .any(|p| p.eq_ignore_ascii_case(GRANT_OPTION));
        if set.contains(ALL_PRIVILEGES) {
            set.retain(|p| p == ALL_PRIVILEGES);
        }
        match out.iter_mut().find(|(s, _, _)| *s == g.scope) {
            Some(entry) => {
                entry.1.extend(set);
                entry.2 |= grant_option;
            }
            None => out.push((g.scope.clone(), set, grant_option)),
        }
    }
    Ok(out)
}

fn join(set: &BTreeSet<String>) -> String {
    set.iter().cloned().collect::<Vec<_>>().join(", ")
}

/// Statements that turn `current` (None = account to create) into `desired`.
pub fn build_user_plan(
    is_mariadb: bool,
    current: Option<&UserPermissions>,
    desired: &UserChangeRequest,
) -> Result<Vec<PlannedStatement>, PyroError> {
    validate_account(&desired.user, &desired.host)?;
    let acct = account(&desired.user, &desired.host);
    let mut plan = Vec::new();

    let default_attrs = AccountAttributes::default();
    let current_attrs = match (current, &desired.create) {
        (Some(c), None) => &c.attributes,
        (None, Some(new)) => {
            let (sql, display) = match new.password.as_deref().filter(|p| !p.is_empty()) {
                Some(pw) => password_clause(is_mariadb, new.plugin.as_deref(), pw)?,
                None => (String::new(), String::new()),
            };
            let with = |clause: &str| {
                if clause.is_empty() {
                    format!("CREATE USER {acct}")
                } else {
                    format!("CREATE USER {acct} {clause}")
                }
            };
            plan.push(PlannedStatement {
                sql: with(&sql),
                display_sql: with(&display),
            });
            &default_attrs
        }
        (Some(_), Some(_)) => {
            return Err(PyroError::InvalidOperation(format!(
                "La cuenta {acct} ya existe."
            )))
        }
        (None, None) => {
            return Err(PyroError::InvalidOperation(format!(
                "La cuenta {acct} no existe."
            )))
        }
    };

    // Password change on an existing account keeps its plugin.
    if current.is_some() {
        if let Some(pw) = desired.new_password.as_deref().filter(|p| !p.is_empty()) {
            let plugin = current_attrs
                .plugin
                .as_deref()
                .filter(|p| AUTH_PLUGINS.contains(p));
            let (sql, display) = password_clause(is_mariadb, plugin, pw)?;
            plan.push(PlannedStatement {
                sql: format!("ALTER USER {acct} {sql}"),
                display_sql: format!("ALTER USER {acct} {display}"),
            });
        }
    }

    plan.extend(
        attribute_statements(&acct, current_attrs, &desired.attributes)
            .into_iter()
            .map(PlannedStatement::plain),
    );
    plan.extend(
        grant_statements(
            &acct,
            current.map(|c| c.grants.as_slice()).unwrap_or(&[]),
            &desired.grants,
        )?
        .into_iter()
        .map(PlannedStatement::plain),
    );
    plan.extend(
        role_statements(
            &acct,
            current.map(|c| c.roles.as_slice()).unwrap_or(&[]),
            &desired.roles,
        )?
        .into_iter()
        .map(PlannedStatement::plain),
    );
    Ok(plan)
}

fn attribute_statements(
    acct: &str,
    cur: &AccountAttributes,
    want: &AccountAttributes,
) -> Vec<String> {
    let mut out = Vec::new();
    if want.tls != cur.tls && want.tls != TlsRequirement::Specified {
        let req = match want.tls {
            TlsRequirement::Ssl => "SSL",
            TlsRequirement::X509 => "X509",
            _ => "NONE",
        };
        out.push(format!("ALTER USER {acct} REQUIRE {req}"));
    }
    let limits = [
        (
            "MAX_QUERIES_PER_HOUR",
            cur.max_queries_per_hour,
            want.max_queries_per_hour,
        ),
        (
            "MAX_UPDATES_PER_HOUR",
            cur.max_updates_per_hour,
            want.max_updates_per_hour,
        ),
        (
            "MAX_CONNECTIONS_PER_HOUR",
            cur.max_connections_per_hour,
            want.max_connections_per_hour,
        ),
        (
            "MAX_USER_CONNECTIONS",
            cur.max_user_connections,
            want.max_user_connections,
        ),
    ];
    let changed: Vec<String> = limits
        .iter()
        .filter(|(_, c, w)| c != w)
        .map(|(name, _, w)| format!("{name} {w}"))
        .collect();
    if !changed.is_empty() {
        out.push(format!("ALTER USER {acct} WITH {}", changed.join(" ")));
    }
    if want.password_expiry != cur.password_expiry {
        let policy = match want.password_expiry {
            PasswordExpiry::Default => "PASSWORD EXPIRE DEFAULT".to_string(),
            PasswordExpiry::Never => "PASSWORD EXPIRE NEVER".to_string(),
            PasswordExpiry::Interval { days } => {
                format!("PASSWORD EXPIRE INTERVAL {} DAY", days.clamp(1, 65535))
            }
        };
        out.push(format!("ALTER USER {acct} {policy}"));
    }
    // Only "expire now" can be requested; un-expiring happens by setting a password.
    if want.password_expired && !cur.password_expired {
        out.push(format!("ALTER USER {acct} PASSWORD EXPIRE"));
    }
    if want.account_locked != cur.account_locked {
        let lock = if want.account_locked {
            "LOCK"
        } else {
            "UNLOCK"
        };
        out.push(format!("ALTER USER {acct} ACCOUNT {lock}"));
    }
    out
}

fn grant_statements(
    acct: &str,
    current: &[ScopeGrant],
    desired: &[ScopeGrant],
) -> Result<Vec<String>, PyroError> {
    let cur = normalized_grants(current)?;
    let want = normalized_grants(desired)?;
    let empty = BTreeSet::new();
    let mut scopes: Vec<&PrivilegeScope> = cur
        .iter()
        .map(|g| &g.0)
        .chain(want.iter().map(|g| &g.0))
        .collect();
    scopes.sort();
    scopes.dedup();

    let mut revokes = Vec::new();
    let mut grants = Vec::new();
    for scope in scopes {
        let target = scope_sql(scope)?;
        let (have, have_opt) = cur
            .iter()
            .find(|g| &g.0 == scope)
            .map(|g| (&g.1, g.2))
            .unwrap_or((&empty, false));
        let (need, need_opt) = want
            .iter()
            .find(|g| &g.0 == scope)
            .map(|g| (&g.1, g.2))
            .unwrap_or((&empty, false));

        let had_all = have.contains(ALL_PRIVILEGES);
        let wants_all = need.contains(ALL_PRIVILEGES);
        let (to_revoke, to_grant): (BTreeSet<String>, BTreeSet<String>) = if had_all && !wants_all {
            // ALL cannot be partially revoked: drop it and grant the explicit list.
            let all: BTreeSet<String> = [ALL_PRIVILEGES.to_string()].into();
            (all, need.clone())
        } else {
            (
                have.difference(need).cloned().collect(),
                need.difference(have).cloned().collect(),
            )
        };

        if !to_revoke.is_empty() {
            revokes.push(format!(
                "REVOKE {} ON {target} FROM {acct}",
                join(&to_revoke)
            ));
        }
        if have_opt && !need_opt {
            revokes.push(format!("REVOKE GRANT OPTION ON {target} FROM {acct}"));
        }
        let option = if need_opt && !have_opt {
            " WITH GRANT OPTION"
        } else {
            ""
        };
        if !to_grant.is_empty() {
            grants.push(format!(
                "GRANT {} ON {target} TO {acct}{option}",
                join(&to_grant)
            ));
        } else if !option.is_empty() {
            grants.push(format!("GRANT USAGE ON {target} TO {acct}{option}"));
        }
    }
    revokes.extend(grants);
    Ok(revokes)
}

fn role_statements(
    acct: &str,
    current: &[RoleRef],
    desired: &[RoleRef],
) -> Result<Vec<String>, PyroError> {
    let mut out = Vec::new();
    for r in current.iter().filter(|r| !desired.contains(r)) {
        out.push(format!("REVOKE {} FROM {acct}", role_sql(r)?));
    }
    for r in desired.iter().filter(|r| !current.contains(r)) {
        out.push(format!("GRANT {} TO {acct}", role_sql(r)?));
    }
    Ok(out)
}

/// `DROP USER` for one account.
pub fn build_drop_user(user: &str, host: &str) -> Result<String, PyroError> {
    validate_account(user, host)?;
    Ok(format!("DROP USER {}", account(user, host)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn existing(grants: &[&str]) -> UserPermissions {
        build_permissions(
            "ana",
            "%",
            AccountAttributes::default(),
            grants.iter().map(|s| s.to_string()).collect(),
        )
    }

    fn request_from(p: &UserPermissions) -> UserChangeRequest {
        UserChangeRequest {
            user: p.user.clone(),
            host: p.host.clone(),
            create: None,
            new_password: None,
            attributes: p.attributes.clone(),
            grants: p.grants.clone(),
            roles: p.roles.clone(),
        }
    }

    fn sql(plan: &[PlannedStatement]) -> Vec<String> {
        plan.iter().map(|s| s.sql.clone()).collect()
    }

    #[test]
    fn parses_global_database_table_and_role_grants() {
        let p = existing(&[
            "GRANT RELOAD, PROCESS ON *.* TO `ana`@`%` IDENTIFIED BY PASSWORD '*ABC'",
            "GRANT SELECT, INSERT ON `shop`.* TO `ana`@`%` WITH GRANT OPTION",
            "GRANT ALL PRIVILEGES ON `shop`.`or``ders` TO `ana`@`%`",
            "GRANT SELECT (id), UPDATE (name) ON `shop`.`users` TO `ana`@`%`",
            "GRANT EXECUTE ON PROCEDURE `shop`.`p` TO `ana`@`%`",
            "GRANT `reader`@`%`,`writer`@`%` TO `ana`@`%`",
            "GRANT `analyst` TO `ana`@`%`",
        ]);
        assert_eq!(p.grants.len(), 3);
        assert_eq!(p.grants[0].scope, PrivilegeScope::Global);
        assert_eq!(p.grants[0].privileges, vec!["RELOAD", "PROCESS"]);
        assert!(p.grants[1].with_grant_option);
        assert_eq!(
            p.grants[2].scope,
            PrivilegeScope::Table {
                database: "shop".into(),
                table: "or`ders".into()
            }
        );
        assert_eq!(p.grants[2].privileges, vec![ALL_PRIVILEGES]);
        assert_eq!(p.unmanaged_grants.len(), 2);
        assert_eq!(
            p.roles,
            vec![
                RoleRef {
                    name: "reader".into(),
                    host: Some("%".into())
                },
                RoleRef {
                    name: "writer".into(),
                    host: Some("%".into())
                },
                RoleRef {
                    name: "analyst".into(),
                    host: None
                },
            ]
        );
    }

    #[test]
    fn usage_only_produces_no_grant() {
        let p = existing(&["GRANT USAGE ON *.* TO `ana`@`%`"]);
        assert!(p.grants.is_empty());
        assert!(p.unmanaged_grants.is_empty());
    }

    #[test]
    fn unchanged_state_plans_nothing() {
        let p = existing(&["GRANT SELECT, INSERT ON `shop`.* TO `ana`@`%` WITH GRANT OPTION"]);
        assert!(build_user_plan(false, Some(&p), &request_from(&p))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn diff_emits_revoke_before_grant() {
        let p = existing(&["GRANT SELECT, INSERT ON `shop`.* TO `ana`@`%`"]);
        let mut req = request_from(&p);
        req.grants[0].privileges = vec!["SELECT".into(), "UPDATE".into()];
        assert_eq!(
            sql(&build_user_plan(false, Some(&p), &req).unwrap()),
            vec![
                "REVOKE INSERT ON `shop`.* FROM 'ana'@'%'",
                "GRANT UPDATE ON `shop`.* TO 'ana'@'%'",
            ]
        );
    }

    #[test]
    fn narrowing_all_privileges_revokes_all_then_grants_list() {
        let p = existing(&["GRANT ALL PRIVILEGES ON `shop`.* TO `ana`@`%`"]);
        let mut req = request_from(&p);
        req.grants[0].privileges = vec!["SELECT".into()];
        assert_eq!(
            sql(&build_user_plan(false, Some(&p), &req).unwrap()),
            vec![
                "REVOKE ALL PRIVILEGES ON `shop`.* FROM 'ana'@'%'",
                "GRANT SELECT ON `shop`.* TO 'ana'@'%'",
            ]
        );
    }

    #[test]
    fn identifiers_and_names_are_escaped() {
        let p = existing(&[]);
        let mut req = request_from(&p);
        req.user = "o'brien".into();
        req.grants = vec![ScopeGrant {
            scope: PrivilegeScope::Table {
                database: "d`b".into(),
                table: "t".into(),
            },
            privileges: vec!["SELECT".into()],
            with_grant_option: false,
        }];
        let plan = build_user_plan(false, Some(&p), &req).unwrap();
        assert_eq!(
            sql(&plan),
            vec!["GRANT SELECT ON `d``b`.`t` TO 'o\\'brien'@'%'"]
        );
    }

    #[test]
    fn injected_privilege_is_rejected() {
        let p = existing(&[]);
        let mut req = request_from(&p);
        req.grants = vec![ScopeGrant {
            scope: PrivilegeScope::Global,
            privileges: vec!["SELECT ON *.* TO x; DROP DATABASE y; --".into()],
            with_grant_option: false,
        }];
        assert!(build_user_plan(false, Some(&p), &req).is_err());
    }

    #[test]
    fn create_masks_password_in_preview() {
        let req = UserChangeRequest {
            user: "bob".into(),
            host: "localhost".into(),
            create: Some(NewAccount {
                password: Some("s3cr'et".into()),
                plugin: Some("ed25519".into()),
            }),
            new_password: None,
            attributes: AccountAttributes {
                account_locked: true,
                ..Default::default()
            },
            grants: vec![ScopeGrant {
                scope: PrivilegeScope::Database {
                    database: "shop".into(),
                },
                privileges: vec!["SELECT".into()],
                with_grant_option: false,
            }],
            roles: vec![],
        };
        let plan = build_user_plan(true, None, &req).unwrap();
        assert_eq!(
            plan[0].sql,
            "CREATE USER 'bob'@'localhost' IDENTIFIED VIA ed25519 USING PASSWORD('s3cr\\'et')"
        );
        assert!(!preview_script(&plan).contains("s3cr"));
        assert!(preview_script(&plan).contains(PASSWORD_MASK));
        assert_eq!(plan[1].sql, "ALTER USER 'bob'@'localhost' ACCOUNT LOCK");
        assert_eq!(plan[2].sql, "GRANT SELECT ON `shop`.* TO 'bob'@'localhost'");

        let mysql = build_user_plan(
            false,
            None,
            &UserChangeRequest {
                create: Some(NewAccount {
                    password: Some("x".into()),
                    plugin: Some("caching_sha2_password".into()),
                }),
                ..req.clone()
            },
        )
        .unwrap();
        assert_eq!(
            mysql[0].sql,
            "CREATE USER 'bob'@'localhost' IDENTIFIED WITH caching_sha2_password BY 'x'"
        );
    }

    #[test]
    fn unknown_plugin_is_rejected() {
        let req = UserChangeRequest {
            user: "bob".into(),
            host: "%".into(),
            create: Some(NewAccount {
                password: Some("x".into()),
                plugin: Some("evil BY 'x'".into()),
            }),
            new_password: None,
            attributes: AccountAttributes::default(),
            grants: vec![],
            roles: vec![],
        };
        assert!(build_user_plan(false, None, &req).is_err());
    }

    #[test]
    fn attribute_changes_generate_alter_user() {
        let p = existing(&[]);
        let mut req = request_from(&p);
        req.attributes.tls = TlsRequirement::Ssl;
        req.attributes.max_user_connections = 5;
        req.attributes.password_expiry = PasswordExpiry::Interval { days: 90 };
        req.attributes.account_locked = true;
        assert_eq!(
            sql(&build_user_plan(false, Some(&p), &req).unwrap()),
            vec![
                "ALTER USER 'ana'@'%' REQUIRE SSL",
                "ALTER USER 'ana'@'%' WITH MAX_USER_CONNECTIONS 5",
                "ALTER USER 'ana'@'%' PASSWORD EXPIRE INTERVAL 90 DAY",
                "ALTER USER 'ana'@'%' ACCOUNT LOCK",
            ]
        );
    }

    #[test]
    fn roles_and_grant_option_diff() {
        let p = existing(&[
            "GRANT SELECT ON `shop`.* TO `ana`@`%` WITH GRANT OPTION",
            "GRANT `reader`@`%` TO `ana`@`%`",
        ]);
        let mut req = request_from(&p);
        req.grants[0].with_grant_option = false;
        req.roles = vec![RoleRef {
            name: "writer".into(),
            host: None,
        }];
        assert_eq!(
            sql(&build_user_plan(false, Some(&p), &req).unwrap()),
            vec![
                "REVOKE GRANT OPTION ON `shop`.* FROM 'ana'@'%'",
                "REVOKE 'reader'@'%' FROM 'ana'@'%'",
                "GRANT 'writer' TO 'ana'@'%'",
            ]
        );
    }

    #[test]
    fn password_change_keeps_plugin_and_is_masked() {
        let mut p = existing(&[]);
        p.attributes.plugin = Some("caching_sha2_password".into());
        let mut req = request_from(&p);
        req.new_password = Some("nueva".into());
        let plan = build_user_plan(false, Some(&p), &req).unwrap();
        assert_eq!(
            plan[0].sql,
            "ALTER USER 'ana'@'%' IDENTIFIED WITH caching_sha2_password BY 'nueva'"
        );
        assert_eq!(
            plan[0].display_sql,
            format!(
                "ALTER USER 'ana'@'%' IDENTIFIED WITH caching_sha2_password BY {PASSWORD_MASK}"
            )
        );
    }

    #[test]
    fn drop_user_is_quoted() {
        assert_eq!(
            build_drop_user("a'b", "%").unwrap(),
            "DROP USER 'a\\'b'@'%'"
        );
        assert!(build_drop_user("", "%").is_err());
    }
}
