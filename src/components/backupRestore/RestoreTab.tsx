import React from "react";
import {
  RotateCcw,
  Database,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderOpen,
  ShieldAlert,
  Sparkles,
  Save,
  HardDrive,
  Trash2,
  Plus,
  Clock,
} from "lucide-react";


import { formatBytes } from "./formatBytes";
import type { BackupRestoreState } from "./useBackupRestore";

export const RestoreTab: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const {
    databases,
    dirRestoreProgress,
    dirRestoreSummary,
    handlePickRestoreBackupDir,
    handlePickRestoreBaseDir,
    handlePickRestoreFile,
    handlePickRestoreIncrementalDir,
    handleRemoveIncrementalDir,
    isBusy,
    isRestoring,
    isSqlite,
    newDatabaseName,
    pointInTimeSummary,
    restoreBackupDir,
    restoreBaseBackupDir,
    restoreDisableFk,
    restoreError,
    restoreFilePath,
    restoreFormat,
    restoreIncrementalDirs,
    restoreProgress,
    restoreStopOnError,
    restoreStrategy,
    restoreSummary,
    restoreTargetDb,
    restoreTargetTimestamp,
    restoreTargetType,
    setNewDatabaseName,
    setRestoreBackupDir,
    setRestoreBaseBackupDir,
    setRestoreDisableFk,
    setRestoreFormat,
    setRestoreStopOnError,
    setRestoreStrategy,
    setRestoreTargetDb,
    setRestoreTargetTimestamp,
    setRestoreTargetType,
  } = state;

  return (
    <>
          <div className="space-y-5">
            {/* Restore Error */}
            {restoreError && (
              <div className="p-3.5 rounded-lg border border-line text-danger text-xs flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="font-semibold block mb-0.5">Error en la restauración</span>
                  <span className="font-mono text-[11px] break-all">{restoreError}</span>
                </div>
              </div>
            )}

            {/* Restore Progress Display */}
            {isRestoring && restoreProgress && (
              <div className="p-4 rounded-xl bg-raised border border-line text-fg text-xs space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin text-fg-muted" />
                    <span className="font-bold text-fg text-sm">{restoreProgress.stage}</span>
                  </div>
                  <span className="font-mono text-fg font-bold">
                    {restoreProgress.percent_complete.toFixed(1)}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2 bg-raised rounded-full overflow-hidden border border-line">
                  <div
                    className="h-full bg-raised hover:bg-hover transition-all duration-150 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(0, restoreProgress.percent_complete))}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-fg-muted font-mono">
                  <span>Sentencias ejecutadas: {restoreProgress.statements_executed.toLocaleString()}</span>
                  <span>
                    {formatBytes(restoreProgress.bytes_read)} / {formatBytes(restoreProgress.total_bytes)}
                  </span>
                </div>

                {restoreProgress.current_statement_preview && (
                  <div className="p-2 rounded bg-canvas border border-line font-mono text-[11px] text-fg truncate">
                    {restoreProgress.current_statement_preview}
                  </div>
                )}
              </div>
            )}

            {/* Directory Restore Progress Display */}
            {isRestoring && dirRestoreProgress && (
              <div className="p-4 rounded-xl bg-raised border border-line text-fg text-xs space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin text-accent-text" />
                    <span className="font-bold text-fg text-sm">{dirRestoreProgress.stage}</span>
                  </div>
                  <span className="font-mono text-accent-text font-bold">
                    {dirRestoreProgress.percent_complete.toFixed(1)}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2 bg-surface rounded-full overflow-hidden border border-line">
                  <div
                    className="h-full bg-accent transition-all duration-150 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(0, dirRestoreProgress.percent_complete))}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-fg-muted font-mono">
                  <span>
                    {dirRestoreProgress.current_table ? `Tabla: ${dirRestoreProgress.current_table}` : "Procesando metadatos..."}
                  </span>
                  <span>
                    {dirRestoreProgress.rows_restored.toLocaleString()} filas restauradas
                  </span>
                </div>
              </div>
            )}

            {/* Restore Success / Complete Summary */}
            {restoreSummary && !isRestoring && (
              <div
                className={`p-4 rounded-xl border text-xs space-y-3 animate-in fade-in ${
                  restoreSummary.failed_statements === 0
                    ? "border-line text-success"
                    : "border-line text-warning"
                }`}
              >
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <div className="flex items-center space-x-2">
                    {restoreSummary.failed_statements === 0 ? (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-warning" />
                    )}
                    <span className="font-bold text-fg text-sm">
                      {restoreSummary.failed_statements === 0
                        ? "¡Restauración completada con éxito!"
                        : "Restauración finalizada con advertencias"}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-fg-muted">
                    {restoreSummary.duration_ms} ms
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">BD Destino</span>
                    <span className="font-bold text-fg text-sm truncate block">
                      {restoreSummary.target_database}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Total Sentencias</span>
                    <span className="font-bold text-fg text-sm">
                      {restoreSummary.total_statements.toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Exitosas</span>
                    <span className="font-bold text-success text-sm">
                      {restoreSummary.successful_statements.toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Fallidas</span>
                    <span
                      className={`font-bold text-sm ${
                        restoreSummary.failed_statements === 0
                          ? "text-fg-muted"
                          : "text-danger"
                      }`}
                    >
                      {restoreSummary.failed_statements.toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Errors details list if any failed */}
                {restoreSummary.errors.length > 0 && (
                  <div className="mt-2 p-2.5 rounded bg-canvas border border-line space-y-1">
                    <span className="text-danger font-semibold text-[11px] block">
                      Detalle de errores ({restoreSummary.errors.length}):
                    </span>
                    <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] font-mono text-danger">
                      {restoreSummary.errors.map((err, idx) => (
                        <div key={idx} className="p-1.5 rounded border border-line break-all">
                          {err}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Directory Restore Success Summary */}
            {dirRestoreSummary && !isRestoring && (
              <div className="p-4 rounded-xl border border-line text-xs space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="font-bold text-fg text-sm">
                      ¡Restauración estructurada completada con éxito!
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-fg-muted">
                    {dirRestoreSummary.duration_ms} ms
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">BD Destino</span>
                    <span className="font-bold text-fg text-sm truncate block">
                      {dirRestoreSummary.target_database}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Tablas</span>
                    <span className="font-bold text-fg text-sm">
                      {dirRestoreSummary.total_tables.toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Bloques (Chunks)</span>
                    <span className="font-bold text-fg text-sm">
                      {dirRestoreSummary.total_chunks.toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Filas Insertadas</span>
                    <span className="font-bold text-success text-sm">
                      {dirRestoreSummary.total_rows.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-fg-muted font-mono bg-canvas p-2 rounded border border-line flex items-center justify-between">
                  <span>Datos procesados y descomprimidos:</span>
                  <span className="font-bold text-fg">{formatBytes(dirRestoreSummary.bytes_processed)}</span>
                </div>
              </div>
            )}

            {/* Point-In-Time Restore Success Summary */}
            {pointInTimeSummary && !isRestoring && (
              <div className="p-4 rounded-xl border border-line text-xs space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="font-bold text-fg text-sm">
                      ¡Recuperación Point-in-Time completada con éxito!
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-fg-muted">
                    {pointInTimeSummary.duration_ms} ms
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block font-sans">BD Destino</span>
                    <span className="font-bold text-fg text-sm truncate block">
                      {pointInTimeSummary.target_database}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block font-sans">Tablas Base</span>
                    <span className="font-bold text-fg text-sm">
                      {pointInTimeSummary.base_tables_restored.toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block font-sans">Incrementales</span>
                    <span className="font-bold text-fg text-sm">
                      {pointInTimeSummary.incrementals_applied} aplicados
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block font-sans">Eventos Binlog</span>
                    <span className="font-bold text-success text-sm">
                      {pointInTimeSummary.events_replayed.toLocaleString()}
                    </span>
                  </div>
                </div>

                {pointInTimeSummary.point_in_time_reached && (
                  <div className="text-[11px] text-fg font-mono bg-canvas p-2 rounded border border-line flex items-center justify-between">
                    <span className="text-fg-muted">Punto en el tiempo alcanzado:</span>
                    <span className="font-bold text-accent-text">{pointInTimeSummary.point_in_time_reached}</span>
                  </div>
                )}
              </div>
            )}

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
