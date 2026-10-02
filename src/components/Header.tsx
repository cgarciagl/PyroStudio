import {
  Flame,
  Database,
  Unplug,
  RefreshCw,
  Server,
  Zap,
  Terminal,
} from "lucide-react";
import type { ConnectionStatus } from "../types/database";

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  onOpenConnectModal: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onNewQuery?: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  connectionStatus,
  onOpenConnectModal,
  onDisconnect,
  onRefresh,
  onNewQuery,
  isRefreshing,
}) => {
  return (
    <header className="h-14 bg-[#0d0f14] border-b border-[#1f2433] px-4 flex items-center justify-between select-none">
      {/* Brand & Logo */}
      <div className="flex items-center space-x-3">
        <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500/20 via-orange-600/20 to-red-600/20 border border-orange-500/30 shadow-inner">
          <img
            src="/logo.png"
            alt="Pyro Studio Logo"
            className="w-7 h-7 object-contain drop-shadow-[0_0_8px_rgba(255,92,22,0.6)]"
            onError={(e) => {
              // Fallback to Lucide icon if logo asset is loading
              (e.currentTarget as HTMLElement).style.display = "none";
            }}
          />
          <Flame className="w-5 h-5 text-orange-500 absolute pointer-events-none opacity-0 only:opacity-100" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-sm tracking-wide text-white">
              PYRO <span className="text-orange-500">STUDIO</span>
            </span>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
              MariaDB
            </span>
          </div>
          <span className="text-[11px] text-neutral-400">
            Ultra-light & High-Performance Client
          </span>
        </div>
      </div>

      {/* Middle: Active Session details */}
      {connectionStatus.is_connected && connectionStatus.server_info && (
        <div className="hidden md:flex items-center space-x-3 bg-[#141721] px-3 py-1.5 rounded-lg border border-[#232838] text-xs">
          <div className="flex items-center space-x-1.5 text-neutral-300">
            <Server className="w-3.5 h-3.5 text-orange-400" />
            <span className="font-medium text-white">
              {connectionStatus.config?.savedConnectionName || "MariaDB"}
            </span>
            <span className="text-neutral-500 font-mono text-[11px]">
              ({connectionStatus.config?.host}:{connectionStatus.config?.port})
            </span>
          </div>
          <span className="text-neutral-600">|</span>
          <div className="flex items-center space-x-1.5 text-neutral-400">
            <span className="text-neutral-500">Versión:</span>
            <span className="text-neutral-200 font-mono text-[11px]">
              {connectionStatus.server_info.version.split("-")[0]}
            </span>
          </div>
          <span className="text-neutral-600">|</span>
          <div className="flex items-center space-x-1 text-emerald-400">
            <Zap className="w-3 h-3" />
            <span className="font-mono text-[11px]">
              {connectionStatus.server_info.ping_ms} ms
            </span>
          </div>
        </div>
      )}

      {/* Action Buttons & Status Indicator */}
      <div className="flex items-center space-x-2.5">
        {connectionStatus.is_connected ? (
          <>
            {onNewQuery && (
              <button
                onClick={onNewQuery}
                title="Abrir nueva pestaña de consulta SQL"
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-white bg-orange-600/90 hover:bg-orange-500 border border-orange-500/40 rounded-md transition-colors shadow-xs"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Nueva Consulta</span>
              </button>
            )}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refrescar esquemas y tablas"
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-neutral-300 bg-[#161a24] hover:bg-[#1f2535] border border-[#262c3e] rounded-md transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-orange-400 ${
                  isRefreshing ? "animate-spin" : ""
                }`}
              />
              <span className="hidden sm:inline">Refrescar</span>
            </button>
            <button
              onClick={onDisconnect}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-950/20 hover:bg-red-900/30 border border-red-900/40 rounded-md transition-colors"
            >
              <Unplug className="w-3.5 h-3.5" />
              <span>Desconectar</span>
            </button>
          </>
        ) : (
          <button
            onClick={onOpenConnectModal}
            className="flex items-center space-x-2 px-3.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 shadow-md shadow-orange-950/40 border border-orange-400/30 rounded-md transition-all active:scale-95"
          >
            <Database className="w-3.5 h-3.5" />
            <span>Conectar a MariaDB</span>
          </button>
        )}
      </div>
    </header>
  );
};
