use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{DatabaseUserMetadata, UserPrivilegeInfo};

/// Lists server users and their authentication plugins and lock statuses.
pub async fn list_database_users(
    backend: &dyn DatabaseBackend,
) -> Result<Vec<DatabaseUserMetadata>, PyroError> {
    let sql = r#"
        SELECT 
            User, 
            Host, 
            COALESCE(plugin, '') AS plugin,
            account_locked,
            password_expired
        FROM mysql.user
        ORDER BY User ASC, Host ASC;
    "#;

    let res = backend.execute_query(sql, None).await?;
    let mut users = Vec::new();

    for r in res.rows {
        let user = r
            .first()
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let host = r
            .get(1)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let plugin = r.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());
        let account_locked = r
            .get(3)
            .and_then(|v| {
                v.as_str()
                    .map(|s| s.eq_ignore_ascii_case("Y"))
                    .or_else(|| v.as_bool())
            })
            .unwrap_or(false);
        let password_expired = r
            .get(4)
            .and_then(|v| {
                v.as_str()
                    .map(|s| s.eq_ignore_ascii_case("Y"))
                    .or_else(|| v.as_bool())
            })
            .unwrap_or(false);

        if !user.is_empty() {
            users.push(DatabaseUserMetadata {
                user,
                host,
                plugin,
                account_locked,
                password_expired,
            });
        }
    }

    Ok(users)
}

/// Retrieves the effective grants of a user.
pub async fn get_user_grants(
    backend: &dyn DatabaseBackend,
    user: &str,
    host: &str,
) -> Result<UserPrivilegeInfo, PyroError> {
    let clean_user = user.replace('\'', "''");
    let clean_host = host.replace('\'', "''");
    let sql = format!("SHOW GRANTS FOR '{clean_user}'@'{clean_host}';");

    let res = backend.execute_query(&sql, None).await?;
    let mut grants = Vec::new();

    for r in res.rows {
        if let Some(grant_str) = r.first().and_then(|v| v.as_str()) {
            grants.push(grant_str.to_string());
        }
    }

    Ok(UserPrivilegeInfo {
        user: user.to_string(),
        host: host.to_string(),
        grants,
    })
}
