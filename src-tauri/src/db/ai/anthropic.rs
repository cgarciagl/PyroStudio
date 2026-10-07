use super::provider::{
    AiCompletionRequest, AiCompletionResponse, AiMessageRole, AiProvider, ToolCall,
};
use super::security::redact_sensitive_text;
use crate::db::error::PyroError;
use serde_json::json;
use std::time::Instant;

pub struct AnthropicProvider {
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(api_key: String, model: Option<String>) -> Self {
        let model_name = model.unwrap_or_else(|| "claude-3-5-sonnet-20241022".to_string());
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(45))
            .build()
            .unwrap_or_default();

        Self {
            api_key,
            model: model_name,
            client,
        }
    }
}

impl AiProvider for AnthropicProvider {
    fn name(&self) -> &str {
        "Anthropic"
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
        Box::pin(async move {
            let start = Instant::now();
            let url = "https://api.anthropic.com/v1/messages";

            let mut messages = Vec::new();
            for msg in &req.messages {
                let role_str = match msg.role {
                    AiMessageRole::User => "user",
                    AiMessageRole::Assistant => "assistant",
                    AiMessageRole::System => "user",
                    AiMessageRole::Tool => "user",
                };

                let mut content_arr = Vec::new();
                if !msg.content.is_empty() {
                    content_arr.push(json!({
                        "type": "text",
                        "text": redact_sensitive_text(&msg.content)
                    }));
                }

                for tc in &msg.tool_calls {
                    content_arr.push(json!({
                        "type": "tool_use",
                        "id": tc.id,
                        "name": tc.name,
                        "input": tc.arguments
                    }));
                }

                if let Some(ref tid) = msg.tool_call_id {
                    content_arr.push(json!({
                        "type": "tool_result",
                        "tool_use_id": tid,
                        "content": redact_sensitive_text(&msg.content)
                    }));
                }

                messages.push(json!({
                    "role": role_str,
                    "content": content_arr
                }));
            }

            let mut body = json!({
                "model": self.model,
                "messages": messages,
                "max_tokens": req.max_tokens.unwrap_or(2048)
            });

            if let Some(ref sys) = req.system_prompt {
                body["system"] = json!(redact_sensitive_text(sys));
            }

            if let Some(temp) = req.temperature {
                body["temperature"] = json!(temp);
            }

            if !req.tools.is_empty() {
                let mut tools_arr = Vec::new();
                for t in &req.tools {
                    tools_arr.push(json!({
                        "name": t.name,
                        "description": t.description,
                        "input_schema": t.parameters
                    }));
                }
                body["tools"] = json!(tools_arr);
            }

            let res = self
                .client
                .post(url)
                .header("x-api-key", &self.api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| {
                    let sanitized_err = redact_sensitive_text(&e.to_string());
                    PyroError::Ai(format!("Error conectando con Anthropic API: {sanitized_err}"))
                })?;

            let status = res.status();
            let latency_ms = start.elapsed().as_millis() as u64;

            if !status.is_success() {
                let err_text = res
                    .text()
                    .await
                    .unwrap_or_else(|_| "Error desconocido".into());
                let clean_err = redact_sensitive_text(&err_text);
                return Err(PyroError::Ai(format!(
                    "Anthropic API devolvió error {status}: {clean_err}"
                )));
            }

            let resp_json: serde_json::Value = res
                .json()
                .await
                .map_err(|e| PyroError::Ai(format!("Respuesta JSON inválida de Anthropic: {e}")))?;

            let mut content_text = String::new();
            let mut tool_calls = Vec::new();
            let finish_reason = resp_json
                .get("stop_reason")
                .and_then(|r| r.as_str())
                .unwrap_or("end_turn")
                .to_string();

            if let Some(content_items) = resp_json.get("content").and_then(|c| c.as_array()) {
                for item in content_items {
                    let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if item_type == "text" {
                        if let Some(txt) = item.get("text").and_then(|t| t.as_str()) {
                            content_text.push_str(txt);
                        }
                    } else if item_type == "tool_use" {
                        let id = item
                            .get("id")
                            .and_then(|i| i.as_str())
                            .unwrap_or("")
                            .to_string();
                        let name = item
                            .get("name")
                            .and_then(|n| n.as_str())
                            .unwrap_or("")
                            .to_string();
                        let input = item.get("input").cloned().unwrap_or(json!({}));
                        tool_calls.push(ToolCall {
                            id,
                            name,
                            arguments: input,
                            thought_signature: None,
                            extra: None,
                        });
                    }
                }
            }

            let prompt_tokens = resp_json
                .get("usage")
                .and_then(|u| u.get("input_tokens"))
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let completion_tokens = resp_json
                .get("usage")
                .and_then(|u| u.get("output_tokens"))
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let total_tokens = match (prompt_tokens, completion_tokens) {
                (Some(p), Some(c)) => Some(p + c),
                _ => None,
            };

            Ok(AiCompletionResponse {
                content: content_text,
                tool_calls,
                finish_reason,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                latency_ms,
                provider: "Anthropic".to_string(),
                model: self.model.clone(),
                extra_content: None,
            })
        })
    }
}
