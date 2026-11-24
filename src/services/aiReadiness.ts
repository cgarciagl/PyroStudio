import type { AiConfig } from "../types/database";
import i18n from "../i18n";

export type AiReadiness =
  | { ready: true }
  | { ready: false; reason: "disabled" | "privacy"; title: string; message: string };

/** Providers that run on this machine: allowed while privacy mode is on. */
const LOCAL_PROVIDERS = new Set(["ollama", "mock"]);

/**
 * Whether the AI features can answer with the current settings, and why not. Shared so
 * every AI view explains the same thing before the user types, not after sending.
 */
export function aiReadiness(config: Pick<AiConfig, "enabled" | "privacy_mode" | "provider">): AiReadiness {
  if (!config.enabled) {
    return {
      ready: false,
      reason: "disabled",
      title: i18n.t("errors:aiReadiness.disabledTitle"),
      message: i18n.t("errors:aiReadiness.disabledMessage"),
    };
  }
  if (config.privacy_mode && !LOCAL_PROVIDERS.has(config.provider)) {
    return {
      ready: false,
      reason: "privacy",
      title: i18n.t("errors:aiReadiness.privacyTitle"),
      message: i18n.t("errors:aiReadiness.privacyMessage"),
    };
  }
  return { ready: true };
}
