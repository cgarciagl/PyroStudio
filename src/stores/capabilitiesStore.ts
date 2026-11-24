import { create } from "zustand";
import i18n from "../i18n";
import { dbService } from "../services/tauriDb";
import type { CapabilityAvailability, EngineFeature, ServerCapabilities } from "../types/database";

interface CapabilitiesState {
  capabilities: ServerCapabilities | null;
  isLoading: boolean;
  error: string | null;

  loadCapabilities: () => Promise<ServerCapabilities | null>;
  clearCapabilities: () => void;
  /**
   * Whether the connected engine offers an interface feature. Until the
   * capabilities load, everything is assumed available (MariaDB/MySQL).
   */
  supportsFeature: (feature: EngineFeature) => boolean;
  isAvailable: (featureId: string) => boolean;
  isSupported: (featureId: string) => boolean;
  getAvailability: (featureId: string) => CapabilityAvailability | null;
  getExplanation: (featureId: string) => string;
  getResolution: (featureId: string) => string | undefined;
}

export const useCapabilitiesStore = create<CapabilitiesState>((set, get) => ({
  capabilities: null,
  isLoading: false,
  error: null,

  loadCapabilities: async () => {
    set({ isLoading: true, error: null });
    try {
      const caps = await dbService.getServerCapabilities();
      set({ capabilities: caps, isLoading: false });
      return caps;
    } catch (err: any) {
      console.warn("Could not load server capabilities:", err);
      set({ error: err?.message || String(err), isLoading: false });
      return null;
    }
  },

  clearCapabilities: () => set({ capabilities: null, isLoading: false, error: null }),

  supportsFeature: (feature: EngineFeature): boolean => {
    const caps = get().capabilities;
    return !caps?.features || caps.features.includes(feature);
  },

  isAvailable: (featureId: string): boolean => {
    const caps = get().capabilities;
    if (!caps) return false;

    // Check direct properties first
    const direct = (caps as any)[featureId];
    if (direct && direct.status) {
      return direct.status.status === "Compatible";
    }

    // Check items list
    const found = caps.items?.find((i) => i.id === featureId);
    return found ? found.status.status === "Compatible" : false;
  },

  isSupported: (featureId: string): boolean => {
    return get().isAvailable(featureId);
  },

  getAvailability: (featureId: string): CapabilityAvailability | null => {
    const caps = get().capabilities;
    if (!caps) return null;

    const direct = (caps as any)[featureId];
    if (direct && direct.status) {
      return direct.status;
    }

    const found = caps.items?.find((i) => i.id === featureId);
    return found ? found.status : null;
  },

  getExplanation: (featureId: string): string => {
    const avail = get().getAvailability(featureId);
    if (!avail) return i18n.t("errors:capabilities.unverified");

    switch (avail.status) {
      case "Compatible":
        return i18n.t("errors:capabilities.compatible");
      case "UnsupportedVersion":
        return i18n.t("errors:capabilities.unsupportedVersion", {
          minVersion: avail.detail.min_version,
          currentVersion: avail.detail.current_version,
        });
      case "InsufficientPrivileges":
        return i18n.t("errors:capabilities.insufficientPrivileges", {
          privilege: avail.detail.required_privilege,
        });
      case "DisabledByConfig":
        return i18n.t("errors:capabilities.disabledByConfig", {
          variable: avail.detail.variable_name,
          currentValue: avail.detail.current_value,
          expectedValue: avail.detail.expected_value,
        });
      case "Unverified":
        return i18n.t("errors:capabilities.unverifiedReason", { reason: avail.detail.reason });
      case "UnsupportedEngine":
        return i18n.t("errors:capabilities.unsupportedEngine", { engine: avail.detail.engine });
      default:
        return i18n.t("errors:capabilities.unknownStatus");
    }
  },

  getResolution: (featureId: string): string | undefined => {
    const avail = get().getAvailability(featureId);
    if (!avail) return undefined;

    switch (avail.status) {
      case "UnsupportedVersion":
        return i18n.t("errors:capabilities.resUnsupportedVersion", {
          minVersion: avail.detail.min_version,
        });
      case "InsufficientPrivileges":
        return i18n.t("errors:capabilities.resInsufficientPrivileges", {
          privilege: avail.detail.required_privilege,
        });
      case "DisabledByConfig":
        return i18n.t("errors:capabilities.resDisabledByConfig", {
          variable: avail.detail.variable_name,
          expectedValue: avail.detail.expected_value,
        });
      default:
        return undefined;
    }
  },
}));

/**
 * Returns `gate(feature, action)`: the action when the connected engine
 * offers the feature, `undefined` otherwise. Optional callbacks set to
 * `undefined` hide their menu entry, so components need no engine checks.
 */
export function useFeatureGate() {
  const supportsFeature = useCapabilitiesStore((state) => state.supportsFeature);
  // Subscribing to the capabilities re-renders callers when they load.
  useCapabilitiesStore((state) => state.capabilities);
  return <T,>(feature: EngineFeature, action: T): T | undefined =>
    supportsFeature(feature) ? action : undefined;
}
