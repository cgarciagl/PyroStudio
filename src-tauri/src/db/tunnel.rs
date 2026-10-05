use base64::Engine;
use reqwest::header::AUTHORIZATION;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Instant;

use super::error::PyroError;
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

    pub async fn test_connection(&self) -> Result<ServerInfo, PyroError> {
        let start = Instant::now();
        let mut form = HashMap::new();
        form.insert("actn", "C".to_string());
        form.insert("host", self.config.host.clone());
        form.insert("port", self.config.port.to_string());
        form.insert("login", self.config.user.clone());
        form.insert("password", self.config.password.clone().unwrap_or_default());
        form.insert("db", self.config.database.clone().unwrap_or_default());

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
            .map_err(|e| PyroError::Tunnel(format!("Error en petición HTTP al túnel: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(PyroError::Tunnel(format!(
                "El servidor del túnel HTTP respondió con código de estado: {}",
                status
            )));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| PyroError::Tunnel(format!("Error leyendo respuesta del túnel: {e}")))?;
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
        let results = self.execute_queries(&[sql], database).await?;
        results.into_iter().next().ok_or_else(|| {
            PyroError::Tunnel("No se recibieron resultados de la consulta".to_string())
        })
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

        let mut req = self.client.post(&self.tunnel.url).form(&form);

        if let (Some(ref u), Some(ref p)) = (&self.tunnel.http_user, &self.tunnel.http_password) {
            if !u.is_empty() {
                let creds = format!("{}:{}", u, p);
                let encoded = base64::engine::general_purpose::STANDARD.encode(creds);
                req = req.header(AUTHORIZATION, format!("Basic {}", encoded));
            }
        }

        let resp = req.send().await.map_err(|e| {
            PyroError::Tunnel(format!("Error en consulta a través del túnel HTTP: {e}"))
        })?;
        let status = resp.status();
        if !status.is_success() {
            return Err(PyroError::Tunnel(format!(
                "El servidor del túnel respondió con código de estado: {}",
                status
            )));
        }

        let bytes = resp.bytes().await.map_err(|e| {
            PyroError::Tunnel(format!(
                "Error leyendo respuesta de consulta del túnel: {e}"
            ))
        })?;
        let elapsed = start.elapsed().as_millis() as u64;

        parse_query_response(&bytes, elapsed)
    }
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
    if data.len() < 16 {
        let raw = String::from_utf8_lossy(data);
        return Err(PyroError::Tunnel(format!(
            "Respuesta inválida del túnel (se esperaba cabecera binaria de al menos 16 bytes): {}",
            raw.chars().take(300).collect::<String>()
        )));
    }
    let magic = read_u32_be(data, offset)?;
    if magic != 1111 {
        let raw = String::from_utf8_lossy(data);
        return Err(PyroError::Tunnel(format!(
            "Número mágico incorrecto {} (se esperaba 1111). Respuesta del servidor: {}",
            magic,
            raw.chars().take(300).collect::<String>()
        )));
    }
    let _version = read_u16_be(data, offset)?;
    let errno = read_u32_be(data, offset)?;
    if *offset + 6 > data.len() {
        return Err(PyroError::Tunnel(
            "Fin de datos leyendo relleno de cabecera".into(),
        ));
    }
    *offset += 6; // dummy 6 bytes

    if errno > 0 {
        let error_msg =
            read_string_block(data, offset).unwrap_or_else(|_| format!("Error code {}", errno));
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
        if offset + 32 > data.len() {
            break;
        }

        let errno = read_u32_be(data, &mut offset)?;
        let affected_rows = read_u32_be(data, &mut offset)? as u64;
        let _insert_id = read_u32_be(data, &mut offset)?;
        let num_fields = read_u32_be(data, &mut offset)? as usize;
        let num_rows = read_u32_be(data, &mut offset)? as usize;
        if offset + 12 > data.len() {
            return Err(PyroError::Tunnel(
                "Fin inesperado leyendo padding de query".into(),
            ));
        }
        offset += 12; // 12 bytes dummy padding

        if errno > 0 {
            let err_msg =
                read_string_block(data, &mut offset).unwrap_or_else(|_| format!("Error {}", errno));
            return Err(PyroError::Database(format!(
                "Error en consulta [{}]: {}",
                errno, err_msg
            )));
        }

        if num_fields > 0 {
            // Read field descriptors safely, preventing malicious allocations
            let mut col_names = Vec::with_capacity(num_fields.min(1000));
            let mut col_types = Vec::with_capacity(num_fields.min(1000));

            for _ in 0..num_fields {
                let field_name = read_string_block(data, &mut offset)?;
                let _table_name = read_string_block(data, &mut offset)?;
                let ftype = read_u32_be(data, &mut offset)?;
                let _flags = read_u32_be(data, &mut offset)?;
                let _length = read_u32_be(data, &mut offset)?;

                col_names.push(field_name);
                col_types.push(ftype);
            }

            // Read rows safely
            let mut rows = Vec::with_capacity(num_rows.min(5000));
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
                        let s = String::from_utf8_lossy(cell_bytes).to_string();
                        let ftype = col_types.get(col_idx).copied().unwrap_or(253);

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

#[cfg(test)]
mod tests {
    use super::*;

    fn build_packet_header(magic: u32, version: u16, errno: u32) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&magic.to_be_bytes());
        buf.extend_from_slice(&version.to_be_bytes());
        buf.extend_from_slice(&errno.to_be_bytes());
        buf.extend_from_slice(&[0u8; 6]); // 6 dummy bytes
        buf
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
        let mut buf = build_packet_header(1111, 1, 0);
        append_block(&mut buf, b"Localhost via UNIX socket");
        append_block(&mut buf, b"10");
        append_block(&mut buf, b"10.11.8-MariaDB");

        let (server_info, host_info) = parse_connect_response(&buf).expect("Should parse connect");
        assert_eq!(server_info, "10.11.8-MariaDB");
        assert_eq!(host_info, "Localhost via UNIX socket");
    }

    #[test]
    fn test_connect_error() {
        let mut buf = build_packet_header(1111, 1, 1045);
        append_block(&mut buf, b"Access denied for user 'root'@'localhost'");

        let result = parse_connect_response(&buf);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("1045"));
        assert!(err_msg.contains("Access denied"));
    }

    #[test]
    fn test_query_success_with_rows_and_null() {
        let mut buf = build_packet_header(1111, 1, 0);
        // Query block: errno(0), affected_rows(2), insert_id(0), num_fields(2), num_rows(2), dummy(12)
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&2u32.to_be_bytes());
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&2u32.to_be_bytes()); // 2 fields
        buf.extend_from_slice(&2u32.to_be_bytes()); // 2 rows
        buf.extend_from_slice(&[0u8; 12]); // 12 dummy bytes

        // Field 1: id (INT = 3)
        append_block(&mut buf, b"id");
        append_block(&mut buf, b"users");
        buf.extend_from_slice(&3u32.to_be_bytes()); // ftype = 3 (INT)
        buf.extend_from_slice(&0u32.to_be_bytes()); // flags
        buf.extend_from_slice(&11u32.to_be_bytes()); // length

        // Field 2: name (VARCHAR = 253)
        append_block(&mut buf, b"name");
        append_block(&mut buf, b"users");
        buf.extend_from_slice(&253u32.to_be_bytes()); // ftype = 253 (VARCHAR)
        buf.extend_from_slice(&0u32.to_be_bytes()); // flags
        buf.extend_from_slice(&255u32.to_be_bytes()); // length

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
    fn test_query_empty_result() {
        let mut buf = build_packet_header(1111, 1, 0);
        // num_fields = 1, num_rows = 0
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&1u32.to_be_bytes());
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&[0u8; 12]);

        append_block(&mut buf, b"empty_col");
        append_block(&mut buf, b"tbl");
        buf.extend_from_slice(&253u32.to_be_bytes());
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&10u32.to_be_bytes());

        buf.push(0x00);

        let results = parse_query_response(&buf, 5).expect("Should parse empty result");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].rows.len(), 0);
        assert_eq!(results[0].columns, vec!["empty_col"]);
    }

    #[test]
    fn test_query_error_response() {
        let mut buf = build_packet_header(1111, 1, 0);
        // Query has errno = 1146 (Table doesn't exist)
        buf.extend_from_slice(&1146u32.to_be_bytes());
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&[0u8; 12]);
        append_block(&mut buf, b"Table 'test.non_existent' doesn't exist");

        let res = parse_query_response(&buf, 8);
        assert!(res.is_err());
        let err_msg = res.unwrap_err().to_string();
        assert!(err_msg.contains("1146"));
        assert!(err_msg.contains("doesn't exist"));
    }

    #[test]
    fn test_large_value_block() {
        let mut buf = build_packet_header(1111, 1, 0);
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&1u32.to_be_bytes());
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&1u32.to_be_bytes());
        buf.extend_from_slice(&1u32.to_be_bytes());
        buf.extend_from_slice(&[0u8; 12]);

        append_block(&mut buf, b"long_text");
        append_block(&mut buf, b"t");
        buf.extend_from_slice(&253u32.to_be_bytes());
        buf.extend_from_slice(&0u32.to_be_bytes());
        buf.extend_from_slice(&1000u32.to_be_bytes());

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
        // Less than 16 bytes
        let truncated = vec![0u8; 10];
        assert!(parse_connect_response(&truncated).is_err());
        assert!(parse_query_response(&truncated, 0).is_err());

        // Wrong magic number
        let wrong_magic = build_packet_header(9999, 1, 0);
        assert!(parse_connect_response(&wrong_magic).is_err());
        assert!(parse_query_response(&wrong_magic, 0).is_err());

        // Header claims 100 bytes block but ends immediately
        let mut corrupt_block = build_packet_header(1111, 1, 0);
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
}
