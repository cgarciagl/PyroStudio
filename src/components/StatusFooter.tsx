import React, { useState, useEffect, useCallback } from "react";
import {
  RotateCcw,
  WifiOff,
  Loader2,
  Lock,
} from "lucide-react";
import type { ConnectionConfig, ConnectionStatus, EnvironmentTag } from "../types/database";
import { useConnectionStore } from "../stores/connectionStore";
import { dbService } from "../services/tauriDb";

interface StatusFooterProps {
  connectionStatus: ConnectionStatus;
  activeDatabase?: string;
  activeTable?: string;
}

const ENV_LABELS: Record<EnvironmentTag, string> = {
  local: "Local",
  development: "Dev",
  staging: "Staging",
  production: "PROD",
};

export const StatusFooter: React.FC<StatusFooterProps> = ({
  connectionStatus,
  activeDatabase,
  activeTable,
}) => {
  const { connect } = useConnectionStore();
  const [pingMs, setPingMs] = useState<number | null>(
    connectionStatus.server_info?.ping_ms ?? null,
  );
  const [isPinging, setIsPinging] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [hasPingError, setHasPingError] = useState(false);

  const envTag = connectionStatus.config?.environment || "local";
  const envLabel = ENV_LABELS[envTag];
  const isProd = connectionStatus.config?.environment === "production";

  const cfg = connectionStatus.config as ConnectionConfig | undefined;
  const isSshTunnel = Boolean(cfg && "ssh_tunnel" in cfg && cfg.ssh_tunnel?.enabled);
  const isHttpTunnel = Boolean(
    (cfg && "tunnel" in cfg && cfg.tunnel?.enabled) ||
    (cfg && "tunnel_enabled" in cfg && (cfg as any).tunnel_enabled)
  );

  // Tunnel classification
  const tunnelType = isSshTunnel
    ? "Túnel SSH"
    : isHttpTunnel
    ? "Túnel HTTP"
    : "Direct";

  const handlePing = useCallback(async () => {
    if (!connectionStatus.is_connected) return;
    setIsPinging(true);
    try {
      const ms = await dbService.pingDatabase();
      setPingMs(ms);
      setHasPingError(false);
    } catch {
      setHasPingError(true);
    } finally {
      setIsPinging(false);
    }
  }, [connectionStatus.is_connected]);

  // Periodic ping telemetry every 25 seconds
  useEffect(() => {
    if (!connectionStatus.is_connected) {
      setPingMs(null);
      setHasPingError(false);
      return;
    }

    setPingMs(connectionStatus.server_info?.ping_ms ?? null);
    const interval = setInterval(() => {
      handlePing();
    }, 25000);

    return () => clearInterval(interval);
  }, [connectionStatus.is_connected, connectionStatus.server_info?.ping_ms, handlePing]);

  const handleReconnect = async () => {
    if (!connectionStatus.config) return;
    const activeCfg = connectionStatus.config as ConnectionConfig;
    const fullConfig: ConnectionConfig = {
      ...activeCfg,
      user: activeCfg.user || (connectionStatus.config as any).username || "root",
    };
    setIsReconnecting(true);
    try {
      await connect(fullConfig);
      setHasPingError(false);
    } catch (err) {
      console.error("Error al reconectar:", err);
    } finally {
      setIsReconnecting(false);
    }
  };

  const sep = <span className="text-line-strong">·</span>;
  const pingBad = hasPingError || (pingMs ?? 0) >= 200;

  return (
    <footer className="h-6 px-3 flex items-center justify-between gap-3 text-[11px] select-none border-t bg-canvas border-line text-fg-muted">
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            connectionStatus.is_connected && !hasPingError
              ? "bg-success"
              : hasPingError
              ? "bg-warning"
              : "bg-fg-subtle"
          }`}
        />
        {connectionStatus.is_connected && connectionStatus.config ? (
          <span
            className="truncate text-fg"
            title={`${connectionStatus.config.user}@${connectionStatus.config.host}:${connectionStatus.config.port} — ${tunnelType} — ${envLabel}`}
          >
            {connectionStatus.config.savedConnectionName || connectionStatus.config.host}
          </span>
        ) : (
          <span>Desconectado</span>
        )}
        {hasPingError && <span className="text-warning">Conexión inestable</span>}
        {connectionStatus.is_connected && tunnelType !== "Direct" && (
          <>
            {sep}
            <span className="shrink-0">{tunnelType}</span>
          </>
        )}
        {connectionStatus.is_connected && cfg?.read_only && (
          <>
            {sep}
            <span
              className="flex items-center gap-1 shrink-0"
              title="Conexión de solo lectura: el backend bloquea cualquier escritura"
            >
              <Lock className="w-3 h-3" />
              Solo lectura
            </span>
          </>
        )}
        {connectionStatus.is_connected && isProd && (
          <>
            {sep}
            <span className="text-danger font-semibold shrink-0">PROD</span>
          </>
        )}
        {(!connectionStatus.is_connected || hasPingError) && connectionStatus.config && (
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="flex items-center gap-1 text-accent hover:underline shrink-0"
            title="Reconectar con las credenciales activas"
          >
            {isReconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            Reconectar
          </button>
        )}
        {activeDatabase && (
          <>
            {sep}
            <span className="truncate font-mono">
              {activeDatabase}
              {activeTable ? ` / ${activeTable}` : ""}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 font-mono">
        {connectionStatus.is_connected && connectionStatus.server_info && (
          <>
            <span title="Versión del servidor">{connectionStatus.server_info.version}</span>
            {sep}
            <button
              onClick={handlePing}
              disabled={isPinging}
              className={`flex items-center gap-1 hover:text-fg ${pingBad ? "text-danger" : ""}`}
              title="Latencia. Clic para medir ahora."
            >
              {isPinging ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : hasPingError ? (
                <WifiOff className="w-3 h-3" />
              ) : null}
              {hasPingError ? "Timeout" : pingMs !== null ? `${pingMs} ms` : "—"}
            </button>
            {sep}
          </>
        )}
        <span title="Versión de PyroStudio">PyroStudio v{__APP_VERSION__}</span>
      </div>
    </footer>
  );
};
