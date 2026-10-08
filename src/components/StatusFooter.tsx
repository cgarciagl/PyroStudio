import { Server, Zap, Database, ShieldCheck } from "lucide-react";
import type { ConnectionStatus } from "../types/database";

interface StatusFooterProps {
  connectionStatus: ConnectionStatus;
  activeDatabase?: string;
  activeTable?: string;
}

export const StatusFooter: React.FC<StatusFooterProps> = ({
  connectionStatus,
  activeDatabase,
  activeTable,
}) => {
  return (
    <footer className="h-7 bg-[#090a0e] border-t border-[#1a1f2b] px-3 flex items-center justify-between text-[11px] text-neutral-400 select-none font-mono">
      {/* Left status & Host */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              connectionStatus.is_connected
                ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]"
                : "bg-neutral-600"
            }`}
          />
          <span className="font-sans text-[11px]">
            {connectionStatus.is_connected ? "Conectado" : "Desconectado"}
          </span>
        </div>

        {connectionStatus.is_connected && connectionStatus.config && (
          <>
            <span className="text-neutral-700">|</span>
            <div className="flex items-center space-x-1 text-neutral-300">
              <Server className="w-3 h-3 text-orange-400" />
              <span>
                {connectionStatus.config.user}@{connectionStatus.config.host}:
                {connectionStatus.config.port}
              </span>
            </div>
          </>
        )}

        {activeDatabase && (
          <>
            <span className="text-neutral-700">|</span>
            <div className="flex items-center space-x-1 text-neutral-300">
              <Database className="w-3 h-3 text-amber-500" />
              <span>
                {activeDatabase}
                {activeTable ? ` > ${activeTable}` : ""}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Right side telemetry */}
      <div className="flex items-center space-x-3">
        {connectionStatus.is_connected && connectionStatus.server_info && (
          <>
            <div className="flex items-center space-x-1 text-neutral-400">
              <ShieldCheck className="w-3 h-3 text-neutral-500" />
              <span>{connectionStatus.server_info.version}</span>
            </div>
            <span className="text-neutral-700">|</span>
            <div className="flex items-center space-x-1 text-emerald-400 font-semibold">
              <Zap className="w-3 h-3" />
              <span>{connectionStatus.server_info.ping_ms} ms</span>
            </div>
            <span className="text-neutral-700">|</span>
          </>
        )}
        <span className="text-neutral-500">UTF-8</span>
        <span className="text-neutral-700">|</span>
        <span className="text-orange-500/80 font-bold">Pyro Engine v0.5</span>
      </div>
    </footer>
  );
};
