import React, { useState, useEffect, useCallback } from "react";
import {
  RotateCcw,
  WifiOff,
  Loader2,
} from "lucide-react";
import type { ConnectionConfig, ConnectionStatus, EnvironmentTag } from "../types/database";
import { useIsLightTheme } from "../stores/preferenceStore";
import { useConnectionStore } from "../stores/connectionStore";
import { dbService } from "../services/tauriDb";

interface StatusFooterProps {
  connectionStatus: ConnectionStatus;
  activeDatabase?: string;
  activeTable?: string;
}

const ENV_FOOTER_BADGES_DARK: Record<
  EnvironmentTag,
  { bg: string; text: string; border: string; label: string }
> = {
  local: {
    bg: "bg-emerald-500/15",
    text: "text-success",
    border: "border-emerald-500/40",
    label: "Local",
  },
  development: {
    bg: "bg-sky-500/15",
    text: "text-info",
    border: "border-sky-500/40",
    label: "Dev",
  },
  staging: {
    bg: "bg-amber-500/15",
    text: "text-warning",
    border: "border-amber-500/40",
    label: "Staging",
  },
  production: {
    bg: "bg-rose-600/20",
    text: "text-danger font-bold",
    border: "border-rose-500/60",
    label: "PROD",
  },
};

const ENV_FOOTER_BADGES_LIGHT: Record<
  EnvironmentTag,
  { bg: string; text: string; border: string; label: string }
> = {
  local: {
    bg: "bg-emerald-100",
    text: "text-emerald-800",
    border: "border-emerald-300",
    label: "Local",
  },
  development: {
    bg: "bg-sky-100",
    text: "text-sky-800",
    border: "border-sky-300",
    label: "Dev",
  },
  staging: {
    bg: "bg-amber-100",
    text: "text-amber-800",
    border: "border-amber-300",
    label: "Staging",
  },
  production: {
    bg: "bg-rose-100",
    text: "text-rose-800 font-bold",
    border: "border-rose-400 shadow-xs",
    label: "PROD",
  },
};

export const StatusFooter: React.FC<StatusFooterProps> = ({
  connectionStatus,
  activeDatabase,
  activeTable,
}) => {
  const isLight = useIsLightTheme();
  const { connect } = useConnectionStore();
  const [pingMs, setPingMs] = useState<number | null>(
    connectionStatus.server_info?.ping_ms ?? null,
  );
  const [isPinging, setIsPinging] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [hasPingError, setHasPingError] = useState(false);

  const envTag = connectionStatus.config?.environment || "local";
  const envBadge = isLight
    ? ENV_FOOTER_BADGES_LIGHT[envTag]
    : ENV_FOOTER_BADGES_DARK[envTag];
  const isProd = connectionStatus.config?.environment === "production";

  const cfg = connectionStatus.config as ConnectionConfig | undefined;
  const isSshTunnel = Boolean(cfg && "ssh_tunnel" in cfg && cfg.ssh_tunnel?.enabled);
  const isHttpTunnel = Boolean(
    (cfg && "tunnel" in cfg && cfg.tunnel?.enabled) ||
    (cfg && "tunnel_enabled" in cfg && (cfg as any).tunnel_enabled)
  );

  // Tunnel classification
  const tunnelType = isSshTunnel
    ? "SSH Tunnel"
    : isHttpTunnel
    ? "HTTP Tunnel"
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
              ? "bg-emerald-500"
              : hasPingError
              ? "bg-amber-500"
              : "bg-fg-subtle"
          }`}
        />
        {connectionStatus.is_connected && connectionStatus.config ? (
          <span
            className="truncate text-fg"
            title={`${connectionStatus.config.user}@${connectionStatus.config.host}:${connectionStatus.config.port} — ${tunnelType} — ${envBadge.label}`}
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

      {connectionStatus.is_connected && connectionStatus.server_info && (
        <div className="flex items-center gap-2 shrink-0 font-mono">
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
        </div>
      )}
    </footer>
  );
};
