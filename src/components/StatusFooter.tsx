import { Server, Zap, Database, ShieldCheck } from "lucide-react";
import type { ConnectionStatus, EnvironmentTag } from "../types/database";
import { useIsLightTheme } from "../stores/preferenceStore";

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
  const envTag = connectionStatus.config?.environment || "local";
  const envBadge = isLight ? ENV_FOOTER_BADGES_LIGHT[envTag] : ENV_FOOTER_BADGES_DARK[envTag];
  const isProd = connectionStatus.config?.environment === "production";

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
          title={connectionStatus.is_connected ? "Estado: Conectado" : "Estado: Desconectado"}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              connectionStatus.is_connected
                ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]"
                : isLight
                ? "bg-slate-400"
                : "bg-neutral-600"
            }`}
          />
          <span className={`font-sans text-[11px] ${isLight ? "text-slate-700 font-medium" : "text-neutral-300"}`}>
            {connectionStatus.is_connected ? "Conectado" : "Desconectado"}
          </span>
        </div>

        {connectionStatus.is_connected && connectionStatus.config && (
          <>
            <span className={isLight ? "text-slate-300" : "text-neutral-700"}>|</span>
            <div
              className={`flex items-center space-x-1.5 truncate ${isLight ? "text-slate-800" : "text-neutral-300"}`}
              title={`${connectionStatus.config.savedConnectionName || "MariaDB"} (${connectionStatus.config.user}@${connectionStatus.config.host}:${connectionStatus.config.port})`}
            >
              <Server className={`w-3 h-3 shrink-0 ${isLight ? "text-orange-600" : "text-orange-400"}`} />
              <span className={`font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                {connectionStatus.config.savedConnectionName || "MariaDB"}
              </span>
              <span className={`text-[10px] ${isLight ? "text-slate-500" : "text-neutral-500"}`}>
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
            <span className={isLight ? "text-slate-300" : "text-neutral-700"}>|</span>
            <div
              className={`flex items-center space-x-1 truncate ${isLight ? "text-slate-800" : "text-neutral-300"}`}
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
              className={`flex items-center space-x-1 ${isLight ? "text-slate-600" : "text-neutral-400"}`}
              title={`Versión del servidor: ${connectionStatus.server_info.version}`}
            >
              <ShieldCheck className={`w-3 h-3 ${isLight ? "text-slate-400" : "text-neutral-500"}`} />
              <span className={`font-mono text-[10px] ${isLight ? "text-slate-700" : "text-neutral-300"}`}>
                {connectionStatus.server_info.version}
              </span>
            </div>
            <span className={isLight ? "text-slate-300" : "text-neutral-700"}>|</span>
            <div
              className={`flex items-center space-x-1 font-semibold ${isLight ? "text-emerald-700" : "text-emerald-400"}`}
              title={`Latencia de conexión / Ping: ${connectionStatus.server_info.ping_ms} ms`}
            >
              <Zap className="w-3 h-3" />
              <span>{connectionStatus.server_info.ping_ms} ms</span>
            </div>
            <span className={isLight ? "text-slate-300" : "text-neutral-700"}>|</span>
          </>
        )}
        <span className={`text-[10px] ${isLight ? "text-slate-500" : "text-neutral-500"}`}>UTF-8</span>
        <span className={isLight ? "text-slate-300" : "text-neutral-700"}>|</span>
        <span className={`font-bold text-[10px] ${isLight ? "text-orange-600" : "text-orange-500/80"}`}>Pyro Engine v0.80</span>
      </div>
    </footer>
  );
};
