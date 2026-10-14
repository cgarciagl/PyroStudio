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
  Settings,
  PanelLeft,
  Sun,
  Moon,
} from "lucide-react";
import type { ConnectionStatus, EnvironmentTag } from "../types/database";
import { useAiStore } from "../stores/aiStore";
import { useUIStore } from "../stores/uiStore";
import { usePreferenceStore, useIsLightTheme } from "../stores/preferenceStore";

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  onOpenConnectModal: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
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
  onToggleSidebar,
  isSidebarCollapsed,
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
  const { openSmartSearch } = useAiStore();
  const { openSettingsModal } = useUIStore();
  const { theme, toggleTheme } = usePreferenceStore();
  const isLight = useIsLightTheme();
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  const isProd = connectionStatus.config?.environment === "production";
  const envTag = connectionStatus.config?.environment || "local";
  const envBadge = ENV_HEADER_BADGES[envTag];

  const envTopBorder = connectionStatus.is_connected
    ? envTag === "production"
      ? "border-t-2 border-t-rose-600 shadow-[0_4px_12px_rgba(225,29,72,0.15)]"
      : envTag === "staging"
      ? "border-t-2 border-t-amber-500"
      : envTag === "development"
      ? "border-t-2 border-t-sky-500"
      : "border-t-2 border-t-emerald-500"
    : "";

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
      className={`h-14 px-4 flex items-center justify-between select-none transition-all border-b ${
        isLight
          ? "bg-white border-slate-200 text-slate-800"
          : "bg-[#0d0f14] border-[#1f2433] text-neutral-200"
      } ${envTopBorder}`}
    >
      {/* Brand & Logo */}
      <div className="flex items-center space-x-3">
        {connectionStatus.is_connected && onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            title={isSidebarCollapsed ? "Mostrar Explorador (Ctrl+B)" : "Ocultar Explorador (Ctrl+B)"}
            className={`p-1.5 rounded-md border transition-colors ${
              isSidebarCollapsed
                ? "bg-orange-950/40 border-orange-500/50 text-orange-400 hover:bg-orange-900/50"
                : isLight
                ? "bg-slate-100 border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-200"
                : "bg-[#141824] border-[#232838] text-neutral-400 hover:text-white hover:bg-[#1e2436]"
            }`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        <div
          className={`relative flex items-center justify-center w-9 h-9 rounded-lg border shadow-inner overflow-hidden ${
            isLight
              ? "bg-orange-50 border-orange-200"
              : "bg-[#141824] border-orange-500/40"
          }`}
        >
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
            <span className={`font-bold text-sm tracking-wide ${isLight ? "text-slate-900" : "text-white"}`}>
              PYRO <span className="text-orange-500">STUDIO</span>
            </span>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 border border-orange-500/20">
              MariaDB
            </span>
          </div>
          <span className={`text-[11px] ${isLight ? "text-slate-500" : "text-neutral-400"}`}>
            Ultra-light & High-Performance Client
          </span>
        </div>
      </div>

      {/* Middle: Active Session details (Compact badge) */}
      {connectionStatus.is_connected && connectionStatus.server_info && (
        <div
          className={`hidden md:flex items-center space-x-2 px-2.5 py-1 rounded-lg border text-xs ${
            isLight
              ? "bg-slate-100 border-slate-200"
              : "bg-[#141721] border-[#232838]"
          }`}
          title={`Conectado a ${connectionStatus.config?.savedConnectionName || "MariaDB"} (${connectionStatus.config?.host}:${connectionStatus.config?.port}) — Versión: ${connectionStatus.server_info.version} — Latencia: ${connectionStatus.server_info.ping_ms} ms`}
        >
          <div className={`flex items-center space-x-1.5 ${isLight ? "text-slate-700" : "text-neutral-300"}`}>
            <Server className="w-3.5 h-3.5 text-orange-500 shrink-0" />
            <span className={`font-semibold max-w-[140px] truncate ${isLight ? "text-slate-900" : "text-white"}`}>
              {connectionStatus.config?.savedConnectionName || "MariaDB"}
            </span>
          </div>
          <span
            className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase font-mono shrink-0 flex items-center gap-1 ${envBadge.bg} ${envBadge.text} ${envBadge.border}`}
          >
            {isProd && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
            )}
            <span>{envBadge.label}</span>
          </span>
          <span className={isLight ? "text-slate-300" : "text-neutral-700"}>|</span>
          <div className="flex items-center space-x-1 text-emerald-600 shrink-0 font-mono text-[11px]">
            <Zap className="w-3 h-3" />
            <span>{connectionStatus.server_info.ping_ms} ms</span>
          </div>
        </div>
      )}

      {/* Action Buttons & Status Indicator */}
      <div className="flex items-center space-x-1.5 sm:space-x-2">
        {connectionStatus.is_connected ? (
          <>
            {/* Diagnostics & Administration Dropdown Menu */}
            <div className="relative" ref={toolsMenuRef}>
              <button
                onClick={() => setIsToolsOpen((prev) => !prev)}
                title="Herramientas y Diagnósticos (Dashboard, Monitor, EXPLAIN, Index Advisor, DDL Diff, Mantenimiento, Backups, IA)"
                className={`flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors border ${
                  isLight
                    ? "text-slate-700 bg-slate-100 hover:bg-slate-200 border-slate-300"
                    : "text-neutral-200 bg-[#161a24] hover:bg-[#202636] border-[#262e42]"
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-orange-500" />
                <span className="hidden xl:inline">Diagnóstico & Herramientas</span>
                <ChevronDown className={`w-3 h-3 ${isLight ? "text-slate-500" : "text-neutral-400"}`} />
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
              className={`p-2 rounded-md transition-colors border ${
                isLight
                  ? "text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border-slate-300"
                  : "text-neutral-300 bg-[#161a24] hover:bg-[#1f2535] border-[#262c3e]"
              }`}
            >
              <Search className="w-3.5 h-3.5 text-sky-500" />
            </button>

            {/* Nueva Consulta SQL (Primary Action) */}
            {onNewQuery && (
              <button
                onClick={onNewQuery}
                title="Abrir nueva pestaña de consulta SQL (Ctrl+N)"
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 border border-orange-500/40 rounded-md transition-colors shadow-xs"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Nueva Consulta</span>
              </button>
            )}

            {/* Refrescar Esquemas */}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refrescar esquemas y tablas (F5 / Ctrl+R)"
              className={`p-2 rounded-md transition-colors disabled:opacity-50 border ${
                isLight
                  ? "text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border-slate-300"
                  : "text-neutral-300 bg-[#161a24] hover:bg-[#1f2535] border-[#262c3e]"
              }`}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-orange-500 ${
                  isRefreshing ? "animate-spin" : ""
                }`}
              />
            </button>

            {/* Alternar Tema (Modo Claro / Modo Oscuro) */}
            <button
              onClick={toggleTheme}
              title={theme === "light" ? "Cambiar a Modo Oscuro" : "Cambiar a Modo Claro"}
              className={`p-2 rounded-md transition-colors border ${
                isLight
                  ? "text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border-slate-300"
                  : "text-neutral-400 hover:text-white bg-[#161a24] hover:bg-[#1f2535] border-[#262c3e]"
              }`}
            >
              {theme === "light" ? (
                <Sun className="w-3.5 h-3.5 text-amber-500" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-orange-400" />
              )}
            </button>

            {/* Configuración y Preferencias */}
            <button
              onClick={() => openSettingsModal()}
              title="Configuración y Preferencias (Ctrl+,)"
              className={`p-2 rounded-md transition-colors border ${
                isLight
                  ? "text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border-slate-300"
                  : "text-neutral-400 hover:text-white bg-[#161a24] hover:bg-[#1f2535] border-[#262c3e]"
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
            </button>

            {/* Desconectar */}
            <button
              onClick={onDisconnect}
              title="Cerrar conexión actual"
              className={`p-2 rounded-md transition-colors border ${
                isLight
                  ? "text-red-700 bg-red-50 hover:bg-red-100 border-red-200"
                  : "text-red-400 bg-red-950/20 hover:bg-red-900/30 border-red-900/40"
              }`}
            >
              <Unplug className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <div className="flex items-center space-x-2">
            {/* Alternar Tema cuando está desconectado */}
            <button
              onClick={toggleTheme}
              title={theme === "light" ? "Cambiar a Modo Oscuro" : "Cambiar a Modo Claro"}
              className={`p-2 rounded-md transition-colors border ${
                isLight
                  ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-slate-200"
                  : "text-neutral-400 hover:text-white hover:bg-[#1f2535] border-transparent hover:border-[#262c3e]"
              }`}
            >
              {theme === "light" ? (
                <Sun className="w-4 h-4 text-amber-500" />
              ) : (
                <Moon className="w-4 h-4 text-orange-400" />
              )}
            </button>
            <button
              onClick={() => openSettingsModal()}
              title="Configuración y Preferencias (Ctrl+,)"
              className="p-2 text-neutral-400 hover:text-white hover:bg-[#1f2535] rounded-md border border-transparent hover:border-[#262c3e] transition-colors"
            >
              <Settings className="w-4 h-4" />
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
