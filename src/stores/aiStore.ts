import { create } from "zustand";
import type {
  AiConfig,
  AgentAuditEntry,
  AiProviderType,
  ProviderSpecificConfig,
} from "../types/database";

interface AiMetrics {
  totalRequests: number;
  totalTokens: number;
  totalDurationMs: number;
}

interface AiState {
  config: AiConfig;
  isAiSettingsOpen: boolean;
  isSmartSearchOpen: boolean;
  isReportsModalOpen: boolean;
  isAuditLogOpen: boolean;
  auditLogs: AgentAuditEntry[];
  metrics: AiMetrics;

  // Actions
  saveConfig: (config: Partial<AiConfig>) => void;
  setPrivacyMode: (enabled: boolean) => void;
  openAiSettings: () => void;
  closeAiSettings: () => void;
  openSmartSearch: () => void;
  closeSmartSearch: () => void;
  openReportsModal: () => void;
  closeReportsModal: () => void;
  openAuditLog: () => void;
  closeAuditLog: () => void;
  addAuditLog: (entry: AgentAuditEntry) => void;
  clearAuditLogs: () => void;
  recordMetric: (tokens?: number, durationMs?: number) => void;
}

const AI_CONFIG_KEY = "pyro_ai_config_v2";
const AI_AUDIT_KEY = "pyro_ai_audit_v2";

export const DEFAULT_PROVIDER_CONFIGS: Record<AiProviderType, ProviderSpecificConfig> = {
  gemini: {
    model: "gemini-3.5-flash-lite",
    custom_endpoint: "",
    temperature: 0.2,
    max_tokens: 2048,
  },
  openai: {
    model: "gpt-4o-mini",
    custom_endpoint: "",
    temperature: 0.2,
    max_tokens: 2048,
  },
  openrouter: {
    model: "anthropic/claude-3.5-sonnet",
    custom_endpoint: "https://openrouter.ai/api/v1/chat/completions",
    temperature: 0.2,
    max_tokens: 2048,
  },
  anthropic: {
    model: "claude-3-5-sonnet-20241022",
    custom_endpoint: "",
    temperature: 0.2,
    max_tokens: 2048,
  },
  ollama: {
    model: "qwen2.5-coder",
    custom_endpoint: "http://localhost:11434/v1/chat/completions",
    temperature: 0.2,
    max_tokens: 2048,
  },
  mock: {
    model: "mock-ai-v1",
    custom_endpoint: "",
    temperature: 0.0,
    max_tokens: 2048,
  },
  none: {
    model: "",
    custom_endpoint: "",
    temperature: 0.2,
    max_tokens: 2048,
  },
};

const getInitialConfig = (): AiConfig => {
  const defaultConfig: AiConfig = {
    enabled: true,
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    credential_id: "ai_api_key_gemini",
    temperature: 0.2,
    max_tokens: 2048,
    custom_endpoint: undefined,
    privacy_mode: true, // Privacy mode default ON
    providers: DEFAULT_PROVIDER_CONFIGS,
  };

  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaultConfig,
        ...parsed,
        providers: {
          ...DEFAULT_PROVIDER_CONFIGS,
          ...(parsed.providers || {}),
        },
      };
    }
  } catch {
    // fallback
  }

  return defaultConfig;
};

const getInitialAuditLogs = (): AgentAuditEntry[] => {
  try {
    const raw = localStorage.getItem(AI_AUDIT_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // fallback
  }
  return [];
};

export const useAiStore = create<AiState>((set, get) => ({
  config: getInitialConfig(),
  isAiSettingsOpen: false,
  isSmartSearchOpen: false,
  isReportsModalOpen: false,
  isAuditLogOpen: false,
  auditLogs: getInitialAuditLogs(),
  metrics: {
    totalRequests: 0,
    totalTokens: 0,
    totalDurationMs: 0,
  },

  saveConfig: (partial) => {
    const next = { ...get().config, ...partial };
    try {
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    set({ config: next });
  },

  setPrivacyMode: (enabled) => {
    const next = { ...get().config, privacy_mode: enabled };
    try {
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    set({ config: next });
  },

  openAiSettings: () => set({ isAiSettingsOpen: true }),
  closeAiSettings: () => set({ isAiSettingsOpen: false }),

  openSmartSearch: () => set({ isSmartSearchOpen: true }),
  closeSmartSearch: () => set({ isSmartSearchOpen: false }),

  openReportsModal: () => set({ isReportsModalOpen: true }),
  closeReportsModal: () => set({ isReportsModalOpen: false }),

  openAuditLog: () => set({ isAuditLogOpen: true }),
  closeAuditLog: () => set({ isAuditLogOpen: false }),

  addAuditLog: (entry) => {
    const current = get().auditLogs;
    const next = [entry, ...current].slice(0, 100); // keep top 100
    try {
      localStorage.setItem(AI_AUDIT_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    set({ auditLogs: next });
  },

  clearAuditLogs: () => {
    try {
      localStorage.removeItem(AI_AUDIT_KEY);
    } catch {
      // ignore
    }
    set({ auditLogs: [] });
  },

  recordMetric: (tokens = 0, durationMs = 0) => {
    set((state) => ({
      metrics: {
        totalRequests: state.metrics.totalRequests + 1,
        totalTokens: state.metrics.totalTokens + tokens,
        totalDurationMs: state.metrics.totalDurationMs + durationMs,
      },
    }));
  },
}));
