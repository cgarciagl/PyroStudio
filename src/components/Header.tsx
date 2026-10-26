import React, { useState, useRef, useEffect } from "react";
import {
  Flame,
  Database,
  Unplug,
  RefreshCw,
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
import { usePreferenceStore } from "../stores/preferenceStore";
import {
  dangerGhostBtn,
  ghostBtn,
  iconBtn,
  menuIcon,
  menuItem,
  menuPanel,
  menuSeparator,
  primaryBtn,
} from "./ui/styles";

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

const ENV_HEADER_BADGES: Record<EnvironmentTag, { dot: string; label: string }> = {
  local: { dot: "bg-emerald-500", label: "Local" },
  development: { dot: "bg-sky-500", label: "Dev" },
  staging: { dot: "bg-amber-500", label: "Staging" },
  production: { dot: "bg-rose-500", label: "PROD" },
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
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  const isProd = connectionStatus.config?.environment === "production";
  const envTag = connectionStatus.config?.environment || "local";
  const envBadge = ENV_HEADER_BADGES[envTag];

  // Only risky environments get a persistent top stripe.
  const envTopBorder = connectionStatus.is_connected
    ? envTag === "production"
      ? "border-t-2 border-t-rose-600"
      : envTag === "staging"
      ? "border-t-2 border-t-amber-500"
      : ""
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

  type ToolItem = { icon: React.ElementType; label: string; hint: string; action?: () => void };
  const toolGroups: ToolItem[][] = [
    [
      { icon: LayoutDashboard, label: "Panel de control", hint: "Métricas, almacenamiento y QPS", action: onOpenDashboard },
      { icon: Activity, label: "Monitor de salud", hint: "Auditoría de rendimiento 0-100", action: onOpenHealth },
      { icon: Flame, label: "Consultas lentas y EXPLAIN", hint: "Árbol visual y cuellos de botella", action: onOpenSlowQuery },
      { icon: Sparkles, label: "Asesor de índices", hint: "Índices redundantes y FK sin índice", action: onOpenAdvisor },
      { icon: GitCompare, label: "Diferencias de esquema", hint: "Comparación y generador DDL", action: onOpenDiff },
      { icon: Wrench, label: "Operaciones y mantenimiento", hint: "ANALYZE, OPTIMIZE, CHECK, REPAIR", action: onOpenOperations },
    ],
    [{ icon: Archive, label: "Respaldar / restaurar", hint: "Volcado .sql y restauración", action: onOpenBackupRestore }],
    [
      { icon: Bot, label: "Agente de base de datos", hint: "Diagnóstico autónomo con IA", action: onOpenAgent },
      { icon: FileText, label: "Generador de informes", hint: "Diccionario y reporte de salud (IA)", action: onOpenReports },
    ],
  ]
    .map((g) => g.filter((t) => t.action))
    .filter((g) => g.length > 0);

  const themeToggle = (
    <button
      onClick={toggleTheme}
      title={theme === "light" ? "Cambiar a modo oscuro" : "Cambiar a modo claro"}
      className={iconBtn}
    >
      {theme === "light" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
  const settingsButton = (
    <button onClick={() => openSettingsModal()} title="Configuración (Ctrl+,)" className={iconBtn}>
      <Settings className="w-4 h-4" />
    </button>
  );

  return (
    <header
      className={`h-12 px-3 flex items-center justify-between gap-3 select-none border-b bg-surface border-line text-fg ${envTopBorder}`}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 min-w-0">
        {connectionStatus.is_connected && onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            title={isSidebarCollapsed ? "Mostrar explorador (Ctrl+B)" : "Ocultar explorador (Ctrl+B)"}
            className={`${iconBtn} ${isSidebarCollapsed ? "text-accent" : ""}`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        <img
          src="/logo.png"
          alt=""
          className="w-6 h-6 rounded object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLElement).style.display = "none";
          }}
        />
        <span className="font-semibold text-sm tracking-tight">
          Pyro <span className="text-accent">Studio</span>
        </span>
      </div>

      {/* Active session */}
      {connectionStatus.is_connected && connectionStatus.server_info && (
        <div
          className="hidden md:flex items-center gap-2 text-xs text-fg-muted min-w-0"
          title={`${connectionStatus.config?.host}:${connectionStatus.config?.port} — MariaDB ${connectionStatus.server_info.version} — ${connectionStatus.server_info.ping_ms} ms`}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            {isProd && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${envBadge.dot} opacity-60`} />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${envBadge.dot}`} />
          </span>
          <span className="font-medium text-fg truncate max-w-[180px]">
            {connectionStatus.config?.savedConnectionName || connectionStatus.config?.host || "MariaDB"}
          </span>
          <span className={isProd ? "text-danger font-semibold" : ""}>{envBadge.label}</span>
          <span className="font-mono text-[11px]">{connectionStatus.server_info.ping_ms} ms</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1">
        {connectionStatus.is_connected ? (
          <>
            {onNewQuery && (
              <button onClick={onNewQuery} title="Nueva pestaña de consulta (Ctrl+N)" className={`${primaryBtn} mr-1`}>
                <Terminal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Nueva consulta</span>
              </button>
            )}

            <div className="relative" ref={toolsMenuRef}>
              <button
                onClick={() => setIsToolsOpen((prev) => !prev)}
                title="Herramientas y diagnóstico"
                className={ghostBtn}
              >
                <Activity className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Herramientas</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
              {isToolsOpen && (
                <div className={`${menuPanel} w-64`}>
                  {toolGroups.map((group, gi) => (
                    <React.Fragment key={gi}>
                      {gi > 0 && <div className={menuSeparator} />}
                      {group.map((t) => (
                        <button
                          key={t.label}
                          onClick={() => {
                            setIsToolsOpen(false);
                            t.action?.();
                          }}
                          className={menuItem}
                        >
                          <t.icon className={menuIcon} />
                          <span className="flex flex-col">
                            <span>{t.label}</span>
                            <span className="text-[10px] text-fg-muted">{t.hint}</span>
                          </span>
                        </button>
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => onOpenSmartSearch?.() || openSmartSearch()}
              title="Búsqueda en el esquema (Ctrl+K)"
              className={iconBtn}
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refrescar esquemas (F5 / Ctrl+R)"
              className={iconBtn}
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            {themeToggle}
            {settingsButton}
            <div className="w-px h-4 bg-line mx-1" />
            <button onClick={onDisconnect} title="Cerrar conexión" className={dangerGhostBtn}>
              <Unplug className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            {themeToggle}
            {settingsButton}
            <button onClick={onOpenConnectModal} className={`${primaryBtn} ml-1`}>
              <Database className="w-3.5 h-3.5" />
              <span>Conectar</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
};
