import React, { useState, useEffect } from "react";
import {
  Plus,
  ArrowRight,
  Edit2,
  Trash2,
  Loader2,
  AlertCircle,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { SavedConnection, ConnectionConfig } from "../types/database";
import { connectionStorage } from "../services/connectionStorage";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { folderNames, groupByFolder } from "../utils/connectionFolders";

const COLLAPSED_FOLDERS_KEY = "pyro_collapsed_connection_folders_v1";
import { useUIStore } from "../stores/uiStore";
import { recentWorkStorage, type RecentWorkData } from "../services/recentWorkStorage";
import { usePreferenceStore } from "../stores/preferenceStore";
import { ConfirmModal } from "./ConfirmModal";
import { TransportBadge, TransportIcon, connectionAddress } from "./connectionTransport";
import { MISSING_PASSWORD_HINT, MissingPasswordIcon, useMissingCredentials } from "./missingCredential";
import { dangerGhostBtn, ghostBtn, iconBtn, primaryBtn } from "./ui/styles";

const ENV_DOTS: Record<string, string> = {
  local: "bg-emerald-500",
  development: "bg-sky-500",
  staging: "bg-amber-500",
  production: "bg-rose-500",
};

interface WelcomeViewProps {
  onOpenConnectModal: (profileToSelect?: SavedConnection) => void;
  isConnected: boolean;
  databasesCount: number;
  onQuickConnect?: (config: ConnectionConfig) => Promise<void>;
  profilesVersion?: number;
  onRestoreSession?: () => void;
}


export const WelcomeView: React.FC<WelcomeViewProps> = ({
  onOpenConnectModal,
  isConnected,
  databasesCount,
  onQuickConnect,
  profilesVersion,
}) => {
  const [savedProfiles, setSavedProfiles] = useState<SavedConnection[]>([]);
  const [connectingProfileId, setConnectingProfileId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastFailedProfile, setLastFailedProfile] = useState<SavedConnection | null>(null);
  const [profileToDelete, setProfileToDelete] = useState<{ id: string; name: string } | null>(null);
  const [prodProfileToConfirm, setProdProfileToConfirm] = useState<SavedConnection | null>(null);
  const [recentWork, setRecentWork] = useState<RecentWorkData>(recentWorkStorage.getRecentWork());

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

  const handleConnectClick = async (profile: SavedConnection) => {
    if (!onQuickConnect) {
      onOpenConnectModal(profile);
      return;
    }

    setConnectingProfileId(profile.id);
    setErrorMessage(null);
    setLastFailedProfile(null);

    const credId = profile.credentialId || `cred-${profile.id}`;
    const tCredId =
      profile.tunnel?.tunnel_credential_id ||
      profile.tunnelCredentialId ||
      `tunnel-cred-${profile.id}`;

    const config: ConnectionConfig = {
      host: profile.host,
      port: profile.port,
      user: profile.user,
      password: profile.password,
      credential_id: !profile.password ? credId : undefined,
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
    } catch (err: unknown) {
      const msg =
        typeof err === "string" ? err : (err as Error)?.message || "Error al conectar con el servidor";
      const hint =
        !profile.password && missingCredentials.has(profile.id) ? ` — ${MISSING_PASSWORD_HINT}` : "";
      setErrorMessage(`Fallo al conectar con "${profile.name}": ${msg}${hint}`);
      setLastFailedProfile(profile);
    } finally {
      setConnectingProfileId(null);
    }
  };

  const { confirmProductionActions } = usePreferenceStore();

  const handleInitiateConnect = (profile: SavedConnection) => {
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

  const handleEditProfile = (profile: SavedConnection, e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenConnectModal(profile);
  };

  const handleDeleteProfile = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setProfileToDelete({ id, name });
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

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-canvas text-center select-none overflow-y-auto">
      {workspaceStatus && workspaceStatus.availability !== "local" && (
        <button
          type="button"
          onClick={() => useUIStore.getState().openSettingsModal("workspace")}
          className={`mb-4 px-3 py-1.5 rounded-md border text-xs font-medium ${
            workspaceStatus.availability === "available"
              ? "border-line text-fg-muted hover:text-fg"
              : "border-amber-500/40 bg-amber-500/10 text-warning"
          }`}
          title="Gestionar workspace"
        >
          {workspaceStatus.availability === "available"
            ? `Workspace: ${workspaceStatus.name ?? ""}`
            : `Workspace «${workspaceStatus.name ?? ""}» no disponible — las conexiones compartidas no se pueden mostrar. Haga clic para recuperarlo.`}
        </button>
      )}

      {/* Brand */}
      <img
        src="/logo.png"
        alt=""
        className="w-12 h-12 rounded-xl object-cover mb-3"
        onError={(e) => {
          (e.currentTarget as HTMLElement).style.display = "none";
        }}
      />
      <h1 className="text-xl font-semibold text-fg tracking-tight">
        Pyro <span className="text-accent">Studio</span>
      </h1>
      <p className="mt-1 text-xs text-fg-muted">Cliente ligero para MariaDB y MySQL</p>

      {errorMessage && (
        <div className="mt-4 max-w-lg w-full px-3 py-2 rounded-md border border-line bg-surface text-xs flex items-center gap-2 text-left">
          <AlertCircle className="w-4 h-4 text-danger shrink-0" />
          <div className="flex-1 font-mono text-[11px] leading-relaxed text-fg">{errorMessage}</div>
          {lastFailedProfile && (
            <button
              onClick={() => {
                onOpenConnectModal(lastFailedProfile);
                setErrorMessage(null);
              }}
              className={ghostBtn}
            >
              Editar conexión
            </button>
          )}
          <button onClick={() => setErrorMessage(null)} className={iconBtn} title="Cerrar">
            ×
          </button>
        </div>
      )}

      <div className="mt-6 flex flex-col items-center gap-5 max-w-xl w-full">
        {!isConnected ? (
          <>
            {recentWork.lastConnection && (() => {
              const matchedProfile = savedProfiles.find(
                (p) => p.id === recentWork.lastConnection?.profileId,
              );
              const effectiveEnv =
                matchedProfile?.environment ||
                recentWork.lastConnection.environment ||
                "local";
              const effectiveProfileName =
                matchedProfile?.name ||
                recentWork.lastConnection.profileName;

              return (
                <div className="w-full p-3 rounded-lg bg-surface border border-line text-left">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-fg-muted">Continuar donde lo dejó</span>
                    <button
                      onClick={() => {
                        recentWorkStorage.clearAll();
                        setRecentWork(recentWorkStorage.getRecentWork());
                      }}
                      className="text-[11px] text-fg-muted hover:text-fg"
                    >
                      Limpiar
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ENV_DOTS[effectiveEnv]}`} title={effectiveEnv} />
                        <span className="text-xs font-medium text-fg truncate">{effectiveProfileName}</span>
                      </div>
                      <div className="text-[11px] text-fg-muted font-mono truncate">
                        {recentWork.lastConnection.user}@{recentWork.lastConnection.host}:{recentWork.lastConnection.port}
                        {recentWork.lastConnection.database && ` · ${recentWork.lastConnection.database}`}
                        {recentWork.recentTables.length > 0 &&
                          ` · ${recentWork.recentTables.slice(0, 3).map((t) => t.table).join(", ")}`}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const profileToConnect: SavedConnection =
                          matchedProfile || ({
                            id: recentWork.lastConnection?.profileId || `conn-${Date.now()}`,
                            name: effectiveProfileName,
                            host: recentWork.lastConnection?.host || "127.0.0.1",
                            port: recentWork.lastConnection?.port || 3306,
                            user: recentWork.lastConnection?.user || "root",
                            environment: effectiveEnv,
                            database: recentWork.lastConnection?.database,
                            createdAt: Date.now(),
                          } as SavedConnection);
                        handleInitiateConnect(profileToConnect);
                      }}
                      className={`${primaryBtn} shrink-0`}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reanudar
                    </button>
                  </div>
                </div>
              );
            })()}

            {savedProfiles.length === 0 ? (
              <div className="w-full py-8 flex flex-col items-center text-center gap-3">
                <p className="text-xs text-fg-muted max-w-sm">
                  Aún no hay conexiones guardadas. Conecte con un servidor MariaDB o MySQL local o remoto.
                </p>
                <button onClick={() => onOpenConnectModal()} className={primaryBtn}>
                  <Plus className="w-3.5 h-3.5" />
                  Nueva conexión
                </button>
              </div>
            ) : (
              <div className="w-full">
                <div className="flex items-center justify-between text-[11px] text-fg-muted px-1 mb-2">
                  <span>Conexiones ({savedProfiles.length})</span>
                  <button onClick={() => onOpenConnectModal()} className={ghostBtn}>
                    <Plus className="w-3.5 h-3.5" />
                    Nueva
                  </button>
                </div>

                {groupByFolder(savedProfiles).map((group) => {
                  const key = group.folder ?? "";
                  const hasFolders = folderNames(savedProfiles).length > 0;
                  const isCollapsed = collapsedFolders.includes(key);
                  return (
                    <div
                      key={key || "__none__"}
                      className={`mb-2 rounded-lg transition-colors ${dropTarget === key ? "bg-hover" : ""}`}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes("application/x-pyro-connection")) return;
                        e.preventDefault();
                        setDropTarget(key);
                      }}
                      onDragLeave={() => setDropTarget((t) => (t === key ? null : t))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDropTarget(null);
                        const id = e.dataTransfer.getData("application/x-pyro-connection");
                        if (id) void moveConnection(id, group.folder);
                      }}
                    >
                      {hasFolders && (
                        <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] text-fg-muted select-none">
                          <button
                            onClick={() => toggleFolder(key)}
                            className="flex items-center gap-1.5 hover:text-fg min-w-0"
                            title={isCollapsed ? "Expandir" : "Contraer"}
                          >
                            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            {isCollapsed ? <Folder className="w-3.5 h-3.5" /> : <FolderOpen className="w-3.5 h-3.5" />}
                          </button>
                          {editingFolder === key && group.folder !== null ? (
                            <input
                              autoFocus
                              value={folderDraft}
                              onChange={(e) => setFolderDraft(e.target.value)}
                              onBlur={() => void commitFolderRename(group.folder!)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void commitFolderRename(group.folder!);
                                if (e.key === "Escape") setEditingFolder(null);
                              }}
                              className="px-1 py-0.5 text-[11px] bg-surface border border-accent rounded text-fg focus:outline-none"
                            />
                          ) : (
                            <span
                              className="font-medium text-fg truncate"
                              onDoubleClick={() => {
                                if (group.folder === null) return;
                                setEditingFolder(key);
                                setFolderDraft(group.folder);
                              }}
                              title={group.folder !== null ? "Doble clic para renombrar" : undefined}
                            >
                              {group.folder ?? "Sin carpeta"}
                            </span>
                          )}
                          <span>{group.connections.length}</span>
                        </div>
                      )}
                      {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                  {group.connections.map((profile) => {
                    const isTunnel = profile.tunnel && profile.tunnel.enabled;
                    const isConnecting = connectingProfileId === profile.id;
                    const env = profile.environment || "local";

                    return (
                      <div
                        key={profile.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-pyro-connection", profile.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        title="Arrastre a otra carpeta para moverla"
                        onClick={() => handleInitiateConnect(profile)}
                        className={`group relative px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                          isConnecting ? "border-accent bg-hover" : "bg-surface border-line hover:border-line-strong hover:bg-hover"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ENV_DOTS[env]}`} title={env} />
                            <span className="font-medium text-xs text-fg truncate">{profile.name}</span>
                            {env === "production" && <span className="text-[10px] text-danger font-semibold">PROD</span>}
                            <TransportBadge connection={profile} />
                            {missingCredentials.has(profile.id) && <MissingPasswordIcon />}
                          </div>
                          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              title="Editar conexión"
                              onClick={(e) => handleEditProfile(profile, e)}
                              className={iconBtn}
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              title="Eliminar conexión"
                              onClick={(e) => handleDeleteProfile(profile.id, profile.name, e)}
                              className={dangerGhostBtn}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] font-mono text-fg-muted">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <TransportIcon connection={profile} className="w-3 h-3" />
                            <span className="truncate" title={isTunnel ? profile.tunnel?.url : undefined}>
                              {connectionAddress(profile)}
                              {profile.database && ` · ${profile.database}`}
                            </span>
                          </span>
                          {isConnecting ? (
                            <Loader2 className="w-3 h-3 animate-spin text-accent shrink-0" />
                          ) : (
                            <ArrowRight className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 text-accent transition-opacity" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Conectado · {databasesCount} bases de datos en el explorador
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!profileToDelete}
        title="Eliminar Perfil de Conexión"
        message={`¿Estás seguro de eliminar el perfil de conexión "${profileToDelete?.name}"?`}
        details="Esta acción eliminará el perfil de la lista de conexiones guardadas."
        confirmText="Eliminar Perfil"
        variant="danger"
        onConfirm={executeDeleteProfile}
        onClose={() => setProfileToDelete(null)}
      />

      {/* Production Connection Confirmation Modal */}
      <ConfirmModal
        isOpen={!!prodProfileToConfirm}
        title="Conexión a Entorno de Producción"
        message={`¿Deseas conectar al servidor "${prodProfileToConfirm?.name}" (Producción)?`}
        details="⚠️ Estás a punto de conectar a una base de datos en PRODUCCIÓN. Todas las consultas, modificaciones y eliminaciones afectarán datos reales en vivo."
        confirmText="Conectar a Producción"
        variant="danger"
        icon="alert"
        onConfirm={handleConfirmProdConnect}
        onClose={() => setProdProfileToConfirm(null)}
      />
    </div>
  );
};
