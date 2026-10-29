use super::backend::{DatabaseBackend, TunnelBackend};
use super::credentials;
use super::engine::DbEngine;
use super::error::PyroError;
use super::models::{
    ConnectionConfig, ConnectionInfo, ConnectionStatus, HttpTunnelConfig, ServerInfo,
};
use super::mysql;
use super::sqlite;
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

/// Tests connection without modifying application state.
pub async fn test_connection(mut config: ConnectionConfig) -> Result<ServerInfo, PyroError> {
    resolve_config_credentials(&mut config);

    ensure_single_tunnel(&config)?;

    if let Some(tunnel_cfg) = active_http_tunnel(&config) {
        let client = TunnelClient::new(config.clone(), tunnel_cfg.clone())?;
        return client.test_connection().await;
    }

    match config.engine {
        DbEngine::Sqlite => sqlite::connect::probe_file(sqlite_file(&config)?).await,
        DbEngine::MySql => {
            let ssh_tunnel = open_ssh_if_configured(&mut config).await?;
            let server_info = mysql::connect::probe_server(&config).await;
            drop(ssh_tunnel);
            server_info
        }
    }
}

/// Connects to database and returns a standalone ActiveSession (used for tests and cross-connection compare).
pub async fn create_standalone_session(
    mut config: ConnectionConfig,
) -> Result<ActiveSession, PyroError> {
    resolve_config_credentials(&mut config);

    ensure_single_tunnel(&config)?;

    if let Some(tunnel_cfg) = active_http_tunnel(&config) {
        let client = TunnelClient::new(config.clone(), tunnel_cfg.clone())?;
        let server_info = client.test_connection().await?;
        return Ok(ActiveSession {
            backend: SessionBackend::Tunnel(Box::new(TunnelBackend::new(client))),
            config,
            server_info,
        });
    }

    if config.engine == DbEngine::Sqlite {
        let (backend, server_info) = sqlite::connect::open_backend(sqlite_file(&config)?).await?;
        return Ok(ActiveSession {
            backend: SessionBackend::Sqlite(backend),
            config,
            server_info,
        });
    }

    let saved_config = config.clone();
    let ssh_tunnel = open_ssh_if_configured(&mut config).await?;
    let (direct_backend, server_info) = mysql::connect::open_backend(&config).await?;
    let backend = match ssh_tunnel {
        Some(tunnel) => SessionBackend::Ssh {
            backend: direct_backend,
            tunnel,
        },
        None => SessionBackend::Direct(direct_backend),
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

fn ensure_single_tunnel(config: &ConnectionConfig) -> Result<(), PyroError> {
    let http_enabled = config.tunnel.as_ref().is_some_and(|tunnel| tunnel.enabled);
    let ssh_enabled = config
        .ssh_tunnel
        .as_ref()
        .is_some_and(|tunnel| tunnel.enabled);
    if http_enabled && ssh_enabled {
        return Err(PyroError::InvalidOperation(
            "Selecciona HTTP Tunnel o SSH Tunnel; no se pueden combinar.".into(),
        ));
    }
    Ok(())
}

fn sqlite_file(config: &ConnectionConfig) -> Result<&str, PyroError> {
    config
        .file_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| {
            PyroError::InvalidOperation("Selecciona el archivo de la base de datos SQLite.".into())
        })
}

fn active_http_tunnel(config: &ConnectionConfig) -> Option<&HttpTunnelConfig> {
    config
        .tunnel
        .as_ref()
        .filter(|tunnel| tunnel.enabled && !tunnel.url.trim().is_empty())
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
                engine: session.config.engine,
                file_path: session.config.file_path.clone(),
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
                saved_connection_id: session.config.saved_connection_id.clone(),
                environment: session.config.environment.clone(),
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
    use crate::db::models::{SshTunnelConfig, TlsConfig};

    fn config(tls: Option<TlsConfig>) -> ConnectionConfig {
        ConnectionConfig {
            engine: Default::default(),
            file_path: None,
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
            environment: None,
        }
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
