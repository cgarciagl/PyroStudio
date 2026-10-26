import React, { useState, useEffect } from "react";
import {
  Database,
  Flame,
  Server,
  Plus,
  ArrowRight,
  Globe,
  Edit2,
  Trash2,
  Loader2,
  AlertCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { SavedConnection, ConnectionConfig, EnvironmentTag } from "../types/database";
import { connectionStorage } from "../services/connectionStorage";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useUIStore } from "../stores/uiStore";
import { recentWorkStorage, type RecentWorkData } from "../services/recentWorkStorage";
import { useIsLightTheme, usePreferenceStore } from "../stores/preferenceStore";
import { ConfirmModal } from "./ConfirmModal";

interface WelcomeViewProps {
  onOpenConnectModal: (profileToSelect?: SavedConnection) => void;
  isConnected: boolean;
  databasesCount: number;
  onQuickConnect?: (config: ConnectionConfig) => Promise<void>;
  profilesVersion?: number;
  onRestoreSession?: () => void;
}

const ENV_BADGES: Record<
  EnvironmentTag,
  { bg: string; text: string; border: string; label: string }
> = {
  local: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    label: "Local",
  },
  development: {
    bg: "bg-sky-500/10",
    text: "text-sky-400",
    border: "border-sky-500/30",
    label: "Dev",
  },
  staging: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/30",
    label: "Staging",
  },
  production: {
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/30",
    label: "Prod",
  },
};

export const WelcomeView: React.FC<WelcomeViewProps> = ({
  onOpenConnectModal,
  isConnected,
  databasesCount,
  onQuickConnect,
  profilesVersion,
}) => {
  const isLight = useIsLightTheme();
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

  const workspaceVersion = useWorkspaceStore((s) => s.version);
  const workspaceStatus = useWorkspaceStore((s) => s.status);

  useEffect(() => {
    refreshProfiles();
  }, [isConnected, profilesVersion, workspaceVersion]);

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
      setErrorMessage(`Fallo al conectar con "${profile.name}": ${msg}`);
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
              ? "border-line text-neutral-400 hover:text-neutral-200"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300"
          }`}
          title="Gestionar workspace"
        >
          {workspaceStatus.availability === "available"
            ? `Workspace: ${workspaceStatus.name ?? ""}`
            : `Workspace «${workspaceStatus.name ?? ""}» no disponible — las conexiones compartidas no se pueden mostrar. Haga clic para recuperarlo.`}
        </button>
      )}

      {/* Brand Hero */}
      <div className="relative mb-4">
        <div className="absolute -inset-4 bg-orange-600/20 rounded-full blur-xl animate-pulse" />
        <div className="relative w-16 h-16 rounded-2xl bg-raised border border-orange-500/40 shadow-2xl flex items-center justify-center overflow-hidden">
          <img
            src="/logo.png"
            alt="Pyro Studio Logo"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = "none";
            }}
          />
          <Flame className="w-8 h-8 text-orange-500 absolute pointer-events-none opacity-0 only:opacity-100" />
        </div>
      </div>

      <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
        <span>Bienvenido a</span>
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-amber-400 to-red-500">
          Pyro Studio
        </span>
      </h1>

      <p className="mt-1 text-xs text-neutral-400 max-w-md leading-relaxed">
        Cliente nativo ultraligero y de alto rendimiento para MariaDB y MySQL.
      </p>

      {/* Error Alert Bar */}
      {errorMessage && (
        <div className="mt-4 max-w-lg w-full p-3 rounded-lg border border-red-800/50 bg-red-950/40 text-red-300 text-xs flex items-center space-x-2 text-left animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <div className="flex-1 font-mono text-[11px] leading-relaxed">
            {errorMessage}
          </div>
          {lastFailedProfile && (
            <button
              onClick={() => {
                onOpenConnectModal(lastFailedProfile);
                setErrorMessage(null);
              }}
              className="px-2 py-1 bg-red-800/50 hover:bg-red-700/70 border border-red-600/50 rounded text-[11px] font-semibold text-white shrink-0 transition-colors"
            >
              Editar Conexión
            </button>
          )}
          <button
            onClick={() => setErrorMessage(null)}
            className="text-neutral-400 hover:text-white p-0.5"
          >
            ×
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="mt-5 flex flex-col items-center space-y-4 max-w-xl w-full">
        {!isConnected ? (
          <>
            {/* Recent Work / Continue Session Card */}
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
              const badgeInfo =
                ENV_BADGES[effectiveEnv] || ENV_BADGES.local;

              return (
                <div className="w-full p-4 rounded-xl bg-surface border border-line hover:border-line-strong shadow-xl text-left transition-all">
                  <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-line">
                    <div className="flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider font-mono">
                        Continuar Trabajo Reciente
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        recentWorkStorage.clearAll();
                        setRecentWork(recentWorkStorage.getRecentWork());
                      }}
                      className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
                    >
                      Limpiar
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <Server className="w-4 h-4 text-orange-400" />
                        <span className="text-xs font-semibold text-white">
                          {effectiveProfileName}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${badgeInfo.bg} ${badgeInfo.text} ${badgeInfo.border}`}
                        >
                          {badgeInfo.label}
                        </span>
                      </div>

                      <div className="text-[11px] text-neutral-400 font-mono">
                        <span>{recentWork.lastConnection.user}@{recentWork.lastConnection.host}:{recentWork.lastConnection.port}</span>
                        {recentWork.lastConnection.database && (
                          <span className="ml-2 text-orange-300/90 font-semibold">
                            • db: {recentWork.lastConnection.database}
                          </span>
                        )}
                      </div>

                      {recentWork.recentTables.length > 0 && (
                        <div className="pt-1 flex items-center space-x-1.5 flex-wrap gap-y-1 text-[10px] font-mono text-neutral-400">
                          <span className="text-neutral-500">Tablas:</span>
                          {recentWork.recentTables.slice(0, 3).map((t, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 rounded bg-raised border border-line text-neutral-300"
                            >
                              {t.table}
                            </span>
                          ))}
                        </div>
                      )}
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
                      className="px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-lg text-xs font-semibold shadow-md flex items-center space-x-1.5 shrink-0 transition-all hover:scale-105 active:scale-95"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reanudar Sesión</span>
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Quick Profile Cards or Empty State */}
            {savedProfiles.length === 0 ? (
              <div className="w-full p-8 rounded-xl bg-surface border border-line flex flex-col items-center justify-center text-center space-y-3">
                <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400">
                  <Database className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Sin conexiones guardadas
                  </h3>
                  <p className="text-xs text-neutral-400 mt-1 max-w-sm">
                    Conecta a tu servidor MariaDB o MySQL local o remoto en pocos segundos.
                  </p>
                </div>
                <button
                  onClick={() => onOpenConnectModal()}
                  className="mt-2 flex items-center space-x-2 px-5 py-2.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-orange-600 via-amber-600 to-orange-700 hover:from-orange-500 hover:to-amber-500 shadow-lg shadow-orange-950/60 border border-orange-400/40 transition-all hover:scale-105 active:scale-95"
                >
                  <Plus className="w-4 h-4" />
                  <span>Crear Nueva Conexión</span>
                </button>
              </div>
            ) : (
              <div className="w-full">
                <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1 mb-2 font-mono">
                  <span>Conexiones Guardadas ({savedProfiles.length})</span>
                  <button
                    onClick={() => onOpenConnectModal()}
                    className="hover:text-orange-400 flex items-center space-x-1 text-neutral-400 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-orange-400" />
                    <span>Nueva Conexión</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
                  {savedProfiles.map((profile) => {
                    const isTunnel = profile.tunnel && profile.tunnel.enabled;
                    const isConnecting = connectingProfileId === profile.id;
                    const envInfo = ENV_BADGES[profile.environment || "local"];

                    return (
                      <div
                        key={profile.id}
                        onClick={() => handleInitiateConnect(profile)}
                        className={`group relative p-3 rounded-lg border transition-all cursor-pointer flex flex-col justify-between ${
                          isLight
                            ? isConnecting
                              ? "border-orange-500 bg-orange-50/50 ring-1 ring-orange-500/50"
                              : "bg-white border-slate-200 hover:border-orange-500/50 hover:bg-slate-50 shadow-xs"
                            : isConnecting
                              ? "border-orange-500 bg-raised ring-1 ring-orange-500/50"
                              : "bg-surface border-line hover:border-orange-500/50 hover:bg-hover"
                        }`}
                      >
                        <div>
                          {/* Card Header: Name + Badges + Actions */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1.5 truncate max-w-[170px]">
                              {isTunnel ? (
                                <Globe className={`w-3.5 h-3.5 shrink-0 ${isLight ? "text-sky-600" : "text-sky-400"}`} />
                              ) : (
                                <Server className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                              )}
                              <span className={`font-semibold text-xs truncate ${isLight ? "text-slate-900" : "text-white"}`}>
                                {profile.name}
                              </span>
                            </div>

                            <div className="flex items-center space-x-1">
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${envInfo.bg} ${envInfo.text} ${envInfo.border}`}
                              >
                                {envInfo.label}
                              </span>

                              {/* Edit & Delete Action Buttons */}
                              <button
                                type="button"
                                title="Editar conexión"
                                onClick={(e) => handleEditProfile(profile, e)}
                                className={`p-1 rounded transition-colors ${
                                  isLight
                                    ? "hover:bg-slate-100 text-slate-400 hover:text-slate-800"
                                    : "hover:bg-hover text-neutral-400 hover:text-orange-400"
                                }`}
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                title="Eliminar conexión"
                                onClick={(e) => handleDeleteProfile(profile.id, profile.name, e)}
                                className={`p-1 rounded transition-colors ${
                                  isLight
                                    ? "hover:bg-red-50 text-slate-400 hover:text-red-600"
                                    : "hover:bg-red-950/50 text-neutral-400 hover:text-red-400"
                                }`}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {/* Card Subtitle: Target Host or Tunnel URL */}
                          <div className={`text-[11px] font-mono mt-1 truncate ${isLight ? "text-slate-600" : "text-neutral-400"}`}>
                            {isTunnel ? (
                              <span className={`truncate flex items-center space-x-1.5 ${isLight ? "text-sky-700 font-medium" : "text-sky-300/90"}`}>
                                <span>🌐</span>
                                <span className="truncate">{profile.tunnel?.url}</span>
                              </span>
                            ) : (
                              <span>
                                {profile.user}@{profile.host}:{profile.port}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Card Footer: Connect action / status */}
                        <div className={`mt-2.5 pt-2 border-t flex items-center justify-between text-[10px] font-mono ${
                          isLight ? "border-slate-100 text-slate-500" : "border-line text-neutral-500"
                        }`}>
                          <span className="flex items-center space-x-1">
                            {isTunnel ? (
                              <span className={isLight ? "text-sky-700 font-medium" : "text-sky-400"}>Túnel HTTP</span>
                            ) : (
                              <span>TCP Directo</span>
                            )}
                            {profile.database && (
                              <>
                                <span>•</span>
                                <span className={isLight ? "text-slate-500" : "text-neutral-400"}>db: {profile.database}</span>
                              </>
                            )}
                          </span>

                          <div className={`flex items-center space-x-1 font-semibold group-hover:translate-x-0.5 transition-transform ${
                            isLight ? "text-orange-600" : "text-orange-400"
                          }`}>
                            {isConnecting ? (
                              <span className="flex items-center space-x-1">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span>Conectando...</span>
                              </span>
                            ) : (
                              <span className="flex items-center space-x-1 opacity-80 group-hover:opacity-100">
                                <span>Conectar</span>
                                <ArrowRight className="w-3 h-3" />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-raised border border-line text-xs text-emerald-400 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            <span>
              Conexión activa ({databasesCount} esquemas disponibles en el
              árbol lateral)
            </span>
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
