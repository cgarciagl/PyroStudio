import type { AiConfig } from "../types/database";

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
      title: "La IA está desactivada",
      message: "Actívela en los ajustes de IA para usar el agente.",
    };
  }
  if (config.privacy_mode && !LOCAL_PROVIDERS.has(config.provider)) {
    return {
      ready: false,
      reason: "privacy",
      title: "El modo privado solo permite modelos locales",
      message: "Configure Ollama o desactive el modo privado en los ajustes de IA para usar un proveedor en la nube.",
    };
  }
  return { ready: true };
}
