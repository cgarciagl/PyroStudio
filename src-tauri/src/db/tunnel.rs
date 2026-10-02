use std::collections::HashMap;
use std::time::Instant;
use base64::Engine;
use reqwest::header::AUTHORIZATION;
use serde_json::Value;

use crate::db::models::{ConnectionConfig, HttpTunnelConfig, QueryExecutionResult, ServerInfo};

#[derive(Clone, Debug)]
pub struct TunnelClient {
    client: reqwest::Client,
    pub config: ConnectionConfig,
    pub tunnel: HttpTunnelConfig,
}

impl TunnelClient {
    pub fn new(config: ConnectionConfig, tunnel: HttpTunnelConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self {
            client,
            config,
            tunnel,
        }
    }

    pub async fn test_connection(&self) -> Result<ServerInfo, String> {
        let start = Instant::now();
        let mut form = HashMap::new();
        form.insert("actn", "C".to_string());
        form.insert("host", self.config.host.clone());
        form.insert("port", self.config.port.to_string());
        form.insert("login", self.config.user.clone());
        form.insert(
            "password",
            self.config.password.clone().unwrap_or_default(),
        );
        form.insert(
            "db",
            self.config.database.clone().unwrap_or_default(),
        );

        let mut req = self.client.post(&self.tunnel.url).form(&form);

        if let (Some(ref u), Some(ref p)) = (&self.tunnel.http_user, &self.tunnel.http_password) {
            if !u.is_empty() {
                let creds = format!("{}:{}", u, p);
                let encoded = base64::engine::general_purpose::STANDARD.encode(creds);
                req = req.header(AUTHORIZATION, format!("Basic {}", encoded));
            }
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("Error en petición HTTP al túnel: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!(
                "El servidor del túnel HTTP respondió con código de estado: {}",
                status
            ));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Error leyendo respuesta del túnel: {e}"))?;
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
    ) -> Result<QueryExecutionResult, String> {
        let results = self.execute_queries(&[sql], database).await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| "No se recibieron resultados de la consulta".to_string())
    }

    pub async fn execute_queries(
        &self,
        queries: &[&str],
        database: Option<&str>,
    ) -> Result<Vec<QueryExecutionResult>, String> {
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

        let mut req = self.client.post(&self.tunnel.url).form(&form);

        if let (Some(ref u), Some(ref p)) = (&self.tunnel.http_user, &self.tunnel.http_password) {
            if !u.is_empty() {
                let creds = format!("{}:{}", u, p);
                let encoded = base64::engine::general_purpose::STANDARD.encode(creds);
                req = req.header(AUTHORIZATION, format!("Basic {}", encoded));
            }
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("Error en consulta a través del túnel HTTP: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!(
                "El servidor del túnel respondió con código de estado: {}",
                status
            ));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Error leyendo respuesta de consulta del túnel: {e}"))?;
        let elapsed = start.elapsed().as_millis() as u64;

        parse_query_response(&bytes, elapsed)
    }
}

// Helper: read a Block from bytes at offset
fn read_block<'a>(data: &'a [u8], offset: &mut usize) -> Result<&'a [u8], String> {
    if *offset >= data.len() {
        return Err("Fin inesperado del paquete al leer cabecera de bloque".to_string());
    }
    let first = data[*offset];
    *offset += 1;

    let len = if first == 0xFE {
        if *offset + 4 > data.len() {
            return Err("Fin inesperado del paquete al leer longitud de 32 bits".to_string());
        }
        let length = u32::from_be_bytes(data[*offset..*offset + 4].try_into().unwrap()) as usize;
        *offset += 4;
        length
    } else {
        first as usize
    };

    if *offset + len > data.len() {
        return Err(format!(
            "Fin inesperado del paquete leyendo contenido: se requerían {} bytes, disponibles {}",
            len,
            data.len() - *offset
        ));
    }

    let slice = &data[*offset..*offset + len];
    *offset += len;
    Ok(slice)
}

fn read_string_block(data: &[u8], offset: &mut usize) -> Result<String, String> {
    let slice = read_block(data, offset)?;
    Ok(String::from_utf8_lossy(slice).to_string())
}

fn read_u32_be(data: &[u8], offset: &mut usize) -> Result<u32, String> {
    if *offset + 4 > data.len() {
        return Err("Fin inesperado del paquete leyendo entero u32".to_string());
    }
    let val = u32::from_be_bytes(data[*offset..*offset + 4].try_into().unwrap());
    *offset += 4;
    Ok(val)
}

fn read_u16_be(data: &[u8], offset: &mut usize) -> Result<u16, String> {
    if *offset + 2 > data.len() {
        return Err("Fin inesperado del paquete leyendo entero u16".to_string());
    }
    let val = u16::from_be_bytes(data[*offset..*offset + 2].try_into().unwrap());
    *offset += 2;
    Ok(val)
}

fn parse_header(data: &[u8], offset: &mut usize) -> Result<u32, String> {
    if data.len() < 16 {
        let raw = String::from_utf8_lossy(data);
        return Err(format!(
            "Respuesta inválida del túnel (se esperaba cabecera binaria): {}",
            raw.chars().take(300).collect::<String>()
        ));
    }
    let magic = read_u32_be(data, offset)?;
    if magic != 1111 {
        let raw = String::from_utf8_lossy(data);
        return Err(format!(
            "Número mágico incorrecto {} (se esperaba 1111). Respuesta del servidor: {}",
            magic,
            raw.chars().take(300).collect::<String>()
        ));
    }
    let _version = read_u16_be(data, offset)?;
    let errno = read_u32_be(data, offset)?;
    *offset += 6; // dummy 6 bytes

    if errno > 0 {
        let error_msg = read_string_block(data, offset)
            .unwrap_or_else(|_| format!("Error code {}", errno));
        return Err(format!("MySQL Error [{}]: {}", errno, error_msg));
    }

    Ok(errno)
}

pub fn parse_connect_response(data: &[u8]) -> Result<(String, String), String> {
    let mut offset = 0;
    parse_header(data, &mut offset)?;

    let host_info = read_string_block(data, &mut offset).unwrap_or_default();
    let _proto_info = read_string_block(data, &mut offset).unwrap_or_default();
    let server_info = read_string_block(data, &mut offset).unwrap_or_default();

    Ok((server_info, host_info))
}

pub fn parse_query_response(
    data: &[u8],
    total_elapsed: u64,
) -> Result<Vec<QueryExecutionResult>, String> {
    let mut offset = 0;
    parse_header(data, &mut offset)?;

    let mut results = Vec::new();

    while offset < data.len() {
        if offset + 32 > data.len() {
            break;
        }

        let errno = read_u32_be(data, &mut offset)?;
        let affected_rows = read_u32_be(data, &mut offset)? as u64;
        let _insert_id = read_u32_be(data, &mut offset)?;
        let num_fields = read_u32_be(data, &mut offset)? as usize;
        let num_rows = read_u32_be(data, &mut offset)? as usize;
        offset += 12; // 12 bytes dummy padding

        if errno > 0 {
            let err_msg = read_string_block(data, &mut offset)
                .unwrap_or_else(|_| format!("Error {}", errno));
            return Err(format!("Error en consulta [{}]: {}", errno, err_msg));
        }

        if num_fields > 0 {
            // Read field descriptors
            let mut col_names = Vec::with_capacity(num_fields);
            let mut col_types = Vec::with_capacity(num_fields);

            for _ in 0..num_fields {
                let field_name = read_string_block(data, &mut offset)?;
                let _table_name = read_string_block(data, &mut offset)?;
                let ftype = read_u32_be(data, &mut offset)?;
                let _flags = read_u32_be(data, &mut offset)?;
                let _length = read_u32_be(data, &mut offset)?;

                col_names.push(field_name);
                col_types.push(ftype);
            }

            // Read rows
            let mut rows = Vec::with_capacity(num_rows);
            for _ in 0..num_rows {
                let mut row = Vec::with_capacity(num_fields);
                for col_idx in 0..num_fields {
                    if offset >= data.len() {
                        return Err("Fin inesperado de datos leyendo celdas".to_string());
                    }
                    if data[offset] == 0xFF {
                        offset += 1;
                        row.push(Value::Null);
                    } else {
                        let cell_bytes = read_block(data, &mut offset)?;
                        let s = String::from_utf8_lossy(cell_bytes).to_string();
                        let ftype = col_types[col_idx];

                        let val = match ftype {
                            1 | 2 | 3 | 8 | 9 | 13 => {
                                if let Ok(n) = s.parse::<i64>() {
                                    Value::Number(n.into())
                                } else {
                                    Value::String(s)
                                }
                            }
                            4 | 5 | 246 => {
                                if let Ok(f) = s.parse::<f64>() {
                                    if let Some(num) = serde_json::Number::from_f64(f) {
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
