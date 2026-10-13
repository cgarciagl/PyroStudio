import { Server, Zap, Database, ShieldCheck } from "lucide-react";
import type { ConnectionStatus, EnvironmentTag } from "../types/database";

interface StatusFooterProps {
  connectionStatus: ConnectionStatus;
  activeDatabase?: string;
  activeTable?: string;
}

const ENV_FOOTER_BADGES: Record<
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

export const StatusFooter: React.FC<StatusFooterProps> = ({
  connectionStatus,
  activeDatabase,
  activeTable,
}) => {
  const envTag = connectionStatus.config?.environment || "local";
  const envBadge = ENV_FOOTER_BADGES[envTag];
  const isProd = connectionStatus.config?.environment === "production";

  return (
    <footer className="h-7 bg-[#090a0e] border-t border-[#1a1f2b] px-3 flex items-center justify-between text-[11px] text-neutral-400 select-none font-mono">
      {/* Left status & Host */}
      <div className="flex items-center space-x-2.5 overflow-hidden">
        <div
          className="flex items-center space-x-1.5 shrink-0"
          title={connectionStatus.is_connected ? "Estado: Conectado" : "Estado: Desconectado"}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              connectionStatus.is_connected
                ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]"
                : "bg-neutral-600"
            }`}
          />
          <span className="font-sans text-[11px] text-neutral-300">
            {connectionStatus.is_connected ? "Conectado" : "Desconectado"}
          </span>
        </div>

        {connectionStatus.is_connected && connectionStatus.config && (
          <>
            <span className="text-neutral-700">|</span>
            <div
              className="flex items-center space-x-1.5 text-neutral-300 truncate"
              title={`${connectionStatus.config.savedConnectionName || "MariaDB"} (${connectionStatus.config.user}@${connectionStatus.config.host}:${connectionStatus.config.port})`}
            >
              <Server className="w-3 h-3 text-orange-400 shrink-0" />
              <span className="font-semibold text-white">
                {connectionStatus.config.savedConnectionName || "MariaDB"}
              </span>
              <span className="text-neutral-500 text-[10px]">
                ({connectionStatus.config.user}@{connectionStatus.config.host}:{connectionStatus.config.port})
              </span>
            </div>
            <span
              className={`text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase font-mono shrink-0 ${envBadge.bg} ${envBadge.text} ${envBadge.border}`}
              title={`Entorno: ${envBadge.label}`}
            >
              {isProd && "⚠️ "}
              {envBadge.label}
            </span>
          </>
        )}

        {activeDatabase && (
          <>
            <span className="text-neutral-700">|</span>
            <div
              className="flex items-center space-x-1 text-neutral-300 truncate"
              title={`Base de datos activa: ${activeDatabase}${activeTable ? ` > ${activeTable}` : ""}`}
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
              className="flex items-center space-x-1 text-neutral-400"
              title={`Versión del servidor: ${connectionStatus.server_info.version}`}
            >
              <ShieldCheck className="w-3 h-3 text-neutral-500" />
              <span className="text-neutral-300 font-mono text-[10px]">
                {connectionStatus.server_info.version}
              </span>
            </div>
            <span className="text-neutral-700">|</span>
            <div
              className="flex items-center space-x-1 text-emerald-400 font-semibold"
              title={`Latencia de conexión / Ping: ${connectionStatus.server_info.ping_ms} ms`}
            >
              <Zap className="w-3 h-3" />
              <span>{connectionStatus.server_info.ping_ms} ms</span>
            </div>
            <span className="text-neutral-700">|</span>
          </>
        )}
        <span className="text-neutral-500 text-[10px]">UTF-8</span>
        <span className="text-neutral-700">|</span>
        <span className="text-orange-500/80 font-bold text-[10px]">Pyro Engine v0.80</span>
      </div>
    </footer>
  );
};
