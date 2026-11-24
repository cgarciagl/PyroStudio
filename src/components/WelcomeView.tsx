import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Edit2,
  Trash2,
  Loader2,
  AlertCircle,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderSync,
  Search,
  X,
  Database,
  FileCode2,
  Command,
  FlaskConical,
  LayoutGrid,
  List,
  ArrowLeftRight,
} from "lucide-react";
import {
  databaseCredentialId,
  type SavedConnection,
  type ConnectionConfig,
  type EnvironmentTag,
} from "../types/database";
import { connectionStorage } from "../services/connectionStorage";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { folderNames, groupByFolder } from "../utils/connectionFolders";
import { useUIStore } from "../stores/uiStore";
import { recentWorkStorage, type RecentWorkData } from "../services/recentWorkStorage";
import { usePreferenceStore } from "../stores/preferenceStore";
import { ConfirmModal } from "./ConfirmModal";
import {
  TransportBadge,
  TransportIcon,
  canToggleHttpTunnel,
  connectionAddress,
  withHttpTunnelToggled,
} from "./connectionTransport";
import { getMissingPasswordHint, MissingPasswordIcon, useMissingCredentials } from "./missingCredential";
import { dangerGhostBtn, ghostBtn, iconBtn, inputClass, primaryBtn, secondaryBtn, sectionLabel } from "./ui/styles";
import { uid } from "../utils/uid";
import { errorText } from "../utils/errors";

const VIEW_MODE_KEY = "pyro_home_connection_view_v1";
const COLLAPSED_FOLDERS_KEY = "pyro_collapsed_connection_folders_v1";
const ROW_SELECTOR = "[data-connection-row]";

const ENV_DOTS: Record<EnvironmentTag, string> = {
  local: "bg-success",
  development: "bg-info",
  staging: "bg-warning",
  production: "bg-danger",
};

/** "hace 5 min", "ayer", "5 min ago", "yesterday"… for the last time a connection was used. */
function formatLastUsed(timestamp: number | undefined, lang: string, nowLabel: string): string {
  if (!timestamp) return "";
  const relativeFormatter = new Intl.RelativeTimeFormat(lang, { numeric: "always", style: "short" });
  const dayFormatter = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
  const minutes = Math.round((timestamp - Date.now()) / 60000);
  if (minutes > -1) return nowLabel;
  if (minutes > -60) return relativeFormatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return relativeFormatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (days > -7) return dayFormatter.format(days, "day");
  if (days > -60) return relativeFormatter.format(Math.round(days / 7), "week");
  return relativeFormatter.format(Math.round(days / 30), "month");
}

const matchesQuery = (p: SavedConnection, terms: string[]): boolean => {
  const haystack = [p.name, p.host, p.user, p.database, p.folder, p.tunnel?.url, p.ssh_tunnel?.ssh_host, String(p.port)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((t) => haystack.includes(t));
};

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded border border-line text-[10px] font-mono text-fg-muted leading-none">
    {children}
  </kbd>
);

interface WelcomeViewProps {
  onOpenConnectModal: (profileToSelect?: SavedConnection) => void;
  isConnected: boolean;
  databasesCount: number;
  onQuickConnect?: (config: ConnectionConfig) => Promise<void>;
  profilesVersion?: number;
  onRestoreSession?: () => void;
  onNewQuery?: () => void;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({
  onOpenConnectModal,
  isConnected,
  databasesCount,
  onQuickConnect,
  profilesVersion,
  onNewQuery,
}) => {
  const { t, i18n } = useTranslation("shell");
  const envMeta = (env: string | undefined) => {
    const key = (env && env in ENV_DOTS ? env : "local") as EnvironmentTag;
    return { dot: ENV_DOTS[key], label: t(`welcome.env.${key}`) };
  };
  const [savedProfiles, setSavedProfiles] = useState<SavedConnection[]>(() => connectionStorage.getSavedConnections());
  const [connectingProfileId, setConnectingProfileId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastFailedProfile, setLastFailedProfile] = useState<SavedConnection | null>(null);
  const [profileToDelete, setProfileToDelete] = useState<{ id: string; name: string } | null>(null);
  const [prodProfileToConfirm, setProdProfileToConfirm] = useState<SavedConnection | null>(null);
  const [recentWork, setRecentWork] = useState<RecentWorkData>(recentWorkStorage.getRecentWork());
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "list">(() =>
    localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "cards",
  );
  const changeViewMode = (mode: "cards" | "list") => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* per-viewer convenience only */
    }
  };

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const refreshProfiles = () => {
    setSavedProfiles(connectionStorage.getSavedConnections());
    setRecentWork(recentWorkStorage.getRecentWork());
  };

  // Folder UI state (collapsed folders are a per-computer preference).
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");

  const toggleFolder = (key: string) =>
    setCollapsedFolders((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify(next));
      } catch {
        /* per-viewer convenience only */
      }
      return next;
    });

  const moveConnection = async (id: string, folder: string | null) => {
    try {
      setSavedProfiles(await connectionStorage.moveToFolder(id, folder));
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const commitFolderRename = async (from: string) => {
    const to = folderDraft.trim();
    setEditingFolder(null);
    if (!to || to === from) return;
    try {
      setSavedProfiles(await connectionStorage.renameFolder(from, to));
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const missingCredentials = useMissingCredentials(savedProfiles);

  const workspaceVersion = useWorkspaceStore((s) => s.version);
  const workspaceStatus = useWorkspaceStore((s) => s.status);
  const workspaceLoadState = useWorkspaceStore((s) => s.loadState);

  useEffect(() => {
    refreshProfiles();
  }, [isConnected, profilesVersion, workspaceVersion]);

  // A failed quick-connect error is stale once any connection succeeds
  // (e.g. after fixing the profile in the connection modal).
  useEffect(() => {
    if (isConnected) {
      setErrorMessage(null);
      setLastFailedProfile(null);
    }
  }, [isConnected]);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const isSearching = terms.length > 0;
  const hasFolders = folderNames(savedProfiles).length > 0;
  const groups = useMemo(
    () =>
      groupByFolder(isSearching ? savedProfiles.filter((p) => matchesQuery(p, terms)) : savedProfiles),
    [savedProfiles, terms, isSearching],
  );
  const matchCount = groups.reduce((n, g) => n + g.connections.length, 0);

  // Focus the search box on arrival without scrolling the page.
  useEffect(() => {
    if (!isConnected && savedProfiles.length > 0) searchRef.current?.focus({ preventScroll: true });
  }, [isConnected, savedProfiles.length > 0]);

  // "/" focuses the search box, like other launchers, unless the user is typing elsewhere.
  useEffect(() => {
    if (isConnected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isConnected]);

  const handleConnectClick = async (profile: SavedConnection) => {
    if (!onQuickConnect) {
      onOpenConnectModal(profile);
      return;
    }

    setConnectingProfileId(profile.id);
    setErrorMessage(null);
    setLastFailedProfile(null);

    const tCredId =
      profile.tunnel?.tunnel_credential_id ||
      profile.tunnelCredentialId ||
      `tunnel-cred-${profile.id}`;

    const config: ConnectionConfig = {
      engine: profile.engine,
      file_path: profile.filePath,
      host: profile.host,
      port: profile.port,
      user: profile.user,
      password: profile.password,
      credential_id: !profile.password ? databaseCredentialId(profile) : undefined,
      database: profile.database,
      environment: profile.environment || "local",
      read_only: profile.readOnly || undefined,
      tunnel: profile.tunnel
        ? {
            ...profile.tunnel,
            tunnel_credential_id: !profile.tunnel.http_password ? tCredId : undefined,
          }
        : undefined,
      savedConnectionId: profile.id,
      savedConnectionName: profile.name,
    };

    try {
      await onQuickConnect(config);
      if (savedProfiles.some((p) => p.id === profile.id)) connectionStorage.markConnected(profile.id);
    } catch (err: unknown) {
      const msg =
        errorText(err, t("welcome.connectErrorFallback"));
      const hint =
        !profile.password && missingCredentials.has(profile.id) ? ` — ${getMissingPasswordHint()}` : "";
      setErrorMessage(t("welcome.connectErrorMessage", { name: profile.name, message: msg, hint }));
      setLastFailedProfile(profile);
    } finally {
      setConnectingProfileId(null);
    }
  };

  const { confirmProductionActions } = usePreferenceStore();

  const handleInitiateConnect = (profile: SavedConnection) => {
    if (connectingProfileId) return;
    if (profile.environment === "production" && confirmProductionActions) {
      setProdProfileToConfirm(profile);
      return;
    }
    void handleConnectClick(profile);
  };

  const handleConfirmProdConnect = () => {
    if (!prodProfileToConfirm) return;
    const p = prodProfileToConfirm;
    setProdProfileToConfirm(null);
    void handleConnectClick(p);
  };

  const executeDeleteProfile = async () => {
    if (!profileToDelete) return;
    try {
      await connectionStorage.removeConnection(profileToDelete.id);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
    }
    setProfileToDelete(null);
    refreshProfiles();
  };

  /** Flip a saved connection between direct and HTTP tunnel, keeping the tunnel settings. */
  const toggleTunnel = async (profile: SavedConnection) => {
    if (!canToggleHttpTunnel(profile)) return;
    try {
      await connectionStorage.persistConnection(withHttpTunnelToggled(profile));
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
    }
    refreshProfiles();
  };

  // --- Keyboard navigation: search ↓ list rows ↑ search -------------------
  const rowButtons = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR) ?? []);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      rowButtons()[0]?.focus();
    } else if (e.key === "Enter" && isSearching) {
      e.preventDefault();
      const first = groups[0]?.connections[0];
      if (first) handleInitiateConnect(first);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
    }
  };

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, profile: SavedConnection) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const rows = rowButtons();
      const idx = rows.indexOf(e.currentTarget);
      let next: HTMLButtonElement | undefined;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        next = rows[idx + (e.key === "ArrowRight" ? 1 : -1)];
      } else {
        // Move to the nearest card in the previous/next visual row (works for list and grid).
        const down = e.key === "ArrowDown";
        const cur = e.currentTarget.getBoundingClientRect();
        let best = Infinity;
        for (const r of rows) {
          const box = r.getBoundingClientRect();
          const dy = down ? box.top - cur.top : cur.top - box.top;
          if (dy <= 1) continue;
          const score = dy * 10000 + Math.abs(box.left - cur.left);
          if (score < best) {
            best = score;
            next = r;
          }
        }
      }
      if (next) next.focus();
      else if (e.key === "ArrowUp") searchRef.current?.focus();
    } else if (e.key === "F2") {
      e.preventDefault();
      onOpenConnectModal(profile);
    } else if ((e.key === "t" || e.key === "T") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (canToggleHttpTunnel(profile)) {
        e.preventDefault();
        void toggleTunnel(profile);
      }
    } else if (e.key === "Delete") {
      e.preventDefault();
      setProfileToDelete({ id: profile.id, name: profile.name });
    }
  };

  // --- Pieces ---------------------------------------------------------------
  const workspaceUnavailable = workspaceStatus && workspaceStatus.availability !== "local" && workspaceStatus.availability !== "available";
  const workspaceAvailable = workspaceStatus?.availability === "available";
  const openWorkspaceSettings = () => useUIStore.getState().openSettingsModal("workspace");

  const lastConnection = recentWork.lastConnection;
  const resumeProfile = lastConnection ? savedProfiles.find((p) => p.id === lastConnection.profileId) : undefined;
  const resumeEnv = resumeProfile?.environment || lastConnection?.environment || "local";
  const productionCount = savedProfiles.filter((profile) => profile.environment === "production").length;
  const folderCount = folderNames(savedProfiles).length;
  const engineCount = new Set(savedProfiles.map((profile) => profile.engine)).size;
  const recentProfiles = [...savedProfiles].filter((profile) => profile.lastConnectedAt).sort((a, b) => (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0)).slice(0, 5);

  const resumeLastConnection = () => {
    if (!lastConnection) return;
    const profileToConnect: SavedConnection =
      resumeProfile ||
      ({
        id: lastConnection.profileId || `conn-${uid()}`,
        name: lastConnection.profileName,
        host: lastConnection.host || "127.0.0.1",
        port: lastConnection.port || 3306,
        user: lastConnection.user || "root",
        environment: resumeEnv,
        database: lastConnection.database,
        createdAt: Date.now(),
      } as SavedConnection);
    handleInitiateConnect(profileToConnect);
  };

  const renderRow = (profile: SavedConnection) => {
    const isConnecting = connectingProfileId === profile.id;
    const env = envMeta(profile.environment);
    const isProd = profile.environment === "production";
    const lastUsed = formatLastUsed(profile.lastConnectedAt, i18n.language, t("welcome.now"));

    return (
      <li
        key={profile.id}
        draggable={hasFolders}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-pyro-connection", profile.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        data-home-connection={viewMode === "cards" ? "card" : "row"}
        data-env={profile.environment || "local"}
        className={`group relative flex items-center gap-3 pl-3 pr-1.5 py-2 transition-colors focus-within:bg-hover hover:bg-hover ${
          isConnecting ? "bg-hover" : ""
        }`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${env.dot}`} title={env.label} aria-hidden />
        <button
          type="button"
          data-connection-row
          onClick={() => handleInitiateConnect(profile)}
          onKeyDown={(e) => handleRowKeyDown(e, profile)}
          aria-busy={isConnecting}
          aria-label={t("welcome.connectAria", { name: profile.name, env: env.label })}
          className="flex-1 min-w-0 text-left focus-visible:outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-1 focus-visible:after:ring-inset focus-visible:after:ring-accent"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-medium text-fg truncate">{profile.name}</span>
            {isProd && <span className="text-[11px] font-semibold text-danger shrink-0">PROD</span>}
            <TransportBadge connection={profile} />
            {missingCredentials.has(profile.id) && <MissingPasswordIcon />}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 min-w-0 text-[11px] font-mono text-fg-muted">
            <TransportIcon connection={profile} className="w-3 h-3" />
            <span className="truncate" title={profile.tunnel?.enabled ? profile.tunnel.url : undefined}>
              {connectionAddress(profile)}
              {profile.database && <span className="text-fg-subtle"> · {profile.database}</span>}
            </span>
          </span>
        </button>

        <span data-row-time className="shrink-0 w-20 whitespace-nowrap text-right text-[11px] text-fg-subtle tabular-nums group-hover:invisible group-focus-within:invisible">
          {isConnecting ? (
            <span className="inline-flex items-center gap-1 text-fg-muted">
              <Loader2 className="w-3 h-3 animate-spin text-accent" />
              {t("welcome.connecting")}
            </span>
          ) : (
            lastUsed
          )}
        </span>
        <div
          data-row-actions
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 z-10 flex items-center ${
            isConnecting ? "hidden" : "invisible group-hover:visible group-focus-within:visible"
          }`}
        >
          {canToggleHttpTunnel(profile) && (
            <button
              type="button"
              tabIndex={-1}
              title={profile.tunnel?.enabled ? t("welcome.switchToDirect") : t("welcome.switchToHttp")}
              aria-label={
                profile.tunnel?.enabled
                  ? t("welcome.useDirectAria", { name: profile.name })
                  : t("welcome.useHttpAria", { name: profile.name })
              }
              onClick={() => void toggleTunnel(profile)}
              className={iconBtn}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            title={t("welcome.editConnectionTitle")}
            aria-label={t("welcome.editAria", { name: profile.name })}
            onClick={() => onOpenConnectModal(profile)}
            className={iconBtn}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            title={t("welcome.deleteConnectionTitle")}
            aria-label={t("welcome.deleteAria", { name: profile.name })}
            onClick={() => setProfileToDelete({ id: profile.id, name: profile.name })}
            className={dangerGhostBtn}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </li>
    );
  };

  const renderFolderHeader = (folder: string | null, key: string, count: number, isCollapsed: boolean) => (
    <div className="flex items-center gap-1.5 px-1 mb-2 text-[11px] text-fg-muted select-none">
      <button
        type="button"
        onClick={() => toggleFolder(key)}
        disabled={isSearching}
        aria-expanded={!isCollapsed}
        className="flex items-center gap-1.5 rounded hover:text-fg disabled:pointer-events-none"
        title={isCollapsed ? t("welcome.expandFolder") : t("welcome.collapseFolder")}
      >
        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {isCollapsed ? <Folder className="w-3.5 h-3.5" /> : <FolderOpen className="w-3.5 h-3.5" />}
      </button>
      {editingFolder === key && folder !== null ? (
        <input
          autoFocus
          value={folderDraft}
          onChange={(e) => setFolderDraft(e.target.value)}
          onBlur={() => void commitFolderRename(folder)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commitFolderRename(folder);
            if (e.key === "Escape") setEditingFolder(null);
          }}
          aria-label={t("welcome.folderNameAria")}
          className="px-1 py-0.5 text-[11px] bg-surface border border-accent rounded text-fg focus:outline-none"
        />
      ) : (
        <span
          className="font-medium text-fg truncate"
          onDoubleClick={() => {
            if (folder === null) return;
            setEditingFolder(key);
            setFolderDraft(folder);
          }}
          title={folder !== null ? t("welcome.doubleClickRename") : undefined}
        >
          {folder ?? t("welcome.noFolder")}
        </span>
      )}
      <span className="text-fg-subtle tabular-nums">{count}</span>
    </div>
  );

  // --- Layout ---------------------------------------------------------------
  return (
    <div className="pyro-view pyro-home flex-1 overflow-y-auto bg-canvas">
      <div className={`mx-auto w-full ${isConnected ? "max-w-[1440px]" : "max-w-[1480px]"} px-5 py-6 sm:px-10 sm:py-8 flex flex-col gap-5`}>
        {/* Brand + workspace */}
        {isConnected && (
        <header className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt=""
            className="w-9 h-9 rounded-lg object-cover shrink-0"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = "none";
            }}
          />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-fg leading-tight">Pyro Studio</h1>
            <p className="text-[11px] text-fg-subtle">MariaDB, MySQL y SQLite · v{__APP_VERSION__}</p>
          </div>
          {workspaceAvailable && (
            <button
              type="button"
              onClick={openWorkspaceSettings}
              className={`${ghostBtn} ml-auto max-w-[45%]`}
              title={t("welcome.manageWorkspaceTitle")}
            >
              <FolderSync className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{workspaceStatus?.name ?? t("welcome.workspaceFallback")}</span>
            </button>
          )}
        </header>
        )}

        {workspaceUnavailable && (
          <div role="status" className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-line bg-surface text-xs">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            <p className="flex-1 text-fg">
              {t("welcome.workspaceUnavailable", { name: workspaceStatus?.name ?? "" })}{" "}
              <span className="text-fg-muted">{t("welcome.workspaceUnavailableDetail")}</span>
            </p>
            <button type="button" onClick={openWorkspaceSettings} className={ghostBtn}>
              {t("welcome.recover")}
            </button>
          </div>
        )}

        {errorMessage && (
          <div role="alert" className="flex items-start gap-2.5 px-3 py-2 rounded-lg border border-line bg-surface text-xs">
            <AlertCircle className="w-4 h-4 mt-px text-danger shrink-0" />
            <p className="flex-1 min-w-0 font-mono text-[11px] leading-relaxed text-fg break-words select-text">
              {errorMessage}
            </p>
            {lastFailedProfile && (
              <button
                type="button"
                onClick={() => {
                  onOpenConnectModal(lastFailedProfile);
                  setErrorMessage(null);
                }}
                className={`${ghostBtn} shrink-0`}
              >
                {t("welcome.editConnection")}
              </button>
            )}
            <button type="button" onClick={() => setErrorMessage(null)} className={`${iconBtn} shrink-0`} aria-label={t("welcome.dismissAlertAria")}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {isConnected ? (
          <section className="rounded-lg border border-line bg-surface p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-success shrink-0" aria-hidden />
              <p className="text-xs text-fg">
                {t("welcome.connected")} <span className="text-fg-muted">{t("welcome.databasesCount", { count: databasesCount })}</span>
              </p>
            </div>
            <p className="text-xs text-fg-muted">
              {t("welcome.connectedSubtitle")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {onNewQuery && (
                <button type="button" onClick={onNewQuery} className={primaryBtn}>
                  <FileCode2 className="w-3.5 h-3.5" />
                  {t("welcome.newQuery")}
                </button>
              )}
              <button type="button" onClick={() => useUIStore.getState().toggleCommandPalette()} className={ghostBtn}>
                <Command className="w-3.5 h-3.5" />
                {t("welcome.commandPalette")}
                <span className="ml-1 flex gap-0.5">
                  <Kbd>Ctrl</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </button>
            </div>
          </section>
        ) : (
          <div className="pyro-home-shell">
            <header data-home-header className="pyro-home-header">
              <img src="/logo.png" alt="" onError={(e) => { (e.currentTarget as HTMLElement).style.display = "none"; }} />
              <div className="min-w-0">
                <h1>Pyro Studio</h1>
                <p>
                  MariaDB, MySQL y SQLite <span aria-hidden>·</span> v{__APP_VERSION__}
                </p>
              </div>
              <div className="pyro-home-header-actions">
                {workspaceAvailable && (
                  <button type="button" onClick={openWorkspaceSettings} className={`${ghostBtn} max-w-[220px]`} title={t("welcome.manageWorkspaceTitle")}>
                    <FolderSync className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{workspaceStatus?.name ?? t("welcome.workspaceFallback")}</span>
                  </button>
                )}
                <button type="button" data-home-panel="tools" onClick={() => useUIStore.getState().toggleCommandPalette()} className={ghostBtn} title={t("welcome.commandPaletteTitle")}>
                  <Command className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">{t("welcome.commands")}</span>
                  <span className="ml-1 hidden md:flex gap-0.5"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
                </button>
                <button type="button" onClick={() => useUIStore.getState().requestDemo()} className={ghostBtn} title={t("welcome.tryDemoTitle")}>
                  <FlaskConical className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">{t("welcome.tryDemo")}</span>
                </button>
                <button type="button" onClick={() => onOpenConnectModal()} className={lastConnection ? secondaryBtn : primaryBtn}>
                  <Plus className="w-3.5 h-3.5" />
                  {t("welcome.newConnection")}
                </button>
              </div>
            </header>

            <div className="pyro-home-body">
            <div className="pyro-home-main">
            {savedProfiles.length === 0 ? (
              workspaceLoadState !== "ready" && workspaceLoadState !== "error" ? (
                <div className="py-12 flex justify-center items-center">
                  <Loader2 className="w-5 h-5 text-accent animate-spin" />
                </div>
              ) : (
                <section className="rounded-lg border border-dashed border-line-strong px-6 py-10 flex flex-col items-center text-center gap-3">
                  <Database className="w-6 h-6 text-fg-subtle" />
                  <div className="space-y-1">
                    <h2 className="text-sm font-medium text-fg">{t("welcome.emptyTitle")}</h2>
                    <p className="text-xs text-fg-muted max-w-sm">
                      {t("welcome.emptyDescription")}
                    </p>
                  </div>
                  <button type="button" onClick={() => onOpenConnectModal()} className={`${primaryBtn} mt-1`}>
                    <Plus className="w-3.5 h-3.5" />
                    {t("welcome.newConnection")}
                  </button>
                  <button type="button" onClick={() => useUIStore.getState().requestDemo()} className={ghostBtn}>
                    <FlaskConical className="w-3.5 h-3.5" />
                    {t("welcome.orTryDemo")}
                  </button>
                </section>
              )
            ) : (
              <section aria-label={t("welcome.savedConnectionsAria")} className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle pointer-events-none" />
                    <input
                      ref={searchRef}
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      placeholder={t("welcome.searchPlaceholder", { count: savedProfiles.length })}
                      aria-label={t("welcome.searchAria")}
                      spellCheck={false}
                      className={`${inputClass} pl-8 pr-8 py-2 [&::-webkit-search-cancel-button]:hidden`}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 flex">
                      {query ? (
                        <button
                          type="button"
                          onClick={() => {
                            setQuery("");
                            searchRef.current?.focus();
                          }}
                          className="p-0.5 rounded text-fg-subtle hover:text-fg"
                          aria-label={t("welcome.clearSearchAria")}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <Kbd>/</Kbd>
                      )}
                    </span>
                  </div>
                  <div role="group" aria-label={t("welcome.viewModeAria")} className="flex shrink-0 rounded-md border border-line bg-surface p-0.5">
                    {([["cards", LayoutGrid, t("welcome.viewCards")], ["list", List, t("welcome.viewList")]] as const).map(([mode, Icon, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => changeViewMode(mode)}
                        aria-pressed={viewMode === mode}
                        title={t("welcome.viewModeTitle", { mode: label.toLowerCase() })}
                        className={`p-1.5 rounded ${viewMode === mode ? "bg-raised text-fg" : "text-fg-subtle hover:text-fg"}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </button>
                    ))}
                  </div>
                </div>

                <div ref={listRef} className="flex flex-col gap-4">
                  {matchCount === 0 ? (
                    <div className="rounded-lg border border-line bg-surface px-4 py-8 text-center">
                      <p className="text-xs text-fg">{t("welcome.noMatches", { query: query.trim() })}</p>
                      <p className="mt-1 text-[11px] text-fg-muted">{t("welcome.noMatchesHint")}</p>
                    </div>
                  ) : (
                    groups.map((group) => {
                      const key = group.folder ?? "";
                      const isCollapsed = !isSearching && collapsedFolders.includes(key);
                      return (
                        <div
                          key={key || "__none__"}
                          className={`rounded-lg transition-colors ${dropTarget === key ? "bg-accent-soft" : ""}`}
                          onDragOver={(e) => {
                            if (!e.dataTransfer.types.includes("application/x-pyro-connection")) return;
                            e.preventDefault();
                            setDropTarget(key);
                          }}
                          onDragLeave={(e) => {
                            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                            setDropTarget((t) => (t === key ? null : t));
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDropTarget(null);
                            const id = e.dataTransfer.getData("application/x-pyro-connection");
                            if (id) void moveConnection(id, group.folder);
                          }}
                        >
                          {hasFolders ? (
                            renderFolderHeader(group.folder, key, group.connections.length, isCollapsed)
                          ) : (
                            <div className={`${sectionLabel} px-1 mb-1.5`}>
                              {isSearching
                                ? t("welcome.searchCount", { matches: matchCount, total: savedProfiles.length })
                                : t("welcome.connectionsHeading")}
                            </div>
                          )}
                          {!isCollapsed && (
                            <ul
                              data-home-connections={viewMode}
                              className={viewMode === "list" ? "rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line" : undefined}
                            >
                              {group.connections.map(renderRow)}
                            </ul>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <p className="hidden sm:flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-fg-subtle">
                  <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> {t("welcome.kbdNavigate")}</span>
                  <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd> {t("welcome.kbdConnect")}</span>
                  <span className="inline-flex items-center gap-1"><Kbd>F2</Kbd> {t("welcome.kbdEdit")}</span>
                  <span className="inline-flex items-center gap-1"><Kbd>{t("welcome.kbdDelKey")}</Kbd> {t("welcome.kbdDelete")}</span>
                  {hasFolders && <span>{t("welcome.dragToFolderHint")}</span>}
                </p>
              </section>
            )}
            </div>

            <aside className="pyro-home-aside" aria-label={t("welcome.activityAria")}>
              {lastConnection && (
                <section data-home-panel="resume" aria-label={t("welcome.resumeTitle")} className="pyro-home-panel">
                  <div className="pyro-home-panel-heading">
                    <h2>{t("welcome.resumeTitle")}</h2>
                    <button
                      type="button"
                      onClick={() => {
                        recentWorkStorage.clearAll();
                        setRecentWork(recentWorkStorage.getRecentWork());
                      }}
                      className="text-[11px] text-fg-subtle hover:text-fg transition-colors"
                      title={t("welcome.forgetSessionTitle")}
                    >
                      {t("welcome.forget")}
                    </button>
                  </div>
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${envMeta(resumeEnv).dot}`} title={envMeta(resumeEnv).label} aria-hidden />
                      <span className="text-xs font-medium text-fg truncate">{resumeProfile?.name || lastConnection.profileName}</span>
                      {resumeEnv === "production" && <span className="text-[11px] font-semibold text-danger shrink-0">PROD</span>}
                    </div>
                    <div className="pl-4 text-[11px] text-fg-muted font-mono truncate">
                      {resumeProfile?.engine === "sqlite"
                        ? resumeProfile.filePath || lastConnection.database
                        : `${lastConnection.user}@${lastConnection.host}:${lastConnection.port}`}
                      {resumeProfile?.engine !== "sqlite" && lastConnection.database && <span className="text-fg-subtle"> · {lastConnection.database}</span>}
                    </div>
                    {recentWork.recentTables.length > 0 && (
                      <div className="pl-4 flex items-center gap-1.5 text-[11px] text-fg-subtle min-w-0">
                        <Database className="w-3 h-3 shrink-0" />
                        <span className="truncate">{recentWork.recentTables.slice(0, 3).map((tb) => tb.table).join(", ")}</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={resumeLastConnection}
                    disabled={!!connectingProfileId}
                    className={`${primaryBtn} mt-3 w-full justify-center`}
                  >
                    {connectingProfileId && connectingProfileId === lastConnection.profileId ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    {t("welcome.resume")}
                  </button>
                </section>
              )}

              {recentProfiles.length > 0 && (
                <section data-home-panel="recent" className="pyro-home-panel" aria-label={t("welcome.recentAria")}>
                  <div className="pyro-home-panel-heading"><h2>{t("welcome.recentTitle")}</h2></div>
                  <div className="pyro-home-recent-grid">
                    {recentProfiles.map((profile) => (
                      <button key={profile.id} type="button" className="pyro-home-recent-card" onClick={() => handleInitiateConnect(profile)} disabled={!!connectingProfileId}>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${envMeta(profile.environment).dot}`} title={envMeta(profile.environment).label} aria-hidden />
                        <span className="pyro-home-recent-copy"><strong>{profile.name}</strong><small>{connectionAddress(profile)}</small></span>
                        <span className="pyro-home-recent-time">{formatLastUsed(profile.lastConnectedAt, i18n.language, t("welcome.now"))}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {savedProfiles.length > 0 && (
                <section data-home-panel="summary" className="pyro-home-panel" aria-label={t("welcome.summaryTitle")}>
                  <div className="pyro-home-panel-heading"><h2>{t("welcome.summaryTitle")}</h2></div>
                  <dl className="pyro-home-stats">
                    <div><dt>{t("welcome.statConnections")}</dt><dd>{savedProfiles.length}</dd></div>
                    <div><dt>{t("welcome.statEngine", { count: engineCount })}</dt><dd>{engineCount}</dd></div>
                    <div><dt>{t("welcome.statFolders")}</dt><dd>{folderCount}</dd></div>
                    <div data-tone={productionCount > 0 ? "warning" : undefined}><dt>{t("welcome.statProduction")}</dt><dd>{productionCount}</dd></div>
                  </dl>
                </section>
              )}
            </aside>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={!!profileToDelete}
        title={t("welcome.deleteConfirmTitle")}
        message={t("welcome.deleteConfirmMessage", { name: profileToDelete?.name })}
        details={t("welcome.deleteConfirmDetails")}
        confirmText={t("welcome.deleteConfirmButton")}
        variant="danger"
        onConfirm={executeDeleteProfile}
        onClose={() => setProfileToDelete(null)}
      />

      <ConfirmModal
        isOpen={!!prodProfileToConfirm}
        title={t("welcome.prodConfirmTitle")}
        message={t("welcome.prodConfirmMessage", { name: prodProfileToConfirm?.name })}
        details={t("welcome.prodConfirmDetails")}
        confirmText={t("welcome.prodConfirmButton")}
        variant="danger"
        icon="alert"
        onConfirm={handleConfirmProdConnect}
        onClose={() => setProdProfileToConfirm(null)}
      />
    </div>
  );
};
