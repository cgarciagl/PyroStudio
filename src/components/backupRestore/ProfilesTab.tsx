import React from "react";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderOpen,
  ShieldCheck,
  Calendar,
  Play,
  Trash2,
  Edit3,
  Plus,
  RefreshCw,
} from "lucide-react";
import type {
  BackupCompressionFormat,
} from "../../types/database";
import {
  primaryBtn,
  secondaryBtn,
  ghostBtn,
  iconBtn,
  inputClass,
  selectClass,
  fieldLabel,
  cardClass,
} from "../ui/styles";
import { EmptyState, Spinner } from "../ui/Modal";


import type { BackupRestoreState } from "./useBackupRestore";

export const ProfilesTab: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const {
    databases,
    editingProfile,
    enforcingRetentionId,
    handleDeleteProfile,
    handleEditProfile,
    handleEnforceRetention,
    handleNewProfile,
    handlePickProfileTargetDir,
    handleRunProfile,
    handleSaveProfile,
    isBusy,
    isLoadingProfiles,
    loadProfiles,
    profileActionError,
    profileActionSuccess,
    profiles,
    runningProfileId,
    setEditingProfile,
  } = state;

  return (
    <>
      <div className="space-y-4">
        {profileActionError && (
          <div className="p-3 rounded-lg border border-line text-danger text-xs flex items-start space-x-2.5 bg-canvas">
            <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block mb-0.5">Error en perfiles</span>
              <span className="font-mono text-[11px] break-all">{profileActionError}</span>
            </div>
          </div>
        )}

        {profileActionSuccess && (
          <div className="p-3 rounded-lg border border-line text-success text-xs flex items-start space-x-2.5 bg-canvas">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block mb-0.5">Operación completada</span>
              <span className="text-[11px]">{profileActionSuccess}</span>
            </div>
          </div>
        )}

        {editingProfile ? (
          /* Profile Editor Form */
          <div className={`${cardClass} p-5 space-y-4`}>
            <div className="border-b border-line pb-3">
              <h3 className="text-xs font-semibold text-fg">
                {profiles.some((p) => p.id === editingProfile.id)
                  ? "Editar Perfil de Respaldo"
                  : "Nuevo Perfil de Respaldo"}
              </h3>
              <p className="text-[11px] text-fg-muted mt-0.5">
                Configura la periodicidad del planificador automático, formato de volcado y reglas de retención inteligente.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={fieldLabel}>Nombre del Perfil</label>
                <input
                  type="text"
                  value={editingProfile.name}
                  onChange={(e) =>
                    setEditingProfile({ ...editingProfile, name: e.target.value })
                  }
                  placeholder="Ej. Respaldo Diario Nocturno"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={fieldLabel}>Base de Datos</label>
                <select
                  value={editingProfile.database}
                  onChange={(e) =>
                    setEditingProfile({ ...editingProfile, database: e.target.value })
                  }
                  className={selectClass}
                >
                  {databases.map((db) => (
                    <option key={db.name} value={db.name}>
                      {db.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={fieldLabel}>Directorio de Destino en Disco</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editingProfile.target_dir}
                  onChange={(e) =>
                    setEditingProfile({ ...editingProfile, target_dir: e.target.value })
                  }
                  placeholder="Ruta absoluta de la carpeta..."
                  className={`${inputClass} flex-1 font-mono`}
                />
                <button
                  type="button"
                  onClick={handlePickProfileTargetDir}
                  className={secondaryBtn}
                >
                  <FolderOpen className="w-4 h-4 mr-1.5" />
                  Examinar...
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={fieldLabel}>Frecuencia de Programación</label>
                <select
                  value={editingProfile.schedule_interval_hours}
                  onChange={(e) =>
                    setEditingProfile({
                      ...editingProfile,
                      schedule_interval_hours: parseInt(e.target.value, 10) || 24,
                    })
                  }
                  className={selectClass}
                >
                  <option value={1}>Cada hora (1 hora)</option>
                  <option value={6}>Cada 6 horas</option>
                  <option value={12}>Cada 12 horas</option>
                  <option value={24}>Diaria (cada 24 horas)</option>
                  <option value={168}>Semanal (cada 7 días)</option>
                </select>
              </div>

              <div>
                <label className={fieldLabel}>Estado del Programador</label>
                <label className="flex items-center gap-2 cursor-pointer pt-2">
                  <input
                    type="checkbox"
                    checked={editingProfile.schedule_enabled}
                    onChange={(e) =>
                      setEditingProfile({ ...editingProfile, schedule_enabled: e.target.checked })
                    }
                    className="rounded border-line text-accent focus:ring-accent"
                  />
                  <span className="text-xs text-fg font-medium">Programador en segundo plano habilitado</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={fieldLabel}>Formato</label>
                <select
                  value={editingProfile.backup_format}
                  onChange={(e) =>
                    setEditingProfile({
                      ...editingProfile,
                      backup_format: e.target.value as "directory" | "sql",
                    })
                  }
                  className={selectClass}
                >
                  <option value="directory">Directorio Estructurado</option>
                  <option value="sql">Archivo SQL (.sql)</option>
                </select>
              </div>

              <div>
                <label className={fieldLabel}>Compresión</label>
                <select
                  value={editingProfile.compression || "zstd"}
                  onChange={(e) =>
                    setEditingProfile({
                      ...editingProfile,
                      compression: e.target.value as BackupCompressionFormat,
                    })
                  }
                  className={selectClass}
                >
                  <option value="zstd">Zstandard (.zst)</option>
                  <option value="gzip">Gzip (.gz)</option>
                  <option value="none">Sin compresión</option>
                </select>
              </div>

              {editingProfile.backup_format === "directory" && (
                <div>
                  <label className={fieldLabel}>Modo de Respaldo</label>
                  <select
                    value={editingProfile.structured_type || "full"}
                    onChange={(e) =>
                      setEditingProfile({
                        ...editingProfile,
                        structured_type: e.target.value as "full" | "differential",
                      })
                    }
                    className={selectClass}
                  >
                    <option value="full">Completo (Full snapshot)</option>
                    <option value="differential">Diferencial (Solo cambios)</option>
                  </select>
                </div>
              )}
            </div>

            {/* Retention Policy Section */}
            <div className="p-3.5 rounded-lg border border-line bg-canvas space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-accent-text" />
                <span className="text-xs font-semibold text-fg">
                  Políticas de Retención Inteligente
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={fieldLabel}>Conservar últimas N copias</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={editingProfile.retention_max_backups ?? 5}
                    onChange={(e) =>
                      setEditingProfile({
                        ...editingProfile,
                        retention_max_backups: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>

                <div>
                  <label className={fieldLabel}>Antigüedad máxima en días (0 = ilimitado)</label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={editingProfile.retention_max_days ?? 0}
                    onChange={(e) =>
                      setEditingProfile({
                        ...editingProfile,
                        retention_max_days: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </div>

              <p className="text-[11px] text-fg-muted">
                Protección de cadena: Si un respaldo base tiene copias diferenciales asociadas activas, el motor de retención nunca lo purgará, preservando la capacidad de restauración íntegra.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setEditingProfile(null)}
                className={secondaryBtn}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                className={primaryBtn}
              >
                Guardar Perfil
              </button>
            </div>
          </div>
        ) : (
          /* Profiles List */
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-fg">
                  Perfiles de Respaldo ({profiles.length})
                </h3>
                <p className="text-[11px] text-fg-muted">
                  El programador en segundo plano evalúa y ejecuta periódicamente los perfiles activos.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadProfiles}
                  disabled={isLoadingProfiles}
                  className={secondaryBtn}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoadingProfiles ? "animate-spin" : ""}`} />
                  Actualizar
                </button>
                <button
                  type="button"
                  onClick={handleNewProfile}
                  className={primaryBtn}
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Nuevo Perfil
                </button>
              </div>
            </div>

            {isLoadingProfiles ? (
              <div className="py-12 flex justify-center">
                <Spinner className="w-6 h-6" />
              </div>
            ) : profiles.length === 0 ? (
              <EmptyState
                icon={<Calendar className="w-8 h-8" />}
                title="No hay perfiles configurados"
                description="Crea perfiles con frecuencias automáticas (horaria, diaria, semanal) y políticas de retención inteligente para proteger tus bases de datos."
                action={
                  <button
                    type="button"
                    onClick={handleNewProfile}
                    className={primaryBtn}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Crear primer perfil
                  </button>
                }
              />
            ) : (
              <div className="space-y-2.5">
                {profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={`${cardClass} p-3.5 space-y-2.5 hover:border-line transition-colors`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            profile.schedule_enabled ? "bg-success" : "bg-fg-muted/40"
                          }`}
                          title={profile.schedule_enabled ? "Programador activo" : "Programador inactivo"}
                        />
                        <span className="font-semibold text-xs text-fg truncate">
                          {profile.name}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-canvas border border-line text-fg-muted shrink-0">
                          {profile.schedule_enabled
                            ? profile.schedule_interval_hours === 1
                              ? "Cada hora"
                              : profile.schedule_interval_hours === 24
                              ? "Diario (24h)"
                              : profile.schedule_interval_hours === 168
                              ? "Semanal (7d)"
                              : `Cada ${profile.schedule_interval_hours}h`
                            : "Manual"}
                        </span>
                        {profile.structured_type === "differential" && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-soft text-accent-text border border-accent/20 shrink-0">
                            Diferencial
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-canvas border border-line text-fg-muted shrink-0">
                          {profile.backup_format === "directory" ? "Estructurado" : "SQL"} ({(profile.compression || "zstd").toUpperCase()})
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleRunProfile(profile)}
                          disabled={isBusy}
                          className={secondaryBtn}
                          title="Ejecutar respaldo ahora"
                        >
                          {runningProfileId === profile.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5 mr-1" />
                          )}
                          <span>Ejecutar</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleEnforceRetention(profile)}
                          disabled={isBusy}
                          className={ghostBtn}
                          title="Aplicar retención y proteger respaldos base"
                        >
                          {enforcingRetentionId === profile.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                          )}
                          <span>Retención</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleEditProfile(profile)}
                          disabled={isBusy}
                          className={iconBtn}
                          title="Editar perfil"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteProfile(profile)}
                          disabled={isBusy}
                          className={`${iconBtn} text-danger hover:text-danger`}
                          title="Eliminar perfil"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px] pt-1 border-t border-line font-mono">
                      <div>
                        <span className="text-fg-muted font-sans mr-1">Base de datos:</span>
                        <span className="text-fg font-medium">{profile.database}</span>
                      </div>

                      <div className="truncate">
                        <span className="text-fg-muted font-sans mr-1">Destino:</span>
                        <span className="text-fg-muted" title={profile.target_dir}>
                          {profile.target_dir}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-fg-muted font-sans mr-1">Retención:</span>
                        <span className="text-fg-subtle font-sans">
                          {profile.retention_max_backups ? `${profile.retention_max_backups} copias` : "Sin límite"}
                          {profile.retention_max_days ? `, máx ${profile.retention_max_days}d` : ""}
                        </span>
                      </div>
                    </div>

                    {profile.last_run_at && (
                      <div className="flex items-center justify-between text-[11px] pt-1 text-fg-muted">
                        <div className="flex items-center gap-1.5">
                          <span>Última ejecución:</span>
                          <span className="font-mono text-fg">
                            {new Date(profile.last_run_at).toLocaleString()}
                          </span>
                        </div>

                        <div>
                          {profile.last_status === "success" ? (
                            <span className="text-success flex items-center gap-1 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Completado con éxito
                            </span>
                          ) : profile.last_status === "failed" ? (
                            <span className="text-danger flex items-center gap-1 font-medium">
                              <AlertCircle className="w-3.5 h-3.5" /> Error en ejecución
                            </span>
                          ) : (
                            <span className="text-accent-text flex items-center gap-1 font-medium">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> En ejecución
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};
