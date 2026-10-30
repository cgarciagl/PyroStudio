import React, { useState, useEffect } from "react";
import {
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
import { useCapabilitiesStore } from "../stores/capabilitiesStore";
import { primaryBtn, secondaryBtn } from "./ui/styles";
import { Modal } from "./ui/Modal";

type TabMode = "backup" | "restore";
type ExportContentMode = "structure_and_data" | "structure_only" | "data_only";

export const BackupRestoreModal: React.FC = () => {
  const {
    isBackupRestoreModalOpen,
    backupRestoreInitialTab,
    backupRestoreTargetDatabase,
    closeBackupRestoreModal,
    openConnectModal,
  } = useUIStore();

  const { capabilities } = useCapabilitiesStore();
  const isSqlite = capabilities?.engine === "sqlite";

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
  const [sqliteBackupSuccessPath, setSqliteBackupSuccessPath] = useState<string | null>(null);

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
      setSqliteBackupSuccessPath(null);
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

  const isBusy = isBackingUp || isRestoring;

  useEffect(() => {
    if (!isBackupRestoreModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isBusy) {
        closeBackupRestoreModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBackupRestoreModalOpen, isBusy, closeBackupRestoreModal]);

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
    if (isSqlite) {
      setBackupError(null);
      setBackupSummary(null);
      setSqliteBackupSuccessPath(null);

      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace("T", "_")
        .slice(0, 15);
      const cleanDbName = (backupDb || "sqlite").replace(/[^a-zA-Z0-9_-]/g, "_");
      const defaultFilename = `${cleanDbName}_backup_${timestamp}.sqlite3`;

      try {
        const savePath = await dbService.saveSqliteBackupDialog(defaultFilename);
        if (!savePath) {
          return;
        }

        setIsBackingUp(true);
        await dbService.backupSqlite(savePath);
        setSqliteBackupSuccessPath(savePath);
      } catch (err: unknown) {
        console.error("SQLite backup error:", err);
        setBackupError(
          typeof err === "string"
            ? err
            : (err as Error)?.message || "Ocurrió un error al generar la copia de seguridad SQLite."
        );
      } finally {
        setIsBackingUp(false);
      }
      return;
    }

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
    setSqliteBackupSuccessPath(null);

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

  return (
    <Modal
      isOpen={true}
      onClose={closeBackupRestoreModal}
      title={<><span>Respaldar y Restaurar Base de Datos</span> <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-accent-soft text-accent-text border border-accent/30">{isSqlite ? "SQLite" : "MariaDB / MySQL"}</span></>}
      subtitle={<>{isSqlite ? "Copia de seguridad consistente mediante VACUUM INTO y gestión de archivos." : "Herramienta integral para copias de seguridad de alta velocidad y restauración inteligente."}</>}
      icon={<Archive className="w-5 h-5" />}
      size="md"
      bodyClassName="flex flex-col overflow-hidden"
    >
      <div className="flex border-b border-line bg-raised px-6">
          <button
            type="button"
            onClick={() => setActiveTab("backup")}
            disabled={isBusy}
            className={`flex items-center space-x-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "backup"
                ? "border-accent text-accent-text bg-accent-soft"
                : "border-transparent text-fg-muted hover:text-fg hover:bg-hover"
            }`}
          >
            <Archive className="w-4 h-4" />
            <span>Respaldar base de datos</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("restore")}
            disabled={isBusy}
            className={`flex items-center space-x-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "restore"
                ? "border-line text-fg-muted bg-raised"
                : "border-transparent text-fg-muted hover:text-fg hover:bg-hover"
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            <span>Restaurar base de datos</span>
          </button>
        </div>
<div className="p-6 space-y-5 max-h-[calc(85vh-160px)] overflow-y-auto">
          {/* ========================================================================= */}
          {/* TAB 1: BACKUP / RESPALDAR */}
          {/* ========================================================================= */}
          {activeTab === "backup" && (
            <div className="space-y-5">
              {/* Backup Error */}
              {backupError && (
                <div className="p-3.5 rounded-lg border border-line text-rose-200 text-xs flex items-start space-x-2.5">
                  <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold block mb-0.5">Error en el respaldo</span>
                    <span className="font-mono text-[11px] break-all">{backupError}</span>
                  </div>
                </div>
              )}

              {/* Backup Success Summary */}
              {backupSummary && (
                <div className="p-4 rounded-lg border border-line text-fg text-xs space-y-2.5">
                  <div className="flex items-center justify-between border-b border-emerald-800/30 pb-2">
                    <div className="flex items-center space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span className="font-bold text-success text-sm">
                        ¡Respaldo completado con éxito!
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-success/80">
                      {backupSummary.duration_ms} ms
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                    <div className="bg-canvas p-2 rounded border border-emerald-900/40">
                      <span className="text-fg-muted text-[11px] block">Tablas</span>
                      <span className="font-bold text-fg text-sm">
                        {backupSummary.total_tables}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-emerald-900/40">
                      <span className="text-fg-muted text-[11px] block">Vistas / Rutinas</span>
                      <span className="font-bold text-fg text-sm">
                        {backupSummary.total_views + backupSummary.total_routines}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-emerald-900/40">
                      <span className="text-fg-muted text-[11px] block">Filas Volcadas</span>
                      <span className="font-bold text-fg text-sm">
                        {backupSummary.total_rows_exported.toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-emerald-900/40">
                      <span className="text-fg-muted text-[11px] block">Tamaño Archivo</span>
                      <span className="font-bold text-fg text-sm">
                        {formatBytes(backupSummary.file_size_bytes)}
                      </span>
                    </div>
                  </div>

                  {backupSummary.file_path && (
                    <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2 rounded border border-emerald-900/30">
                      <span className="text-fg-muted block text-[11px]">Guardado en:</span>
                      <span className="text-success select-all">{backupSummary.file_path}</span>
                    </div>
                  )}
                </div>
              )}

              {/* SQLite Backup Success Summary */}
              {sqliteBackupSuccessPath && (
                <div className="p-4 rounded-lg border border-line text-fg text-xs space-y-2.5">
                  <div className="flex items-center space-x-2 border-b border-line pb-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="font-semibold text-fg text-sm">
                      Copia de seguridad SQLite completada
                    </span>
                  </div>

                  <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2.5 rounded border border-line">
                    <span className="text-fg-muted block text-[11px]">Guardado en:</span>
                    <span className="text-fg select-all">{sqliteBackupSuccessPath}</span>
                  </div>

                  <p className="text-[11px] text-fg-muted pt-1 leading-relaxed">
                    El comando <code className="text-accent-text font-mono">VACUUM INTO</code> generó una copia limpia, idéntica y defragmentada de la base de datos sin alterar la base de datos activa ni bloquear lecturas.
                  </p>
                </div>
              )}

              {isSqlite ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-line bg-raised space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <Database className="w-5 h-5 text-accent-text shrink-0" />
                      <div>
                        <h4 className="text-xs font-semibold text-fg">Respaldo en caliente</h4>
                        <p className="text-[11px] text-fg-muted">
                          SQLite produce una instantánea consistente y optimizada de toda la base de datos.
                        </p>
                      </div>
                    </div>
                    <div className="text-xs text-fg-muted space-y-2 border-t border-line pt-3 leading-relaxed">
                      <p>
                        A diferencia de los volcados SQL tradicionales, <strong className="text-fg">VACUUM INTO</strong> genera directamente un archivo de base de datos SQLite binario completo y optimizado.
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-[11px]">
                        <li>No bloquea lecturas concurrentes durante la copia.</li>
                        <li>Incluye automáticamente todas las tablas ({currentDbTables.length}), índices, vistas y esquemas.</li>
                        <li>Desfragmenta el archivo resultante para un tamaño mínimo en disco.</li>
                      </ul>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-fg">Base de Datos de Origen</label>
                    <div className="p-3 bg-surface border border-line rounded-lg font-mono text-xs text-fg flex items-center justify-between">
                      <span className="truncate">{backupDb || "main"}</span>
                      <span className="text-[11px] text-fg-muted font-sans shrink-0 ml-2">
                        {currentDbTables.length} tablas detectadas
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <>

              {/* Source Database Picker */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-fg flex items-center justify-between">
                  <span>Base de Datos de Origen</span>
                  <span className="text-[11px] text-fg-muted">
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
                  className="w-full bg-raised border border-line rounded-lg px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-accent"
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
          )}
        </div>
      )}

          {/* ========================================================================= */}
          {/* TAB 2: RESTORE / RESTAURAR */}
          {/* ========================================================================= */}
          {activeTab === "restore" && (
            <div className="space-y-5">
              {/* Restore Error */}
              {restoreError && (
                <div className="p-3.5 rounded-lg border border-line text-rose-200 text-xs flex items-start space-x-2.5">
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

              {/* Restore Success / Complete Summary */}
              {restoreSummary && !isRestoring && (
                <div
                  className={`p-4 rounded-xl border text-xs space-y-3 animate-in fade-in ${
                    restoreSummary.failed_statements === 0
                      ? "border-line text-emerald-200"
                      : "border-line text-amber-200"
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-emerald-800/30 pb-2">
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
                    <div className="mt-2 p-2.5 rounded bg-canvas border border-rose-900/50 space-y-1">
                      <span className="text-danger font-semibold text-[11px] block">
                        Detalle de errores ({restoreSummary.errors.length}):
                      </span>
                      <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] font-mono text-rose-200">
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
              {/* Source SQL File Selection */}
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
      )}
        </div>
<div className="px-6 py-4 bg-raised border-t border-line flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={closeBackupRestoreModal}
            disabled={isBusy}
            className={secondaryBtn}
          >
            Cerrar
          </button>

          {activeTab === "backup" ? (
            <button
              type="button"
              onClick={handleStartBackup}
              disabled={isBusy || (!isSqlite && !backupDb)}
              className={primaryBtn}
            >
              {isBackingUp ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isSqlite ? "Creando copia SQLite..." : "Generando Respaldo..."}</span>
                </>
              ) : (
                <>
                  <Archive className="w-4 h-4" />
                  <span>{isSqlite ? "Crear copia SQLite (.sqlite3)" : "Iniciar Respaldo (.sql)"}</span>
                </>
              )}
            </button>
          ) : isSqlite ? (
            <button
              type="button"
              onClick={() => {
                closeBackupRestoreModal();
                openConnectModal();
              }}
              className={primaryBtn}
            >
              <FolderOpen className="w-4 h-4" />
              <span>Gestionar Conexiones SQLite</span>
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
              className={primaryBtn}
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
    </Modal>
  );
};
