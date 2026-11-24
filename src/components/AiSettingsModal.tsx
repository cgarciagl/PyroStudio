import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Key,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Zap,
  Cpu,
  Lock,
  RefreshCw,
} from "lucide-react";
import { useAiStore, DEFAULT_PROVIDER_CONFIGS } from "../stores/aiStore";
import { useUIStore } from "../stores/uiStore";
import { aiService } from "../services/aiService";
import type { AiProviderType, ProviderSpecificConfig } from "../types/database";
import { secondaryBtn } from "./ui/styles";
import { Modal } from "./ui/Modal";
import { errorText } from "../utils/errors";

interface AiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface AiSettingsFormProps {
  onSaved?: () => void;
  onCancel?: () => void;
  showCancel?: boolean;
}

export const AiSettingsForm: React.FC<AiSettingsFormProps> = ({
  onSaved,
  onCancel,
  showCancel = true,
}) => {
  const { t } = useTranslation("settings");
  const { config, saveConfig } = useAiStore();

  const providersList: Array<{ id: AiProviderType; name: string; tag: string }> = [
    { id: "gemini", name: "Google Gemini", tag: t("aiSettings.providers.geminiTag") },
    { id: "openrouter", name: "OpenRouter", tag: t("aiSettings.providers.openrouterTag") },
    { id: "openai", name: "OpenAI (ChatGPT)", tag: t("aiSettings.providers.openaiTag") },
    { id: "anthropic", name: "Anthropic Claude", tag: t("aiSettings.providers.anthropicTag") },
    { id: "ollama", name: "Ollama (Local)", tag: t("aiSettings.providers.ollamaTag") },
    { id: "custom", name: t("aiSettings.providers.customName"), tag: t("aiSettings.providers.customTag") },
    { id: "mock", name: "Mock Provider", tag: t("aiSettings.providers.mockTag") },
    { id: "none", name: t("aiSettings.providers.noneName"), tag: t("aiSettings.providers.noneTag") },
  ];

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

  const [localModels, setLocalModels] = useState<string[]>([]);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [detectStatus, setDetectStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const handleDetectLocalModels = async (endpointOverride?: string) => {
    setIsDetecting(true);
    setDetectStatus(null);
    const targetEndpoint = endpointOverride !== undefined ? endpointOverride : customEndpoint;
    try {
      const models = await aiService.listLocalAiModels(targetEndpoint.trim() || undefined);
      setLocalModels(models);
      if (models.length > 0) {
        setDetectStatus({
          success: true,
          message: t("aiSettings.detectFound", { count: models.length }),
        });
        if (!model || !models.includes(model)) {
          setModel(models[0]);
        }
      } else {
        setDetectStatus({
          success: false,
          message: t("aiSettings.detectEmpty"),
        });
      }
    } catch (err: unknown) {
      setDetectStatus({
        success: false,
        message: errorText(err, t("aiSettings.detectError")),
      });
    } finally {
      setIsDetecting(false);
    }
  };

  // Check stored key and detect local models on provider change
  useEffect(() => {
    const credId = `ai_api_key_${provider}`;
    aiService.hasAiApiKey(credId).then(setHasStoredKey).catch(() => setHasStoredKey(false));

    if (provider === "ollama" || provider === "custom") {
      handleDetectLocalModels();
    } else {
      setLocalModels([]);
      setDetectStatus(null);
    }
  }, [provider]);

  // Sync state on config prop changes
  useEffect(() => {
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
  }, [config]);

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
          title: t("aiSettings.vaultErrorTitle"),
          message: t("aiSettings.vaultErrorMessage"),
          details: errorText(err),
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

    setSaveFeedback(t("aiSettings.saveSuccess"));
    setTimeout(() => {
      setSaveFeedback(null);
      if (onSaved) {
        onSaved();
      }
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
        message: t("aiSettings.testSuccess", { provider: res.provider, model: res.model }),
        latencyMs: res.latency_ms,
      });
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: errorText(err, t("aiSettings.testError")),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const getProviderKeyPlaceholder = () => {
    if (hasStoredKey) {
      return t("aiSettings.keySavedPlaceholder", { provider: provider.toUpperCase() });
    }
    if (provider === "openrouter") {
      return t("aiSettings.keyOpenRouterPlaceholder");
    }
    if (provider === "openai") {
      return t("aiSettings.keyOpenAiPlaceholder");
    }
    if (provider === "gemini") {
      return t("aiSettings.keyGeminiPlaceholder");
    }
    if (provider === "anthropic") {
      return t("aiSettings.keyAnthropicPlaceholder");
    }
    if (provider === "custom") {
      return t("aiSettings.keyCustomPlaceholder");
    }
    return t("aiSettings.keyDefaultPlaceholder");
  };

  return (
    <div className="flex flex-col h-full text-fg">
      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {/* Privacy Mode Card */}
          <div
            className={`p-4 rounded-lg border transition-all ${
              privacyMode
                ? "border-line text-success"
                : "border-line text-warning"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                {privacyMode ? (
                  <ShieldCheck className="w-5 h-5 text-success shrink-0" />
                ) : (
                  <ShieldAlert className="w-5 h-5 text-warning shrink-0" />
                )}
                <div>
                  <div className="font-bold text-sm">
                    {privacyMode ? t("aiSettings.privacyOnTitle") : t("aiSettings.privacyOffTitle")}
                  </div>
                  <p className="text-[11px] text-fg mt-0.5">
                    {privacyMode
                      ? t("aiSettings.privacyOnDescription")
                      : t("aiSettings.privacyOffDescription")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLocalPrivacyMode(!privacyMode)}
                className={`px-3 py-1.5 rounded-md font-semibold text-xs border transition-colors ${
                  privacyMode
                    ? "text-success border-line hover:bg-hover"
                    : "text-warning border-line hover:bg-hover"
                }`}
              >
                {privacyMode ? t("aiSettings.privacyDisable") : t("aiSettings.privacyEnable")}
              </button>
            </div>
          </div>

          {/* AI Master Enable Switch */}
          <div className="flex items-center justify-between p-3.5 bg-raised border border-line rounded-lg">
            <div className="space-y-0.5">
              <div className="font-semibold text-fg">{t("aiSettings.enableAiTitle")}</div>
              <div className="text-[11px] text-fg-muted">
                {t("aiSettings.enableAiDescription")}
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-elevated peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-line after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
            </label>
          </div>

          {/* Provider Selection */}
          <div className="space-y-2">
            <label className="font-semibold text-fg flex items-center space-x-1.5">
              <Cpu className="w-3.5 h-3.5 text-fg-muted" />
              <span>{t("aiSettings.providerLabel")}</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {providersList.map((p) => {
                const isSelected = provider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderChange(p.id)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? "bg-raised border-line text-fg shadow-sm"
                        : "bg-raised border-line text-fg-muted hover:text-fg hover:bg-hover"
                    }`}
                  >
                    <div className="font-semibold text-xs text-fg">{p.name}</div>
                    <div className="text-[11px] text-fg-muted mt-0.5">{p.tag}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model Name & Endpoint */}
          {provider !== "none" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-fg">{t("aiSettings.modelLabel", { provider: provider.toUpperCase() })}</label>
                  {(provider === "ollama" || provider === "custom") && (
                    <button
                      type="button"
                      onClick={() => handleDetectLocalModels()}
                      disabled={isDetecting}
                      className="flex items-center space-x-1 text-[11px] text-accent-text hover:underline font-medium"
                      title={t("aiSettings.detectButtonTitle")}
                    >
                      <RefreshCw className={`w-3 h-3 ${isDetecting ? "animate-spin" : ""}`} />
                      <span>{isDetecting ? t("aiSettings.detecting") : t("aiSettings.detectModels")}</span>
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t("aiSettings.modelPlaceholder")}
                  className="w-full px-3 py-2 bg-canvas border border-line rounded-md text-fg font-mono text-xs focus:outline-none focus:border-line"
                />

                {/* Local Model Discovery Feedback */}
                {detectStatus && (
                  <div
                    className={`text-[11px] px-2 py-1 rounded border font-mono ${
                      detectStatus.success
                        ? "border-line text-success bg-surface"
                        : "border-line text-danger bg-surface"
                    }`}
                  >
                    {detectStatus.message}
                  </div>
                )}

                {/* Model Presets or Detected Local Models */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(localModels.length > 0 && (provider === "ollama" || provider === "custom")
                    ? localModels
                    : provider === "gemini"
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
                    ? ["qwen2.5-coder", "deepseek-coder:6.7b", "llama3.2", "codellama", "mistral"]
                    : provider === "custom"
                    ? ["qwen2.5-coder", "deepseek-coder", "llama3.3", "local-model"]
                    : []
                  ).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModel(m)}
                      className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${
                        model === m
                          ? "bg-raised text-fg border-line"
                          : "bg-elevated text-fg-muted border-line hover:text-fg hover:border-line-strong"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {provider === "ollama" || provider === "openai" || provider === "openrouter" || provider === "custom" ? (
                <div className="space-y-1.5">
                  <label className="font-semibold text-fg">{t("aiSettings.apiUrlLabel")}</label>
                  <input
                    type="text"
                    value={customEndpoint}
                    onChange={(e) => setCustomEndpoint(e.target.value)}
                    placeholder={
                      provider === "openrouter"
                        ? "https://openrouter.ai/api/v1/chat/completions"
                        : provider === "ollama"
                        ? "http://localhost:11434"
                        : provider === "custom"
                        ? "http://localhost:1234/v1/chat/completions"
                        : "https://api.openai.com/v1/chat/completions"
                    }
                    className="w-full px-3 py-2 bg-canvas border border-line rounded-md text-fg font-mono text-xs focus:outline-none focus:border-line"
                  />
                  <p className="text-[11px] text-fg-muted">
                    {provider === "openrouter"
                      ? t("aiSettings.endpointHelpOpenRouter")
                      : provider === "ollama"
                      ? t("aiSettings.endpointHelpOllama")
                      : provider === "custom"
                      ? t("aiSettings.endpointHelpCustom")
                      : t("aiSettings.endpointHelpOpenAi")}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="font-semibold text-fg">{t("aiSettings.temperatureLabel", { value: temperature })}</label>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full mt-2"
                  />
                </div>
              )}
            </div>
          )}

          {/* API Key Vault Input (for Gemini, OpenRouter, OpenAI, Anthropic, Custom) */}
          {(provider === "gemini" ||
            provider === "openrouter" ||
            provider === "openai" ||
            provider === "anthropic" ||
            provider === "custom") && (
            <div className="space-y-2 bg-raised border border-line rounded-lg p-4">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-fg flex items-center space-x-1.5">
                  <Key className="w-3.5 h-3.5 text-warning" />
                  <span>
                    {t("aiSettings.apiKeyFor", { provider: providersList.find((p) => p.id === provider)?.name || provider })}
                    {provider === "custom" && t("aiSettings.optionalSuffix")}
                  </span>
                </label>
                {hasStoredKey && (
                  <span className="text-[11px] font-mono text-success flex items-center space-x-1 px-2 py-0.5 rounded border border-line">
                    <Lock className="w-3 h-3" />
                    <span>{t("aiSettings.savedInVault", { provider })}</span>
                  </span>
                )}
              </div>

              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={getProviderKeyPlaceholder()}
                className="w-full px-3 py-2 bg-canvas border border-line rounded-md text-fg font-mono text-xs focus:outline-none focus:border-line"
              />
              <p className="text-[11px] text-fg-muted">
                {provider === "custom"
                  ? t("aiSettings.apiKeyHelpCustom")
                  : t("aiSettings.apiKeyHelpDefault")}
              </p>
            </div>
          )}

          {/* Test connection alert */}
          {testResult && (
            <div
              className={`p-3.5 rounded-lg border font-mono text-xs flex items-start space-x-2.5 ${
                testResult.success
                  ? "border-line text-success"
                  : "border-line text-danger"
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="font-bold">{testResult.message}</div>
                {testResult.latencyMs !== undefined && (
                  <div className="text-[11px] text-success/80 mt-0.5">
                    {t("aiSettings.responseLatency", { ms: testResult.latencyMs })}
                  </div>
                )}
              </div>
            </div>
          )}

          {saveFeedback && (
            <div className="p-3 rounded-lg border border-line text-success font-mono text-center">
              {saveFeedback}
            </div>
          )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 bg-raised border-t border-line flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={isTesting || provider === "none"}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-elevated hover:bg-hover text-fg border border-line-strong rounded-md font-medium text-xs transition-colors disabled:opacity-50"
        >
          {isTesting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-fg-muted" />
          ) : (
            <Zap className="w-3.5 h-3.5 text-fg-muted" />
          )}
          <span>{t("aiSettings.testConnection")}</span>
        </button>

        <div className="flex items-center space-x-2">
          {showCancel && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className={secondaryBtn}
            >
              {t("aiSettings.cancel")}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 bg-raised hover:bg-hover text-fg rounded-md font-semibold text-xs shadow-sm transition-all"
          >
            {t("aiSettings.saveConfig")}
          </button>
        </div>
      </div>
    </div>
  );
};

export const AiSettingsModal: React.FC<AiSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation("settings");
  if (!isOpen) return null;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={<><span>{t("aiSettings.modalTitle")}</span> <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-raised text-fg border border-line"> Pyro AI </span></>}
      subtitle={<>{t("aiSettings.modalSubtitle")}</>}
      icon={<Sparkles className="w-5 h-5" />}
      size="md"
      className="max-h-[90vh]"
      bodyClassName="flex flex-col overflow-hidden"
      closeOnBackdrop={false}
      closeOnEscape={false}
    >
      <div className="flex-1 overflow-y-auto">
          <AiSettingsForm onSaved={onClose} onCancel={onClose} showCancel={true} />
        </div>
    </Modal>
  );
};

