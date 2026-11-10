import React from "react";
import {
  Database,
  Table as TableIcon,
  Layers,
  Sparkles,
  Settings2,
  Save,
} from "lucide-react";


import type { BackupRestoreState } from "./useBackupRestore";

/** Backup scope (database or tables), content mode and advanced SQL dump options. */
export const BackupContentOptions: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const {
    addDropTable,
    backupScope,
    contentMode,
    currentDbTables,
    disableFkChecks,
    includeCreateDb,
    includeReplicationCoords,
    includeRoutines,
    includeTriggers,
    includeViews,
    insertBatchSize,
    isBusy,
    selectedTables,
    setAddDropTable,
    setBackupScope,
    setContentMode,
    setDisableFkChecks,
    setIncludeCreateDb,
    setIncludeReplicationCoords,
    setIncludeRoutines,
    setIncludeTriggers,
    setIncludeViews,
    setInsertBatchSize,
    setSelectedTables,
  } = state;

  return (
    <>
      {/* Backup Scope: Full vs Selected Tables */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-fg">
          Alcance del Respaldo
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setBackupScope("database")}
            disabled={isBusy}
            className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
              backupScope === "database"
                ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            <Database
              className={`w-5 h-5 shrink-0 mt-0.5 ${
                backupScope === "database" ? "text-accent-text" : "text-fg-subtle"
              }`}
            />
            <div>
              <div className="font-semibold text-xs text-fg">
                Toda la Base de Datos
              </div>
              <div className="text-[11px] text-fg-muted mt-0.5">
                Incluye todas las tablas ({currentDbTables.length}), vistas, rutinas y triggers.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setBackupScope("tables")}
            disabled={isBusy}
            className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
              backupScope === "tables"
                ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            <TableIcon
              className={`w-5 h-5 shrink-0 mt-0.5 ${
                backupScope === "tables" ? "text-accent-text" : "text-fg-subtle"
              }`}
            />
            <div>
              <div className="font-semibold text-xs text-fg">
                Tablas Específicas ({selectedTables.length} selec.)
              </div>
              <div className="text-[11px] text-fg-muted mt-0.5">
                Elige manualmente las tablas individuales a respaldar.
              </div>
            </div>
          </button>
        </div>

        {/* Table Picker if Scope is 'tables' */}
        {backupScope === "tables" && (
          <div className="p-3 bg-raised rounded-lg border border-line space-y-2 animate-in fade-in">
            <div className="flex items-center justify-between text-xs pb-1 border-b border-line">
              <span className="text-fg font-semibold">Seleccionar tablas:</span>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setSelectedTables(currentDbTables.map((t) => t.name))}
                  className="text-[11px] text-accent-text hover:underline"
                >
                  Seleccionar todas
                </button>
                <span className="text-fg-subtle">•</span>
                <button
                  type="button"
                  onClick={() => setSelectedTables([])}
                  className="text-[11px] text-fg-muted hover:underline"
                >
                  Deseleccionar
                </button>
              </div>
            </div>

            <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
              {currentDbTables.length === 0 ? (
                <div className="text-xs text-fg-subtle italic py-2">
                  No hay tablas disponibles en esta base de datos.
                </div>
              ) : (
                currentDbTables.map((tbl) => {
                  const isChecked = selectedTables.includes(tbl.name);
                  return (
                    <label
                      key={tbl.name}
                      className="flex items-center justify-between p-1.5 rounded hover:bg-hover cursor-pointer text-xs"
                    >
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTables([...selectedTables, tbl.name]);
                            } else {
                              setSelectedTables(
                                selectedTables.filter((n) => n !== tbl.name)
                              );
                            }
                          }}
                          className="w-3.5 h-3.5 rounded bg-canvas border-line-strong text-accent-text focus:ring-accent"
                        />
                        <span className="text-fg font-mono">{tbl.name}</span>
                      </div>
                      <span className="text-[11px] text-fg-muted font-mono">
                        {tbl.rows_count !== null && tbl.rows_count !== undefined
                          ? `${tbl.rows_count.toLocaleString()} filas`
                          : ""}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Content Mode Selection */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-fg">
          Tipo de Contenido a Respaldar
        </label>
        <div className="grid grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={() => setContentMode("structure_and_data")}
            disabled={isBusy}
            className={`p-2.5 rounded-lg border text-left transition-all ${
              contentMode === "structure_and_data"
                ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-fg-muted" />
              <span>Estructura y Datos</span>
            </div>
            <div className="text-[11px] text-fg-muted mt-1">
              Esquema completo DDL + sentencias INSERT optimizadas.
            </div>
          </button>

          <button
            type="button"
            onClick={() => setContentMode("structure_only")}
            disabled={isBusy}
            className={`p-2.5 rounded-lg border text-left transition-all ${
              contentMode === "structure_only"
                ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
              <Settings2 className="w-3.5 h-3.5 text-fg-muted" />
              <span>Solo Estructura (DDL)</span>
            </div>
            <div className="text-[11px] text-fg-muted mt-1">
              Solo tablas, vistas, índices, funciones y triggers sin registros.
            </div>
          </button>

          <button
            type="button"
            onClick={() => setContentMode("data_only")}
            disabled={isBusy}
            className={`p-2.5 rounded-lg border text-left transition-all ${
              contentMode === "data_only"
                ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-fg-muted" />
              <span>Solo Datos</span>
            </div>
            <div className="text-[11px] text-fg-muted mt-1">
              Solo sentencias INSERT múltiples sin definiciones DDL.
            </div>
          </button>
        </div>
      </div>

      {/* Advanced SQL Options */}
      <div className="space-y-3 bg-raised p-4 rounded-xl border border-line">
        <div className="flex items-center space-x-2 text-xs font-semibold text-fg pb-2 border-b border-line">
          <Save className="w-4 h-4 text-fg-muted" />
          <span>Opciones Avanzadas del Respaldo</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {backupScope === "database" && (
            <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
              <input
                type="checkbox"
                checked={includeCreateDb}
                onChange={(e) => setIncludeCreateDb(e.target.checked)}
                disabled={isBusy}
                className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
              />
              <span>
                Incluir <code className="text-accent-text text-[11px]">CREATE DATABASE IF NOT EXISTS</code>
              </span>
            </label>
          )}

          {contentMode !== "data_only" && (
            <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
              <input
                type="checkbox"
                checked={addDropTable}
                onChange={(e) => setAddDropTable(e.target.checked)}
                disabled={isBusy}
                className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
              />
              <span>
                Agregar <code className="text-accent-text text-[11px]">DROP TABLE IF EXISTS</code>
              </span>
            </label>
          )}

          {backupScope === "database" && contentMode !== "data_only" && (
            <>
              <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                <input
                  type="checkbox"
                  checked={includeViews}
                  onChange={(e) => setIncludeViews(e.target.checked)}
                  disabled={isBusy}
                  className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
                />
                <span>Incluir Vistas</span>
              </label>

              <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                <input
                  type="checkbox"
                  checked={includeRoutines}
                  onChange={(e) => setIncludeRoutines(e.target.checked)}
                  disabled={isBusy}
                  className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
                />
                <span>Incluir Procedimientos y Funciones</span>
              </label>
            </>
          )}

          {contentMode !== "data_only" && (
            <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
              <input
                type="checkbox"
                checked={includeTriggers}
                onChange={(e) => setIncludeTriggers(e.target.checked)}
                disabled={isBusy}
                className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
              />
              <span>Incluir Triggers</span>
            </label>
          )}

          <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
            <input
              type="checkbox"
              checked={disableFkChecks}
              onChange={(e) => setDisableFkChecks(e.target.checked)}
              disabled={isBusy}
              className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
            />
            <span>Desactivar las claves foráneas temporalmente en el script</span>
          </label>

          <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg col-span-1 sm:col-span-2">
            <input
              type="checkbox"
              checked={includeReplicationCoords}
              onChange={(e) => setIncludeReplicationCoords(e.target.checked)}
              disabled={isBusy}
              className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
            />
            <span>Incluir coordenadas de replicación (requiere un bloqueo global breve en MySQL)</span>
          </label>
        </div>

        {contentMode !== "structure_only" && (
          <div className="pt-2 border-t border-line flex items-center justify-between text-xs">
            <span className="text-fg-muted">Filas por sentencia INSERT múltiple:</span>
            <select
              value={insertBatchSize}
              onChange={(e) => setInsertBatchSize(Number(e.target.value))}
              disabled={isBusy}
              className="bg-surface border border-line rounded px-2.5 py-1 text-xs text-fg font-mono focus:outline-none focus:border-accent"
            >
              <option value={100}>100 filas / INSERT</option>
              <option value={250}>250 filas / INSERT (Recomendado)</option>
              <option value={500}>500 filas / INSERT</option>
              <option value={1000}>1,000 filas / INSERT (Máxima velocidad)</option>
            </select>
          </div>
        )}
      </div>
    </>
  );
};
