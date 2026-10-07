use super::openai::OpenAiProvider;
use super::provider::{AiCompletionRequest, AiCompletionResponse, AiProvider};
use crate::db::error::PyroError;

pub struct OllamaProvider {
    inner: OpenAiProvider,
    model: String,
}

impl OllamaProvider {
    pub fn new(model: Option<String>, custom_endpoint: Option<String>) -> Self {
        let model_name = model.unwrap_or_else(|| "qwen2.5-coder".to_string());
        let endpoint = custom_endpoint
            .unwrap_or_else(|| "http://localhost:11434/v1/chat/completions".to_string());

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
