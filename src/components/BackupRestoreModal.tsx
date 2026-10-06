import React, { useState, useEffect } from "react";
import {
  X,
  Archive,
  RotateCcw,
  Database,
  Table as TableIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderOpen,
  ShieldAlert,
  Layers,
  Sparkles,
  Settings2,
  Save,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import type {
  SqlDumpRequest,
  SqlDumpSummary,
  SqlRestoreRequest,
  SqlRestoreProgressEvent,
  SqlRestoreSummary,
} from "../types/database";
import { dbService } from "../services/tauriDb";
import { useSchemaStore } from "../stores/schemaStore";
import { useUIStore } from "../stores/uiStore";

type TabMode = "backup" | "restore";
type ExportContentMode = "structure_and_data" | "structure_only" | "data_only";

export const BackupRestoreModal: React.FC = () => {
  const {
    isBackupRestoreModalOpen,
    backupRestoreInitialTab,
    backupRestoreTargetDatabase,
    closeBackupRestoreModal,
  } = useUIStore();

  const { databases, selectedDatabase, tables, loadDatabases, loadSchemaObjects } =
    useSchemaStore();

  const [activeTab, setActiveTab] = useState<TabMode>("backup");

  // ─── BACKUP STATE ─────────────────────────────────────────────────────────
  const [backupDb, setBackupDb] = useState<string>("");
  const [backupScope, setBackupScope] = useState<"database" | "tables">("database");
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [contentMode, setContentMode] = useState<ExportContentMode>("structure_and_data");
  const [includeCreateDb, setIncludeCreateDb] = useState<boolean>(true);
  const [addDropTable, setAddDropTable] = useState<boolean>(true);
  const [includeViews, setIncludeViews] = useState<boolean>(true);
  const [includeRoutines, setIncludeRoutines] = useState<boolean>(true);
  const [includeTriggers, setIncludeTriggers] = useState<boolean>(true);
  const [disableFkChecks, setDisableFkChecks] = useState<boolean>(true);
  const [insertBatchSize, setInsertBatchSize] = useState<number>(250);

  const [isBackingUp, setIsBackingUp] = useState<boolean>(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupSummary, setBackupSummary] = useState<SqlDumpSummary | null>(null);

  // ─── RESTORE STATE ────────────────────────────────────────────────────────
  const [restoreFilePath, setRestoreFilePath] = useState<string>("");
  const [restoreTargetType, setRestoreTargetType] = useState<"existing" | "new">("existing");
  const [restoreTargetDb, setRestoreTargetDb] = useState<string>("");
  const [newDatabaseName, setNewDatabaseName] = useState<string>("");
  const [restoreDisableFk, setRestoreDisableFk] = useState<boolean>(true);
  const [restoreStopOnError, setRestoreStopOnError] = useState<boolean>(false);

  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreProgress, setRestoreProgress] = useState<SqlRestoreProgressEvent | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSummary, setRestoreSummary] = useState<SqlRestoreSummary | null>(null);

  // Initialize state when modal opens
  useEffect(() => {
    if (isBackupRestoreModalOpen) {
      setActiveTab(backupRestoreInitialTab || "backup");
      const defaultDb =
        backupRestoreTargetDatabase ||
        selectedDatabase ||
        (databases.length > 0 ? databases[0].name : "");

      setBackupDb(defaultDb);
      setRestoreTargetDb(defaultDb);
      setBackupScope("database");
      setSelectedTables([]);
      setBackupError(null);
      setBackupSummary(null);
      setRestoreFilePath("");
      setRestoreProgress(null);
      setRestoreError(null);
      setRestoreSummary(null);
      setNewDatabaseName("");

      if (defaultDb && (!tables[defaultDb] || tables[defaultDb].length === 0)) {
        void loadSchemaObjects(defaultDb);
      }
    }
  }, [
    isBackupRestoreModalOpen,
    backupRestoreInitialTab,
    backupRestoreTargetDatabase,
    selectedDatabase,
    databases,
  ]);

  // Load tables when backup DB changes
  useEffect(() => {
    if (backupDb && (!tables[backupDb] || tables[backupDb].length === 0)) {
      void loadSchemaObjects(backupDb);
    }
  }, [backupDb]);

  // Tauri Progress Event Listener for Restore
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    if (isBackupRestoreModalOpen) {
      void listen<SqlRestoreProgressEvent>("sql-restore-progress", (event) => {
        setRestoreProgress(event.payload);
      }).then((fn) => {
        unlisten = fn;
      });
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [isBackupRestoreModalOpen]);

  if (!isBackupRestoreModalOpen) return null;

  const currentDbTables = backupDb ? tables[backupDb] || [] : [];

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // ─── BACKUP HANDLER ───────────────────────────────────────────────────────
  const handleStartBackup = async () => {
    if (!backupDb) {
      setBackupError("Por favor selecciona una base de datos para respaldar.");
      return;
    }

    if (backupScope === "tables" && selectedTables.length === 0) {
      setBackupError("Por favor selecciona al menos una tabla para el respaldo.");
      return;
    }

    setBackupError(null);
    setBackupSummary(null);

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "_")
      .slice(0, 15);
    const defaultFilename = `${backupDb}_backup_${timestamp}.sql`;

    try {
      const savePath = await dbService.saveSqlDialog(defaultFilename);
      if (!savePath) {
        return; // User canceled save dialog
      }

      setIsBackingUp(true);

      const request: SqlDumpRequest = {
        database: backupDb,
        tables: backupScope === "tables" ? selectedTables : undefined,
        export_mode: contentMode,
        include_drop_table: addDropTable,
        include_views: includeViews && backupScope === "database",
        include_routines: includeRoutines && backupScope === "database",
        include_triggers: includeTriggers,
        include_create_database: includeCreateDb && backupScope === "database",
        insert_batch_size: insertBatchSize,
        output_file_path: savePath,
      };

      const result = await dbService.exportSqlDump(request);
      setBackupSummary(result);
    } catch (err: unknown) {
      console.error("Backup error:", err);
      setBackupError(
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Ocurrió un error al generar el respaldo."
      );
    } finally {
      setIsBackingUp(false);
    }
  };

  // ─── RESTORE HANDLER ──────────────────────────────────────────────────────
  const handlePickRestoreFile = async () => {
    try {
      const filePath = await dbService.openSqlDialog();
      if (filePath) {
        setRestoreFilePath(filePath);
        setRestoreError(null);
      }
    } catch (err) {
      console.error("Error picking SQL restore file:", err);
    }
  };

  const handleStartRestore = async () => {
    if (!restoreFilePath) {
      setRestoreError("Por favor selecciona un archivo SQL de respaldo.");
      return;
    }

    const effectiveTargetDb =
      restoreTargetType === "new" ? newDatabaseName.trim() : restoreTargetDb.trim();

    if (!effectiveTargetDb) {
      setRestoreError("Por favor especifica la base de datos de destino.");
      return;
    }

    setRestoreError(null);
    setRestoreSummary(null);
    setRestoreProgress(null);
    setIsRestoring(true);

    try {
      const request: SqlRestoreRequest = {
        file_path: restoreFilePath,
        target_database: effectiveTargetDb,
        create_database_if_not_exists: restoreTargetType === "new",
        stop_on_error: restoreStopOnError,
        disable_foreign_keys: restoreDisableFk,
      };

      const summary = await dbService.executeSqlRestore(request);
      setRestoreSummary(summary);

      // Refresh database list & schemas upon completion
      void loadDatabases();
      if (effectiveTargetDb) {
        void loadSchemaObjects(effectiveTargetDb);
      }
    } catch (err: unknown) {
      console.error("Restore error:", err);
      setRestoreError(
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Ocurrió un error al restaurar el respaldo."
      );
    } finally {
      setIsRestoring(false);
    }
  };

  const isBusy = isBackingUp || isRestoring;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-[#0f1219] border border-[#202738] rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col text-neutral-200 my-auto">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#141824] border-b border-[#202738] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-orange-950/60 border border-orange-500/40 flex items-center justify-center text-orange-400 shadow-sm">
              <Archive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Respaldar y Restaurar Base de Datos</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-orange-950/70 text-orange-400 border border-orange-800/40">
                  MariaDB / MySQL
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Herramienta integral para copias de seguridad de alta velocidad y restauración inteligente.
              </p>
            </div>
          </div>

          <button
            onClick={closeBackupRestoreModal}
            disabled={isBusy}
            className="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-[#202738] transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-[#202738] bg-[#111520] px-6">
          <button
            type="button"
            onClick={() => setActiveTab("backup")}
            disabled={isBusy}
            className={`flex items-center space-x-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "backup"
                ? "border-orange-500 text-orange-400 bg-orange-950/20"
                : "border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/30"
            }`}
          >
            <Archive className="w-4 h-4" />
            <span>Respaldar Base de Datos (Backup)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("restore")}
            disabled={isBusy}
            className={`flex items-center space-x-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "restore"
                ? "border-cyan-500 text-cyan-400 bg-cyan-950/20"
                : "border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/30"
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            <span>Restaurar Base de Datos (Restore)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[calc(85vh-160px)] overflow-y-auto">
          {/* ========================================================================= */}
          {/* TAB 1: BACKUP / RESPALDAR */}
          {/* ========================================================================= */}
          {activeTab === "backup" && (
            <div className="space-y-5">
              {/* Backup Error */}
              {backupError && (
                <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-200 text-xs flex items-start space-x-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold block mb-0.5">Error en el respaldo</span>
                    <span className="font-mono text-[11px] break-all">{backupError}</span>
                  </div>
                </div>
              )}

              {/* Backup Success Summary */}
              {backupSummary && (
                <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-700/40 text-emerald-200 text-xs space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between border-b border-emerald-800/30 pb-2">
                    <div className="flex items-center space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="font-bold text-emerald-300 text-sm">
                        ¡Respaldo completado con éxito!
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-emerald-400/80">
                      {backupSummary.duration_ms} ms
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                    <div className="bg-[#0b121c] p-2 rounded border border-emerald-900/40">
                      <span className="text-neutral-400 text-[10px] block">Tablas</span>
                      <span className="font-bold text-white text-sm">
                        {backupSummary.total_tables}
                      </span>
                    </div>
                    <div className="bg-[#0b121c] p-2 rounded border border-emerald-900/40">
                      <span className="text-neutral-400 text-[10px] block">Vistas / Rutinas</span>
                      <span className="font-bold text-white text-sm">
                        {backupSummary.total_views + backupSummary.total_routines}
                      </span>
                    </div>
                    <div className="bg-[#0b121c] p-2 rounded border border-emerald-900/40">
                      <span className="text-neutral-400 text-[10px] block">Filas Volcadas</span>
                      <span className="font-bold text-white text-sm">
                        {backupSummary.total_rows_exported.toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-[#0b121c] p-2 rounded border border-emerald-900/40">
                      <span className="text-neutral-400 text-[10px] block">Tamaño Archivo</span>
                      <span className="font-bold text-white text-sm">
                        {formatBytes(backupSummary.file_size_bytes)}
                      </span>
                    </div>
                  </div>

                  {backupSummary.file_path && (
                    <div className="text-[11px] text-neutral-300 font-mono break-all pt-1 bg-[#0b121c] p-2 rounded border border-emerald-900/30">
                      <span className="text-neutral-400 block text-[10px]">Guardado en:</span>
                      <span className="text-emerald-300 select-all">{backupSummary.file_path}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Source Database Picker */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
                  <span>Base de Datos de Origen</span>
                  <span className="text-[11px] text-neutral-400">
                    Total disponibles: {databases.length}
                  </span>
                </label>
                <select
                  value={backupDb}
                  onChange={(e) => {
                    setBackupDb(e.target.value);
                    setSelectedTables([]);
                  }}
                  disabled={isBusy}
                  className="w-full bg-[#121622] border border-[#242c40] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-orange-500"
                >
                  {databases.map((db) => (
                    <option key={db.name} value={db.name}>
                      {db.name} {db.tables_count ? `(${db.tables_count} tablas)` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Backup Scope: Full vs Selected Tables */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-300">
                  Alcance del Respaldo
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setBackupScope("database")}
                    disabled={isBusy}
                    className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                      backupScope === "database"
                        ? "bg-orange-950/30 border-orange-500/60 text-white shadow-sm ring-1 ring-orange-500/30"
                        : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                    }`}
                  >
                    <Database
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        backupScope === "database" ? "text-orange-400" : "text-neutral-500"
                      }`}
                    />
                    <div>
                      <div className="font-semibold text-xs text-white">
                        Toda la Base de Datos
                      </div>
                      <div className="text-[11px] text-neutral-400 mt-0.5">
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
                        ? "bg-orange-950/30 border-orange-500/60 text-white shadow-sm ring-1 ring-orange-500/30"
                        : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                    }`}
                  >
                    <TableIcon
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        backupScope === "tables" ? "text-orange-400" : "text-neutral-500"
                      }`}
                    />
                    <div>
                      <div className="font-semibold text-xs text-white">
                        Tablas Específicas ({selectedTables.length} selec.)
                      </div>
                      <div className="text-[11px] text-neutral-400 mt-0.5">
                        Elige manualmente las tablas individuales a respaldar.
                      </div>
                    </div>
                  </button>
                </div>

                {/* Table Picker if Scope is 'tables' */}
                {backupScope === "tables" && (
                  <div className="p-3 bg-[#121622] rounded-lg border border-[#202738] space-y-2 animate-in fade-in">
                    <div className="flex items-center justify-between text-xs pb-1 border-b border-[#1c2232]">
                      <span className="text-neutral-300 font-semibold">Seleccionar tablas:</span>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setSelectedTables(currentDbTables.map((t) => t.name))}
                          className="text-[11px] text-orange-400 hover:underline"
                        >
                          Seleccionar todas
                        </button>
                        <span className="text-neutral-600">•</span>
                        <button
                          type="button"
                          onClick={() => setSelectedTables([])}
                          className="text-[11px] text-neutral-400 hover:underline"
                        >
                          Deseleccionar
                        </button>
                      </div>
                    </div>

                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {currentDbTables.length === 0 ? (
                        <div className="text-xs text-neutral-500 italic py-2">
                          No hay tablas disponibles en esta base de datos.
                        </div>
                      ) : (
                        currentDbTables.map((tbl) => {
                          const isChecked = selectedTables.includes(tbl.name);
                          return (
                            <label
                              key={tbl.name}
                              className="flex items-center justify-between p-1.5 rounded hover:bg-[#181e2e] cursor-pointer text-xs"
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
                                  className="w-3.5 h-3.5 rounded bg-[#0b0e14] border-neutral-700 text-orange-600 focus:ring-orange-500"
                                />
                                <span className="text-neutral-200 font-mono">{tbl.name}</span>
                              </div>
                              <span className="text-[10px] text-neutral-400 font-mono">
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
                <label className="text-xs font-semibold text-neutral-300">
                  Tipo de Contenido a Respaldar
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setContentMode("structure_and_data")}
                    disabled={isBusy}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      contentMode === "structure_and_data"
                        ? "bg-orange-600/20 border-orange-500/60 text-white shadow-sm ring-1 ring-orange-500/30"
                        : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                    }`}
                  >
                    <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-orange-400" />
                      <span>Estructura y Datos</span>
                    </div>
                    <div className="text-[10px] text-neutral-400 mt-1">
                      Esquema completo DDL + sentencias INSERT optimizadas.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setContentMode("structure_only")}
                    disabled={isBusy}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      contentMode === "structure_only"
                        ? "bg-orange-600/20 border-orange-500/60 text-white shadow-sm ring-1 ring-orange-500/30"
                        : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                    }`}
                  >
                    <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                      <Settings2 className="w-3.5 h-3.5 text-amber-400" />
                      <span>Solo Estructura (DDL)</span>
                    </div>
                    <div className="text-[10px] text-neutral-400 mt-1">
                      Solo tablas, vistas, índices, funciones y triggers sin registros.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setContentMode("data_only")}
                    disabled={isBusy}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      contentMode === "data_only"
                        ? "bg-orange-600/20 border-orange-500/60 text-white shadow-sm ring-1 ring-orange-500/30"
                        : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                    }`}
                  >
                    <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Solo Datos</span>
                    </div>
                    <div className="text-[10px] text-neutral-400 mt-1">
                      Solo sentencias INSERT múltiples sin definiciones DDL.
                    </div>
                  </button>
                </div>
              </div>

              {/* Advanced SQL Options */}
              <div className="space-y-3 bg-[#121622] p-4 rounded-xl border border-[#202738]">
                <div className="flex items-center space-x-2 text-xs font-semibold text-neutral-200 pb-2 border-b border-[#1f2638]">
                  <Save className="w-4 h-4 text-orange-400" />
                  <span>Opciones Avanzadas del Respaldo</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {backupScope === "database" && (
                    <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                      <input
                        type="checkbox"
                        checked={includeCreateDb}
                        onChange={(e) => setIncludeCreateDb(e.target.checked)}
                        disabled={isBusy}
                        className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500"
                      />
                      <span>
                        Incluir <code className="text-orange-400 text-[11px]">CREATE DATABASE IF NOT EXISTS</code>
                      </span>
                    </label>
                  )}

                  {contentMode !== "data_only" && (
                    <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                      <input
                        type="checkbox"
                        checked={addDropTable}
                        onChange={(e) => setAddDropTable(e.target.checked)}
                        disabled={isBusy}
                        className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500"
                      />
                      <span>
                        Agregar <code className="text-orange-400 text-[11px]">DROP TABLE IF EXISTS</code>
                      </span>
                    </label>
                  )}

                  {backupScope === "database" && contentMode !== "data_only" && (
                    <>
                      <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                        <input
                          type="checkbox"
                          checked={includeViews}
                          onChange={(e) => setIncludeViews(e.target.checked)}
                          disabled={isBusy}
                          className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500"
                        />
                        <span>Incluir Vistas</span>
                      </label>

                      <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                        <input
                          type="checkbox"
                          checked={includeRoutines}
                          onChange={(e) => setIncludeRoutines(e.target.checked)}
                          disabled={isBusy}
                          className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500"
                        />
                        <span>Incluir Procedimientos y Funciones</span>
                      </label>
                    </>
                  )}

                  {contentMode !== "data_only" && (
                    <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                      <input
                        type="checkbox"
                        checked={includeTriggers}
                        onChange={(e) => setIncludeTriggers(e.target.checked)}
                        disabled={isBusy}
                        className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500"
                      />
                      <span>Incluir Triggers</span>
                    </label>
                  )}

                  <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={disableFkChecks}
                      onChange={(e) => setDisableFkChecks(e.target.checked)}
                      disabled={isBusy}
                      className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500"
                    />
                    <span>Desactivar Foreign Keys temporalmente en script</span>
                  </label>
                </div>

                {contentMode !== "structure_only" && (
                  <div className="pt-2 border-t border-[#1f2638] flex items-center justify-between text-xs">
                    <span className="text-neutral-400">Filas por sentencia INSERT múltiple:</span>
                    <select
                      value={insertBatchSize}
                      onChange={(e) => setInsertBatchSize(Number(e.target.value))}
                      disabled={isBusy}
                      className="bg-[#0e111a] border border-[#252c40] rounded px-2.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-orange-500"
                    >
                      <option value={100}>100 filas / INSERT</option>
                      <option value={250}>250 filas / INSERT (Recomendado)</option>
                      <option value={500}>500 filas / INSERT</option>
                      <option value={1000}>1,000 filas / INSERT (Máxima velocidad)</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: RESTORE / RESTAURAR */}
          {/* ========================================================================= */}
          {activeTab === "restore" && (
            <div className="space-y-5">
              {/* Restore Error */}
              {restoreError && (
                <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-200 text-xs flex items-start space-x-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold block mb-0.5">Error en la restauración</span>
                    <span className="font-mono text-[11px] break-all">{restoreError}</span>
                  </div>
                </div>
              )}

              {/* Restore Progress Display */}
              {isRestoring && restoreProgress && (
                <div className="p-4 rounded-xl bg-cyan-950/30 border border-cyan-700/40 text-cyan-200 text-xs space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                      <span className="font-bold text-white text-sm">{restoreProgress.stage}</span>
                    </div>
                    <span className="font-mono text-cyan-300 font-bold">
                      {restoreProgress.percent_complete.toFixed(1)}%
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2 bg-[#0d1522] rounded-full overflow-hidden border border-cyan-900/50">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-600 to-teal-400 transition-all duration-150 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, restoreProgress.percent_complete))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono">
                    <span>Sentencias ejecutadas: {restoreProgress.statements_executed.toLocaleString()}</span>
                    <span>
                      {formatBytes(restoreProgress.bytes_read)} / {formatBytes(restoreProgress.total_bytes)}
                    </span>
                  </div>

                  {restoreProgress.current_statement_preview && (
                    <div className="p-2 rounded bg-[#09101a] border border-cyan-900/40 font-mono text-[10px] text-cyan-300/90 truncate">
                      {restoreProgress.current_statement_preview}
                    </div>
                  )}
                </div>
              )}

              {/* Restore Success / Complete Summary */}
              {restoreSummary && !isRestoring && (
                <div
                  className={`p-4 rounded-xl border text-xs space-y-3 animate-in fade-in ${
                    restoreSummary.failed_statements === 0
                      ? "bg-emerald-950/30 border-emerald-700/40 text-emerald-200"
                      : "bg-amber-950/30 border-amber-700/40 text-amber-200"
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-emerald-800/30 pb-2">
                    <div className="flex items-center space-x-2">
                      {restoreSummary.failed_statements === 0 ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-amber-400" />
                      )}
                      <span className="font-bold text-white text-sm">
                        {restoreSummary.failed_statements === 0
                          ? "¡Restauración completada con éxito!"
                          : "Restauración finalizada con advertencias"}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-neutral-400">
                      {restoreSummary.duration_ms} ms
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                    <div className="bg-[#0b121c] p-2 rounded border border-neutral-800">
                      <span className="text-neutral-400 text-[10px] block">BD Destino</span>
                      <span className="font-bold text-white text-sm truncate block">
                        {restoreSummary.target_database}
                      </span>
                    </div>
                    <div className="bg-[#0b121c] p-2 rounded border border-neutral-800">
                      <span className="text-neutral-400 text-[10px] block">Total Sentencias</span>
                      <span className="font-bold text-white text-sm">
                        {restoreSummary.total_statements.toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-[#0b121c] p-2 rounded border border-neutral-800">
                      <span className="text-neutral-400 text-[10px] block">Exitosas</span>
                      <span className="font-bold text-emerald-400 text-sm">
                        {restoreSummary.successful_statements.toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-[#0b121c] p-2 rounded border border-neutral-800">
                      <span className="text-neutral-400 text-[10px] block">Fallidas</span>
                      <span
                        className={`font-bold text-sm ${
                          restoreSummary.failed_statements === 0
                            ? "text-neutral-400"
                            : "text-rose-400"
                        }`}
                      >
                        {restoreSummary.failed_statements.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Errors details list if any failed */}
                  {restoreSummary.errors.length > 0 && (
                    <div className="mt-2 p-2.5 rounded bg-[#100707] border border-rose-900/50 space-y-1">
                      <span className="text-rose-300 font-semibold text-[11px] block">
                        Detalle de errores ({restoreSummary.errors.length}):
                      </span>
                      <div className="max-h-28 overflow-y-auto space-y-1 text-[10px] font-mono text-rose-200">
                        {restoreSummary.errors.map((err, idx) => (
                          <div key={idx} className="bg-rose-950/40 p-1.5 rounded border border-rose-900/30 break-all">
                            {err}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Source SQL File Selection */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-300">
                  Archivo SQL de Respaldo (.sql)
                </label>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handlePickRestoreFile}
                    disabled={isBusy}
                    className="flex items-center space-x-2 px-3.5 py-2 text-xs font-semibold text-white bg-[#1a2133] hover:bg-[#232c44] border border-[#2a3652] rounded-lg transition-colors shrink-0"
                  >
                    <FolderOpen className="w-4 h-4 text-cyan-400" />
                    <span>Seleccionar Archivo...</span>
                  </button>

                  <div className="flex-1 bg-[#121622] border border-[#242c40] rounded-lg px-3 py-2 text-xs text-neutral-300 font-mono truncate">
                    {restoreFilePath || (
                      <span className="text-neutral-500 italic">Ningún archivo seleccionado</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Target Database Config */}
              <div className="space-y-3 bg-[#121622] p-4 rounded-xl border border-[#202738]">
                <div className="flex items-center space-x-2 text-xs font-semibold text-neutral-200 pb-2 border-b border-[#1f2638]">
                  <Database className="w-4 h-4 text-cyan-400" />
                  <span>Base de Datos de Destino para la Restauración</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRestoreTargetType("existing")}
                    disabled={isBusy}
                    className={`p-3 rounded-lg border text-left flex items-start space-x-2.5 transition-all ${
                      restoreTargetType === "existing"
                        ? "bg-cyan-950/30 border-cyan-500/60 text-white shadow-sm ring-1 ring-cyan-500/30"
                        : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                    }`}
                  >
                    <Database
                      className={`w-4 h-4 shrink-0 mt-0.5 ${
                        restoreTargetType === "existing" ? "text-cyan-400" : "text-neutral-500"
                      }`}
                    />
                    <div>
                      <div className="font-semibold text-xs text-white">
                        Restaurar en BD Existente
                      </div>
                      <div className="text-[10px] text-neutral-400 mt-0.5">
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
                        ? "bg-cyan-950/30 border-cyan-500/60 text-white shadow-sm ring-1 ring-cyan-500/30"
                        : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                    }`}
                  >
                    <Sparkles
                      className={`w-4 h-4 shrink-0 mt-0.5 ${
                        restoreTargetType === "new" ? "text-cyan-400" : "text-neutral-500"
                      }`}
                    />
                    <div>
                      <div className="font-semibold text-xs text-white">
                        Crear Nueva Base de Datos
                      </div>
                      <div className="text-[10px] text-neutral-400 mt-0.5">
                        Crea un nuevo esquema con UTF-8 mb4 antes de restaurar.
                      </div>
                    </div>
                  </button>
                </div>

                {restoreTargetType === "existing" ? (
                  <div className="pt-2 animate-in fade-in">
                    <label className="text-[11px] font-semibold text-neutral-400 block mb-1">
                      Seleccionar Base de Datos Existente:
                    </label>
                    <select
                      value={restoreTargetDb}
                      onChange={(e) => setRestoreTargetDb(e.target.value)}
                      disabled={isBusy}
                      className="w-full bg-[#0e111a] border border-[#252c40] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
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
                    <label className="text-[11px] font-semibold text-neutral-400 block mb-1">
                      Nombre de la nueva Base de Datos a crear:
                    </label>
                    <input
                      type="text"
                      value={newDatabaseName}
                      onChange={(e) => setNewDatabaseName(e.target.value)}
                      placeholder="ej. mi_base_de_datos_restaurada"
                      disabled={isBusy}
                      className="w-full bg-[#0e111a] border border-[#252c40] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                )}
              </div>

              {/* Execution Options */}
              <div className="space-y-3 bg-[#121622] p-4 rounded-xl border border-[#202738]">
                <div className="flex items-center space-x-2 text-xs font-semibold text-neutral-200 pb-2 border-b border-[#1f2638]">
                  <ShieldAlert className="w-4 h-4 text-cyan-400" />
                  <span>Control de Ejecución y Consistencia</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={restoreDisableFk}
                      onChange={(e) => setRestoreDisableFk(e.target.checked)}
                      disabled={isBusy}
                      className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-cyan-600 focus:ring-cyan-500"
                    />
                    <span>Desactivar verificación de Foreign Keys temporalmente</span>
                  </label>

                  <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={restoreStopOnError}
                      onChange={(e) => setRestoreStopOnError(e.target.checked)}
                      disabled={isBusy}
                      className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-cyan-600 focus:ring-cyan-500"
                    />
                    <span>Detener ejecución ante el primer error</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-[#141824] border-t border-[#202738] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={closeBackupRestoreModal}
            disabled={isBusy}
            className="px-4 py-2 text-xs font-semibold text-neutral-400 hover:text-white hover:bg-[#202738] rounded-lg transition-colors disabled:opacity-50"
          >
            Cerrar
          </button>

          {activeTab === "backup" ? (
            <button
              type="button"
              onClick={handleStartBackup}
              disabled={isBusy || !backupDb}
              className="flex items-center space-x-2 px-5 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-500 rounded-lg transition-all shadow-md hover:shadow-orange-600/20 disabled:opacity-50"
            >
              {isBackingUp ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generando Respaldo...</span>
                </>
              ) : (
                <>
                  <Archive className="w-4 h-4" />
                  <span>Iniciar Respaldo (.sql)</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartRestore}
              disabled={
                isBusy ||
                !restoreFilePath ||
                (restoreTargetType === "new" ? !newDatabaseName.trim() : !restoreTargetDb.trim())
              }
              className="flex items-center space-x-2 px-5 py-2 text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-all shadow-md hover:shadow-cyan-600/20 disabled:opacity-50"
            >
              {isRestoring ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Restaurando Base de Datos...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" />
                  <span>Iniciar Restauración (.sql)</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
