import React, { useState, useEffect } from "react";
import {
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Key,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  Zap,
  Cpu,
  Lock,
} from "lucide-react";
import { useAiStore, DEFAULT_PROVIDER_CONFIGS } from "../stores/aiStore";
import { useUIStore } from "../stores/uiStore";
import { aiService } from "../services/aiService";
import type { AiProviderType, ProviderSpecificConfig } from "../types/database";

interface AiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PROVIDERS_LIST: Array<{ id: AiProviderType; name: string; tag: string }> = [
  { id: "gemini", name: "Google Gemini", tag: "Nube (Google AI)" },
  { id: "openrouter", name: "OpenRouter", tag: "Multi-modelo (Gateway)" },
  { id: "openai", name: "OpenAI (ChatGPT)", tag: "Nube" },
  { id: "anthropic", name: "Anthropic Claude", tag: "Nube" },
  { id: "ollama", name: "Ollama (Local)", tag: "100% Offline" },
  { id: "mock", name: "Mock Provider", tag: "Pruebas / CI" },
  { id: "none", name: "Deshabilitado", tag: "Solo Heurísticas" },
];

export const AiSettingsModal: React.FC<AiSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { config, saveConfig } = useAiStore();

  const [provider, setProvider] = useState<AiProviderType>(config.provider);
  const [providerConfigs, setProviderConfigs] = useState<
    Record<AiProviderType, ProviderSpecificConfig>
  >(() => {
    const merged: Record<AiProviderType, ProviderSpecificConfig> = { ...DEFAULT_PROVIDER_CONFIGS };
    if (config.providers) {
      (Object.keys(config.providers) as AiProviderType[]).forEach((key) => {
        const val = config.providers?.[key];
        if (val) {
          merged[key] = { ...merged[key], ...val };
        }
      });
    }
    return merged;
  });

  const [model, setModel] = useState<string>(config.model);
  const [apiKey, setApiKey] = useState<string>("");
  const [hasStoredKey, setHasStoredKey] = useState<boolean>(false);
  const [temperature, setTemperature] = useState<number>(config.temperature ?? 0.2);
  const [maxTokens, setMaxTokens] = useState<number>(config.max_tokens ?? 2048);
  const [customEndpoint, setCustomEndpoint] = useState<string>(config.custom_endpoint || "");
  const [privacyMode, setLocalPrivacyMode] = useState<boolean>(config.privacy_mode);
  const [aiEnabled, setAiEnabled] = useState<boolean>(config.enabled);

  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  // Check stored key for current provider
  useEffect(() => {
    if (!isOpen) return;
    const credId = `ai_api_key_${provider}`;
    aiService.hasAiApiKey(credId).then(setHasStoredKey).catch(() => setHasStoredKey(false));
  }, [isOpen, provider]);

  // Sync state on config prop changes or open
  useEffect(() => {
    if (!isOpen) return;
    setProvider(config.provider);
    const initialConfigs: Record<AiProviderType, ProviderSpecificConfig> = {
      ...DEFAULT_PROVIDER_CONFIGS,
    };
    if (config.providers) {
      (Object.keys(config.providers) as AiProviderType[]).forEach((key) => {
        const val = config.providers?.[key];
        if (val) {
          initialConfigs[key] = { ...initialConfigs[key], ...val };
        }
      });
    }
    setProviderConfigs(initialConfigs);

    const currentP = config.provider;
    const savedForP = initialConfigs[currentP] || DEFAULT_PROVIDER_CONFIGS[currentP];
    setModel(config.model || savedForP.model);
    setTemperature(config.temperature ?? savedForP.temperature ?? 0.2);
    setMaxTokens(config.max_tokens ?? savedForP.max_tokens ?? 2048);
    setCustomEndpoint(config.custom_endpoint ?? savedForP.custom_endpoint ?? "");
    setLocalPrivacyMode(config.privacy_mode);
    setAiEnabled(config.enabled);
    setApiKey("");
    setTestResult(null);
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleProviderChange = (newProvider: AiProviderType) => {
    // 1. Save current state into providerConfigs for the old provider
    const updatedConfigs: Record<AiProviderType, ProviderSpecificConfig> = {
      ...providerConfigs,
      [provider]: {
        model,
        custom_endpoint: customEndpoint,
        temperature,
        max_tokens: maxTokens,
      },
    };
    setProviderConfigs(updatedConfigs);

    // 2. Switch to new provider
    setProvider(newProvider);
    setApiKey(""); // Never leak typed keys across providers
    setTestResult(null);

    // 3. Load config for new provider
    const targetConfig =
      updatedConfigs[newProvider] || DEFAULT_PROVIDER_CONFIGS[newProvider] || {
        model: "gemini-3.8-flash",
        custom_endpoint: "",
        temperature: 0.2,
        max_tokens: 2048,
      };

    setModel(targetConfig.model);
    setCustomEndpoint(targetConfig.custom_endpoint || "");
    setTemperature(targetConfig.temperature ?? 0.2);
    setMaxTokens(targetConfig.max_tokens ?? 2048);

    // 4. Check if new provider has an API key in vault
    const credId = `ai_api_key_${newProvider}`;
    aiService.hasAiApiKey(credId).then(setHasStoredKey).catch(() => setHasStoredKey(false));
  };

  const handleSave = async () => {
    const credId = `ai_api_key_${provider}`;
    if (apiKey.trim()) {
      try {
        await aiService.saveAiApiKey(credId, apiKey.trim());
        setHasStoredKey(true);
        setApiKey("");
      } catch (err: unknown) {
        useUIStore.getState().showAlert({
          title: "Error en Almacén Seguro",
          message: "No se pudo guardar la clave API en el almacén seguro.",
          details: typeof err === "string" ? err : (err as Error)?.message || String(err),
          variant: "danger",
          icon: "alert",
        });
        return;
      }
    }

    const updatedConfigs: Record<AiProviderType, ProviderSpecificConfig> = {
      ...providerConfigs,
      [provider]: {
        model: model.trim() || DEFAULT_PROVIDER_CONFIGS[provider]?.model || "gemini-3.8-flash",
        custom_endpoint: customEndpoint.trim() || undefined,
        temperature,
        max_tokens: maxTokens,
      },
    };

    saveConfig({
      enabled: aiEnabled,
      provider,
      model: model.trim() || DEFAULT_PROVIDER_CONFIGS[provider]?.model || "gemini-3.8-flash",
      credential_id: credId,
      temperature,
      max_tokens: maxTokens,
      custom_endpoint: customEndpoint.trim() || undefined,
      privacy_mode: privacyMode,
      providers: updatedConfigs,
    });

    setSaveFeedback("¡Ajustes de IA guardados con éxito!");
    setTimeout(() => {
      setSaveFeedback(null);
      onClose();
    }, 1200);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    const credId = `ai_api_key_${provider}`;
    if (apiKey.trim()) {
      try {
        await aiService.saveAiApiKey(credId, apiKey.trim());
        setHasStoredKey(true);
      } catch {
        // continue
      }
    }

    const testConfig = {
      enabled: true,
      provider,
      model: model.trim() || DEFAULT_PROVIDER_CONFIGS[provider]?.model || "gemini-3.8-flash",
      credential_id: credId,
      temperature,
      max_tokens: 100,
      custom_endpoint: customEndpoint.trim() || undefined,
      privacy_mode: privacyMode,
    };

    try {
      const res = await aiService.testAiProvider(testConfig);
      setTestResult({
        success: true,
        message: `Conexión exitosa con ${res.provider} (${res.model})`,
        latencyMs: res.latency_ms,
      });
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message:
          typeof err === "string"
            ? err
            : (err as Error)?.message || "Error al conectar con el proveedor de IA.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const getProviderKeyPlaceholder = () => {
    if (hasStoredKey) {
      return `•••••••••••••••••••••••••••••••• (Clave de ${provider.toUpperCase()} guardada - escribe para cambiar)`;
    }
    if (provider === "openrouter") {
      return "sk-or-v1-... (Ingresa tu API Key de OpenRouter)";
    }
    if (provider === "openai") {
      return "sk-... (Ingresa tu API Key de OpenAI)";
    }
    if (provider === "gemini") {
      return "AIzaSy... (Ingresa tu API Key de Google AI Studio)";
    }
    if (provider === "anthropic") {
      return "sk-ant-... (Ingresa tu API Key de Anthropic)";
    }
    return "Ingresa tu API Key";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none">
      <div className="bg-[#10131c] border border-[#232a3c] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-neutral-200">
        {/* Header */}
        <div className="px-6 py-4 bg-[#141824] border-b border-[#202738] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center space-x-2">
                <span>Configuración de Inteligencia Artificial</span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-purple-950/40 text-purple-300 border border-purple-800/50">
                  Pyro AI
                </span>
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Claves independientes en Vault AES-256-GCM, multi-proveedor y Modo Privado.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {/* Privacy Mode Card */}
          <div
            className={`p-4 rounded-lg border transition-all ${
              privacyMode
                ? "bg-emerald-950/20 border-emerald-800/50 text-emerald-200"
                : "bg-amber-950/20 border-amber-800/50 text-amber-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                {privacyMode ? (
                  <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : (
                  <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                )}
                <div>
                  <div className="font-bold text-sm">
                    {privacyMode ? "🔒 Privacy Mode (Modo Privado ACTIVO)" : "🔓 Privacy Mode DESACTIVADO"}
                  </div>
                  <p className="text-[11px] text-neutral-300 mt-0.5">
                    {privacyMode
                      ? "Ningún SQL, esquema ni metadatos se envía a proveedores externos en la nube. Las consultas de IA solo pueden usar modelos locales (Ollama) o el motor offline."
                      : "Las consultas y metadatos seleccionados pueden enviarse al proveedor de IA en la nube configurado de forma segura y anonimizada."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLocalPrivacyMode(!privacyMode)}
                className={`px-3 py-1.5 rounded-md font-semibold text-xs border transition-colors ${
                  privacyMode
                    ? "bg-emerald-600/30 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600/50"
                    : "bg-amber-600/30 text-amber-300 border-amber-500/50 hover:bg-amber-600/50"
                }`}
              >
                {privacyMode ? "Desactivar" : "Activar Modo Privado"}
              </button>
            </div>
          </div>

          {/* AI Master Enable Switch */}
          <div className="flex items-center justify-between p-3.5 bg-[#141824] border border-[#202738] rounded-lg">
            <div className="space-y-0.5">
              <div className="font-semibold text-neutral-200">Habilitar Funcionalidades de IA</div>
              <div className="text-[11px] text-neutral-400">
                Activa el SQL Copilot, Database Agent, Smart Search y sugerencias contextuales.
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
            </label>
          </div>

          {/* Provider Selection */}
          <div className="space-y-2">
            <label className="font-semibold text-neutral-300 flex items-center space-x-1.5">
              <Cpu className="w-3.5 h-3.5 text-purple-400" />
              <span>Proveedor de Inteligencia Artificial</span>
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {PROVIDERS_LIST.map((p) => {
                const isSelected = provider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderChange(p.id)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? "bg-purple-950/40 border-purple-500 text-white shadow-md shadow-purple-950/30"
                        : "bg-[#141824] border-[#202738] text-neutral-400 hover:text-neutral-200 hover:bg-[#181d2a]"
                    }`}
                  >
                    <div className="font-semibold text-xs text-neutral-200">{p.name}</div>
                    <div className="text-[10px] text-neutral-400 mt-0.5">{p.tag}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model Name & Endpoint */}
          {provider !== "none" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="font-semibold text-neutral-300">Modelo ({provider.toUpperCase()})</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Escribe el nombre del modelo"
                  className="w-full px-3 py-2 bg-[#0c0e14] border border-[#202738] rounded-md text-neutral-200 font-mono text-xs focus:outline-none focus:border-purple-500"
                />
                {/* Model Presets */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(provider === "gemini"
                    ? [
                        "gemini-3.5-flash-lite",
                        "gemini-2.5-flash-lite",
                        "gemini-3.8-flash",
                        "gemini-3.7-flash",
                        "gemini-3.8-pro",
                      ]
                    : provider === "openrouter"
                    ? [
                        "anthropic/claude-3.5-sonnet",
                        "google/gemini-2.5-flash",
                        "meta-llama/llama-3.3-70b-instruct",
                        "deepseek/deepseek-chat",
                        "openai/gpt-4o-mini",
                        "qwen/qwen-2.5-coder-32b-instruct",
                      ]
                    : provider === "openai"
                    ? ["gpt-4o-mini", "gpt-4o", "o3-mini", "gpt-3.5-turbo"]
                    : provider === "anthropic"
                    ? ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"]
                    : provider === "ollama"
                    ? ["qwen2.5-coder", "deepseek-coder:6.7b", "llama3.2"]
                    : []
                  ).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModel(m)}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                        model === m
                          ? "bg-purple-600/30 text-purple-200 border-purple-500/50"
                          : "bg-[#181d2a] text-neutral-400 border-[#252c3f] hover:text-neutral-200 hover:border-neutral-600"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {provider === "ollama" || provider === "openai" || provider === "openrouter" ? (
                <div className="space-y-1.5">
                  <label className="font-semibold text-neutral-300">Endpoint API</label>
                  <input
                    type="text"
                    value={customEndpoint}
                    onChange={(e) => setCustomEndpoint(e.target.value)}
                    placeholder={
                      provider === "openrouter"
                        ? "https://openrouter.ai/api/v1/chat/completions"
                        : provider === "ollama"
                        ? "http://localhost:11434/v1/chat/completions"
                        : "https://api.openai.com/v1/chat/completions"
                    }
                    className="w-full px-3 py-2 bg-[#0c0e14] border border-[#202738] rounded-md text-neutral-200 font-mono text-xs focus:outline-none focus:border-purple-500"
                  />
                  <p className="text-[10px] text-neutral-400">
                    {provider === "openrouter"
                      ? "URL de la API de OpenRouter (OpenAI-compatible)."
                      : provider === "ollama"
                      ? "Endpoint de tu servidor Ollama local."
                      : "Endpoint base (dejar en blanco para la API oficial de OpenAI)."}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="font-semibold text-neutral-300">Temperatura ({temperature})</label>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full accent-purple-500 mt-2"
                  />
                </div>
              )}
            </div>
          )}

          {/* API Key Vault Input (for Gemini, OpenRouter, OpenAI, Anthropic) */}
          {(provider === "gemini" ||
            provider === "openrouter" ||
            provider === "openai" ||
            provider === "anthropic") && (
            <div className="space-y-2 bg-[#141824] border border-[#202738] rounded-lg p-4">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-neutral-200 flex items-center space-x-1.5">
                  <Key className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    API Key para {PROVIDERS_LIST.find((p) => p.id === provider)?.name || provider}
                  </span>
                </label>
                {hasStoredKey && (
                  <span className="text-[10px] font-mono text-emerald-400 flex items-center space-x-1 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
                    <Lock className="w-3 h-3" />
                    <span>Guardada en Vault AES-256 (`ai_api_key_{provider}`)</span>
                  </span>
                )}
              </div>

              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={getProviderKeyPlaceholder()}
                className="w-full px-3 py-2 bg-[#0c0e14] border border-[#202738] rounded-md text-neutral-200 font-mono text-xs focus:outline-none focus:border-purple-500"
              />
              <p className="text-[10px] text-neutral-400">
                Cada proveedor gestiona su propia API Key de forma 100% independiente. Se almacenan cifradas localmente con AES-256-GCM.
              </p>
            </div>
          )}

          {/* Test connection alert */}
          {testResult && (
            <div
              className={`p-3.5 rounded-lg border font-mono text-xs flex items-start space-x-2.5 ${
                testResult.success
                  ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-300"
                  : "bg-red-950/30 border-red-800/50 text-red-300"
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="font-bold">{testResult.message}</div>
                {testResult.latencyMs !== undefined && (
                  <div className="text-[10px] text-emerald-400/80 mt-0.5">
                    Latencia de respuesta: {testResult.latencyMs} ms
                  </div>
                )}
              </div>
            </div>
          )}

          {saveFeedback && (
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 font-mono text-center">
              {saveFeedback}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#141824] border-t border-[#202738] flex items-center justify-between">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting || provider === "none"}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#1a202e] hover:bg-[#232b3e] text-neutral-200 border border-[#2b354c] rounded-md font-medium text-xs transition-colors disabled:opacity-50"
          >
            {isTesting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
            ) : (
              <Zap className="w-3.5 h-3.5 text-purple-400" />
            )}
            <span>Probar Conexión</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-[#1b202e] hover:bg-[#252c40] text-neutral-300 rounded-md font-medium text-xs transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-md font-semibold text-xs shadow-md shadow-purple-950/40 transition-all active:scale-95"
            >
              Guardar Configuración
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

