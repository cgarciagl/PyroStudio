use super::openai::OpenAiProvider;
use super::provider::{AiCompletionRequest, AiCompletionResponse, AiProvider};
use crate::db::error::PyroError;

/// Google Gemini Provider using Google AI Studio's official OpenAI-compatible Chat Completions API.
/// Endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
pub struct GeminiProvider {
    inner: OpenAiProvider,
    model: String,
}

impl GeminiProvider {
    pub fn new(api_key: String, model: Option<String>, custom_endpoint: Option<String>) -> Self {
        let model_name = model.unwrap_or_else(|| "gemini-3.5-flash-lite".to_string());
        let endpoint = custom_endpoint.unwrap_or_else(|| {
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions".to_string()
        });

        Self {
            inner: OpenAiProvider::new(
                api_key,
                Some(model_name.clone()),
                Some(endpoint),
            ),
            model: model_name,
        }
    }
}

impl AiProvider for GeminiProvider {
    fn name(&self) -> &str {
        "Gemini"
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
                    "Error de conexión con Gemini API (Google AI Studio): {e}"
                ))
            })?;
            resp.provider = "Gemini".to_string();
            Ok(resp)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gemini_provider_defaults_and_model() {
        let provider_default = GeminiProvider::new("test_key".to_string(), None, None);
        assert_eq!(provider_default.name(), "Gemini");
        assert_eq!(provider_default.model(), "gemini-3.5-flash-lite");

        let provider_custom = GeminiProvider::new(
            "test_key".to_string(),
            Some("gemini-3.7-flash".to_string()),
            None,
        );
        assert_eq!(provider_custom.model(), "gemini-3.7-flash");
    }
}
