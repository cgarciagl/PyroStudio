import { create } from "zustand";
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
    if (!avail) return "Capacidad no verificada.";

    switch (avail.status) {
      case "Compatible":
        return "Funcionalidad totalmente compatible y disponible en este servidor.";
      case "UnsupportedVersion":
        return `Requiere versión ${avail.detail.min_version} (servidor actual: ${avail.detail.current_version}).`;
      case "InsufficientPrivileges":
        return `Privilegios insuficientes: se requiere ${avail.detail.required_privilege}.`;
      case "DisabledByConfig":
        return `Deshabilitado por configuración del servidor (${avail.detail.variable_name} = '${avail.detail.current_value}', se esperaba '${avail.detail.expected_value}').`;
      case "Unverified":
        return `No verificado: ${avail.detail.reason}`;
      case "UnsupportedEngine":
        return `No disponible en ${avail.detail.engine}.`;
      default:
        return "Estado de compatibilidad desconocido.";
    }
  },

  getResolution: (featureId: string): string | undefined => {
    const avail = get().getAvailability(featureId);
    if (!avail) return undefined;

    switch (avail.status) {
      case "UnsupportedVersion":
        return `Actualiza el servidor MariaDB a la versión ${avail.detail.min_version} o superior.`;
      case "InsufficientPrivileges":
        return `Solicita al administrador ejecutar: GRANT ${avail.detail.required_privilege} ON *.* TO ...;`;
      case "DisabledByConfig":
        return `Habilita la variable en el servidor ejecutando: SET GLOBAL ${avail.detail.variable_name} = ${avail.detail.expected_value}; o editando my.cnf.`;
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
