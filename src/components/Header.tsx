import React, { useState, useRef, useEffect } from "react";
import {
  Flame,
  Database,
  Unplug,
  RefreshCw,
  Server,
  Zap,
  Terminal,
  LayoutDashboard,
  Activity,
  Sparkles,
  GitCompare,
  Wrench,
  ChevronDown,
  Archive,
  Bot,
  Search,
  FileText,
  ShieldCheck,
  Keyboard,
} from "lucide-react";
import type { ConnectionStatus, EnvironmentTag } from "../types/database";
import { useAiStore } from "../stores/aiStore";
import { useUIStore } from "../stores/uiStore";

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  onOpenConnectModal: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onNewQuery?: () => void;
  onOpenDashboard?: () => void;
  onOpenHealth?: () => void;
  onOpenSlowQuery?: () => void;
  onOpenAdvisor?: () => void;
  onOpenDiff?: () => void;
  onOpenOperations?: () => void;
  onOpenBackupRestore?: () => void;
  onOpenAgent?: () => void;
  onOpenSmartSearch?: () => void;
  onOpenReports?: () => void;
  isRefreshing: boolean;
}

const ENV_HEADER_BADGES: Record<
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

export const Header: React.FC<HeaderProps> = ({
  connectionStatus,
  onOpenConnectModal,
  onDisconnect,
  onRefresh,
  onNewQuery,
  onOpenDashboard,
  onOpenHealth,
  onOpenSlowQuery,
  onOpenAdvisor,
  onOpenDiff,
  onOpenOperations,
  onOpenBackupRestore,
  onOpenAgent,
  onOpenSmartSearch,
  onOpenReports,
  isRefreshing,
}) => {
  const { config, openAiSettings, openSmartSearch } = useAiStore();
  const { openShortcutsModal } = useUIStore();
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  const isProd = connectionStatus.config?.environment === "production";
  const envTag = connectionStatus.config?.environment || "local";
  const envBadge = ENV_HEADER_BADGES[envTag];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setIsToolsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header
      className={`h-14 bg-[#0d0f14] border-b border-[#1f2433] px-4 flex items-center justify-between select-none transition-all ${
        isProd
          ? "border-t-2 border-t-rose-600 shadow-[0_4px_12px_rgba(225,29,72,0.15)]"
          : ""
      }`}
    >
      {/* Brand & Logo */}
      <div className="flex items-center space-x-3">
        <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-[#141824] border border-orange-500/40 shadow-inner overflow-hidden">
          <img
            src="/logo.png"
            alt="Pyro Studio Logo"
            className="w-full h-full object-cover"
            onError={(e) => {
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
        <div className="hidden lg:flex items-center space-x-3 bg-[#141721] px-3 py-1.5 rounded-lg border border-[#232838] text-xs">
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
          <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase font-mono ${envBadge.bg} ${envBadge.text} ${envBadge.border}`}
          >
            {isProd && "⚠️ "}
            {envBadge.label}
          </span>
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
            {/* Diagnostics & Administration Dropdown Menu */}
            <div className="relative" ref={toolsMenuRef}>
              <button
                onClick={() => setIsToolsOpen((prev) => !prev)}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-200 bg-[#161a24] hover:bg-[#202636] border border-[#262e42] rounded-md transition-colors"
              >
                <Activity className="w-3.5 h-3.5 text-orange-400" />
                <span>Diagnóstico & Herramientas</span>
                <ChevronDown className="w-3 h-3 text-neutral-400" />
              </button>

              {isToolsOpen && (
                <div className="absolute right-0 mt-1.5 w-60 bg-[#11141c] border border-[#232a3c] rounded-lg shadow-2xl py-1 z-50 text-xs animate-in fade-in duration-100">
                  {onOpenDashboard && (
                    <button
                      onClick={() => {
                        setIsToolsOpen(false);
                        onOpenDashboard();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#191f2c] flex items-center space-x-2.5 text-neutral-200 hover:text-white transition-colors"
                    >
                      <LayoutDashboard className="w-4 h-4 text-emerald-400" />
                      <div>
                        <div className="font-medium">Dashboard de Base de Datos</div>
                        <div className="text-[10px] text-neutral-400">Métricas, almacenamiento y QPS</div>
                      </div>
                    </button>
                  )}

                  {onOpenHealth && (
                    <button
                      onClick={() => {
                        setIsToolsOpen(false);
                        onOpenHealth();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#191f2c] flex items-center space-x-2.5 text-neutral-200 hover:text-white transition-colors"
                    >
                      <Activity className="w-4 h-4 text-emerald-400" />
                      <div>
                        <div className="font-medium">Monitor de Salud</div>
                        <div className="text-[10px] text-neutral-400">Auditoría de rendimiento 0-100</div>
                      </div>
                    </button>
                  )}

                  {onOpenSlowQuery && (
                    <button
                      onClick={() => {
                        setIsToolsOpen(false);
                        onOpenSlowQuery();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#191f2c] flex items-center space-x-2.5 text-neutral-200 hover:text-white transition-colors"
                    >
                      <Flame className="w-4 h-4 text-orange-400" />
                      <div>
                        <div className="font-medium">Slow Query & EXPLAIN Visual</div>
                        <div className="text-[10px] text-neutral-400">Árbol visual y cuellos de botella</div>
                      </div>
                    </button>
                  )}

                  {onOpenAdvisor && (
                    <button
                      onClick={() => {
                        setIsToolsOpen(false);
                        onOpenAdvisor();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#191f2c] flex items-center space-x-2.5 text-neutral-200 hover:text-white transition-colors"
                    >
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <div>
                        <div className="font-medium">Index Advisor</div>
                        <div className="text-[10px] text-neutral-400">Índices redundantes y FKs faltantes</div>
                      </div>
                    </button>
                  )}

                  {onOpenDiff && (
                    <button
                      onClick={() => {
                        setIsToolsOpen(false);
                        onOpenDiff();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#191f2c] flex items-center space-x-2.5 text-neutral-200 hover:text-white transition-colors"
                    >
                      <GitCompare className="w-4 h-4 text-indigo-400" />
                      <div>
                        <div className="font-medium">Schema Diff & Migrations</div>
                        <div className="text-[10px] text-neutral-400">Comparación y generador DDL</div>
                      </div>
                    </button>
                  )}

                  {onOpenOperations && (
                    <button
                      onClick={() => {
                        setIsToolsOpen(false);
                        onOpenOperations();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#191f2c] flex items-center space-x-2.5 text-neutral-200 hover:text-white transition-colors"
                    >
                      <Wrench className="w-4 h-4 text-cyan-400" />
                      <div>
                        <div className="font-medium">Operaciones & Mantenimiento</div>
                        <div className="text-[10px] text-neutral-400">ANALYZE, OPTIMIZE, CHECK, REPAIR</div>
                      </div>
                    </button>
                  )}

                  {onOpenBackupRestore && (
                    <button
                      onClick={() => {
                        setIsToolsOpen(false);
                        onOpenBackupRestore();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#191f2c] flex items-center space-x-2.5 text-neutral-200 hover:text-white transition-colors border-t border-[#1c2333] pt-2 mt-1"
                    >
                      <Archive className="w-4 h-4 text-orange-400" />
                      <div>
                        <div className="font-medium">Respaldar / Restaurar Base de Datos</div>
                        <div className="text-[10px] text-neutral-400">Exportación .sql dump y restauración</div>
                      </div>
                    </button>
                  )}

                  {/* AI & Automation section */}
                  <div className="border-t border-[#1c2333] pt-1 mt-1">
                    {onOpenAgent && (
                      <button
                        onClick={() => {
                          setIsToolsOpen(false);
                          onOpenAgent();
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-[#191f2c] flex items-center space-x-2.5 text-purple-300 hover:text-purple-200 transition-colors"
                      >
                        <Bot className="w-4 h-4 text-purple-400" />
                        <div>
                          <div className="font-medium">Agente de Base de Datos (AI)</div>
                          <div className="text-[10px] text-neutral-400">Diagnóstico autónomo con tools</div>
                        </div>
                      </button>
                    )}

                    {onOpenReports && (
                      <button
                        onClick={() => {
                          setIsToolsOpen(false);
                          onOpenReports();
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-[#191f2c] flex items-center space-x-2.5 text-neutral-200 hover:text-white transition-colors"
                      >
                        <FileText className="w-4 h-4 text-sky-400" />
                        <div>
                          <div className="font-medium">Generador de Informes (AI)</div>
                          <div className="text-[10px] text-neutral-400">Diccionario y reporte de salud</div>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Smart Search Button */}
            <button
              onClick={() => onOpenSmartSearch?.() || openSmartSearch()}
              title="Búsqueda Inteligente en el Esquema (Ctrl+K)"
              className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-300 bg-[#161a24] hover:bg-[#1f2535] border border-[#262c3e] rounded-md transition-colors"
            >
              <Search className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden md:inline">Buscar (Ctrl+K)</span>
            </button>

            {/* AI Status Badge / Settings Trigger */}
            <button
              onClick={openAiSettings}
              title={`Ajustes de IA — Proveedor: ${config.provider} | Modo Privado: ${
                config.privacy_mode ? "Activado (Local/Sin fuga de datos)" : "Desactivado"
              }`}
              className={`flex items-center space-x-1.5 px-2.5 py-1 text-xs font-mono rounded-md border transition-colors ${
                !config.enabled
                  ? "bg-neutral-900/60 border-neutral-800 text-neutral-500 hover:bg-neutral-850"
                  : config.privacy_mode
                  ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-400 hover:bg-emerald-950/50"
                  : "bg-purple-950/30 border-purple-800/50 text-purple-300 hover:bg-purple-950/50"
              }`}
            >
              {config.privacy_mode ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Bot className="w-3.5 h-3.5 text-purple-400" />
              )}
              <span className="hidden lg:inline text-[11px]">
                {config.privacy_mode
                  ? "Privacidad: ON"
                  : `${config.provider.toUpperCase()}`}
              </span>
            </button>

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
              onClick={openShortcutsModal}
              title="Atajos de teclado y productividad (F1)"
              className="p-1.5 text-neutral-400 hover:text-white hover:bg-[#1f2535] rounded-md border border-transparent hover:border-[#262c3e] transition-colors"
            >
              <Keyboard className="w-4 h-4" />
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
          <div className="flex items-center space-x-2">
            <button
              onClick={openShortcutsModal}
              title="Atajos de teclado y productividad (F1)"
              className="p-1.5 text-neutral-400 hover:text-white hover:bg-[#1f2535] rounded-md border border-transparent hover:border-[#262c3e] transition-colors"
            >
              <Keyboard className="w-4 h-4" />
            </button>
            <button
              onClick={onOpenConnectModal}
              className="flex items-center space-x-2 px-3.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 shadow-md shadow-orange-950/40 border border-orange-400/30 rounded-md transition-all active:scale-95"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Conectar a MariaDB</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
