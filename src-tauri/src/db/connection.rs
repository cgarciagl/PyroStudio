use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::Row;
use std::time::Instant;

use super::backend::{DatabaseBackend, DirectBackend, TunnelBackend};
use super::credentials;
use super::error::PyroError;
use super::models::{ConnectionConfig, ConnectionInfo, ConnectionStatus, ServerInfo};
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
        }
    }
}

/// Builds SQLx MySqlConnectOptions from ConnectionConfig.
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

/// Tests connection without modifying application state.
pub async fn test_connection(mut config: ConnectionConfig) -> Result<ServerInfo, PyroError> {
    resolve_config_credentials(&mut config);

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

    Ok(ServerInfo {
        version,
        current_user,
        current_database,
        ping_ms: elapsed,
    })
}

/// Connects to database and saves session in DbState.
pub async fn connect(
    mut config: ConnectionConfig,
    state: &DbState,
) -> Result<ServerInfo, PyroError> {
    resolve_config_credentials(&mut config);

    if let Some(ref tunnel_cfg) = config.tunnel {
        if tunnel_cfg.enabled && !tunnel_cfg.url.trim().is_empty() {
            let client = TunnelClient::new(config.clone(), tunnel_cfg.clone());
            let server_info = client.test_connection().await?;

            let mut session_guard = state.session.write().await;
            if let Some(old_session) = session_guard.take() {
                old_session.backend.close().await;
            }

            *session_guard = Some(ActiveSession {
                backend: SessionBackend::Tunnel(TunnelBackend::new(client)),
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

    let mut session_guard = state.session.write().await;
    if let Some(old_session) = session_guard.take() {
        old_session.backend.close().await;
    }

    *session_guard = Some(ActiveSession {
        backend: SessionBackend::Direct(DirectBackend::new(pool)),
        config,
        server_info: server_info.clone(),
    });

    Ok(server_info)
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
