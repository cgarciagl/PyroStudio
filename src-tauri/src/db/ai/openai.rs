use super::provider::{
    AiCompletionRequest, AiCompletionResponse, AiMessageRole, AiProvider, ToolCall,
};
use super::security::redact_sensitive_text;
use crate::db::error::PyroError;
use serde_json::json;
use std::time::Instant;

pub struct OpenAiProvider {
    api_key: String,
    model: String,
    endpoint: String,
    client: reqwest::Client,
}

impl OpenAiProvider {
    pub fn new(api_key: String, model: Option<String>, custom_endpoint: Option<String>) -> Self {
        let model_name = model.unwrap_or_else(|| "gpt-4o-mini".to_string());
        let endpoint = custom_endpoint
            .unwrap_or_else(|| "https://api.openai.com/v1/chat/completions".to_string());
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(45))
            .build()
            .unwrap_or_default();

        Self {
            api_key,
            model: model_name,
            endpoint,
            client,
        }
    }
}

impl AiProvider for OpenAiProvider {
    fn name(&self) -> &str {
        if self.endpoint.contains("openrouter.ai") {
            "OpenRouter"
        } else {
            "OpenAI"
        }
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
            let mut messages = Vec::new();

            if let Some(ref sys) = req.system_prompt {
                messages.push(json!({
                    "role": "system",
                    "content": redact_sensitive_text(sys)
                }));
            }

            for msg in &req.messages {
                let role_str = match msg.role {
                    AiMessageRole::System => "system",
                    AiMessageRole::User => "user",
                    AiMessageRole::Assistant => "assistant",
                    AiMessageRole::Tool => "tool",
                };

                let mut msg_obj = json!({
                    "role": role_str,
                    "content": if msg.content.is_empty() && !msg.tool_calls.is_empty() {
                        serde_json::Value::Null
                    } else {
                        json!(redact_sensitive_text(&msg.content))
                    }
                });

                if let Some(ref t_id) = msg.tool_call_id {
                    msg_obj["tool_call_id"] = json!(t_id);
                }

                if !msg.tool_calls.is_empty() {
                    let mut tc_arr = Vec::new();
                    for tc in &msg.tool_calls {
                        let mut tc_obj = json!({
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": tc.arguments.to_string()
                            }
                        });

                        if let Some(ref extra) = tc.extra {
                            tc_obj["extra_content"] = extra.clone();
                        } else if let Some(ref sig) = tc.thought_signature {
                            tc_obj["extra_content"] = json!({
                                "google": {
                                    "thought_signature": sig
                                }
                            });
                        }

                        tc_arr.push(tc_obj);
                    }
                    msg_obj["tool_calls"] = json!(tc_arr);
                }

                if let Some(ref extra) = msg.extra_content {
                    msg_obj["extra_content"] = extra.clone();
                }

                messages.push(msg_obj);
            }

            let mut body = json!({
                "model": self.model,
                "messages": messages
            });

            if let Some(temp) = req.temperature {
                body["temperature"] = json!(temp);
            }
            if let Some(max_t) = req.max_tokens {
                body["max_tokens"] = json!(max_t);
            }

            if !req.tools.is_empty() {
                let mut tools_arr = Vec::new();
                for t in &req.tools {
                    tools_arr.push(json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters
                        }
                    }));
                }
                body["tools"] = json!(tools_arr);
            }

            let is_openrouter = self.endpoint.contains("openrouter.ai");
            let prov_label = if is_openrouter { "OpenRouter" } else { "OpenAI" };
            let max_retries = 2;
            let mut last_error_msg = String::new();
            let mut resp_json_opt = None;

            for attempt in 0..=max_retries {
                let mut req_builder = self
                    .client
                    .post(&self.endpoint)
                    .header("Authorization", format!("Bearer {}", self.api_key));

                if is_openrouter {
                    req_builder = req_builder
                        .header("HTTP-Referer", "https://pyrostudio.app")
                        .header("X-Title", "PyroStudio");
                }

                let res_result = req_builder.json(&body).send().await;

                let res = match res_result {
                    Ok(r) => r,
                    Err(e) => {
                        let sanitized_err = redact_sensitive_text(&e.to_string());
                        last_error_msg = format!("Error conectando con {prov_label} API: {sanitized_err}");
                        if attempt < max_retries {
                            tokio::time::sleep(std::time::Duration::from_millis(1500 * (attempt as u64 + 1))).await;
                            continue;
                        }
                        return Err(PyroError::Ai(last_error_msg));
                    }
                };

                let status = res.status();
                if !status.is_success() {
                    let err_text = res
                        .text()
                        .await
                        .unwrap_or_else(|_| "Error desconocido".into());
                    let clean_err = redact_sensitive_text(&err_text);
                    let is_busy = status.as_u16() == 429
                        || status.as_u16() == 503
                        || status.as_u16() == 502
                        || status.as_u16() == 504
                        || clean_err.to_lowercase().contains("overloaded")
                        || clean_err.to_lowercase().contains("resource_exhausted")
                        || clean_err.to_lowercase().contains("rate limit")
                        || clean_err.to_lowercase().contains("quota")
                        || clean_err.to_lowercase().contains("busy");

                    if is_busy {
                        last_error_msg = format!(
                            "El modelo de IA está ocupado por alta demanda (Status {status}): {clean_err}"
                        );
                    } else {
                        last_error_msg = format!("{prov_label} API devolvió error {status}: {clean_err}");
                    }

                    if is_busy && attempt < max_retries {
                        tokio::time::sleep(std::time::Duration::from_millis(1500 * (attempt as u64 + 1))).await;
                        continue;
                    }

                    return Err(PyroError::Ai(last_error_msg));
                }

                let parsed: Result<serde_json::Value, _> = res.json().await;
                match parsed {
                    Ok(j) => {
                        resp_json_opt = Some(j);
                        break;
                    }
                    Err(e) => {
                        return Err(PyroError::Ai(format!("Respuesta JSON inválida de {prov_label}: {e}")));
                    }
                }
            }

            let resp_json = resp_json_opt.ok_or_else(|| PyroError::Ai(last_error_msg))?;
            let latency_ms = start.elapsed().as_millis() as u64;

            let mut content_text = String::new();
            let mut tool_calls = Vec::new();
            let mut finish_reason = "stop".to_string();
            let mut extra_content = None;

            if let Some(choice) = resp_json.get("choices").and_then(|c| c.get(0)) {
                if let Some(reason) = choice.get("finish_reason").and_then(|r| r.as_str()) {
                    finish_reason = reason.to_string();
                }

                if let Some(msg) = choice.get("message") {
                    if let Some(txt) = msg.get("content").and_then(|t| t.as_str()) {
                        content_text.push_str(txt);
                    }

                    if let Some(extra) = msg.get("extra_content") {
                        extra_content = Some(extra.clone());
                    }

                    if let Some(tcs) = msg.get("tool_calls").and_then(|t| t.as_array()) {
                        for tc in tcs {
                            let id = tc
                                .get("id")
                                .and_then(|i| i.as_str())
                                .unwrap_or("")
                                .to_string();
                            let fn_obj = tc.get("function");
                            let name = fn_obj
                                .and_then(|f| f.get("name"))
                                .and_then(|n| n.as_str())
                                .unwrap_or("")
                                .to_string();
                            let args_str = fn_obj
                                .and_then(|f| f.get("arguments"))
                                .and_then(|a| a.as_str())
                                .unwrap_or("{}");
                            let args_json: serde_json::Value =
                                serde_json::from_str(args_str).unwrap_or(json!({}));

                            let tc_extra = tc.get("extra_content").cloned();
                            let thought_sig = tc_extra
                                .as_ref()
                                .and_then(|e| e.get("google"))
                                .and_then(|g| g.get("thought_signature"))
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string())
                                .or_else(|| {
                                    tc.get("thought_signature")
                                        .and_then(|s| s.as_str())
                                        .map(|s| s.to_string())
                                });

                            tool_calls.push(ToolCall {
                                id,
                                name,
                                arguments: args_json,
                                thought_signature: thought_sig,
                                extra: tc_extra,
                            });
                        }
                    }
                }
            }

            let prompt_tokens = resp_json
                .get("usage")
                .and_then(|u| u.get("prompt_tokens"))
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let completion_tokens = resp_json
                .get("usage")
                .and_then(|u| u.get("completion_tokens"))
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let total_tokens = resp_json
                .get("usage")
                .and_then(|u| u.get("total_tokens"))
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);

            Ok(AiCompletionResponse {
                content: content_text,
                tool_calls,
                finish_reason,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                latency_ms,
                provider: self.name().to_string(),
                model: self.model.clone(),
                extra_content,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ai::provider::AiMessage;

    #[test]
    fn test_thought_signature_serialization() {
        let msg = AiMessage {
            role: AiMessageRole::Assistant,
            content: "".into(),
            tool_call_id: None,
            tool_calls: vec![ToolCall {
                id: "call_123".into(),
                name: "get_database_health".into(),
                arguments: json!({}),
                thought_signature: Some("sig_abc".into()),
                extra: Some(json!({ "google": { "thought_signature": "sig_abc" } })),
            }],
            extra_content: None,
        };

        let req = AiCompletionRequest {
            system_prompt: None,
            messages: vec![msg],
            tools: vec![],
            temperature: None,
            max_tokens: None,
        };

        let serialized_tc = &req.messages[0].tool_calls[0];
        assert_eq!(serialized_tc.thought_signature.as_deref(), Some("sig_abc"));
    }
}
