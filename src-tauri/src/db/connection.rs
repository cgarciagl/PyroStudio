use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::Row;
use std::path::Path;
use std::time::Instant;

use super::backend::{DatabaseBackend, DirectBackend, TunnelBackend};
use super::credentials;
use super::error::PyroError;
use super::models::{ConnectionConfig, ConnectionInfo, ConnectionStatus, ServerInfo};
use super::ssh::{self, SshTunnel};
use super::state::{ActiveSession, DbState, SessionBackend};
use super::tunnel::TunnelClient;

/// Resolves stored passwords from the encrypted vault if empty in the request config.
pub fn resolve_config_credentials(config: &mut ConnectionConfig) {
    if config.password.as_deref().unwrap_or("").is_empty() {
        let cred_id = config.credential_id.clone().or_else(|| {
            config
                .saved_connection_id
                .as_ref()
                .map(|id| format!("cred-{id}"))
        });
        if let Some(ref cid) = cred_id {
            if let Ok(secret) = credentials::get_credential(cid) {
                config.password = Some(secret);
            }
        }
    }
    if let Some(ref mut tunnel) = config.tunnel {
        if tunnel.http_password.as_deref().unwrap_or("").is_empty() {
            let t_cred_id = tunnel.tunnel_credential_id.clone().or_else(|| {
                config
                    .saved_connection_id
                    .as_ref()
                    .map(|id| format!("tunnel-cred-{id}"))
            });
            if let Some(ref tcid) = t_cred_id {
                if let Ok(secret) = credentials::get_credential(tcid) {
                    tunnel.http_password = Some(secret);
                }
            }
            if tunnel.auth_token.as_deref().unwrap_or("").is_empty() {
                let token_id = tunnel.token_credential_id.clone().or_else(|| {
                    config
                        .saved_connection_id
                        .as_ref()
                        .map(|id| format!("tunnel-token-cred-{id}"))
                });
                if let Some(ref token_id) = token_id {
                    if let Ok(secret) = credentials::get_credential(token_id) {
                        tunnel.auth_token = Some(secret);
                    }
                }
            }
        }
    }
}

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

/// Tests connection without modifying application state.
pub async fn test_connection(mut config: ConnectionConfig) -> Result<ServerInfo, PyroError> {
    resolve_config_credentials(&mut config);

    if config.tunnel.as_ref().is_some_and(|tunnel| tunnel.enabled)
        && config
            .ssh_tunnel
            .as_ref()
            .is_some_and(|tunnel| tunnel.enabled)
    {
        return Err(PyroError::InvalidOperation(
            "Selecciona HTTP Tunnel o SSH Tunnel; no se pueden combinar.".into(),
        ));
    }

    if let Some(ref tunnel_cfg) = config.tunnel {
        if tunnel_cfg.enabled && !tunnel_cfg.url.trim().is_empty() {
            let client = TunnelClient::new(config.clone(), tunnel_cfg.clone())?;
            return client.test_connection().await;
        }
    }

    let ssh_tunnel = open_ssh_if_configured(&mut config).await?;
    let opts = build_connect_options(&config)?;
    let start = Instant::now();

    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect_with(opts)
        .await
        .map_err(|e| PyroError::Connection(format!("Error conectando a MariaDB/MySQL: {e}")))?;

    let elapsed = start.elapsed().as_millis() as u64;

    let row = sqlx::query("SELECT VERSION() AS ver, USER() AS usr, DATABASE() AS cur_db")
        .fetch_one(&pool)
        .await
        .map_err(|e| {
            PyroError::Database(format!("Error obteniendo metadatos del servidor: {e}"))
        })?;

    let version: String = row.try_get("ver").unwrap_or_else(|_| "Desconocido".into());
    let current_user: String = row.try_get("usr").unwrap_or_else(|_| config.user.clone());
    let current_database: Option<String> = row.try_get("cur_db").ok();

    pool.close().await;
    drop(ssh_tunnel);

    Ok(ServerInfo {
        version,
        current_user,
        current_database,
        ping_ms: elapsed,
    })
}

/// Connects to database and returns a standalone ActiveSession (used for tests and cross-connection compare).
pub async fn create_standalone_session(
    mut config: ConnectionConfig,
) -> Result<ActiveSession, PyroError> {
    resolve_config_credentials(&mut config);

    if config.tunnel.as_ref().is_some_and(|tunnel| tunnel.enabled)
        && config
            .ssh_tunnel
            .as_ref()
            .is_some_and(|tunnel| tunnel.enabled)
    {
        return Err(PyroError::InvalidOperation(
            "Selecciona HTTP Tunnel o SSH Tunnel; no se pueden combinar.".into(),
        ));
    }

    if let Some(ref tunnel_cfg) = config.tunnel {
        if tunnel_cfg.enabled && !tunnel_cfg.url.trim().is_empty() {
            let client = TunnelClient::new(config.clone(), tunnel_cfg.clone())?;
            let server_info = client.test_connection().await?;

            return Ok(ActiveSession {
                backend: SessionBackend::Tunnel(TunnelBackend::new(client)),
                config,
                server_info,
            });
        }
    }

    let saved_config = config.clone();
    let ssh_tunnel = open_ssh_if_configured(&mut config).await?;
    let opts = build_connect_options(&config)?;
    let start = Instant::now();

    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .min_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(8))
        .connect_with(opts)
        .await
        .map_err(|e| PyroError::Connection(format!("Error conectando a MariaDB: {e}")))?;

    let elapsed = start.elapsed().as_millis() as u64;

    let row = sqlx::query("SELECT VERSION() AS ver, USER() AS usr, DATABASE() AS cur_db")
        .fetch_one(&pool)
        .await
        .map_err(|e| {
            PyroError::Database(format!("Error consultando información del servidor: {e}"))
        })?;

    let version: String = row.try_get("ver").unwrap_or_else(|_| "Desconocido".into());
    let current_user: String = row.try_get("usr").unwrap_or_else(|_| config.user.clone());
    let current_database: Option<String> = row.try_get("cur_db").ok();

    let server_info = ServerInfo {
        version,
        current_user,
        current_database,
        ping_ms: elapsed,
    };

    let direct_backend = DirectBackend::new(pool);
    let backend = if let Some(tunnel) = ssh_tunnel {
        SessionBackend::Ssh {
            backend: direct_backend,
            tunnel,
        }
    } else {
        SessionBackend::Direct(direct_backend)
    };

    Ok(ActiveSession {
        backend,
        config: saved_config,
        server_info,
    })
}

/// Connects to database and saves session in DbState.
pub async fn connect(config: ConnectionConfig, state: &DbState) -> Result<ServerInfo, PyroError> {
    let session = create_standalone_session(config).await?;
    let server_info = session.server_info.clone();

    let mut session_guard = state.session.write().await;
    if let Some(old_session) = session_guard.take() {
        old_session.backend.close().await;
    }

    *session_guard = Some(session);

    Ok(server_info)
}

async fn open_ssh_if_configured(
    config: &mut ConnectionConfig,
) -> Result<Option<SshTunnel>, PyroError> {
    let Some(ssh_config) = config.ssh_tunnel.as_ref().filter(|ssh| ssh.enabled) else {
        return Ok(None);
    };
    let tunnel = ssh::open_tunnel(ssh_config).await?;
    config.host = "127.0.0.1".to_string();
    config.port = tunnel.local_port();
    Ok(Some(tunnel))
}

/// Closes the current active session.
pub async fn disconnect(state: &DbState) -> Result<(), PyroError> {
    let mut session_guard = state.session.write().await;
    if let Some(session) = session_guard.take() {
        session.backend.close().await;
    }
    Ok(())
}

/// Returns current connection status.
pub async fn get_connection_status(state: &DbState) -> Result<ConnectionStatus, PyroError> {
    let session_guard = state.session.read().await;
    match &*session_guard {
        Some(session) => {
            let info = ConnectionInfo {
                host: session.config.host.clone(),
                port: session.config.port,
                username: session.config.user.clone(),
                user: session.config.user.clone(),
                database: session.config.database.clone(),
                tunnel_enabled: session
                    .config
                    .tunnel
                    .as_ref()
                    .map(|t| t.enabled)
                    .unwrap_or(false),
                credential_id: session.config.credential_id.clone(),
                saved_connection_name: session.config.saved_connection_name.clone(),
            };
            Ok(ConnectionStatus {
                is_connected: true,
                connection_info: Some(info.clone()),
                config: Some(info),
                server_info: Some(session.server_info.clone()),
            })
        }
        None => Ok(ConnectionStatus {
            is_connected: false,
            connection_info: None,
            config: None,
            server_info: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{HttpTunnelConfig, SshTunnelConfig, TlsConfig};

    fn config(tls: Option<TlsConfig>) -> ConnectionConfig {
        ConnectionConfig {
            host: "db.example.test".into(),
            port: 3306,
            user: "test".into(),
            password: None,
            credential_id: None,
            database: None,
            tunnel: Some(HttpTunnelConfig {
                enabled: false,
                url: String::new(),
                http_user: None,
                http_password: None,
                auth_token: None,
                tunnel_credential_id: None,
                token_credential_id: None,
                encode_base64: None,
                timeout_seconds: None,
                max_response_bytes: None,
            }),
            tls,
            ssh_tunnel: Some(SshTunnelConfig {
                enabled: false,
                ssh_host: String::new(),
                ssh_port: 22,
                ssh_user: String::new(),
                remote_host: String::new(),
                remote_port: 3306,
                authentication: Default::default(),
                private_key_path: None,
            }),
            saved_connection_id: None,
            saved_connection_name: None,
        }
    }

    #[test]
    fn tls_enabled_uses_identity_verification_by_default() {
        let options = build_connect_options(&config(Some(TlsConfig {
            enabled: true,
            ca_cert_path: None,
            verify_certificate: true,
            allow_insecure_tls: false,
        })));
        assert!(options.is_ok());
    }

    #[test]
    fn disabling_tls_verification_requires_explicit_acknowledgement() {
        let mut tls = TlsConfig {
            enabled: true,
            ca_cert_path: None,
            verify_certificate: false,
            allow_insecure_tls: false,
        };
        assert!(build_connect_options(&config(Some(tls.clone()))).is_err());
        tls.allow_insecure_tls = true;
        assert!(build_connect_options(&config(Some(tls))).is_ok());
    }

    #[test]
    fn custom_ca_path_is_accepted_with_certificate_verification() {
        let options = build_connect_options(&config(Some(TlsConfig {
            enabled: true,
            ca_cert_path: Some("C:\\certs\\database-ca.pem".into()),
            verify_certificate: true,
            allow_insecure_tls: false,
        })));
        assert!(options.is_ok());
    }

    #[test]
    fn connection_serialization_never_exposes_passwords_or_tunnel_tokens() {
        let mut config = config(None);
        config.password = Some("db-secret-value".into());
        let tunnel = config.tunnel.as_mut().unwrap();
        tunnel.http_password = Some("basic-secret-value".into());
        tunnel.auth_token = Some("bearer-secret-value".into());
        let serialized = serde_json::to_string(&config).unwrap();
        assert!(!serialized.contains("db-secret-value"));
        assert!(!serialized.contains("basic-secret-value"));
        assert!(!serialized.contains("bearer-secret-value"));
    }
}
