use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;

use super::error::PyroError;
use crate::db::models::{ConnectionConfig, HttpTunnelConfig, QueryExecutionResult, ServerInfo};

const PYRO_TUNNEL_MAGIC: u32 = 0x5059_524F; // "PYRO"
const PYRO_TUNNEL_VERSION: u16 = 1;
const DEFAULT_TIMEOUT_SECONDS: u64 = 30;
const MAX_TIMEOUT_SECONDS: u64 = 120;
const DEFAULT_MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const HARD_MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_TUNNEL_FIELDS: usize = 4096;
const MAX_TUNNEL_ROWS: usize = 20_000;
static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug)]
pub struct TunnelClient {
    client: reqwest::Client,
    request_slots: Arc<Semaphore>,
    pub config: ConnectionConfig,
    pub tunnel: HttpTunnelConfig,
}

impl TunnelClient {
    pub fn new(config: ConnectionConfig, tunnel: HttpTunnelConfig) -> Result<Self, PyroError> {
        validate_endpoint(&tunnel.url)?;
        let timeout = tunnel
            .timeout_seconds
            .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
            .clamp(1, MAX_TIMEOUT_SECONDS);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(timeout))
            .tcp_nodelay(true)
            .pool_max_idle_per_host(8)
            .pool_idle_timeout(Duration::from_secs(90))
            .user_agent(concat!("PyroStudio/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| {
                PyroError::Tunnel("No se pudo configurar el cliente HTTP del túnel.".into())
            })?;
        Ok(Self {
            client,
            request_slots: Arc::new(Semaphore::new(6)),
            config,
            tunnel,
        })
    }

    pub async fn test_connection(&self) -> Result<ServerInfo, PyroError> {
        let start = Instant::now();
        let form = vec![
            ("actn", "C".to_string()),
            ("host", self.config.host.clone()),
            ("port", self.config.port.to_string()),
            ("login", self.config.user.clone()),
            ("password", self.config.password.clone().unwrap_or_default()),
            ("db", self.config.database.clone().unwrap_or_default()),
        ];
        let bytes = self.send_form(&form).await?;
        let elapsed = start.elapsed().as_millis() as u64;

        let (server_info_str, host_info) = parse_connect_response(&bytes)?;

        Ok(ServerInfo {
            version: server_info_str,
            current_user: format!("{} ({})", self.config.user, host_info),
            current_database: self.config.database.clone(),
            ping_ms: elapsed,
        })
    }

    pub async fn execute_query(
        &self,
        sql: &str,
        database: Option<&str>,
    ) -> Result<QueryExecutionResult, PyroError> {
        self.execute_query_cancellable(sql, database, None).await
    }

    pub async fn execute_query_cancellable(
        &self,
        sql: &str,
        database: Option<&str>,
        query_id: Option<&str>,
    ) -> Result<QueryExecutionResult, PyroError> {
        let sql_tagged = match query_id {
            Some(qid) => format!("/*pyro_qid:{qid}*/ {sql}"),
            None => sql.to_string(),
        };
        let results = self.execute_queries(&[&sql_tagged], database).await?;
        results.into_iter().next().ok_or_else(|| {
            PyroError::Tunnel("No se recibieron resultados de la consulta".to_string())
        })
    }

    pub async fn cancel_query(&self, query_id: &str) -> Result<bool, PyroError> {
        let form = vec![
            ("actn".to_string(), "K".to_string()),
            ("host".to_string(), self.config.host.clone()),
            ("port".to_string(), self.config.port.to_string()),
            ("login".to_string(), self.config.user.clone()),
            (
                "password".to_string(),
                self.config.password.clone().unwrap_or_default(),
            ),
            ("qid".to_string(), query_id.to_string()),
        ];

        let bytes = self.send_form(&form).await?;
        let mut offset = 0;
        parse_header(&bytes, &mut offset)?;
        let msg = read_string_block(&bytes, &mut offset).unwrap_or_default();
        Ok(msg.contains("successfully"))
    }

    pub async fn execute_queries(
        &self,
        queries: &[&str],
        database: Option<&str>,
    ) -> Result<Vec<QueryExecutionResult>, PyroError> {
        let start = Instant::now();
        let encode_base64 = self.tunnel.encode_base64.unwrap_or(true);

        let mut form: Vec<(String, String)> = Vec::new();
        form.push(("actn".to_string(), "Q".to_string()));
        form.push(("host".to_string(), self.config.host.clone()));
        form.push(("port".to_string(), self.config.port.to_string()));
        form.push(("login".to_string(), self.config.user.clone()));
        form.push((
            "password".to_string(),
            self.config.password.clone().unwrap_or_default(),
        ));

        let target_db = database
            .map(|s| s.to_string())
            .or_else(|| self.config.database.clone())
            .unwrap_or_default();
        form.push(("db".to_string(), target_db));

        if encode_base64 {
            form.push(("encodeBase64".to_string(), "1".to_string()));
            for q in queries {
                let b64 = base64::engine::general_purpose::STANDARD.encode(q.as_bytes());
                form.push(("q[]".to_string(), b64));
            }
        } else {
            form.push(("encodeBase64".to_string(), "0".to_string()));
            for q in queries {
                form.push(("q[]".to_string(), q.to_string()));
            }
        }

        let request_bytes = form
            .iter()
            .map(|(key, value)| key.len() + value.len())
            .sum::<usize>();
        if request_bytes > MAX_REQUEST_BYTES {
            return Err(PyroError::Tunnel(
                "La consulta supera el límite de solicitud de 8 MiB del túnel.".into(),
            ));
        }

        let bytes = self.send_form(&form).await?;
        let elapsed = start.elapsed().as_millis() as u64;

        parse_query_response(&bytes, elapsed)
    }

    async fn send_form<T: Serialize + ?Sized>(&self, form: &T) -> Result<Vec<u8>, PyroError> {
        let estimated_body_size = serde_json::to_vec(form)
            .map_err(|_| PyroError::Tunnel("No se pudo preparar el formulario HTTP.".into()))?
            .len()
            .saturating_mul(3);
        if estimated_body_size > MAX_REQUEST_BYTES {
            return Err(PyroError::Tunnel(
                "La solicitud al túnel supera el límite de 8 MiB.".into(),
            ));
        }
        let _request_slot = self.request_slots.acquire().await.map_err(|_| {
            PyroError::Tunnel("El control de solicitudes del túnel se cerró.".into())
        })?;
        let request_id = next_request_id();
        let mut request = self
            .client
            .post(&self.tunnel.url)
            .header("X-Request-Id", &request_id)
            .form(form);
        if let Some(token) = self
            .tunnel
            .auth_token
            .as_deref()
            .filter(|token| !token.is_empty())
        {
            // X-Pyro-Token survives servers that strip Authorization (Apache + CGI/FastCGI).
            request = request.bearer_auth(token).header("X-Pyro-Token", token);
        } else if let (Some(user), Some(password)) =
            (&self.tunnel.http_user, &self.tunnel.http_password)
        {
            if !user.is_empty() {
                request = request.basic_auth(user, Some(password));
            }
        }

        let mut response = request.send().await.map_err(|error| {
            if error.is_timeout() {
                PyroError::Tunnel(format!(
                    "Tiempo agotado en la solicitud HTTP del túnel (ID {request_id})."
                ))
            } else {
                PyroError::Tunnel(format!(
                    "No se pudo completar la solicitud HTTP del túnel (ID {request_id})."
                ))
            }
        })?;
        let status = response.status();
        let max_bytes = self
            .tunnel
            .max_response_bytes
            .unwrap_or(DEFAULT_MAX_RESPONSE_BYTES)
            .clamp(1024, HARD_MAX_RESPONSE_BYTES);
        if response
            .content_length()
            .is_some_and(|length| length > max_bytes as u64)
        {
            return Err(PyroError::Tunnel(format!(
                "La respuesta del túnel excede el límite de {max_bytes} bytes."
            )));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            PyroError::Tunnel(format!(
                "No se pudo leer la respuesta HTTP del túnel (ID {request_id})."
            ))
        })? {
            if body.len().saturating_add(chunk.len()) > max_bytes {
                return Err(PyroError::Tunnel(format!(
                    "La respuesta del túnel excede el límite de {max_bytes} bytes."
                )));
            }
            body.extend_from_slice(&chunk);
        }

        if !status.is_success() {
            // Check if server returned a PyroTunnel binary error packet
            if body.len() >= 10 {
                let mut offset = 0;
                if let Ok(magic) = read_u32_be(&body, &mut offset) {
                    if magic == PYRO_TUNNEL_MAGIC {
                        let _version = read_u16_be(&body, &mut offset);
                        if let Ok(err_code) = read_u32_be(&body, &mut offset) {
                            if let Ok(msg) = read_string_block(&body, &mut offset) {
                                let hint = tunnel_error_hint(err_code);
                                return Err(PyroError::Tunnel(format!(
                                    "Error del túnel [{err_code}]: {msg} (HTTP {status}, ID {request_id}).{hint}"
                                )));
                            }
                        }
                    }
                }
            }

            let text_snippet = String::from_utf8_lossy(&body);
            let cleaned = extract_html_error_text(&text_snippet);
            if !cleaned.is_empty() {
                return Err(PyroError::Tunnel(format!(
                    "El servidor del túnel respondió con HTTP {status}: {cleaned} (ID {request_id})."
                )));
            }

            return Err(PyroError::Tunnel(format!(
                "El servidor del túnel respondió con HTTP {status} (ID {request_id})."
            )));
        }

        Ok(body)
    }
}

fn extract_html_error_text(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    if let Some(start) = lower.find("<title>") {
        if let Some(end) = lower[start..].find("</title>") {
            let title = &html[start + 7..start + end];
            let clean = title
                .replace('\n', " ")
                .replace('\r', "")
                .trim()
                .to_string();
            if !clean.is_empty() && clean.len() < 120 {
                return clean;
            }
        }
    }
    if let Some(start) = lower.find("<h1>") {
        if let Some(end) = lower[start..].find("</h1>") {
            let h1 = &html[start + 4..start + end];
            let clean = h1.replace('\n', " ").replace('\r', "").trim().to_string();
            if !clean.is_empty() && clean.len() < 120 {
                return clean;
            }
        }
    }
    String::new()
}

fn validate_endpoint(endpoint: &str) -> Result<(), PyroError> {
    let url = reqwest::Url::parse(endpoint)
        .map_err(|_| PyroError::Tunnel("La URL del túnel no es válida.".into()))?;
    let is_loopback = url.host_str().is_some_and(is_loopback_host);
    if url.scheme() != "https" && !(url.scheme() == "http" && is_loopback) {
        return Err(PyroError::Tunnel(
            "El túnel debe usar HTTPS. HTTP se permite únicamente para localhost.".into(),
        ));
    }
    if url.username() != "" || url.password().is_some() || url.fragment().is_some() {
        return Err(PyroError::Tunnel(
            "La URL del túnel no debe incluir credenciales ni fragmentos.".into(),
        ));
    }
    Ok(())
}

fn is_loopback_host(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false)
}

fn next_request_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let sequence = REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("pyro-{timestamp:x}-{sequence:x}")
}

// Helper: read a Block from bytes at offset
fn read_block<'a>(data: &'a [u8], offset: &mut usize) -> Result<&'a [u8], PyroError> {
    if *offset >= data.len() {
        return Err(PyroError::Tunnel(
            "Fin inesperado del paquete al leer cabecera de bloque".to_string(),
        ));
    }
    let first = data[*offset];
    *offset += 1;

    let len = if first == 0xFE {
        if *offset + 4 > data.len() {
            return Err(PyroError::Tunnel(
                "Fin inesperado del paquete al leer longitud de 32 bits".to_string(),
            ));
        }
        let bytes: [u8; 4] = match data[*offset..*offset + 4].try_into() {
            Ok(b) => b,
            Err(_) => {
                return Err(PyroError::Tunnel(
                    "Error convirtiendo slice a longitud de 32 bits".into(),
                ))
            }
        };
        *offset += 4;
        u32::from_be_bytes(bytes) as usize
    } else {
        first as usize
    };

    if *offset > data.len() || len > data.len() - *offset {
        return Err(PyroError::Tunnel(format!(
            "Fin inesperado del paquete leyendo contenido: se requerían {} bytes, disponibles {}",
            len,
            data.len().saturating_sub(*offset)
        )));
    }

    let slice = &data[*offset..*offset + len];
    *offset += len;
    Ok(slice)
}

fn read_string_block(data: &[u8], offset: &mut usize) -> Result<String, PyroError> {
    let slice = read_block(data, offset)?;
    Ok(String::from_utf8_lossy(slice).to_string())
}

fn read_u64_be(data: &[u8], offset: &mut usize) -> Result<u64, PyroError> {
    if *offset + 8 > data.len() {
        return Err(PyroError::Tunnel(
            "Fin inesperado del paquete leyendo entero u64".to_string(),
        ));
    }
    let bytes: [u8; 8] = match data[*offset..*offset + 8].try_into() {
        Ok(b) => b,
        Err(_) => return Err(PyroError::Tunnel("Error decodificando u64 de bytes".into())),
    };
    *offset += 8;
    Ok(u64::from_be_bytes(bytes))
}

fn read_u32_be(data: &[u8], offset: &mut usize) -> Result<u32, PyroError> {
    if *offset + 4 > data.len() {
        return Err(PyroError::Tunnel(
            "Fin inesperado del paquete leyendo entero u32".to_string(),
        ));
    }
    let bytes: [u8; 4] = match data[*offset..*offset + 4].try_into() {
        Ok(b) => b,
        Err(_) => return Err(PyroError::Tunnel("Error decodificando u32 de bytes".into())),
    };
    *offset += 4;
    Ok(u32::from_be_bytes(bytes))
}

fn read_u16_be(data: &[u8], offset: &mut usize) -> Result<u16, PyroError> {
    if *offset + 2 > data.len() {
        return Err(PyroError::Tunnel(
            "Fin inesperado del paquete leyendo entero u16".to_string(),
        ));
    }
    let bytes: [u8; 2] = match data[*offset..*offset + 2].try_into() {
        Ok(b) => b,
        Err(_) => return Err(PyroError::Tunnel("Error decodificando u16 de bytes".into())),
    };
    *offset += 2;
    Ok(u16::from_be_bytes(bytes))
}

fn parse_header(data: &[u8], offset: &mut usize) -> Result<u32, PyroError> {
    if data.len() < 10 {
        return Err(PyroError::Tunnel(format!(
            "Respuesta inválida del túnel: cabecera binaria incompleta ({} bytes).",
            data.len()
        )));
    }
    let magic = read_u32_be(data, offset)?;
    if magic != PYRO_TUNNEL_MAGIC {
        return Err(PyroError::Tunnel(format!(
            "Firma de protocolo no válida (0x{magic:08X}, se esperaba PYRO 0x{PYRO_TUNNEL_MAGIC:08X}). Asegúrate de usar pyro_tunnel.php.",
        )));
    }
    let version = read_u16_be(data, offset)?;
    if version != PYRO_TUNNEL_VERSION {
        return Err(PyroError::Tunnel(format!(
            "Versión de protocolo PyroTunnel no compatible: v{version} (se esperaba v{PYRO_TUNNEL_VERSION})."
        )));
    }
    let errno = read_u32_be(data, offset)?;

    if errno > 0 {
        let error_msg = read_string_block(data, offset).map_err(|_| {
            PyroError::Tunnel(format!(
                "Respuesta de error malformada del servidor (código {errno})."
            ))
        })?;
        return Err(PyroError::Database(format!(
            "MySQL Error [{}]: {}",
            errno, error_msg
        )));
    }

    Ok(errno)
}

pub fn parse_connect_response(data: &[u8]) -> Result<(String, String), PyroError> {
    let mut offset = 0;
    parse_header(data, &mut offset)?;

    let host_info = read_string_block(data, &mut offset)?;
    let _proto_info = read_string_block(data, &mut offset)?;
    let server_info = read_string_block(data, &mut offset)?;

    Ok((server_info, host_info))
}

pub fn parse_query_response(
    data: &[u8],
    total_elapsed: u64,
) -> Result<Vec<QueryExecutionResult>, PyroError> {
    let mut offset = 0;
    parse_header(data, &mut offset)?;

    let mut results = Vec::new();

    while offset < data.len() {
        // Result header: errno (4) + affected_rows (8) + insert_id (8) + num_fields (4) + num_rows (4) = 28 bytes
        if offset + 28 > data.len() {
            return Err(PyroError::Tunnel(
                "Respuesta incompleta leyendo el encabezado de resultados.".into(),
            ));
        }

        let errno = read_u32_be(data, &mut offset)?;
        let affected_rows = read_u64_be(data, &mut offset)?;
        let _insert_id = read_u64_be(data, &mut offset)?;
        let num_fields = read_u32_be(data, &mut offset)? as usize;
        let num_rows = read_u32_be(data, &mut offset)? as usize;
        if num_fields > MAX_TUNNEL_FIELDS || num_rows > MAX_TUNNEL_ROWS {
            return Err(PyroError::Tunnel(format!(
                "Respuesta fuera de límites: {num_fields} columnas y {num_rows} filas."
            )));
        }

        if errno > 0 {
            let err_msg = read_string_block(data, &mut offset).map_err(|_| {
                PyroError::Tunnel(format!(
                    "Respuesta de error malformada del servidor (código {errno})."
                ))
            })?;
            return Err(PyroError::Database(format!(
                "Error en consulta [{}]: {}",
                errno, err_msg
            )));
        }

        if num_fields > 0 {
            let mut col_names = Vec::with_capacity(num_fields);
            let mut col_types = Vec::with_capacity(num_fields);
            let mut col_flags = Vec::with_capacity(num_fields);

            for _ in 0..num_fields {
                let field_name = read_string_block(data, &mut offset)?;
                let _table_name = read_string_block(data, &mut offset)?;
                let ftype = read_u16_be(data, &mut offset)?;
                let flags = read_u16_be(data, &mut offset)?;
                let _length = read_u32_be(data, &mut offset)?;

                col_names.push(field_name);
                col_types.push(ftype);
                col_flags.push(flags);
            }

            let mut rows = Vec::with_capacity(num_rows);
            for _ in 0..num_rows {
                let mut row = Vec::with_capacity(num_fields.min(1000));
                for col_idx in 0..num_fields {
                    if offset >= data.len() {
                        return Err(PyroError::Tunnel(
                            "Fin inesperado de datos leyendo celdas".to_string(),
                        ));
                    }
                    if data[offset] == 0xFF {
                        offset += 1;
                        row.push(Value::Null);
                    } else {
                        let cell_bytes = read_block(data, &mut offset)?;
                        let ftype = col_types.get(col_idx).copied().unwrap_or(253);
                        let flags = col_flags.get(col_idx).copied().unwrap_or(0);

                        // Handle BIT type (16) or binary non-UTF8 payloads cleanly
                        if ftype == 16 && !cell_bytes.is_empty() && cell_bytes.len() <= 8 {
                            let mut bit_val: u64 = 0;
                            for &b in cell_bytes {
                                bit_val = (bit_val << 8) | (b as u64);
                            }
                            row.push(Value::Number(bit_val.into()));
                            continue;
                        }

                        if (flags & 128) != 0 && std::str::from_utf8(cell_bytes).is_err() {
                            let mut hex_str = String::with_capacity(2 + cell_bytes.len() * 2);
                            hex_str.push_str("0x");
                            for &b in cell_bytes {
                                use std::fmt::Write;
                                let _ = write!(&mut hex_str, "{b:02X}");
                            }
                            row.push(Value::String(hex_str));
                            continue;
                        }

                        let s = String::from_utf8_lossy(cell_bytes).to_string();

                        let val = match ftype {
                            1 | 2 | 3 | 8 | 9 | 13 => {
                                if let Ok(n) = s.parse::<i64>() {
                                    Value::Number(n.into())
                                } else if let Ok(u) = s.parse::<u64>() {
                                    Value::Number(u.into())
                                } else {
                                    Value::String(s)
                                }
                            }
                            0 | 4 | 5 | 246 => {
                                if let Ok(n) = s.parse::<i64>() {
                                    Value::Number(n.into())
                                } else if let Ok(u) = s.parse::<u64>() {
                                    Value::Number(u.into())
                                } else if let Ok(f) = s.parse::<f64>() {
                                    if f.is_finite()
                                        && f.fract() == 0.0
                                        && f >= (i64::MIN as f64)
                                        && f <= (i64::MAX as f64)
                                    {
                                        Value::Number((f as i64).into())
                                    } else if let Some(num) = serde_json::Number::from_f64(f) {
                                        Value::Number(num)
                                    } else {
                                        Value::String(s)
                                    }
                                } else {
                                    Value::String(s)
                                }
                            }
                            245 => {
                                if let Ok(json_v) = serde_json::from_str::<Value>(&s) {
                                    json_v
                                } else {
                                    Value::String(s)
                                }
                            }
                            _ => Value::String(s),
                        };
                        row.push(val);
                    }
                }
                rows.push(row);
            }

            results.push(QueryExecutionResult {
                columns: col_names,
                rows,
                affected_rows,
                execution_time_ms: total_elapsed,
                message: format!("{} fila(s) retornada(s)", num_rows),
            });
        } else {
            let info = read_string_block(data, &mut offset).unwrap_or_default();
            results.push(QueryExecutionResult {
                columns: vec![],
                rows: vec![],
                affected_rows,
                execution_time_ms: total_elapsed,
                message: if !info.is_empty() {
                    info
                } else {
                    format!(
                        "Consulta ejecutada exitosamente. Filas afectadas: {}",
                        affected_rows
                    )
                },
            });
        }

        if offset < data.len() {
            let delim = data[offset];
            offset += 1;
            if delim == 0x00 {
                break;
            }
        }
    }

    Ok(results)
}

/// Actionable guidance for tunnel error codes caused by server-side configuration.
fn tunnel_error_hint(err_code: u32) -> &'static str {
    match err_code {
        212 => " Revise el token del túnel configurado en la conexión: debe coincidir con PYRO_TUNNEL_TOKEN (o $tunnelToken) del servidor.",
        215 => " El script del túnel no tiene token del túnel configurado: defina PYRO_TUNNEL_TOKEN (o $tunnelToken, mínimo 16 caracteres) en el servidor y use el mismo valor en la conexión.",
        206 => " El host de base de datos no está permitido: añádalo a PYRO_TUNNEL_ALLOWED_DB_HOSTS (o $allowedDbHosts) en el servidor.",
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::time::sleep;

    fn build_packet_header(magic: u32, version: u16, errno: u32) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&magic.to_be_bytes());
        buf.extend_from_slice(&version.to_be_bytes());
        buf.extend_from_slice(&errno.to_be_bytes());
        buf
    }

    fn append_result_header(
        buf: &mut Vec<u8>,
        errno: u32,
        affected_rows: u64,
        insert_id: u64,
        num_fields: u32,
        num_rows: u32,
    ) {
        buf.extend_from_slice(&errno.to_be_bytes());
        buf.extend_from_slice(&affected_rows.to_be_bytes());
        buf.extend_from_slice(&insert_id.to_be_bytes());
        buf.extend_from_slice(&num_fields.to_be_bytes());
        buf.extend_from_slice(&num_rows.to_be_bytes());
    }

    fn append_field(
        buf: &mut Vec<u8>,
        name: &[u8],
        table: &[u8],
        ftype: u16,
        flags: u16,
        length: u32,
    ) {
        append_block(buf, name);
        append_block(buf, table);
        buf.extend_from_slice(&ftype.to_be_bytes());
        buf.extend_from_slice(&flags.to_be_bytes());
        buf.extend_from_slice(&length.to_be_bytes());
    }

    fn append_block(buf: &mut Vec<u8>, data: &[u8]) {
        if data.len() < 254 {
            buf.push(data.len() as u8);
        } else {
            buf.push(0xFE);
            buf.extend_from_slice(&(data.len() as u32).to_be_bytes());
        }
        buf.extend_from_slice(data);
    }

    #[test]
    fn test_connect_success() {
        let mut buf = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 0);
        append_block(&mut buf, b"Localhost via UNIX socket");
        append_block(&mut buf, b"10");
        append_block(&mut buf, b"10.11.8-MariaDB");

        let (server_info, host_info) = parse_connect_response(&buf).expect("Should parse connect");
        assert_eq!(server_info, "10.11.8-MariaDB");
        assert_eq!(host_info, "Localhost via UNIX socket");
    }

    #[test]
    fn rejects_unsupported_tunnel_version_header() {
        let mut buf = build_packet_header(PYRO_TUNNEL_MAGIC, 99, 0);
        append_block(&mut buf, b"localhost");
        append_block(&mut buf, b"10");
        append_block(&mut buf, b"MariaDB");
        assert!(parse_connect_response(&buf).is_err());
    }

    #[test]
    fn test_connect_error() {
        let mut buf = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 1045);
        append_block(&mut buf, b"Access denied for user 'root'@'localhost'");

        let result = parse_connect_response(&buf);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("1045"));
        assert!(err_msg.contains("Access denied"));
    }

    #[test]
    fn test_query_success_with_rows_and_null() {
        let mut buf = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 0);
        append_result_header(&mut buf, 0, 2, 0, 2, 2);

        // Field 1: id (INT = 3)
        append_field(&mut buf, b"id", b"users", 3, 0, 11);
        // Field 2: name (VARCHAR = 253)
        append_field(&mut buf, b"name", b"users", 253, 0, 255);

        // Row 1: id = 1, name = "Alice"
        append_block(&mut buf, b"1");
        append_block(&mut buf, b"Alice");

        // Row 2: id = 2, name = NULL (0xFF)
        append_block(&mut buf, b"2");
        buf.push(0xFF); // NULL

        buf.push(0x00); // termination delimiter

        let results = parse_query_response(&buf, 10).expect("Should parse query response");
        assert_eq!(results.len(), 1);
        let res = &results[0];
        assert_eq!(res.columns, vec!["id", "name"]);
        assert_eq!(res.rows.len(), 2);
        assert_eq!(res.rows[0][0], serde_json::json!(1));
        assert_eq!(res.rows[0][1], serde_json::json!("Alice"));
        assert_eq!(res.rows[1][0], serde_json::json!(2));
        assert_eq!(res.rows[1][1], serde_json::Value::Null);
    }

    #[test]
    fn test_query_accepts_twenty_thousand_rows_and_rejects_more() {
        let mut buf = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 0);
        append_result_header(&mut buf, 0, 20_000, 0, 1, 20_000);
        append_field(&mut buf, b"id", b"rows", 3, 0, 11);

        for _ in 0..20_000 {
            append_block(&mut buf, b"1");
        }
        buf.push(0);

        let results = parse_query_response(&buf, 1).unwrap();
        assert_eq!(results[0].rows.len(), 20_000);

        let mut oversized = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 0);
        append_result_header(&mut oversized, 0, 20_001, 0, 1, 20_001);
        assert!(parse_query_response(&oversized, 1).is_err());
    }

    #[test]
    fn test_query_preserves_utf8_and_multiple_columns() {
        let mut buf = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 0);
        append_result_header(&mut buf, 0, 1, 0, 2, 1);
        for name in ["name", "city"] {
            append_field(&mut buf, name.as_bytes(), b"users", 253, 0, 255);
        }
        append_block(&mut buf, "Ángela 東京".as_bytes());
        append_block(&mut buf, "München".as_bytes());
        buf.push(0);

        let result = parse_query_response(&buf, 1).unwrap();
        assert_eq!(result[0].columns, vec!["name", "city"]);
        assert_eq!(result[0].rows[0], vec!["Ángela 東京", "München"]);
    }

    #[test]
    fn test_query_empty_result() {
        let mut buf = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 0);
        append_result_header(&mut buf, 0, 0, 0, 1, 0);
        append_field(&mut buf, b"empty_col", b"tbl", 253, 0, 10);
        buf.push(0x00);

        let results = parse_query_response(&buf, 5).expect("Should parse empty result");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].rows.len(), 0);
        assert_eq!(results[0].columns, vec!["empty_col"]);
    }

    #[test]
    fn test_query_error_response() {
        let mut buf = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 0);
        append_result_header(&mut buf, 1146, 0, 0, 0, 0);
        append_block(&mut buf, b"Table 'test.non_existent' doesn't exist");

        let res = parse_query_response(&buf, 8);
        assert!(res.is_err());
        let err_msg = res.unwrap_err().to_string();
        assert!(err_msg.contains("1146"));
        assert!(err_msg.contains("doesn't exist"));
    }

    #[test]
    fn test_large_value_block() {
        let mut buf = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 0);
        append_result_header(&mut buf, 0, 1, 0, 1, 1);
        append_field(&mut buf, b"long_text", b"t", 253, 0, 1000);

        let large_string = "X".repeat(500);
        append_block(&mut buf, large_string.as_bytes());

        buf.push(0x00);

        let results = parse_query_response(&buf, 12).expect("Should parse large value block");
        assert_eq!(
            results[0].rows[0][0],
            serde_json::Value::String(large_string)
        );
    }

    #[test]
    fn test_malformed_truncated_data_never_panics() {
        // Less than 10 bytes
        let truncated = vec![0u8; 6];
        assert!(parse_connect_response(&truncated).is_err());
        assert!(parse_query_response(&truncated, 0).is_err());

        // Wrong magic number
        let wrong_magic = build_packet_header(9999, 1, 0);
        assert!(parse_connect_response(&wrong_magic).is_err());
        assert!(parse_query_response(&wrong_magic, 0).is_err());

        // Header claims 100 bytes block but ends immediately
        let mut corrupt_block = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 0);
        corrupt_block.push(100); // 100 bytes claimed, but no following bytes
        assert!(parse_connect_response(&corrupt_block).is_err());

        // Random garbage bytes
        let garbage = vec![
            0xFF, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC,
            0xDD, 0xEE,
        ];
        assert!(parse_connect_response(&garbage).is_err());
        assert!(parse_query_response(&garbage, 0).is_err());
    }

    #[test]
    fn rejects_remote_http_and_credentials_in_tunnel_urls() {
        assert!(validate_endpoint("http://example.com/pyro_tunnel.php").is_err());
        assert!(validate_endpoint("http://user:password@localhost/pyro_tunnel.php").is_err());
        assert!(validate_endpoint("http://127.0.0.1/pyro_tunnel.php").is_ok());
        assert!(validate_endpoint("https://db.example.com/pyro_tunnel.php").is_ok());
    }

    fn tunnel_config(url: String, timeout_seconds: Option<u64>) -> TunnelClient {
        TunnelClient::new(
            ConnectionConfig {
                host: "127.0.0.1".into(),
                port: 3306,
                user: "tester".into(),
                password: None,
                credential_id: None,
                database: None,
                tunnel: None,
                tls: None,
                ssh_tunnel: None,
                saved_connection_id: None,
                saved_connection_name: None,
                environment: None,
            },
            HttpTunnelConfig {
                enabled: true,
                url,
                http_user: None,
                http_password: None,
                auth_token: None,
                tunnel_credential_id: None,
                token_credential_id: None,
                encode_base64: None,
                timeout_seconds,
                max_response_bytes: Some(1024),
            },
        )
        .unwrap()
    }

    async fn mock_http_response(
        status: &str,
        body: Vec<u8>,
        delay: Duration,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_string();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            loop {
                let mut chunk = [0u8; 2048];
                let read = socket.read(&mut chunk).await.unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                let Some(header_end) = request.windows(4).position(|w| w == b"\r\n\r\n") else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&request[..header_end]).to_ascii_lowercase();
                let body_length = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .and_then(|value| value.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                if request.len() >= header_end + 4 + body_length {
                    break;
                }
            }
            let captured = String::from_utf8_lossy(&request).to_ascii_lowercase();
            sleep(delay).await;
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.write_all(&body).await;
            captured
        });
        (format!("http://{address}/pyro_tunnel.php"), task)
    }

    #[tokio::test]
    async fn http_status_errors_are_correlated_to_request_id() {
        let (url, server) =
            mock_http_response("401 Unauthorized", Vec::new(), Duration::ZERO).await;
        let client = tunnel_config(url, None);
        let error = client.send_form(&[("actn", "C")]).await.unwrap_err();
        assert!(error.to_string().contains("HTTP 401"));
        assert!(server.await.unwrap().contains("x-request-id: pyro-"));
    }

    #[tokio::test]
    async fn test_connection_accepts_a_valid_pyro_tunnel_response() {
        let mut body = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 0);
        append_block(&mut body, b"127.0.0.1 via TCP/IP");
        append_block(&mut body, b"10");
        append_block(&mut body, b"MariaDB 11");
        let (url, server) = mock_http_response("200 OK", body, Duration::ZERO).await;
        let client = tunnel_config(url, None);
        let server_info = client.test_connection().await.unwrap();
        assert_eq!(server_info.version, "MariaDB 11");
        assert!(server.await.unwrap().contains("x-request-id: pyro-"));
    }

    #[tokio::test]
    async fn rejects_http_responses_over_the_configured_payload_limit() {
        let (url, server) = mock_http_response("200 OK", vec![b'x'; 2048], Duration::ZERO).await;
        let client = tunnel_config(url, None);
        let error = client.send_form(&[("actn", "C")]).await.unwrap_err();
        assert!(error.to_string().contains("excede el límite"));
        assert!(server.await.unwrap().contains("x-request-id: pyro-"));
    }

    #[tokio::test]
    async fn maps_http_timeouts_to_explicit_tunnel_errors() {
        let (url, server) =
            mock_http_response("200 OK", Vec::new(), Duration::from_millis(1500)).await;
        let client = tunnel_config(url, Some(1));
        let error = client.send_form(&[("actn", "C")]).await.unwrap_err();
        assert!(error.to_string().contains("Tiempo agotado"));
        assert!(server.await.unwrap().contains("x-request-id: pyro-"));
    }

    #[tokio::test]
    async fn sends_honest_user_agent_and_bearer_token() {
        let (url, server) = mock_http_response("200 OK", Vec::new(), Duration::ZERO).await;
        let mut client = tunnel_config(url, None);
        client.tunnel.auth_token = Some("s3cret-token-0123456789".into());
        let _ = client.send_form(&[("actn", "C")]).await;
        let request = server.await.unwrap();
        let expected = format!("user-agent: pyrostudio/{}", env!("CARGO_PKG_VERSION"));
        assert!(
            request.lines().any(|line| line.trim_end() == expected),
            "{request}"
        );
        assert!(!request.contains("mozilla"));
        assert!(request.contains("authorization: bearer s3cret-token-0123456789"));
        assert!(request.contains("x-pyro-token: s3cret-token-0123456789"));
    }

    #[tokio::test]
    async fn unconfigured_tunnel_error_explains_token_setup() {
        let mut body = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 215);
        append_block(
            &mut body,
            b"Tunnel is not configured: set PYRO_TUNNEL_TOKEN.",
        );
        let (url, server) =
            mock_http_response("503 Service Unavailable", body, Duration::ZERO).await;
        let client = tunnel_config(url, None);
        let error = client
            .send_form(&[("actn", "C")])
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("[215]"), "{error}");
        assert!(error.contains("token del túnel"), "{error}");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn invalid_token_error_explains_token_setup() {
        let mut body = build_packet_header(PYRO_TUNNEL_MAGIC, PYRO_TUNNEL_VERSION, 212);
        append_block(&mut body, b"Invalid authentication token.");
        let (url, server) = mock_http_response("401 Unauthorized", body, Duration::ZERO).await;
        let client = tunnel_config(url, None);
        let error = client
            .send_form(&[("actn", "C")])
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("token del túnel"), "{error}");
        server.await.unwrap();
    }
}
