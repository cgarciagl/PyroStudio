import { describe, it, expect, beforeEach } from "vitest";
import { useAiStore } from "../aiStore";

describe("aiStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAiStore.setState({
      config: {
        enabled: true,
        provider: "gemini",
        model: "gemini-3.8-flash",
        credential_id: "ai_api_key_gemini",
        temperature: 0.2,
        max_tokens: 2048,
        privacy_mode: true,
      },
      isAiSettingsOpen: false,
      isSmartSearchOpen: false,
      isReportsModalOpen: false,
      isAuditLogOpen: false,
      auditLogs: [],
      metrics: {
        totalRequests: 0,
        totalTokens: 0,
        totalDurationMs: 0,
      },
    });
  });

  it("should have privacy mode enabled by default", () => {
    const state = useAiStore.getState();
    expect(state.config.privacy_mode).toBe(true);
  });

  it("should update config and persist to localStorage", () => {
    useAiStore.getState().saveConfig({
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      temperature: 0.5,
    });

    const state = useAiStore.getState();
    expect(state.config.provider).toBe("anthropic");
    expect(state.config.model).toBe("claude-3-5-sonnet");
    expect(state.config.temperature).toBe(0.5);

    const stored = JSON.parse(localStorage.getItem("pyro_ai_config_v2") || "{}");
    expect(stored.provider).toBe("anthropic");
  });

  it("should toggle privacy mode", () => {
    useAiStore.getState().setPrivacyMode(false);
    expect(useAiStore.getState().config.privacy_mode).toBe(false);

    useAiStore.getState().setPrivacyMode(true);
    expect(useAiStore.getState().config.privacy_mode).toBe(true);
  });

  it("should open and close modals", () => {
    useAiStore.getState().openAiSettings();
    expect(useAiStore.getState().isAiSettingsOpen).toBe(true);
    useAiStore.getState().closeAiSettings();
    expect(useAiStore.getState().isAiSettingsOpen).toBe(false);

    useAiStore.getState().openSmartSearch();
    expect(useAiStore.getState().isSmartSearchOpen).toBe(true);
    useAiStore.getState().closeSmartSearch();
    expect(useAiStore.getState().isSmartSearchOpen).toBe(false);

    useAiStore.getState().openReportsModal();
    expect(useAiStore.getState().isReportsModalOpen).toBe(true);
    useAiStore.getState().closeReportsModal();
    expect(useAiStore.getState().isReportsModalOpen).toBe(false);
  });

  it("should add and clear audit logs", () => {
    useAiStore.getState().addAuditLog({
      id: "audit_test_1",
      timestamp: "2026-10-07T12:00:00Z",
      question: "¿Por qué orders está lenta?",
      tools_invoked: ["explain_query", "get_table_indexes"],
      total_steps: 2,
      duration_ms: 320,
      proposed_actions: [],
      summary: "Diagnóstico completado con 2 recomendaciones",
    });

    expect(useAiStore.getState().auditLogs.length).toBe(1);
    expect(useAiStore.getState().auditLogs[0].question).toBe("¿Por qué orders está lenta?");

    useAiStore.getState().clearAuditLogs();
    expect(useAiStore.getState().auditLogs.length).toBe(0);
  });

  it("should record AI metrics correctly", () => {
    useAiStore.getState().recordMetric(150, 420);
    useAiStore.getState().recordMetric(250, 380);

    const metrics = useAiStore.getState().metrics;
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.totalTokens).toBe(400);
    expect(metrics.totalDurationMs).toBe(800);
  });

  it("should support openrouter provider with custom endpoint", () => {
    useAiStore.getState().saveConfig({
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      custom_endpoint: "https://openrouter.ai/api/v1/chat/completions",
      credential_id: "ai_api_key_openrouter",
    });

    const state = useAiStore.getState();
    expect(state.config.provider).toBe("openrouter");
    expect(state.config.model).toBe("anthropic/claude-3.5-sonnet");
    expect(state.config.custom_endpoint).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(state.config.credential_id).toBe("ai_api_key_openrouter");
  });
});
