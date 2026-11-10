import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type {
  SqlDumpRequest,
  SqlDumpSummary,
  SqlRestoreRequest,
  SqlRestoreProgressEvent,
  SqlRestoreSummary,
  DirectoryBackupOptions,
  DirectoryBackupSummary,
  DirectoryBackupVerificationResult,
  DirectoryRestoreRequest,
  DirectoryRestoreProgressEvent,
  DirectoryRestoreSummary,
  BackupCompressionFormat,
  BackupProfile,
  BackupExecutionRecord,
  SchedulerEventPayload,
  BinlogRequirements,
  BinlogChainCheck,
  BinlogBackupSummary,
  PointInTimeRestoreSummary,
} from "../../types/database";
import { dbService } from "../../services/tauriDb";
import { useSchemaStore } from "../../stores/schemaStore";
import { useUIStore } from "../../stores/uiStore";
import { useCapabilitiesStore } from "../../stores/capabilitiesStore";
import type { TabMode, ExportContentMode } from "./types";



/**
 * State and actions of the backup/restore modal shared by its five tabs:
 * SQL dumps, structured directory backups, restore (incl. point-in-time),
 * verification, scheduled profiles and execution history.
 */
export function useBackupRestore() {
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
  const [includeReplicationCoords, setIncludeReplicationCoords] = useState<boolean>(false);

  const [isBackingUp, setIsBackingUp] = useState<boolean>(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupSummary, setBackupSummary] = useState<SqlDumpSummary | null>(null);
  const [sqliteBackupSuccessPath, setSqliteBackupSuccessPath] = useState<string | null>(null);

  // ─── PHASE 4 STRUCTURED DIRECTORY BACKUP STATE ────────────────────────────
  const [backupFormat, setBackupFormat] = useState<"file" | "directory">("file");
  const [structuredBackupType, setStructuredBackupType] = useState<"full" | "differential" | "incremental_binlog">("full");
  const [backupDir, setBackupDir] = useState<string>("");
  const [baseBackupDir, setBaseBackupDir] = useState<string>("");
  const [compression, setCompression] = useState<BackupCompressionFormat>("zstd");
  const [chunkSizeRows, setChunkSizeRows] = useState<number>(50000);
  const [zstdLevel, setZstdLevel] = useState<number>(3);
  const [dirBackupSummary, setDirBackupSummary] = useState<DirectoryBackupSummary | null>(null);

  // ─── PHASE 4.2 BINLOG INCREMENTAL STATE ────────────────────────────────────
  const [binlogReq, setBinlogReq] = useState<BinlogRequirements | null>(null);
  const [isLoadingBinlogReq, setIsLoadingBinlogReq] = useState<boolean>(false);
  const [binlogChainCheck, setBinlogChainCheck] = useState<BinlogChainCheck | null>(null);
  const [isCheckingChain, setIsCheckingChain] = useState<boolean>(false);
  const [binlogBackupSummary, setBinlogBackupSummary] = useState<BinlogBackupSummary | null>(null);

  // ─── VERIFICATION STATE ───────────────────────────────────────────────────
  const [verifyDir, setVerifyDir] = useState<string>("");
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<DirectoryBackupVerificationResult | null>(null);

  // ─── RESTORE STATE ────────────────────────────────────────────────────────
  const [restoreFormat, setRestoreFormat] = useState<"file" | "directory">("file");
  const [restoreStrategy, setRestoreStrategy] = useState<"snapshot" | "point_in_time">("snapshot");
  const [restoreFilePath, setRestoreFilePath] = useState<string>("");
  const [restoreBackupDir, setRestoreBackupDir] = useState<string>("");
  const [restoreBaseBackupDir, setRestoreBaseBackupDir] = useState<string>("");
  const [restoreIncrementalDirs, setRestoreIncrementalDirs] = useState<string[]>([]);
  const [restoreTargetTimestamp, setRestoreTargetTimestamp] = useState<string>("");
  const [restoreTargetType, setRestoreTargetType] = useState<"existing" | "new">("existing");
  const [restoreTargetDb, setRestoreTargetDb] = useState<string>("");
  const [newDatabaseName, setNewDatabaseName] = useState<string>("");
  const [restoreDisableFk, setRestoreDisableFk] = useState<boolean>(true);
  const [restoreStopOnError, setRestoreStopOnError] = useState<boolean>(false);

  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreProgress, setRestoreProgress] = useState<SqlRestoreProgressEvent | null>(null);
  const [dirRestoreProgress, setDirRestoreProgress] = useState<DirectoryRestoreProgressEvent | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSummary, setRestoreSummary] = useState<SqlRestoreSummary | null>(null);
  const [dirRestoreSummary, setDirRestoreSummary] = useState<DirectoryRestoreSummary | null>(null);
  const [pointInTimeSummary, setPointInTimeSummary] = useState<PointInTimeRestoreSummary | null>(null);

  // ─── PROFILES & AUTOMATION STATE ───────────────────────────────────────────
  const [profiles, setProfiles] = useState<BackupProfile[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState<boolean>(false);
  const [editingProfile, setEditingProfile] = useState<BackupProfile | null>(null);
  const [runningProfileId, setRunningProfileId] = useState<string | null>(null);
  const [enforcingRetentionId, setEnforcingRetentionId] = useState<string | null>(null);
  const [profileActionError, setProfileActionError] = useState<string | null>(null);
  const [profileActionSuccess, setProfileActionSuccess] = useState<string | null>(null);

  // ─── HISTORY STATE ────────────────────────────────────────────────────────
  const [historyRecords, setHistoryRecords] = useState<BackupExecutionRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);

  const loadProfiles = async () => {
    setIsLoadingProfiles(true);
    try {
      const list = await dbService.getBackupProfiles();
      setProfiles(list);
    } catch (err) {
      console.error("Error loading backup profiles:", err);
    } finally {
      setIsLoadingProfiles(false);
    }
  };

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const list = await dbService.getBackupHistory(100);
      setHistoryRecords(list);
    } catch (err) {
      console.error("Error loading backup history:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

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
      setDirBackupSummary(null);
      setIncludeReplicationCoords(false);
      setSqliteBackupSuccessPath(null);
      setRestoreFilePath("");
      setRestoreBackupDir("");
      setRestoreBaseBackupDir("");
      setRestoreProgress(null);
      setDirRestoreProgress(null);
      setRestoreError(null);
      setRestoreSummary(null);
      setDirRestoreSummary(null);
      setNewDatabaseName("");
      setVerifyError(null);
      setVerifyResult(null);
      setEditingProfile(null);
      setProfileActionError(null);
      setProfileActionSuccess(null);

      if (defaultDb && (!tables[defaultDb] || tables[defaultDb].length === 0)) {
        void loadSchemaObjects(defaultDb);
      }

      if (!isSqlite) {
        void loadProfiles();
        void loadHistory();
      }
    }
  }, [
    isBackupRestoreModalOpen,
    backupRestoreInitialTab,
    backupRestoreTargetDatabase,
    selectedDatabase,
    databases,
    isSqlite,
  ]);

  // Load tables when backup DB changes
  useEffect(() => {
    if (backupDb && (!tables[backupDb] || tables[backupDb].length === 0)) {
      void loadSchemaObjects(backupDb);
    }
  }, [backupDb]);

  // Tauri Progress & Scheduler Event Listeners
  useEffect(() => {
    let unlistenSql: (() => void) | undefined;
    let unlistenDir: (() => void) | undefined;
    let unlistenScheduler: (() => void) | undefined;

    if (isBackupRestoreModalOpen) {
      void listen<SqlRestoreProgressEvent>("sql-restore-progress", (event) => {
        setRestoreProgress(event.payload);
      }).then((fn) => {
        unlistenSql = fn;
      });

      void listen<DirectoryRestoreProgressEvent>("directory-restore-progress", (event) => {
        setDirRestoreProgress(event.payload);
      }).then((fn) => {
        unlistenDir = fn;
      });

      void listen<SchedulerEventPayload>("backup-scheduler-event", () => {
        void loadProfiles();
        void loadHistory();
      }).then((fn) => {
        unlistenScheduler = fn;
      });
    }

    return () => {
      if (unlistenSql) unlistenSql();
      if (unlistenDir) unlistenDir();
      if (unlistenScheduler) unlistenScheduler();
    };
  }, [isBackupRestoreModalOpen]);

  const isBusy =
    isBackingUp ||
    isRestoring ||
    isVerifying ||
    runningProfileId !== null ||
    enforcingRetentionId !== null;

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

  const handleNewProfile = () => {
    setEditingProfile({
      id: `bp-${Date.now()}`,
      name: "",
      connection_id: "default",
      database: backupDb || (databases.length > 0 ? databases[0].name : ""),
      target_dir: backupDir || "",
      backup_format: "directory",
      structured_type: "full",
      base_backup_dir: undefined,
      compression: "zstd",
      zstd_level: 3,
      chunk_size_rows: 50000,
      include_views: true,
      include_routines: true,
      include_triggers: true,
      schedule_enabled: true,
      schedule_interval_hours: 24,
      retention_max_backups: 5,
      retention_max_days: 30,
      created_at: new Date().toISOString(),
    });
    setProfileActionError(null);
    setProfileActionSuccess(null);
  };

  const handleEditProfile = (profile: BackupProfile) => {
    setEditingProfile({ ...profile });
    setProfileActionError(null);
    setProfileActionSuccess(null);
  };

  const handlePickProfileTargetDir = async () => {
    if (!editingProfile) return;
    try {
      const dir = await dbService.pickBackupDirectoryDialog(editingProfile.target_dir || undefined);
      if (dir) {
        setEditingProfile({ ...editingProfile, target_dir: dir });
      }
    } catch (err) {
      console.error("Error picking profile target directory:", err);
    }
  };

  const handleSaveProfile = async () => {
    if (!editingProfile) return;
    if (!editingProfile.name.trim()) {
      setProfileActionError("Por favor ingresa un nombre para el perfil.");
      return;
    }
    if (!editingProfile.database.trim()) {
      setProfileActionError("Por favor selecciona una base de datos para el perfil.");
      return;
    }
    if (!editingProfile.target_dir.trim()) {
      setProfileActionError("Por favor especifica un directorio de destino para los respaldos.");
      return;
    }

    try {
      setProfileActionError(null);
      await dbService.saveBackupProfile(editingProfile);
      setProfileActionSuccess(`Perfil "${editingProfile.name}" guardado correctamente.`);
      setEditingProfile(null);
      await loadProfiles();
    } catch (err) {
      console.error("Error saving backup profile:", err);
      setProfileActionError(
        typeof err === "string" ? err : (err as Error)?.message || "Error al guardar el perfil."
      );
    }
  };

  const handleDeleteProfile = (profile: BackupProfile) => {
    useUIStore.getState().showConfirm({
      title: "Eliminar Perfil de Respaldo",
      message: `¿Estás seguro de que deseas eliminar el perfil "${profile.name}"? Los respaldos existentes en disco no se borrarán.`,
      confirmText: "Eliminar",
      variant: "danger",
      onConfirm: async () => {
        try {
          await dbService.deleteBackupProfile(profile.id);
          setProfileActionSuccess(`Perfil "${profile.name}" eliminado.`);
          await loadProfiles();
        } catch (err) {
          console.error("Error deleting profile:", err);
          setProfileActionError(
            typeof err === "string" ? err : (err as Error)?.message || "Error al eliminar el perfil."
          );
        }
      },
    });
  };

  const handleRunProfile = async (profile: BackupProfile) => {
    setRunningProfileId(profile.id);
    setProfileActionError(null);
    setProfileActionSuccess(null);
    try {
      await dbService.runBackupProfile(profile.id);
      setProfileActionSuccess(`Respaldo ejecutado exitosamente para el perfil "${profile.name}".`);
      await loadProfiles();
      await loadHistory();
    } catch (err) {
      console.error("Error running backup profile:", err);
      setProfileActionError(
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al ejecutar el perfil de respaldo."
      );
    } finally {
      setRunningProfileId(null);
    }
  };

  const handleEnforceRetention = async (profile: BackupProfile) => {
    setEnforcingRetentionId(profile.id);
    setProfileActionError(null);
    setProfileActionSuccess(null);
    try {
      const res = await dbService.enforceProfileRetention(profile.id);
      let msg = `Retención aplicada: ${res.deleted_backups} copias purgadas (${formatBytes(res.freed_bytes)} liberados).`;
      if (res.protected_base_backups > 0) {
        msg += ` ${res.protected_base_backups} respaldos base protegidos contra purga por dependencias activas.`;
      }
      setProfileActionSuccess(msg);
      await loadProfiles();
    } catch (err) {
      console.error("Error enforcing profile retention:", err);
      setProfileActionError(
        typeof err === "string" ? err : (err as Error)?.message || "Error al aplicar retención."
      );
    } finally {
      setEnforcingRetentionId(null);
    }
  };

  const handleClearHistory = () => {
    useUIStore.getState().showConfirm({
      title: "Limpiar Historial de Respaldos",
      message: "¿Deseas eliminar todo el historial de registros de ejecución de respaldos?",
      confirmText: "Limpiar historial",
      variant: "danger",
      onConfirm: async () => {
        try {
          await dbService.clearBackupHistory();
          await loadHistory();
        } catch (err) {
          console.error("Error clearing backup history:", err);
        }
      },
    });
  };


  const currentDbTables = backupDb ? tables[backupDb] || [] : [];

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handlePickBackupDir = async () => {
    try {
      const dir = await dbService.pickBackupDirectoryDialog(backupDir || undefined);
      if (dir) {
        setBackupDir(dir);
        setBackupError(null);
      }
    } catch (err) {
      console.error("Error picking backup directory:", err);
    }
  };

  const handlePickVerifyDir = async () => {
    try {
      const dir = await dbService.pickBackupDirectoryDialog(verifyDir || undefined);
      if (dir) {
        setVerifyDir(dir);
        setVerifyError(null);
        setVerifyResult(null);
      }
    } catch (err) {
      console.error("Error picking verify dir:", err);
    }
  };

  const handleCheckBinlogReq = async () => {
    setIsLoadingBinlogReq(true);
    try {
      const req = await dbService.checkBinlogRequirements();
      setBinlogReq(req);
    } catch (err) {
      console.error("Error checking binlog requirements:", err);
    } finally {
      setIsLoadingBinlogReq(false);
    }
  };

  const handleVerifyChain = async (baseDir: string) => {
    if (!baseDir.trim()) return;
    setIsCheckingChain(true);
    try {
      const res = await dbService.verifyBinlogChain(baseDir.trim());
      setBinlogChainCheck(res);
    } catch (err) {
      console.error("Error verifying binlog chain:", err);
      setBinlogChainCheck({
        is_valid: false,
        base_file: "",
        base_pos: 0,
        current_file: "",
        current_pos: 0,
        missing_file: undefined,
        message: typeof err === "string" ? err : (err as Error)?.message || "Error al verificar cadena binlog.",
      });
    } finally {
      setIsCheckingChain(false);
    }
  };

  const handlePickBaseBackupDir = async () => {
    try {
      const dir = await dbService.pickBackupDirectoryDialog(baseBackupDir || undefined);
      if (dir) {
        setBaseBackupDir(dir);
        setBackupError(null);
        if (structuredBackupType === "incremental_binlog") {
          void handleVerifyChain(dir);
        }
      }
    } catch (err) {
      console.error("Error picking base backup directory:", err);
    }
  };

  const handlePickRestoreBackupDir = async () => {
    try {
      const dir = await dbService.pickBackupDirectoryDialog(restoreBackupDir || undefined);
      if (dir) {
        setRestoreBackupDir(dir);
        setRestoreError(null);
      }
    } catch (err) {
      console.error("Error picking restore backup directory:", err);
    }
  };

  const handlePickRestoreBaseDir = async () => {
    try {
      const dir = await dbService.pickBackupDirectoryDialog(restoreBaseBackupDir || undefined);
      if (dir) {
        setRestoreBaseBackupDir(dir);
        setRestoreError(null);
      }
    } catch (err) {
      console.error("Error picking restore base backup directory:", err);
    }
  };

  const handlePickRestoreIncrementalDir = async () => {
    try {
      const dir = await dbService.pickBackupDirectoryDialog();
      if (dir && !restoreIncrementalDirs.includes(dir)) {
        setRestoreIncrementalDirs((prev) => [...prev, dir]);
        setRestoreError(null);
      }
    } catch (err) {
      console.error("Error picking incremental restore directory:", err);
    }
  };

  const handleRemoveIncrementalDir = (idx: number) => {
    setRestoreIncrementalDirs((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleStartVerify = async () => {
    if (!verifyDir) {
      setVerifyError("Por favor selecciona una carpeta de respaldo estructurado.");
      return;
    }
    setVerifyError(null);
    setVerifyResult(null);
    setIsVerifying(true);
    try {
      const res = await dbService.verifyDirectoryBackup(verifyDir);
      setVerifyResult(res);
    } catch (err: unknown) {
      setVerifyError(
        typeof err === "string" ? err : (err as Error)?.message || "Error al verificar el respaldo."
      );
    } finally {
      setIsVerifying(false);
    }
  };

  // ─── BACKUP HANDLER ───────────────────────────────────────────────────────
  const handleStartBackup = async () => {
    if (isSqlite) {
      setBackupError(null);
      setBackupSummary(null);
      setDirBackupSummary(null);
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
    setDirBackupSummary(null);
    setBinlogBackupSummary(null);
    setSqliteBackupSuccessPath(null);

    // Phase 4 Directory Backup
    if (backupFormat === "directory") {
      let targetPath = backupDir;
      if (!targetPath) {
        targetPath = (await dbService.pickBackupDirectoryDialog()) || "";
        if (!targetPath) {
          return;
        }
        setBackupDir(targetPath);
      }

      if (structuredBackupType === "differential" && !baseBackupDir.trim()) {
        setBackupError("Por favor selecciona la carpeta del respaldo base para el modo diferencial.");
        return;
      }

      if (structuredBackupType === "incremental_binlog") {
        if (!baseBackupDir.trim()) {
          setBackupError("Por favor selecciona la carpeta del respaldo base para el modo incremental binlog.");
          return;
        }

        setIsBackingUp(true);
        try {
          const res = await dbService.executeBinlogBackup({
            database: backupDb,
            base_backup_dir: baseBackupDir.trim(),
            output_dir: targetPath,
            compression,
          });
          setBinlogBackupSummary(res);
        } catch (err: unknown) {
          console.error("Binlog backup error:", err);
          setBackupError(
            typeof err === "string"
              ? err
              : (err as Error)?.message || "Ocurrió un error al generar el respaldo incremental binlog."
          );
        } finally {
          setIsBackingUp(false);
        }
        return;
      }

      setIsBackingUp(true);
      try {
        const options: DirectoryBackupOptions = {
          database: backupDb,
          target_dir: targetPath,
          backup_type:
            structuredBackupType === "differential"
              ? "differential"
              : contentMode === "structure_only"
              ? "schema_only"
              : contentMode === "data_only"
              ? "data_only"
              : "full",
          base_backup_dir:
            structuredBackupType === "differential" && baseBackupDir.trim()
              ? baseBackupDir.trim()
              : undefined,
          compression,
          chunk_size_rows: chunkSizeRows,
          tables: backupScope === "tables" ? selectedTables : undefined,
          include_views: includeViews && backupScope === "database",
          include_routines: includeRoutines && backupScope === "database",
          include_triggers: includeTriggers,
          max_parallel_tables: 4,
          zstd_level: zstdLevel,
          include_replication_coordinates: includeReplicationCoords,
        };

        const result = await dbService.executeDirectoryBackup(options);
        setDirBackupSummary(result);
      } catch (err: unknown) {
        console.error("Directory backup error:", err);
        setBackupError(
          typeof err === "string"
            ? err
            : (err as Error)?.message || "Ocurrió un error al generar el respaldo estructurado."
        );
      } finally {
        setIsBackingUp(false);
      }
      return;
    }

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
        include_replication_coordinates: includeReplicationCoords,
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
    const effectiveTargetDb =
      restoreTargetType === "new" ? newDatabaseName.trim() : restoreTargetDb.trim();

    if (!effectiveTargetDb) {
      setRestoreError("Por favor especifica la base de datos de destino.");
      return;
    }

    if (restoreFormat === "directory") {
      if (restoreStrategy === "point_in_time") {
        if (!restoreBaseBackupDir.trim()) {
          setRestoreError("Por favor selecciona la carpeta del respaldo base para Point-in-Time.");
          return;
        }
        if (restoreIncrementalDirs.length === 0) {
          setRestoreError("Por favor agrega al menos una carpeta de respaldo incremental.");
          return;
        }

        setRestoreError(null);
        setPointInTimeSummary(null);
        setDirRestoreSummary(null);
        setIsRestoring(true);

        try {
          const req = {
            base_backup_dir: restoreBaseBackupDir.trim(),
            incremental_dirs: restoreIncrementalDirs,
            target_database: effectiveTargetDb,
            create_database_if_not_exists: restoreTargetType === "new",
            target_timestamp: restoreTargetTimestamp.trim() || undefined,
            disable_foreign_keys: restoreDisableFk,
            stop_on_error: restoreStopOnError,
          };

          const summary = await dbService.executePointInTimeRestore(req);
          setPointInTimeSummary(summary);

          void loadDatabases();
          if (effectiveTargetDb) {
            void loadSchemaObjects(effectiveTargetDb);
          }
        } catch (err: unknown) {
          console.error("Point-in-time restore error:", err);
          setRestoreError(
            typeof err === "string"
              ? err
              : (err as Error)?.message || "Ocurrió un error en la recuperación point-in-time."
          );
        } finally {
          setIsRestoring(false);
        }
        return;
      }

      if (!restoreBackupDir.trim()) {
        setRestoreError("Por favor selecciona una carpeta de respaldo estructurado.");
        return;
      }

      setRestoreError(null);
      setDirRestoreSummary(null);
      setPointInTimeSummary(null);
      setDirRestoreProgress(null);
      setIsRestoring(true);

      try {
        const req: DirectoryRestoreRequest = {
          backup_dir: restoreBackupDir.trim(),
          base_backup_dir: restoreBaseBackupDir.trim() ? restoreBaseBackupDir.trim() : undefined,
          target_database: effectiveTargetDb,
          create_database_if_not_exists: restoreTargetType === "new",
          disable_foreign_keys: restoreDisableFk,
          stop_on_error: restoreStopOnError,
        };

        const summary = await dbService.executeDirectoryRestore(req);
        setDirRestoreSummary(summary);

        void loadDatabases();
        if (effectiveTargetDb) {
          void loadSchemaObjects(effectiveTargetDb);
        }
      } catch (err: unknown) {
        console.error("Directory restore error:", err);
        setRestoreError(
          typeof err === "string"
            ? err
            : (err as Error)?.message || "Ocurrió un error al restaurar el respaldo estructurado."
        );
      } finally {
        setIsRestoring(false);
      }
      return;
    }

    if (!restoreFilePath) {
      setRestoreError("Por favor selecciona un archivo SQL de respaldo.");
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


  return {
    isBackupRestoreModalOpen,
    activeTab,
    addDropTable,
    backupDb,
    backupDir,
    backupError,
    backupFormat,
    backupScope,
    backupSummary,
    baseBackupDir,
    binlogBackupSummary,
    binlogChainCheck,
    binlogReq,
    chunkSizeRows,
    closeBackupRestoreModal,
    compression,
    contentMode,
    currentDbTables,
    databases,
    dirBackupSummary,
    dirRestoreProgress,
    dirRestoreSummary,
    disableFkChecks,
    editingProfile,
    enforcingRetentionId,
    formatBytes,
    handleCheckBinlogReq,
    handleClearHistory,
    handleDeleteProfile,
    handleEditProfile,
    handleEnforceRetention,
    handleNewProfile,
    handlePickBackupDir,
    handlePickBaseBackupDir,
    handlePickProfileTargetDir,
    handlePickRestoreBackupDir,
    handlePickRestoreBaseDir,
    handlePickRestoreFile,
    handlePickRestoreIncrementalDir,
    handlePickVerifyDir,
    handleRemoveIncrementalDir,
    handleRunProfile,
    handleSaveProfile,
    handleStartBackup,
    handleStartRestore,
    handleStartVerify,
    handleVerifyChain,
    historyRecords,
    includeCreateDb,
    includeReplicationCoords,
    includeRoutines,
    includeTriggers,
    includeViews,
    insertBatchSize,
    isBackingUp,
    isBusy,
    isCheckingChain,
    isLoadingBinlogReq,
    isLoadingHistory,
    isLoadingProfiles,
    isRestoring,
    isSqlite,
    isVerifying,
    loadHistory,
    loadProfiles,
    newDatabaseName,
    openConnectModal,
    pointInTimeSummary,
    profileActionError,
    profileActionSuccess,
    profiles,
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
    runningProfileId,
    selectedTables,
    setActiveTab,
    setAddDropTable,
    setBackupDb,
    setBackupDir,
    setBackupFormat,
    setBackupScope,
    setBaseBackupDir,
    setChunkSizeRows,
    setCompression,
    setContentMode,
    setDisableFkChecks,
    setEditingProfile,
    setIncludeCreateDb,
    setIncludeReplicationCoords,
    setIncludeRoutines,
    setIncludeTriggers,
    setIncludeViews,
    setInsertBatchSize,
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
    setSelectedTables,
    setStructuredBackupType,
    setVerifyDir,
    setZstdLevel,
    sqliteBackupSuccessPath,
    structuredBackupType,
    verifyDir,
    verifyError,
    verifyResult,
    zstdLevel,
  };
}

export type BackupRestoreState = ReturnType<typeof useBackupRestore>;
