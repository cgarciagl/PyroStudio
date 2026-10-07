use super::provider::{AiCompletionRequest, AiCompletionResponse, AiProvider, ToolCall};
use crate::db::error::PyroError;
use serde_json::json;
use std::sync::Mutex;

pub struct MockAiProvider {
    canned_responses: Mutex<Vec<AiCompletionResponse>>,
    model: String,
}

impl MockAiProvider {
    pub fn new() -> Self {
        Self {
            canned_responses: Mutex::new(Vec::new()),
            model: "mock-ai-v1".to_string(),
        }
    }

    pub fn with_responses(responses: Vec<AiCompletionResponse>) -> Self {
        Self {
            canned_responses: Mutex::new(responses),
            model: "mock-ai-v1".to_string(),
        }
    }

    pub fn push_response(&self, response: AiCompletionResponse) {
        if let Ok(mut lock) = self.canned_responses.lock() {
            lock.push(response);
        }
    }
}

impl Default for MockAiProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl AiProvider for MockAiProvider {
    fn name(&self) -> &str {
        "Mock AI Provider"
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
        let canned = if let Ok(mut lock) = self.canned_responses.lock() {
            if !lock.is_empty() {
                Some(lock.remove(0))
            } else {
                None
            }
        } else {
            None
        };

        let last_user_msg = req
            .messages
            .iter()
            .rev()
            .find(|m| matches!(m.role, super::provider::AiMessageRole::User))
            .map(|m| m.content.clone())
            .unwrap_or_default();
        let msg_count = req.messages.len();
        let has_tools = !req.tools.is_empty();

        Box::pin(async move {
            if let Some(resp) = canned {
                return Ok(resp);
            }

            let mut tool_calls = Vec::new();
            let content;

            if last_user_msg.contains("¿Por qué orders está lenta?")
                || last_user_msg.contains("lenta")
            {
                if msg_count <= 2 && has_tools {
                    tool_calls.push(ToolCall {
                        id: "call_mock_explain_1".to_string(),
                        name: "explain_query".to_string(),
                        arguments: json!({ "sql": "SELECT * FROM orders WHERE customer_id = 42 ORDER BY created_at DESC" }),
                        thought_signature: None,
                        extra: None,
                    });
                    content =
                        "Voy a inspeccionar el plan de ejecución de la consulta sobre `orders`."
                            .to_string();
                } else {
                    content = "### Diagnóstico de Rendimiento para `orders`:\n- **Cuello de botella:** Full Table Scan en la tabla `orders` debido a la falta de índice en `(customer_id, created_at)`.\n- **Recomendación:** Crear un índice compuesto `CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at);`.".to_string();
                }
            } else if last_user_msg.contains("Optimiza esta consulta")
                || last_user_msg.contains("Optimize")
            {
                content = "### Optimización Propuesta:\n```sql\nSELECT id, customer_id, total, created_at FROM orders WHERE customer_id = 10 LIMIT 100;\n```\n- **Mejora esperada:** Evita recuperar todas las columnas innecesarias y limita la transferencia de memoria.".to_string();
            } else if last_user_msg.contains("Explícame esta consulta")
                || last_user_msg.contains("Explain")
            {
                content = "### Explicación de la consulta:\n1. Filtra registros de `orders` donde `status = 'completed'`.\n2. Une con `customers` mediante `customer_id`.\n3. Agrupa por cliente y calcula la suma total.".to_string();
            } else if last_user_msg.contains("Corrige") || last_user_msg.contains("Error") {
                content = "### Corrección de Error:\n- **Causa:** La columna `user_id` no existe en la tabla `orders` (la columna correcta es `customer_id`).\n```sql\nSELECT * FROM orders WHERE customer_id = 5;\n```".to_string();
            } else {
                content = format!("Mock AI response for query: {last_user_msg}");
            }

            Ok(AiCompletionResponse {
                content,
                tool_calls,
                finish_reason: "stop".to_string(),
                prompt_tokens: Some(120),
                completion_tokens: Some(85),
                total_tokens: Some(205),
                latency_ms: 15,
                provider: "Mock".to_string(),
                model: "mock-ai-v1".to_string(),
                extra_content: None,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ai::provider::AiMessage;

    #[tokio::test]
    async fn test_mock_provider_deterministic() {
        let provider = MockAiProvider::new();
        let req = AiCompletionRequest {
            system_prompt: Some("System prompt".into()),
            messages: vec![AiMessage::user(
                "Optimiza esta consulta: SELECT * FROM orders",
            )],
            tools: vec![],
            temperature: Some(0.0),
            max_tokens: Some(100),
        };

        let res = provider.complete(&req).await;
        assert!(res.is_ok());
        let resp = res.unwrap();
        assert!(resp.content.contains("Optimización Propuesta"));
        assert_eq!(resp.provider, "Mock");
    }
}
