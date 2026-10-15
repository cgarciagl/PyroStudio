import { create } from "zustand";
import { dbService } from "../services/tauriDb";
import { usePreferenceStore } from "./preferenceStore";
import { useCapabilitiesStore } from "./capabilitiesStore";
import type { ConnectionConfig, ConnectionStatus, ServerInfo } from "../types/database";

interface ConnectionState {
  connectionStatus: ConnectionStatus;
  isConnecting: boolean;
  isRefreshing: boolean;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setIsConnecting: (isConnecting: boolean) => void;
  setIsRefreshing: (isRefreshing: boolean) => void;
  checkInitialStatus: () => Promise<ConnectionStatus>;
  testConnection: (config: ConnectionConfig) => Promise<ServerInfo>;
  connect: (config: ConnectionConfig) => Promise<ServerInfo>;
  disconnect: () => Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connectionStatus: { is_connected: false },
  isConnecting: false,
  isRefreshing: false,

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setIsConnecting: (isConnecting) => set({ isConnecting }),
  setIsRefreshing: (isRefreshing) => set({ isRefreshing }),

  checkInitialStatus: async () => {
    try {
      const status = await dbService.getConnectionStatus();
      if (status.is_connected) {
        set({ connectionStatus: status });
      }
      return status;
    } catch (err) {
      console.warn("Could not retrieve initial connection status:", err);
      return { is_connected: false };
    }
  },

  testConnection: async (config) => {
    return await dbService.testConnection(config);
  },

  connect: async (config) => {
    set({ isConnecting: true });
    try {
      const serverInfo = await dbService.connect(config);
      set({
        connectionStatus: {
          is_connected: true,
          config,
          server_info: serverInfo,
        },
      });

      // Fase 3: Si una conexión está marcada como 'production', forzar Safe Mode
      if (config.environment === "production") {
        usePreferenceStore.getState().setSafeMode(true);
      }

      // Load server capabilities asynchronously
      useCapabilitiesStore.getState().loadCapabilities().catch(() => {});

      return serverInfo;
    } finally {
      set({ isConnecting: false });
    }
  },

  disconnect: async () => {
    try {
      await dbService.disconnect();
    } catch (err) {
      console.error("Error disconnecting from database:", err);
    } finally {
      useCapabilitiesStore.getState().clearCapabilities();
      set({
        connectionStatus: { is_connected: false },
      });
    }
  },
}));
