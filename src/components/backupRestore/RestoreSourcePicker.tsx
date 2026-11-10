import React from "react";
import {
  FolderOpen,
  Trash2,
  Plus,
  Clock,
} from "lucide-react";


import type { BackupRestoreState } from "./useBackupRestore";

/** Restore source: a .sql file, or a structured backup directory with incremental chain and point-in-time target. */
export const RestoreSourcePicker: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const {
    handlePickRestoreBackupDir,
    handlePickRestoreBaseDir,
    handlePickRestoreFile,
    handlePickRestoreIncrementalDir,
    handleRemoveIncrementalDir,
    isBusy,
    restoreBackupDir,
    restoreBaseBackupDir,
    restoreFilePath,
    restoreFormat,
    restoreIncrementalDirs,
    restoreStrategy,
    restoreTargetTimestamp,
    setRestoreBackupDir,
    setRestoreBaseBackupDir,
    setRestoreStrategy,
    setRestoreTargetTimestamp,
  } = state;

  return (
    <>
      {/* Source Selection (File or Directory) */}
      {restoreFormat === "file" ? (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-fg">
            Archivo SQL de Respaldo (.sql)
          </label>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handlePickRestoreFile}
              disabled={isBusy}
              className="flex items-center space-x-2 px-3.5 py-2 text-xs font-semibold text-fg bg-elevated hover:bg-hover border border-line-strong rounded-lg transition-colors shrink-0"
            >
              <FolderOpen className="w-4 h-4 text-fg-muted" />
              <span>Seleccionar Archivo...</span>
            </button>

            <div className="flex-1 bg-raised border border-line rounded-lg px-3 py-2 text-xs text-fg font-mono truncate">
              {restoreFilePath || (
                <span className="text-fg-subtle italic">Ningún archivo seleccionado</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-3.5 bg-raised rounded-xl border border-line space-y-3">
          {/* Strategy: Snapshot vs Point-in-Time */}
          <div className="space-y-1.5 pb-2 border-b border-line">
            <label className="text-[11px] font-semibold text-fg-muted">
              Modo de Restauración
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRestoreStrategy("snapshot")}
                disabled={isBusy}
                className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                  restoreStrategy === "snapshot"
                    ? "bg-accent-soft border-accent/60 text-fg ring-1 ring-accent/30 font-semibold"
                    : "bg-surface border-line text-fg-muted hover:text-fg"
                }`}
              >
                <div>Instantánea (Full / Dif)</div>
                <div className="text-[10px] text-fg-muted font-normal mt-0.5">
                  Restaura un volcado estructurado completo o diferencial.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRestoreStrategy("point_in_time")}
                disabled={isBusy}
                className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                  restoreStrategy === "point_in_time"
                    ? "bg-accent-soft border-accent/60 text-fg ring-1 ring-accent/30 font-semibold"
                    : "bg-surface border-line text-fg-muted hover:text-fg"
                }`}
              >
                <div className="flex items-center gap-1">
                  <span>Point-in-Time Recovery</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-accent-soft text-accent-text border border-accent/30">Fase 4.2</span>
                </div>
                <div className="text-[10px] text-fg-muted font-normal mt-0.5">
                  Aplica backup base + cadena cronológica de binlogs.
                </div>
              </button>
            </div>
          </div>

          {restoreStrategy === "snapshot" ? (
            <>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-fg-muted">
                  Directorio del Respaldo Estructurado
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={restoreBackupDir}
                    onChange={(e) => setRestoreBackupDir(e.target.value)}
                    placeholder="Ruta de la carpeta del respaldo (con manifest.json)..."
                    disabled={isBusy}
                    className="flex-1 bg-surface border border-line rounded-lg px-3 py-1.5 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={handlePickRestoreBackupDir}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg bg-surface border border-line hover:bg-hover text-fg text-xs font-medium flex items-center space-x-1.5 shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Examinar...</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="text-[11px] font-semibold text-fg-muted flex items-center justify-between">
                  <span>Directorio Base (Opcional - para respaldos diferenciales)</span>
                  <span className="text-[10px] text-fg-subtle">Solo si el respaldo base cambió de ubicación</span>
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={restoreBaseBackupDir}
                    onChange={(e) => setRestoreBaseBackupDir(e.target.value)}
                    placeholder="Ruta opcional del respaldo base..."
                    disabled={isBusy}
                    className="flex-1 bg-surface border border-line rounded-lg px-3 py-1.5 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={handlePickRestoreBaseDir}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg bg-surface border border-line hover:bg-hover text-fg text-xs font-medium flex items-center space-x-1.5 shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Examinar...</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Point-in-Time Mode */
            <div className="space-y-3">
              {/* Base Backup Dir */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-fg-muted flex items-center justify-between">
                  <span>1. Carpeta del Respaldo Base Completo</span>
                  <span className="text-[10px] text-accent-text">Punto de partida</span>
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={restoreBaseBackupDir}
                    onChange={(e) => setRestoreBaseBackupDir(e.target.value)}
                    placeholder="Ruta del respaldo base..."
                    disabled={isBusy}
                    className="flex-1 bg-surface border border-line rounded-lg px-3 py-1.5 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={handlePickRestoreBaseDir}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg bg-surface border border-line hover:bg-hover text-fg text-xs font-medium flex items-center space-x-1.5 shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Examinar...</span>
                  </button>
                </div>
              </div>

              {/* Incremental Chains List */}
              <div className="space-y-2 pt-1 border-t border-line">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-fg-muted">
                    2. Carpetas de Respaldos Incrementales (en orden cronológico)
                  </label>
                  <button
                    type="button"
                    onClick={handlePickRestoreIncrementalDir}
                    disabled={isBusy}
                    className="text-[11px] px-2 py-1 rounded bg-surface border border-line hover:bg-hover text-accent-text flex items-center space-x-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Añadir carpeta...</span>
                  </button>
                </div>

                {restoreIncrementalDirs.length === 0 ? (
                  <div className="p-3 rounded bg-canvas border border-dashed border-line text-center text-xs text-fg-muted">
                    Ninguna carpeta incremental añadida. Añade una o más carpetas de respaldo incremental.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {restoreIncrementalDirs.map((dir, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded bg-canvas border border-line font-mono text-[11px]"
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <span className="px-1.5 py-0.5 rounded bg-raised border border-line text-[10px] text-fg-muted shrink-0">
                            #{idx + 1}
                          </span>
                          <span className="truncate text-fg" title={dir}>
                            {dir}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveIncrementalDir(idx)}
                          className="text-fg-subtle hover:text-danger p-1 rounded transition-colors ml-2 shrink-0"
                          title="Remover carpeta"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Optional Target Timestamp */}
              <div className="space-y-1.5 pt-1 border-t border-line">
                <label className="text-[11px] font-semibold text-fg-muted flex items-center justify-between">
                  <span>3. Punto en el Tiempo Objetivo (Opcional)</span>
                  <span className="text-[10px] text-fg-subtle">Deja vacío para reproducir todo</span>
                </label>
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-fg-muted shrink-0" />
                  <input
                    type="text"
                    value={restoreTargetTimestamp}
                    onChange={(e) => setRestoreTargetTimestamp(e.target.value)}
                    placeholder="Ej: 2026-10-31 14:30:00 o ISO 8601"
                    disabled={isBusy}
                    className="flex-1 bg-surface border border-line rounded-lg px-3 py-1.5 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};
