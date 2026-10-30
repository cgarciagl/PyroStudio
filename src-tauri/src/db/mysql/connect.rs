use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::{MySqlPool, Row};
use std::path::Path;
use std::time::{Duration, Instant};

use super::backend::DirectBackend;
use crate::db::error::PyroError;
use crate::db::models::{ConnectionConfig, ServerInfo};

/// Builds SQLx MySqlConnectOptions from ConnectionConfig.
pub fn build_connect_options(config: &ConnectionConfig) -> Result<MySqlConnectOptions, PyroError> {
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

    if let Some(tls) = &config.tls {
        if tls.enabled {
            let mode = if tls.verify_certificate {
                if config
                    .ssh_tunnel
                    .as_ref()
                    .is_some_and(|tunnel| tunnel.enabled)
                {
                    MySqlSslMode::VerifyCa
                } else {
                    MySqlSslMode::VerifyIdentity
                }
            } else if tls.allow_insecure_tls {
                MySqlSslMode::Required
            } else {
                return Err(PyroError::InvalidOperation(
                    "Desactivar la validación de certificados requiere habilitar explícitamente «Permitir TLS inseguro».".into(),
                ));
            };
            opts = opts.ssl_mode(mode);
            if let Some(ca_path) = tls
                .ca_cert_path
                .as_deref()
                .filter(|path| !path.trim().is_empty())
            {
                opts = opts.ssl_ca(Path::new(ca_path));
            }
        } else {
            opts = opts.ssl_mode(MySqlSslMode::Disabled);
        }
    }

    Ok(opts)
}

/// Opens a short-lived single connection to validate the settings.
pub async fn probe_server(config: &ConnectionConfig) -> Result<ServerInfo, PyroError> {
    let opts = build_connect_options(config)?;
    let start = Instant::now();
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(opts)
        .await
        .map_err(|e| PyroError::Connection(format!("Error conectando a MariaDB/MySQL: {e}")))?;
    let ping_ms = start.elapsed().as_millis() as u64;

    let server_info = fetch_server_info(&pool, &config.user, ping_ms)
        .await
        .map_err(|e| PyroError::Database(format!("Error obteniendo metadatos del servidor: {e}")));
    pool.close().await;
    server_info
}

/// Opens the pool used by an interactive session.
pub async fn open_backend(
    config: &ConnectionConfig,
) -> Result<(DirectBackend, ServerInfo), PyroError> {
    let opts = build_connect_options(config)?;
    let start = Instant::now();
    let read_only = config.read_only;
    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(8))
        // Second barrier for read-only connections: the server itself rejects
        // writes, even those hidden in stored functions.
        .after_connect(move |conn, _meta| {
            Box::pin(async move {
                if read_only {
                    sqlx::query("SET SESSION TRANSACTION READ ONLY")
                        .execute(conn)
                        .await?;
                }
                Ok(())
            })
        })
        .connect_with(opts)
        .await
        .map_err(|e| PyroError::Connection(format!("Error conectando a MariaDB: {e}")))?;
    let ping_ms = start.elapsed().as_millis() as u64;

    let server_info = fetch_server_info(&pool, &config.user, ping_ms)
        .await
        .map_err(|e| {
            PyroError::Database(format!("Error consultando información del servidor: {e}"))
        })?;
    Ok((DirectBackend::new(pool), server_info))
}

async fn fetch_server_info(
    pool: &MySqlPool,
    configured_user: &str,
    ping_ms: u64,
) -> Result<ServerInfo, sqlx::Error> {
    let row = sqlx::query("SELECT VERSION() AS ver, USER() AS usr, DATABASE() AS cur_db")
        .fetch_one(pool)
        .await?;
    Ok(ServerInfo {
        version: row.try_get("ver").unwrap_or_else(|_| "Desconocido".into()),
        current_user: row
            .try_get("usr")
            .unwrap_or_else(|_| configured_user.to_string()),
        current_database: row.try_get("cur_db").ok(),
        ping_ms,
        warnings: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::TlsConfig;

    fn config_with_tls(tls: TlsConfig) -> ConnectionConfig {
        ConnectionConfig {
            engine: Default::default(),
            file_path: None,
            host: "db.example.test".into(),
            port: 3306,
            user: "test".into(),
            password: None,
            credential_id: None,
            database: None,
            tunnel: None,
            tls: Some(tls),
            ssh_tunnel: None,
            saved_connection_id: None,
            saved_connection_name: None,
            environment: None,
            read_only: false,
        }
    }

    fn tls(verify_certificate: bool, allow_insecure_tls: bool) -> TlsConfig {
        TlsConfig {
            enabled: true,
            ca_cert_path: None,
            verify_certificate,
            allow_insecure_tls,
        }
    }

    #[test]
    fn tls_enabled_uses_identity_verification_by_default() {
        assert!(build_connect_options(&config_with_tls(tls(true, false))).is_ok());
    }

    #[test]
    fn disabling_tls_verification_requires_explicit_acknowledgement() {
        assert!(build_connect_options(&config_with_tls(tls(false, false))).is_err());
        assert!(build_connect_options(&config_with_tls(tls(false, true))).is_ok());
    }

    #[test]
    fn custom_ca_path_is_accepted_with_certificate_verification() {
        let mut tls = tls(true, false);
        tls.ca_cert_path = Some(r"C:\certs\database-ca.pem".into());
        assert!(build_connect_options(&config_with_tls(tls)).is_ok());
    }
}
