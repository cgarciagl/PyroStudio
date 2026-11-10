import { create } from "zustand";
import { dbService } from "../services/tauriDb";
import { usePreferenceStore } from "./preferenceStore";
import { useCapabilitiesStore } from "./capabilitiesStore";
import type { ConnectionConfig, ConnectionStatus, ServerInfo } from "../types/database";

interface ConnectionState {
  connectionStatus: ConnectionStatus;
  isConnecting: boolean;
  isRefreshing: boolean;
  isSwitchingTransport: boolean;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setIsConnecting: (isConnecting: boolean) => void;
  setIsRefreshing: (isRefreshing: boolean) => void;
  checkInitialStatus: () => Promise<ConnectionStatus>;
  testConnection: (config: ConnectionConfig) => Promise<ServerInfo>;
  connect: (config: ConnectionConfig) => Promise<ServerInfo>;
  disconnect: () => Promise<void>;
  /**
   * Reconnects the live session flipping the HTTP tunnel on/off (same server,
   * credentials and tunnel settings). The backend opens the new session before
   * closing the old one, so on failure the current connection keeps working.
   * Uncommitted manual transactions are rolled back by the backend.
   */
  switchHttpTunnel: () => Promise<ServerInfo>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connectionStatus: { is_connected: false },
  isConnecting: false,
  isRefreshing: false,
  isSwitchingTransport: false,

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setIsConnecting: (isConnecting) => set({ isConnecting }),
  setIsRefreshing: (isRefreshing) => set({ isRefreshing }),

  checkInitialStatus: async () => {
    try {
      const status = await dbService.getConnectionStatus();
      if (status.is_connected) {
        await useCapabilitiesStore.getState().loadCapabilities();
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
      // Capabilities decide which panels exist (e.g. SQLite has no routines),
      // so they load before the session is shown. Failures are not fatal.
      await useCapabilitiesStore.getState().loadCapabilities();
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

      return serverInfo;
    } finally {
      set({ isConnecting: false });
    }
  },

  switchHttpTunnel: async () => {
    const { connectionStatus } = get();
    const raw = connectionStatus.config;
    const cfg = raw && "tunnel" in raw ? raw : undefined;
    if (!connectionStatus.is_connected || !cfg?.tunnel?.url?.trim() || cfg.ssh_tunnel?.enabled) {
      throw new Error("Esta conexión no tiene un túnel HTTP configurado para alternar.");
    }
    const next: ConnectionConfig = { ...cfg, tunnel: { ...cfg.tunnel, enabled: !cfg.tunnel.enabled } };
    set({ isSwitchingTransport: true });
    try {
      const serverInfo = await dbService.connect(next);
      await useCapabilitiesStore.getState().loadCapabilities();
      set({ connectionStatus: { is_connected: true, config: next, server_info: serverInfo } });
      return serverInfo;
    } finally {
      set({ isSwitchingTransport: false });
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
