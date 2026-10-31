use super::openai::OpenAiProvider;
use super::provider::{AiCompletionRequest, AiCompletionResponse, AiProvider};
use crate::db::error::PyroError;
use serde_json::Value;

/// Normalizes any user-supplied endpoint into a full OpenAI-compatible chat completions URL.
/// Handles:
/// - "http://localhost:11434" -> "http://localhost:11434/v1/chat/completions"
/// - "http://localhost:11434/" -> "http://localhost:11434/v1/chat/completions"
/// - "http://localhost:11434/v1" -> "http://localhost:11434/v1/chat/completions"
/// - "http://localhost:11434/v1/chat/completions" -> preserved
pub fn normalize_ollama_endpoint(custom_endpoint: Option<&str>) -> String {
    let raw = custom_endpoint
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("http://localhost:11434");
    let trimmed = raw.trim_end_matches('/');
    if trimmed.ends_with("/v1/chat/completions") {
        trimmed.to_string()
    } else if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else if trimmed.ends_with("/v1") {
        format!("{trimmed}/chat/completions")
    } else {
        format!("{trimmed}/v1/chat/completions")
    }
}

/// Extracts the host root (protocol + domain + port) without path suffixes like /v1 or /api.
pub fn extract_base_url(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if let Some(idx) = trimmed.find("/v1") {
        trimmed[..idx].to_string()
    } else if let Some(idx) = trimmed.find("/api") {
        trimmed[..idx].to_string()
    } else {
        trimmed.to_string()
    }
}

pub struct OllamaProvider {
    inner: OpenAiProvider,
    model: String,
}

impl OllamaProvider {
    pub fn new(model: Option<String>, custom_endpoint: Option<String>) -> Self {
        let model_name = model.unwrap_or_else(|| "qwen2.5-coder".to_string());
        let endpoint = normalize_ollama_endpoint(custom_endpoint.as_deref());

        Self {
            inner: OpenAiProvider::new(
                "ollama-local".to_string(),
                Some(model_name.clone()),
                Some(endpoint),
            ),
            model: model_name,
        }
    }
}

impl AiProvider for OllamaProvider {
    fn name(&self) -> &str {
        "Ollama (Local)"
    }

    fn model(&self) -> &str {
        &self.model
    }

    fn complete<'a>(
        &'a self,
        req: &'a AiCompletionRequest,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<AiCompletionResponse, PyroError>> + Send + 'a>,
    > {
        let fut = self.inner.complete(req);
        Box::pin(async move {
            let mut resp = fut.await.map_err(|e| {
                PyroError::Ai(format!(
                    "No se pudo conectar con el servidor local Ollama. Verifica que Ollama esté ejecutándose: {e}"
                ))
            })?;
            resp.provider = "Ollama (Local)".to_string();
            Ok(resp)
        })
    }
}

/// Discovers installed local AI models by querying Ollama (/api/tags) or OpenAI-compatible endpoints (/v1/models).
pub async fn list_local_models(custom_endpoint: Option<&str>) -> Result<Vec<String>, PyroError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| PyroError::Ai(format!("Error inicializando cliente HTTP: {e}")))?;

    let raw_endpoint = custom_endpoint
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("http://localhost:11434");

    let base_url = extract_base_url(raw_endpoint);

    // 1. First attempt: Ollama native API (/api/tags)
    let ollama_tags_url = format!("{base_url}/api/tags");
    if let Ok(resp) = client.get(&ollama_tags_url).send().await {
        if resp.status().is_success() {
            if let Ok(val) = resp.json::<Value>().await {
                if let Some(models) = val.get("models").and_then(|m| m.as_array()) {
                    let mut names = Vec::new();
                    for item in models {
                        if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                            names.push(name.to_string());
                        }
                    }
                    if !names.is_empty() {
                        return Ok(names);
                    }
                }
            }
        }
    }

    // 2. Second attempt: OpenAI-compatible models list (/v1/models)
    let openai_models_url = format!("{base_url}/v1/models");
    if let Ok(resp) = client.get(&openai_models_url).send().await {
        if resp.status().is_success() {
            if let Ok(val) = resp.json::<Value>().await {
                if let Some(data) = val.get("data").and_then(|d| d.as_array()) {
                    let mut names = Vec::new();
                    for item in data {
                        if let Some(id) = item.get("id").and_then(|n| n.as_str()) {
                            names.push(id.to_string());
                        }
                    }
                    if !names.is_empty() {
                        return Ok(names);
                    }
                }
            }
        }
    }

    Err(PyroError::Ai(format!(
        "No se detectaron modelos en {base_url}. Verifica que Ollama esté activo (ej: 'ollama serve') o que el servidor local compatible (LM Studio / vLLM) esté iniciado."
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_ollama_endpoint() {
        assert_eq!(
            normalize_ollama_endpoint(None),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            normalize_ollama_endpoint(Some("http://localhost:11434")),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            normalize_ollama_endpoint(Some("http://localhost:11434/")),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            normalize_ollama_endpoint(Some("http://localhost:11434/v1")),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            normalize_ollama_endpoint(Some("http://localhost:11434/v1/chat/completions")),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            normalize_ollama_endpoint(Some("http://192.168.1.100:11434")),
            "http://192.168.1.100:11434/v1/chat/completions"
        );
    }

    #[test]
    fn test_extract_base_url() {
        assert_eq!(
            extract_base_url("http://localhost:11434/v1/chat/completions"),
            "http://localhost:11434"
        );
        assert_eq!(
            extract_base_url("http://localhost:11434/api/tags"),
            "http://localhost:11434"
        );
        assert_eq!(
            extract_base_url("http://localhost:11434/v1"),
            "http://localhost:11434"
        );
        assert_eq!(
            extract_base_url("http://localhost:11434/"),
            "http://localhost:11434"
        );
        assert_eq!(
            extract_base_url("http://localhost:11434"),
            "http://localhost:11434"
        );
    }
}
