import React, { useState, useEffect, useMemo, useRef } from "react";
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
import { TransportBadge, TransportIcon, connectionAddress } from "./connectionTransport";
import { MISSING_PASSWORD_HINT, MissingPasswordIcon, useMissingCredentials } from "./missingCredential";
import { dangerGhostBtn, ghostBtn, iconBtn, inputClass, primaryBtn, secondaryBtn, sectionLabel } from "./ui/styles";

const COLLAPSED_FOLDERS_KEY = "pyro_collapsed_connection_folders_v1";
const ROW_SELECTOR = "[data-connection-row]";

const ENVIRONMENTS: Record<EnvironmentTag, { dot: string; label: string }> = {
  local: { dot: "bg-success", label: "Local" },
  development: { dot: "bg-info", label: "Desarrollo" },
  staging: { dot: "bg-warning", label: "Staging" },
  production: { dot: "bg-danger", label: "Producción" },
};

const envMeta = (env: string | undefined) => ENVIRONMENTS[(env as EnvironmentTag) || "local"] ?? ENVIRONMENTS.local;

const relativeFormatter = new Intl.RelativeTimeFormat("es", { numeric: "always", style: "short" });
const dayFormatter = new Intl.RelativeTimeFormat("es", { numeric: "auto", style: "short" });

/** "hace 5 min", "ayer", "hace 3 sem."… for the last time a connection was used. */
function formatLastUsed(timestamp?: number): string {
  if (!timestamp) return "";
  const minutes = Math.round((timestamp - Date.now()) / 60000);
  if (minutes > -1) return "ahora";
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
  const [savedProfiles, setSavedProfiles] = useState<SavedConnection[]>([]);
  const [connectingProfileId, setConnectingProfileId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastFailedProfile, setLastFailedProfile] = useState<SavedConnection | null>(null);
  const [profileToDelete, setProfileToDelete] = useState<{ id: string; name: string } | null>(null);
  const [prodProfileToConfirm, setProdProfileToConfirm] = useState<SavedConnection | null>(null);
  const [recentWork, setRecentWork] = useState<RecentWorkData>(recentWorkStorage.getRecentWork());
  const [query, setQuery] = useState("");

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
        typeof err === "string" ? err : (err as Error)?.message || "Error al conectar con el servidor";
      const hint =
        !profile.password && missingCredentials.has(profile.id) ? ` — ${MISSING_PASSWORD_HINT}` : "";
      setErrorMessage(`No se pudo conectar con «${profile.name}»: ${msg}${hint}`);
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
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const rows = rowButtons();
      const idx = rows.indexOf(e.currentTarget);
      const next = rows[idx + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) next.focus();
      else if (e.key === "ArrowUp") searchRef.current?.focus();
    } else if (e.key === "F2") {
      e.preventDefault();
      onOpenConnectModal(profile);
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

  const resumeLastConnection = () => {
    if (!lastConnection) return;
    const profileToConnect: SavedConnection =
      resumeProfile ||
      ({
        id: lastConnection.profileId || `conn-${Date.now()}`,
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
    const lastUsed = formatLastUsed(profile.lastConnectedAt);

    return (
      <li
        key={profile.id}
        draggable={hasFolders}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-pyro-connection", profile.id);
          e.dataTransfer.effectAllowed = "move";
        }}
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
          aria-label={`Conectar con ${profile.name} (${env.label})`}
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

        <span className="shrink-0 w-20 whitespace-nowrap text-right text-[11px] text-fg-subtle tabular-nums group-hover:invisible group-focus-within:invisible">
          {isConnecting ? (
            <span className="inline-flex items-center gap-1 text-fg-muted">
              <Loader2 className="w-3 h-3 animate-spin text-accent" />
              Conectando
            </span>
          ) : (
            lastUsed
          )}
        </span>
        <div
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 z-10 flex items-center ${
            isConnecting ? "hidden" : "invisible group-hover:visible group-focus-within:visible"
          }`}
        >
          <button
            type="button"
            tabIndex={-1}
            title="Editar conexión (F2)"
            aria-label={`Editar ${profile.name}`}
            onClick={() => onOpenConnectModal(profile)}
            className={iconBtn}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="Eliminar conexión (Supr)"
            aria-label={`Eliminar ${profile.name}`}
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
    <div className="flex items-center gap-1.5 px-1 mb-1.5 text-[11px] text-fg-muted select-none">
      <button
        type="button"
        onClick={() => toggleFolder(key)}
        disabled={isSearching}
        aria-expanded={!isCollapsed}
        className="flex items-center gap-1.5 rounded hover:text-fg disabled:pointer-events-none"
        title={isCollapsed ? "Expandir carpeta" : "Contraer carpeta"}
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
          aria-label="Nombre de la carpeta"
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
          title={folder !== null ? "Doble clic para renombrar" : undefined}
        >
          {folder ?? "Sin carpeta"}
        </span>
      )}
      <span className="text-fg-subtle tabular-nums">{count}</span>
    </div>
  );

  // --- Layout ---------------------------------------------------------------
  return (
    <div className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-2xl px-6 py-10 sm:py-16 flex flex-col gap-6">
        {/* Brand + workspace */}
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
            <p className="text-[11px] text-fg-subtle">MariaDB y MySQL · v{__APP_VERSION__}</p>
          </div>
          {workspaceAvailable && (
            <button
              type="button"
              onClick={openWorkspaceSettings}
              className={`${ghostBtn} ml-auto max-w-[45%]`}
              title="Gestionar workspace"
            >
              <FolderSync className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{workspaceStatus?.name ?? "Workspace"}</span>
            </button>
          )}
        </header>

        {workspaceUnavailable && (
          <div role="status" className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-line bg-surface text-xs">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            <p className="flex-1 text-fg">
              El workspace «{workspaceStatus?.name ?? ""}» no está disponible.{" "}
              <span className="text-fg-muted">Las conexiones compartidas no se pueden mostrar.</span>
            </p>
            <button type="button" onClick={openWorkspaceSettings} className={ghostBtn}>
              Recuperar
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
                Editar conexión
              </button>
            )}
            <button type="button" onClick={() => setErrorMessage(null)} className={`${iconBtn} shrink-0`} aria-label="Cerrar aviso">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {isConnected ? (
          <section className="rounded-lg border border-line bg-surface p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-success shrink-0" aria-hidden />
              <p className="text-xs text-fg">
                Conectado <span className="text-fg-muted">· {databasesCount} {databasesCount === 1 ? "base de datos" : "bases de datos"} en el explorador</span>
              </p>
            </div>
            <p className="text-xs text-fg-muted">
              Abra una tabla desde el explorador lateral o empiece con una consulta.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {onNewQuery && (
                <button type="button" onClick={onNewQuery} className={primaryBtn}>
                  <FileCode2 className="w-3.5 h-3.5" />
                  Nueva consulta
                </button>
              )}
              <button type="button" onClick={() => useUIStore.getState().toggleCommandPalette()} className={ghostBtn}>
                <Command className="w-3.5 h-3.5" />
                Paleta de comandos
                <span className="ml-1 flex gap-0.5">
                  <Kbd>Ctrl</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </button>
            </div>
          </section>
        ) : (
          <>
            {lastConnection && (
              <section aria-label="Continuar donde lo dejó" className="rounded-lg border border-line bg-surface p-3">
                <div className="flex items-center justify-between mb-2">
                  <h2 className={sectionLabel}>Continuar donde lo dejó</h2>
                  <button
                    type="button"
                    onClick={() => {
                      recentWorkStorage.clearAll();
                      setRecentWork(recentWorkStorage.getRecentWork());
                    }}
                    className="text-[11px] text-fg-subtle hover:text-fg transition-colors"
                    title="Olvidar la última sesión"
                  >
                    Olvidar
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${envMeta(resumeEnv).dot}`}
                        title={envMeta(resumeEnv).label}
                        aria-hidden
                      />
                      <span className="text-xs font-medium text-fg truncate">{resumeProfile?.name || lastConnection.profileName}</span>
                      {resumeEnv === "production" && <span className="text-[11px] font-semibold text-danger shrink-0">PROD</span>}
                    </div>
                    <div className="pl-4 text-[11px] text-fg-muted font-mono truncate">
                      {lastConnection.user}@{lastConnection.host}:{lastConnection.port}
                      {lastConnection.database && <span className="text-fg-subtle"> · {lastConnection.database}</span>}
                    </div>
                    {recentWork.recentTables.length > 0 && (
                      <div className="pl-4 flex items-center gap-1.5 text-[11px] text-fg-subtle truncate">
                        <Database className="w-3 h-3 shrink-0" />
                        <span className="truncate">
                          {recentWork.recentTables.slice(0, 3).map((t) => t.table).join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={resumeLastConnection}
                    disabled={!!connectingProfileId}
                    className={`${primaryBtn} shrink-0`}
                  >
                    {connectingProfileId && connectingProfileId === lastConnection.profileId ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    Reanudar
                  </button>
                </div>
              </section>
            )}

            {savedProfiles.length === 0 ? (
              <section className="rounded-lg border border-dashed border-line-strong px-6 py-10 flex flex-col items-center text-center gap-3">
                <Database className="w-6 h-6 text-fg-subtle" />
                <div className="space-y-1">
                  <h2 className="text-sm font-medium text-fg">Aún no hay conexiones guardadas</h2>
                  <p className="text-xs text-fg-muted max-w-sm">
                    Registre un servidor MariaDB o MySQL, local o remoto. Puede conectar directamente, por túnel SSH o
                    por túnel HTTP.
                  </p>
                </div>
                <button type="button" onClick={() => onOpenConnectModal()} className={`${primaryBtn} mt-1`}>
                  <Plus className="w-3.5 h-3.5" />
                  Nueva conexión
                </button>
              </section>
            ) : (
              <section aria-label="Conexiones guardadas" className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle pointer-events-none" />
                    <input
                      ref={searchRef}
                      autoFocus
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      placeholder={`Buscar entre ${savedProfiles.length} ${savedProfiles.length === 1 ? "conexión" : "conexiones"}…`}
                      aria-label="Buscar conexión por nombre, host, usuario, base de datos o carpeta"
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
                          aria-label="Limpiar búsqueda"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <Kbd>/</Kbd>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenConnectModal()}
                    className={`${lastConnection ? secondaryBtn : primaryBtn} py-2 shrink-0`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Nueva conexión
                  </button>
                </div>

                <div ref={listRef} className="flex flex-col gap-4">
                  {matchCount === 0 ? (
                    <div className="rounded-lg border border-line bg-surface px-4 py-8 text-center">
                      <p className="text-xs text-fg">Ninguna conexión coincide con «{query.trim()}»</p>
                      <p className="mt-1 text-[11px] text-fg-muted">Se busca por nombre, host, usuario, base de datos y carpeta.</p>
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
                              {isSearching ? `${matchCount} de ${savedProfiles.length} conexiones` : "Conexiones"}
                            </div>
                          )}
                          {!isCollapsed && (
                            <ul className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line">
                              {group.connections.map(renderRow)}
                            </ul>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <p className="hidden sm:flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-fg-subtle">
                  <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar</span>
                  <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd> conectar</span>
                  <span className="inline-flex items-center gap-1"><Kbd>F2</Kbd> editar</span>
                  <span className="inline-flex items-center gap-1"><Kbd>Supr</Kbd> eliminar</span>
                  {hasFolders && <span>Arrastre una conexión para moverla de carpeta</span>}
                </p>
              </section>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={!!profileToDelete}
        title="Eliminar conexión"
        message={`¿Eliminar la conexión «${profileToDelete?.name}»?`}
        details="Se quitará de la lista de conexiones guardadas. Las bases de datos del servidor no se modifican."
        confirmText="Eliminar"
        variant="danger"
        onConfirm={executeDeleteProfile}
        onClose={() => setProfileToDelete(null)}
      />

      <ConfirmModal
        isOpen={!!prodProfileToConfirm}
        title="Conectar a producción"
        message={`¿Conectar con «${prodProfileToConfirm?.name}»?`}
        details="Es un servidor de PRODUCCIÓN: las consultas, modificaciones y eliminaciones afectarán a datos reales."
        confirmText="Conectar a producción"
        variant="danger"
        icon="alert"
        onConfirm={handleConfirmProdConnect}
        onClose={() => setProdProfileToConfirm(null)}
      />
    </div>
  );
};
