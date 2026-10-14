import React, { useState, useEffect, useCallback } from "react";
import {
  Server,
  Zap,
  Database,
  ShieldCheck,
  RotateCcw,
  Globe,
  Radio,
  Wifi,
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
    text: "text-emerald-400",
    border: "border-emerald-500/40",
    label: "Local",
  },
  development: {
    bg: "bg-sky-500/15",
    text: "text-sky-400",
    border: "border-sky-500/40",
    label: "Dev",
  },
  staging: {
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    border: "border-amber-500/40",
    label: "Staging",
  },
  production: {
    bg: "bg-rose-600/20",
    text: "text-rose-300 font-bold",
    border: "border-rose-500/60 shadow-[0_0_8px_rgba(244,63,94,0.3)]",
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

  return (
    <footer
      className={`h-7 px-3 flex items-center justify-between text-[11px] select-none font-mono transition-colors border-t ${
        isLight
          ? "bg-slate-100 border-slate-300 text-slate-600"
          : "bg-[#090a0e] border-[#1a1f2b] text-neutral-400"
      }`}
    >
      {/* Left status & Host */}
      <div className="flex items-center space-x-2.5 overflow-hidden">
        <div
          className="flex items-center space-x-1.5 shrink-0"
          title={
            connectionStatus.is_connected
              ? "Estado: Conectado"
              : "Estado: Desconectado"
          }
        >
          <span
            className={`w-2 h-2 rounded-full ${
              connectionStatus.is_connected && !hasPingError
                ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]"
                : hasPingError
                ? "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.8)] animate-pulse"
                : isLight
                ? "bg-slate-400"
                : "bg-neutral-600"
            }`}
          />
          <span
            className={`font-sans text-[11px] ${
              isLight ? "text-slate-700 font-medium" : "text-neutral-300"
            }`}
          >
            {connectionStatus.is_connected
              ? hasPingError
                ? "Conexión inestable"
                : "Conectado"
              : "Desconectado"}
          </span>
        </div>

        {connectionStatus.is_connected && connectionStatus.config && (
          <>
            <span className={isLight ? "text-slate-300" : "text-neutral-700"}>|</span>
            <div
              className={`flex items-center space-x-1.5 truncate ${
                isLight ? "text-slate-800" : "text-neutral-300"
              }`}
              title={`${connectionStatus.config.savedConnectionName || "MariaDB"} (${connectionStatus.config.user}@${connectionStatus.config.host}:${connectionStatus.config.port})`}
            >
              <Server
                className={`w-3 h-3 shrink-0 ${
                  isLight ? "text-orange-600" : "text-orange-400"
                }`}
              />
              <span
                className={`font-semibold ${
                  isLight ? "text-slate-900" : "text-white"
                }`}
              >
                {connectionStatus.config.savedConnectionName || "MariaDB"}
              </span>
              <span
                className={`text-[10px] ${
                  isLight ? "text-slate-500" : "text-neutral-500"
                }`}
              >
                ({connectionStatus.config.user}@{connectionStatus.config.host}:
                {connectionStatus.config.port})
              </span>
            </div>

            {/* Tunnel Type Indicator */}
            <span
              className={`text-[9px] font-semibold px-1.5 py-0.2 rounded border flex items-center space-x-1 shrink-0 ${
                tunnelType === "SSH Tunnel"
                  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                  : tunnelType === "HTTP Tunnel"
                  ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
                  : "bg-neutral-800/60 text-neutral-400 border-neutral-700/40"
              }`}
              title={`Tipo de transporte: ${tunnelType}`}
            >
              {tunnelType === "SSH Tunnel" ? (
                <Radio className="w-2.5 h-2.5 text-indigo-400" />
              ) : tunnelType === "HTTP Tunnel" ? (
                <Globe className="w-2.5 h-2.5 text-purple-400" />
              ) : (
                <Zap className="w-2.5 h-2.5 text-emerald-400" />
              )}
              <span>{tunnelType}</span>
            </span>

            {/* Environment Badge */}
            <span
              className={`text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase font-mono shrink-0 ${envBadge.bg} ${envBadge.text} ${envBadge.border}`}
              title={`Entorno: ${envBadge.label}`}
            >
              {isProd && "⚠️ "}
              {envBadge.label}
            </span>
          </>
        )}

        {/* 1-click Reconnect button if disconnected or unstable */}
        {(!connectionStatus.is_connected || hasPingError) && connectionStatus.config && (
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/50 text-orange-400 font-semibold text-[10px] transition-colors ml-1 cursor-pointer"
            title="Reconectar con las credenciales activas"
          >
            {isReconnecting ? (
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <RotateCcw className="w-2.5 h-2.5" />
            )}
            <span>Reconectar</span>
          </button>
        )}

        {activeDatabase && (
          <>
            <span className={isLight ? "text-slate-300" : "text-neutral-700"}>|</span>
            <div
              className={`flex items-center space-x-1 truncate ${
                isLight ? "text-slate-800" : "text-neutral-300"
              }`}
              title={`Base de datos activa: ${activeDatabase}${
                activeTable ? ` > ${activeTable}` : ""
              }`}
            >
              <Database className="w-3 h-3 text-amber-500 shrink-0" />
              <span className="truncate">
                {activeDatabase}
                {activeTable ? ` > ${activeTable}` : ""}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Right side telemetry */}
      <div className="flex items-center space-x-2.5 shrink-0">
        {connectionStatus.is_connected && connectionStatus.server_info && (
          <>
            <div
              className={`flex items-center space-x-1 ${
                isLight ? "text-slate-600" : "text-neutral-400"
              }`}
              title={`Versión del servidor: ${connectionStatus.server_info.version}`}
            >
              <ShieldCheck
                className={`w-3 h-3 ${
                  isLight ? "text-slate-400" : "text-neutral-500"
                }`}
              />
              <span
                className={`font-mono text-[10px] ${
                  isLight ? "text-slate-700" : "text-neutral-300"
                }`}
              >
                {connectionStatus.server_info.version}
              </span>
            </div>
            <span className={isLight ? "text-slate-300" : "text-neutral-700"}>|</span>

            {/* Live Ping telemetry indicator (click to ping) */}
            <button
              onClick={handlePing}
              disabled={isPinging}
              className={`flex items-center space-x-1 font-semibold transition-opacity hover:opacity-80 cursor-pointer ${
                hasPingError
                  ? "text-rose-400"
                  : (pingMs ?? 0) < 50
                  ? isLight
                    ? "text-emerald-700"
                    : "text-emerald-400"
                  : (pingMs ?? 0) < 200
                  ? "text-amber-400"
                  : "text-rose-400"
              }`}
              title="Latencia en milisegundos. Haz clic para medir el ping ahora."
            >
              {isPinging ? (
                <Loader2 className="w-3 h-3 animate-spin text-orange-400" />
              ) : hasPingError ? (
                <WifiOff className="w-3 h-3 text-rose-400" />
              ) : (
                <Wifi className="w-3 h-3" />
              )}
              <span>{hasPingError ? "Timeout" : pingMs !== null ? `${pingMs} ms` : "—"}</span>
            </button>
            <span className={isLight ? "text-slate-300" : "text-neutral-700"}>|</span>
          </>
        )}
        <span
          className={`text-[10px] ${
            isLight ? "text-slate-500" : "text-neutral-500"
          }`}
        >
          UTF-8
        </span>
        <span className={isLight ? "text-slate-300" : "text-neutral-700"}>|</span>
        <span
          className={`font-bold text-[10px] ${
            isLight ? "text-orange-600" : "text-orange-500/80"
          }`}
        >
          Pyro Engine v0.80
        </span>
      </div>
    </footer>
  );
};
