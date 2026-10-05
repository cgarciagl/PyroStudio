use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::{sleep, Instant};

use super::error::PyroError;
use super::models::{SshAuthentication, SshTunnelConfig};

#[derive(Clone)]
pub struct SshTunnel {
    local_port: u16,
    child: Arc<Mutex<Child>>,
}

impl SshTunnel {
    pub fn local_port(&self) -> u16 {
        self.local_port
    }

    pub fn close(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        if Arc::strong_count(&self.child) == 1 {
            self.close();
        }
    }
}

pub async fn open_tunnel(config: &SshTunnelConfig) -> Result<SshTunnel, PyroError> {
    validate_config(config)?;
    let local_port = reserve_local_port()?;
    let mut command = Command::new("ssh");
    command
        .arg("-N")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-o")
        .arg("ConnectTimeout=8")
        .arg("-p")
        .arg(config.ssh_port.to_string())
        .arg("-L")
        .arg(format!(
            "127.0.0.1:{local_port}:{}:{}",
            format_remote_host(&config.remote_host),
            config.remote_port
        ));

    match &config.authentication {
        SshAuthentication::Agent => {}
        SshAuthentication::PrivateKey => {
            let key_path = config
                .private_key_path
                .as_deref()
                .filter(|path| !path.trim().is_empty())
                .ok_or_else(|| PyroError::Connection("Falta la ruta de la clave SSH".into()))?;
            command
                .arg("-i")
                .arg(key_path)
                .arg("-o")
                .arg("IdentitiesOnly=yes");
        }
    }

    let child = command
        .arg("-l")
        .arg(&config.ssh_user)
        .arg(&config.ssh_host)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| PyroError::Connection(format!("No se pudo iniciar OpenSSH: {error}")))?;
    let child = Arc::new(Mutex::new(child));
    let deadline = Instant::now() + Duration::from_secs(10);
    let tunnel = SshTunnel { local_port, child };

    loop {
        if TcpStream::connect(("127.0.0.1", local_port)).await.is_ok() {
            return Ok(tunnel);
        }
        let exited = tunnel
            .child
            .lock()
            .map_err(|_| PyroError::Connection("Estado SSH no disponible".into()))?
            .try_wait()
            .map_err(|error| PyroError::Connection(format!("Error comprobando SSH: {error}")))?
            .is_some();
        if exited {
            return Err(PyroError::Connection(
                "El túnel SSH terminó antes de abrir el reenvío. Comprueba autenticación, host y puerto.".into(),
            ));
        }
        if Instant::now() >= deadline {
            return Err(PyroError::Connection(
                "Tiempo agotado esperando el reenvío SSH.".into(),
            ));
        }
        sleep(Duration::from_millis(100)).await;
    }
}

fn validate_config(config: &SshTunnelConfig) -> Result<(), PyroError> {
    if !config.enabled
        || !is_safe_host(&config.ssh_host)
        || !is_safe_host(&config.remote_host)
        || config.ssh_user.is_empty()
        || !config
            .ssh_user
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "._-".contains(ch))
        || config.ssh_port == 0
        || config.remote_port == 0
    {
        return Err(PyroError::Connection(
            "La configuración del túnel SSH contiene campos inválidos.".into(),
        ));
    }
    Ok(())
}

fn is_safe_host(host: &str) -> bool {
    !host.is_empty()
        && !host.starts_with('-')
        && host.len() <= 253
        && host
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ".-:[]".contains(ch))
}

fn format_remote_host(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

fn reserve_local_port() -> Result<u16, PyroError> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| {
        PyroError::Connection(format!("No se pudo reservar el puerto SSH: {error}"))
    })?;
    let port = listener
        .local_addr()
        .map_err(|error| {
            PyroError::Connection(format!("No se pudo consultar el puerto SSH: {error}"))
        })?
        .port();
    drop(listener);
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> SshTunnelConfig {
        SshTunnelConfig {
            enabled: true,
            ssh_host: "gateway.example.com".into(),
            ssh_port: 22,
            ssh_user: "db-user".into(),
            remote_host: "db.internal".into(),
            remote_port: 3306,
            authentication: SshAuthentication::Agent,
            private_key_path: None,
        }
    }

    #[test]
    fn validates_hosts_users_and_ports_before_spawning() {
        let mut invalid = config();
        invalid.ssh_host = "-oProxyCommand=bad".into();
        assert!(validate_config(&invalid).is_err());
        invalid = config();
        invalid.ssh_user = "user;command".into();
        assert!(validate_config(&invalid).is_err());
        invalid = config();
        invalid.remote_port = 0;
        assert!(validate_config(&invalid).is_err());
    }

    #[test]
    fn brackets_ipv6_forwarding_targets() {
        assert_eq!(format_remote_host("::1"), "[::1]");
        assert_eq!(format_remote_host("db.internal"), "db.internal");
    }

    #[tokio::test]
    async fn rejects_missing_private_key_without_starting_ssh() {
        let mut config = config();
        config.authentication = SshAuthentication::PrivateKey;
        assert!(open_tunnel(&config).await.is_err());
    }
}
