import React from "react";
import {
  RotateCcw,
  Database,
  ShieldAlert,
  Sparkles,
  Save,
  HardDrive,
} from "lucide-react";


import { RestoreSourcePicker } from "./RestoreSourcePicker";
import { RestoreResults } from "./RestoreResults";
import type { BackupRestoreState } from "./useBackupRestore";

export const RestoreTab: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const {
    databases,
    isBusy,
    isSqlite,
    newDatabaseName,
    restoreDisableFk,
    restoreFormat,
    restoreStopOnError,
    restoreTargetDb,
    restoreTargetType,
    setNewDatabaseName,
    setRestoreDisableFk,
    setRestoreFormat,
    setRestoreStopOnError,
    setRestoreTargetDb,
    setRestoreTargetType,
  } = state;

  return (
    <>
          <div className="space-y-5">
            <RestoreResults state={state} />

            {isSqlite ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-line bg-raised space-y-3">
                  <div className="flex items-center space-x-2.5">
                    <RotateCcw className="w-5 h-5 text-accent-text shrink-0" />
                    <div>
                      <h4 className="text-xs font-semibold text-fg">Restauración de SQLite</h4>
                      <p className="text-[11px] text-fg-muted">
                        SQLite almacena cada base de datos en un único archivo autónomo en disco.
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-fg-muted space-y-3 border-t border-line pt-3 leading-relaxed">
                    <p>
                      Para restaurar una copia de seguridad o trabajar con un archivo <code className="text-accent-text font-mono">.sqlite3</code> / <code className="text-accent-text font-mono">.db</code> anterior:
                    </p>
                    <div className="space-y-2">
                      <div className="p-3 bg-surface border border-line rounded-lg">
                        <span className="font-semibold text-fg block text-xs mb-1">Opción 1: Abrir como nueva conexión</span>
                        <span className="text-[11px] text-fg-muted block">
                          Puede conectarse al archivo de respaldo en cualquier momento utilizando el diálogo de conexión de SQLite en PyroStudio sin sobrescribir el archivo actual.
                        </span>
                      </div>
                      <div className="p-3 bg-surface border border-line rounded-lg">
                        <span className="font-semibold text-fg block text-xs mb-1">Opción 2: Reemplazo directo en el sistema de archivos</span>
                        <span className="text-[11px] text-fg-muted block">
                          Si desea sustituir completamente su base de datos original, desconecte la sesión activa y reemplace el archivo de la base de datos en su explorador de archivos con el archivo de respaldo.
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
            {/* Restore Format Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-fg">
                Formato del Respaldo a Restaurar
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRestoreFormat("file")}
                  disabled={isBusy}
                  className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                    restoreFormat === "file"
                      ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                      : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <Save
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      restoreFormat === "file" ? "text-accent-text" : "text-fg-subtle"
                    }`}
                  />
                  <div>
                    <div className="font-semibold text-xs text-fg">Archivo SQL (.sql)</div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      Script DDL y sentencias INSERT estándar.
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setRestoreFormat("directory")}
                  disabled={isBusy}
                  className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                    restoreFormat === "directory"
                      ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                      : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <HardDrive
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      restoreFormat === "directory" ? "text-accent-text" : "text-fg-subtle"
                    }`}
                  />
                  <div>
                    <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                      <span>Directorio Estructurado</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-accent-soft text-accent-text border border-accent/20">Fase 4</span>
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      Restauración streaming por bloques Zstandard / Gzip y soporte diferencial.
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <RestoreSourcePicker state={state} />

            {/* Target Database Config */}
            <div className="space-y-3 bg-raised p-4 rounded-xl border border-line">
              <div className="flex items-center space-x-2 text-xs font-semibold text-fg pb-2 border-b border-line">
                <Database className="w-4 h-4 text-fg-muted" />
                <span>Base de Datos de Destino para la Restauración</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRestoreTargetType("existing")}
                  disabled={isBusy}
                  className={`p-3 rounded-lg border text-left flex items-start space-x-2.5 transition-all ${
                    restoreTargetType === "existing"
                      ? "bg-raised border-line text-fg shadow-sm ring-1 "
                      : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <Database
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      restoreTargetType === "existing" ? "text-fg-muted" : "text-fg-subtle"
                    }`}
                  />
                  <div>
                    <div className="font-semibold text-xs text-fg">
                      Restaurar en BD Existente
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      Sobrescribe o inserta en una base de datos ya creada.
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setRestoreTargetType("new")}
                  disabled={isBusy}
                  className={`p-3 rounded-lg border text-left flex items-start space-x-2.5 transition-all ${
                    restoreTargetType === "new"
                      ? "bg-raised border-line text-fg shadow-sm ring-1 "
                      : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <Sparkles
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      restoreTargetType === "new" ? "text-fg-muted" : "text-fg-subtle"
                    }`}
                  />
                  <div>
                    <div className="font-semibold text-xs text-fg">
                      Crear Nueva Base de Datos
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      Crea un nuevo esquema con UTF-8 mb4 antes de restaurar.
                    </div>
                  </div>
                </button>
              </div>

              {restoreTargetType === "existing" ? (
                <div className="pt-2 animate-in fade-in">
                  <label className="text-[11px] font-semibold text-fg-muted block mb-1">
                    Seleccionar Base de Datos Existente:
                  </label>
                  <select
                    value={restoreTargetDb}
                    onChange={(e) => setRestoreTargetDb(e.target.value)}
                    disabled={isBusy}
                    className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-line"
                  >
                    {databases.map((db) => (
                      <option key={db.name} value={db.name}>
                        {db.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="pt-2 animate-in fade-in">
                  <label className="text-[11px] font-semibold text-fg-muted block mb-1">
                    Nombre de la nueva Base de Datos a crear:
                  </label>
                  <input
                    type="text"
                    value={newDatabaseName}
                    onChange={(e) => setNewDatabaseName(e.target.value)}
                    placeholder="ej. mi_base_de_datos_restaurada"
                    disabled={isBusy}
                    className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-line"
                  />
                </div>
              )}
            </div>

            {/* Execution Options */}
            <div className="space-y-3 bg-raised p-4 rounded-xl border border-line">
              <div className="flex items-center space-x-2 text-xs font-semibold text-fg pb-2 border-b border-line">
                <ShieldAlert className="w-4 h-4 text-fg-muted" />
                <span>Control de Ejecución y Consistencia</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                  <input
                    type="checkbox"
                    checked={restoreDisableFk}
                    onChange={(e) => setRestoreDisableFk(e.target.checked)}
                    disabled={isBusy}
                    className="w-4 h-4 rounded bg-surface border-line-strong text-fg-muted focus:"
                  />
                  <span>Desactivar temporalmente la verificación de claves foráneas</span>
                </label>

                <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                  <input
                    type="checkbox"
                    checked={restoreStopOnError}
                    onChange={(e) => setRestoreStopOnError(e.target.checked)}
                    disabled={isBusy}
                    className="w-4 h-4 rounded bg-surface border-line-strong text-fg-muted focus:"
                  />
                  <span>Detener ejecución ante el primer error</span>
                </label>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};
