import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Database,
  Unplug,
  RefreshCw,
  Terminal,
  Activity,
  ChevronDown,
  Search,
  Settings,
  PanelLeft,
  Sun,
  Moon,
  AlertCircle,
  Star,
  History,
} from "lucide-react";
import type { ConnectionStatus, EnvironmentTag } from "../types/database";
import { useAiStore } from "../stores/aiStore";
import { useCapabilitiesStore } from "../stores/capabilitiesStore";
import { fileName } from "./connectionTransport";
import { groupDbTools, type DbTool } from "./dbTools";
import { useUIStore } from "../stores/uiStore";
import { usePreferenceStore } from "../stores/preferenceStore";
import { useEnvVariablesStore } from "../stores/envVariablesStore";
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
  onOpenSmartSearch?: () => void;
  /** Database-scoped tools; shown only while connected with a database selected. */
  dbTools?: DbTool[];
  activeDatabase?: string | null;
  isRefreshing: boolean;
}

const ENV_DOTS: Record<EnvironmentTag, string> = {
  local: "bg-emerald-500",
  development: "bg-sky-500",
  staging: "bg-amber-500",
  production: "bg-rose-500",
};

export const Header: React.FC<HeaderProps> = ({
  connectionStatus,
  onOpenConnectModal,
  onDisconnect,
  onRefresh,
  onToggleSidebar,
  isSidebarCollapsed,
  onNewQuery,
  onOpenSmartSearch,
  dbTools = [],
  activeDatabase,
  isRefreshing,
}) => {
  const { t } = useTranslation("shell");
  const { openSmartSearch } = useAiStore();
  const capabilities = useCapabilitiesStore((state) => state.capabilities);
  const { openSettingsModal, openAboutModal } = useUIStore();
  const { theme, toggleTheme } = usePreferenceStore();
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  const isProd = connectionStatus.config?.environment === "production";
  const serverVersion =
    capabilities?.version.normalized_display ?? connectionStatus.server_info?.version ?? "";
  /** Where the session points: the database file, or host and port. */
  const sessionEndpoint = connectionStatus.config?.file_path
    ? fileName(connectionStatus.config.file_path)
    : `${connectionStatus.config?.host}:${connectionStatus.config?.port}`;
  const envTag = (connectionStatus.config?.environment || "local") as EnvironmentTag;
  const envBadge = { dot: ENV_DOTS[envTag], label: t(`header.env.${envTag}`) };

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

  const toolGroups =
    connectionStatus.is_connected && activeDatabase ? groupDbTools(dbTools) : [];

  const themeToggle = (
    <button
      onClick={toggleTheme}
      title={theme === "light" ? t("header.switchToDark") : t("header.switchToLight")}
      className={iconBtn}
    >
      {theme === "light" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
  const environments = useEnvVariablesStore((s) => s.environments);
  const activeEnv = useEnvVariablesStore((s) => s.active);
  const envNames = Object.keys(environments);
  const envSelector =
    envNames.length > 0 ? (
      <select
        value={activeEnv ?? ""}
        onChange={(e) => useEnvVariablesStore.getState().setActive(e.target.value || null)}
        title={t("header.envSelectorTitle")}
        aria-label={t("header.envSelectorAria")}
        className="h-7 px-2 text-xs rounded-md bg-transparent border border-transparent hover:border-line text-fg-muted hover:text-fg focus:outline-none focus:border-accent cursor-pointer"
      >
        <option value="">{t("header.noVariables")}</option>
        {envNames.map((name) => (
          <option key={name} value={name}>
            {`$ ${name}`}
          </option>
        ))}
      </select>
    ) : null;

  const settingsButton = (
    <button onClick={() => openSettingsModal()} title={t("header.settingsTitle")} className={iconBtn}>
      <Settings className="w-4 h-4" />
    </button>
  );

  return (
    <header
      className={`pyro-app-header h-12 px-3 flex items-center justify-between gap-3 select-none border-b bg-surface border-line text-fg ${envTopBorder}`}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 min-w-0">
        {connectionStatus.is_connected && onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            title={isSidebarCollapsed ? t("header.showSidebarTitle") : t("header.hideSidebarTitle")}
            className={`${iconBtn} ${isSidebarCollapsed ? "text-accent" : ""}`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={openAboutModal}
          title={t("header.aboutTitle")}
          className="flex items-center gap-2 rounded px-1 hover:bg-hover"
        >
          <img
            src="/logo.png"
            alt=""
            className="w-6 h-6 rounded object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = "none";
            }}
          />
          <span className="pyro-brand font-semibold text-sm">
            Pyro <span className="text-accent">Studio</span>
          </span>
        </button>
      </div>

      {/* Active session */}
      {connectionStatus.is_connected && connectionStatus.server_info && (
        <div
          className="hidden md:flex items-center gap-2 text-xs text-fg-muted min-w-0"
          title={`${sessionEndpoint} — ${serverVersion} — ${connectionStatus.server_info.ping_ms} ms`}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            {isProd && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${envBadge.dot} opacity-60`} />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${envBadge.dot}`} />
          </span>
          <span className="font-medium text-fg truncate max-w-[180px]">
            {connectionStatus.config?.savedConnectionName || sessionEndpoint}
          </span>
          <span className={isProd ? "text-danger font-semibold" : ""}>{envBadge.label}</span>
          <span className="font-mono text-[11px]">{connectionStatus.server_info.ping_ms} ms</span>
          {connectionStatus.server_info.warnings?.length ? (
            <span title={connectionStatus.server_info.warnings.join("\n")} className="flex">
              <AlertCircle className="w-3.5 h-3.5 text-warning" />
            </span>
          ) : null}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1">
        {connectionStatus.is_connected ? (
          <>
            {onNewQuery && (
              <button onClick={onNewQuery} title={t("header.newQueryTitle")} className={`${primaryBtn} mr-1`}>
                <Terminal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t("header.newQuery")}</span>
              </button>
            )}

            {toolGroups.length > 0 && (
            <div className="relative" ref={toolsMenuRef}>
              <button
                onClick={() => setIsToolsOpen((prev) => !prev)}
                title={t("header.toolsTitle")}
                className={ghostBtn}
              >
                <Activity className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">{t("header.tools")}</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
              {isToolsOpen && (
                <div className={`${menuPanel} w-64`}>
                  {toolGroups.map((group, gi) => (
                    <React.Fragment key={gi}>
                      {gi > 0 && <div className={menuSeparator} />}
                      {group.map((tool) => (
                        <button
                          key={tool.label}
                          onClick={() => {
                            setIsToolsOpen(false);
                            tool.run(activeDatabase!);
                          }}
                          className={menuItem}
                        >
                          <tool.icon className={menuIcon} />
                          <span className="flex flex-col">
                            <span>{tool.label}</span>
                            <span className="text-[11px] text-fg-muted">{tool.hint}</span>
                          </span>
                        </button>
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>

            )}

            <button
              onClick={() => useUIStore.getState().openFavoritesModal()}
              title={t("header.savedQueriesTitle")}
              className={iconBtn}
            >
              <Star className="w-4 h-4" />
            </button>
            <button
              onClick={() => useUIStore.getState().openHistoryModal()}
              title={t("header.historyTitle")}
              className={iconBtn}
            >
              <History className="w-4 h-4" />
            </button>
            <button
              onClick={() => onOpenSmartSearch?.() || openSmartSearch()}
              title={t("header.schemaSearchTitle")}
              className={iconBtn}
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t("header.refreshTitle")}
              className={iconBtn}
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            {envSelector}
            {themeToggle}
            {settingsButton}
            <div className="w-px h-4 bg-line mx-1" />
            <button onClick={onDisconnect} title={t("header.disconnectTitle")} className={dangerGhostBtn}>
              <Unplug className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            {themeToggle}
            {settingsButton}
            <button onClick={onOpenConnectModal} className={`${primaryBtn} ml-1`}>
              <Database className="w-3.5 h-3.5" />
              <span>{t("header.connect")}</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
};
