use crate::db::error::PyroError;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderType {
    Gemini,
    #[serde(rename = "openai", alias = "open_ai")]
    OpenAi,
    #[serde(rename = "openrouter", alias = "open_router")]
    OpenRouter,
    Anthropic,
    Ollama,
    Mock,
    None,
}

impl fmt::Display for AiProviderType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Gemini => write!(f, "Gemini"),
            Self::OpenAi => write!(f, "OpenAI"),
            Self::OpenRouter => write!(f, "OpenRouter"),
            Self::Anthropic => write!(f, "Anthropic"),
            Self::Ollama => write!(f, "Ollama (Local)"),
            Self::Mock => write!(f, "Mock Provider"),
            Self::None => write!(f, "None (Disabled)"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiMessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub thought_signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: AiMessageRole,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub tool_calls: Vec<ToolCall>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub extra_content: Option<serde_json::Value>,
}

impl AiMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: AiMessageRole::User,
            content: content.into(),
            tool_call_id: None,
            tool_calls: vec![],
            extra_content: None,
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: AiMessageRole::Assistant,
            content: content.into(),
            tool_call_id: None,
            tool_calls: vec![],
            extra_content: None,
        }
    }

    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: AiMessageRole::System,
            content: content.into(),
            tool_call_id: None,
            tool_calls: vec![],
            extra_content: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value, // JSON Schema
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiCompletionRequest {
    pub system_prompt: Option<String>,
    pub messages: Vec<AiMessage>,
    pub tools: Vec<ToolDefinition>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiCompletionResponse {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub finish_reason: String,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub latency_ms: u64,
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub extra_content: Option<serde_json::Value>,
}

/// Settings and preferences for AI integration in PyroStudio.
/// SECURITY: Never stores raw API keys in serialized structs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub enabled: bool,
    pub provider: AiProviderType,
    pub model: String,
    #[serde(alias = "credentialId", alias = "credential_id", default)]
    pub credential_id: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(alias = "maxTokens", alias = "max_tokens", default)]
    pub max_tokens: Option<u32>,
    #[serde(alias = "customEndpoint", alias = "custom_endpoint", default)]
    pub custom_endpoint: Option<String>,
    #[serde(alias = "privacyMode", alias = "privacy_mode", default)]
    pub privacy_mode: bool,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: AiProviderType::None,
            model: "gemini-3.8-flash".to_string(),
            credential_id: None,
            temperature: Some(0.2),
            max_tokens: Some(2048),
            custom_endpoint: None,
            privacy_mode: true, // Privacy Mode ON by default!
        }
    }
}

/// Abstract AI Provider interface.
pub trait AiProvider: Send + Sync {
    fn name(&self) -> &str;
    fn model(&self) -> &str;
    fn complete<'a>(
        &'a self,
        req: &'a AiCompletionRequest,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<AiCompletionResponse, PyroError>> + Send + 'a>,
    >;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ai_provider_type_deserialization_aliases() {
        let p1: AiProviderType = serde_json::from_str("\"openai\"").unwrap();
        assert_eq!(p1, AiProviderType::OpenAi);

        let p2: AiProviderType = serde_json::from_str("\"open_ai\"").unwrap();
        assert_eq!(p2, AiProviderType::OpenAi);

        let p3: AiProviderType = serde_json::from_str("\"openrouter\"").unwrap();
        assert_eq!(p3, AiProviderType::OpenRouter);

        let p4: AiProviderType = serde_json::from_str("\"open_router\"").unwrap();
        assert_eq!(p4, AiProviderType::OpenRouter);

        let p5: AiProviderType = serde_json::from_str("\"gemini\"").unwrap();
        assert_eq!(p5, AiProviderType::Gemini);
    }
}

