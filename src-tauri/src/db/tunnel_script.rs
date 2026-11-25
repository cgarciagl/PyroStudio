use crate::db::error::PyroError;

const MYSQL_TUNNEL_SCRIPT: &str = include_str!("../../../tunnel/pyro_tunnel.php");
const SQLITE_TUNNEL_SCRIPT: &str = include_str!("../../../tunnel/pyro_tunnel_sqlite.php");

const TOKEN_PLACEHOLDER: &str = "$tunnelToken = '';";
const MIN_TOKEN_LENGTH: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TunnelScriptKind {
    Mysql,
    Sqlite,
}

impl TunnelScriptKind {
    pub fn parse(raw: &str) -> Result<Self, PyroError> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "mysql" | "mariadb" => Ok(Self::Mysql),
            "sqlite" => Ok(Self::Sqlite),
            other => Err(PyroError::QueryExecution(format!(
                "Tipo de script de túnel no soportado: {other}"
            ))),
        }
    }

    pub fn default_filename(self) -> &'static str {
        match self {
            Self::Mysql => "pyro_tunnel.php",
            Self::Sqlite => "pyro_tunnel_sqlite.php",
        }
    }

    pub fn raw_source(self) -> &'static str {
        match self {
            Self::Mysql => MYSQL_TUNNEL_SCRIPT,
            Self::Sqlite => SQLITE_TUNNEL_SCRIPT,
        }
    }
}

/// Escapes a token for safe inclusion inside a PHP single-quoted string literal.
fn escape_php_single_quoted(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            _ => out.push(ch),
        }
    }
    out
}

/// Renders the embedded PHP tunnel script, optionally injecting `$tunnelToken`.
pub fn render_tunnel_script(
    kind: TunnelScriptKind,
    token: Option<&str>,
) -> Result<String, PyroError> {
    let source = kind.raw_source();
    let trimmed = token.map(str::trim).unwrap_or("");
    if trimmed.is_empty() {
        return Ok(source.to_string());
    }

    if trimmed.len() < MIN_TOKEN_LENGTH {
        return Err(PyroError::QueryExecution(format!(
            "El token del túnel debe tener al menos {MIN_TOKEN_LENGTH} caracteres."
        )));
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(PyroError::QueryExecution(
            "El token del túnel no puede contener caracteres de control.".to_string(),
        ));
    }

    if !source.contains(TOKEN_PLACEHOLDER) {
        return Err(PyroError::QueryExecution(
            "No se encontró el marcador de token en el script embebido.".to_string(),
        ));
    }

    let escaped = escape_php_single_quoted(trimmed);
    let replacement = format!("$tunnelToken = '{escaped}';");
    Ok(source.replacen(TOKEN_PLACEHOLDER, &replacement, 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_scripts_are_present_and_have_placeholder() {
        for kind in [TunnelScriptKind::Mysql, TunnelScriptKind::Sqlite] {
            let src = kind.raw_source();
            assert!(!src.is_empty());
            assert!(
                src.contains(TOKEN_PLACEHOLDER),
                "{} must contain {}",
                kind.default_filename(),
                TOKEN_PLACEHOLDER
            );
        }
    }

    #[test]
    fn render_without_token_returns_original() {
        let rendered = render_tunnel_script(TunnelScriptKind::Mysql, None).unwrap();
        assert_eq!(rendered, MYSQL_TUNNEL_SCRIPT);

        let rendered_empty = render_tunnel_script(TunnelScriptKind::Sqlite, Some("   ")).unwrap();
        assert_eq!(rendered_empty, SQLITE_TUNNEL_SCRIPT);
    }

    #[test]
    fn render_with_token_injects_and_escapes_php_literal() {
        let token = "abc'123\\def4567890";
        let rendered = render_tunnel_script(TunnelScriptKind::Mysql, Some(token)).unwrap();
        assert!(rendered.contains("$tunnelToken = 'abc\\'123\\\\def4567890';"));
        assert!(!rendered.contains(TOKEN_PLACEHOLDER));
    }

    #[test]
    fn render_rejects_short_or_control_char_tokens() {
        assert!(render_tunnel_script(TunnelScriptKind::Mysql, Some("short")).is_err());
        assert!(
            render_tunnel_script(TunnelScriptKind::Sqlite, Some("0123456789abcdef\n")).is_err()
        );
    }
}
