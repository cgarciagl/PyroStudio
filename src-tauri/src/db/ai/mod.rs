pub mod agent;
pub mod anthropic;
pub mod context;
pub mod copilot;
pub mod gemini;
pub mod intelligence;
pub mod mock;
pub mod ollama;
pub mod openai;
pub mod provider;
pub mod reports;
pub mod security;

pub use agent::*;
pub use context::*;
pub use copilot::*;
pub use intelligence::*;
pub use provider::*;
pub use reports::*;

use crate::db::credentials::get_credential;
use crate::db::error::PyroError;

/// Factory function to instantiate an AI Provider based on configuration and secure vault credentials.
pub fn create_ai_provider(config: &AiConfig) -> Result<Box<dyn AiProvider>, PyroError> {
    if !config.enabled {
        return Err(PyroError::InvalidOperation(
            "La integración de IA está deshabilitada en la configuración de PyroStudio.".into(),
        ));
    }

    // Strict Privacy Mode verification
    if config.privacy_mode {
        match config.provider {
            AiProviderType::Gemini
            | AiProviderType::OpenAi
            | AiProviderType::OpenRouter
            | AiProviderType::Anthropic => {
                return Err(PyroError::InvalidOperation(
                    "Modo Privado (Privacy Mode) ACTIVO: Las solicitudes a proveedores de IA externos en la nube están estrictamente bloqueadas. Para usar IA en Modo Privado, configura un modelo local (Ollama) o desactiva el Modo Privado en Ajustes de IA.".into(),
                ));
            }
            _ => {}
        }
    }

    match config.provider {
        AiProviderType::Gemini => {
            let cred_id = config.credential_id.as_deref().ok_or_else(|| {
                PyroError::InvalidOperation(
                    "Se requiere configurar la API Key para Gemini en los Ajustes de IA.".into(),
                )
            })?;
            let api_key = get_credential(cred_id).map_err(|_| {
                PyroError::InvalidOperation(format!(
                    "No se encontró la clave de API para Gemini en el almacén seguro (ID: '{cred_id}')."
                ))
            })?;
            Ok(Box::new(gemini::GeminiProvider::new(
                api_key,
                Some(config.model.clone()),
                config.custom_endpoint.clone(),
            )))
        }

        AiProviderType::OpenAi => {
            let cred_id = config.credential_id.as_deref().ok_or_else(|| {
                PyroError::InvalidOperation(
                    "Se requiere configurar la API Key para OpenAI en los Ajustes de IA.".into(),
                )
            })?;
            let api_key = get_credential(cred_id).map_err(|_| {
                PyroError::InvalidOperation(format!(
                    "No se encontró la clave de API para OpenAI en el almacén seguro (ID: '{cred_id}')."
                ))
            })?;
            Ok(Box::new(openai::OpenAiProvider::new(
                api_key,
                Some(config.model.clone()),
                config.custom_endpoint.clone(),
            )))
        }

        AiProviderType::OpenRouter => {
            let cred_id = config.credential_id.as_deref().ok_or_else(|| {
                PyroError::InvalidOperation(
                    "Se requiere configurar la API Key para OpenRouter en los Ajustes de IA.".into(),
                )
            })?;
            let api_key = get_credential(cred_id).map_err(|_| {
                PyroError::InvalidOperation(format!(
                    "No se encontró la clave de API para OpenRouter en el almacén seguro (ID: '{cred_id}')."
                ))
            })?;
            let endpoint = config.custom_endpoint.clone().unwrap_or_else(|| {
                "https://openrouter.ai/api/v1/chat/completions".to_string()
            });
            Ok(Box::new(openai::OpenAiProvider::new(
                api_key,
                Some(config.model.clone()),
                Some(endpoint),
            )))
        }

        AiProviderType::Anthropic => {
            let cred_id = config.credential_id.as_deref().ok_or_else(|| {
                PyroError::InvalidOperation(
                    "Se requiere configurar la API Key para Anthropic en los Ajustes de IA.".into(),
                )
            })?;
            let api_key = get_credential(cred_id).map_err(|_| {
                PyroError::InvalidOperation(format!(
                    "No se encontró la clave de API para Anthropic en el almacén seguro (ID: '{cred_id}')."
                ))
            })?;
            Ok(Box::new(anthropic::AnthropicProvider::new(
                api_key,
                Some(config.model.clone()),
            )))
        }

        AiProviderType::Ollama => Ok(Box::new(ollama::OllamaProvider::new(
            Some(config.model.clone()),
            config.custom_endpoint.clone(),
        ))),

        AiProviderType::Mock => Ok(Box::new(mock::MockAiProvider::new())),

        AiProviderType::None => Err(PyroError::InvalidOperation(
            "Ningún proveedor de IA seleccionado.".into(),
        )),
    }
}
