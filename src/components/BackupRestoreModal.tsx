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
  ShieldCheck,
  Layers,
  Sparkles,
  Settings2,
  Save,
  FileCheck,
  HardDrive,
  Calendar,
  History as HistoryIcon,
  Play,
  Trash2,
  Edit3,
  Plus,
  RefreshCw,
  Clock,
  GitBranch,
} from "lucide-react";
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
} from "../types/database";
import { dbService } from "../services/tauriDb";
import { useSchemaStore } from "../stores/schemaStore";
import { useUIStore } from "../stores/uiStore";
import { useCapabilitiesStore } from "../stores/capabilitiesStore";
import {
  primaryBtn,
  secondaryBtn,
  dangerGhostBtn,
  ghostBtn,
  iconBtn,
  inputClass,
  selectClass,
  fieldLabel,
  cardClass,
} from "./ui/styles";
import { Modal, EmptyState, Spinner } from "./ui/Modal";

type TabMode = "backup" | "restore" | "profiles" | "history" | "verify";
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

  if (!isBackupRestoreModalOpen) return null;

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

  return (
    <Modal
      isOpen={true}
      onClose={closeBackupRestoreModal}
      title={<><span>Respaldar y Restaurar Base de Datos</span> <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-accent-soft text-accent-text border border-accent/30">{isSqlite ? "SQLite" : "MariaDB / MySQL"}</span></>}
      subtitle={<>{isSqlite ? "Copia de seguridad consistente mediante VACUUM INTO y gestión de archivos." : "Herramienta integral para copias de seguridad de alta velocidad y restauración inteligente."}</>}
      icon={<Archive className="w-5 h-5" />}
      size="lg"
      bodyClassName="pyro-operation-modal flex flex-col overflow-hidden"
    >
      <div className="flex border-b border-line bg-raised px-6 overflow-x-auto">
        <button
          type="button"
          onClick={() => {
            setActiveTab("backup");
            setEditingProfile(null);
          }}
          disabled={isBusy}
          className={`flex items-center space-x-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all shrink-0 ${
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
          onClick={() => {
            setActiveTab("restore");
            setEditingProfile(null);
          }}
          disabled={isBusy}
          className={`flex items-center space-x-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all shrink-0 ${
            activeTab === "restore"
              ? "border-accent text-accent-text bg-accent-soft"
              : "border-transparent text-fg-muted hover:text-fg hover:bg-hover"
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Restaurar base de datos</span>
        </button>

        {!isSqlite && (
          <>
            <button
              type="button"
              onClick={() => {
                setActiveTab("profiles");
                setEditingProfile(null);
                void loadProfiles();
              }}
              disabled={isBusy}
              className={`flex items-center space-x-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all shrink-0 ${
                activeTab === "profiles"
                  ? "border-accent text-accent-text bg-accent-soft"
                  : "border-transparent text-fg-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Perfiles y Programación</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("history");
                setEditingProfile(null);
                void loadHistory();
              }}
              disabled={isBusy}
              className={`flex items-center space-x-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all shrink-0 ${
                activeTab === "history"
                  ? "border-accent text-accent-text bg-accent-soft"
                  : "border-transparent text-fg-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <HistoryIcon className="w-4 h-4" />
              <span>Historial</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("verify");
                setEditingProfile(null);
              }}
              disabled={isBusy}
              className={`flex items-center space-x-2 py-3 px-4 text-xs font-semibold border-b-2 transition-all shrink-0 ${
                activeTab === "verify"
                  ? "border-accent text-accent-text bg-accent-soft"
                  : "border-transparent text-fg-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <FileCheck className="w-4 h-4" />
              <span>Verificar integridad</span>
            </button>
          </>
        )}
      </div>
<div className="p-6 space-y-5 max-h-[calc(85vh-160px)] overflow-y-auto">
          {/* ========================================================================= */}
          {/* TAB 1: BACKUP / RESPALDAR */}
          {/* ========================================================================= */}
          {activeTab === "backup" && (
            <div className="space-y-5">
              {/* Backup Error */}
              {backupError && (
                <div className="p-3.5 rounded-lg border border-line text-danger text-xs flex items-start space-x-2.5">
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
                  <div className="flex items-center justify-between border-b border-line pb-2">
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
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[11px] block">Tablas</span>
                      <span className="font-bold text-fg text-sm">
                        {backupSummary.total_tables}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[11px] block">Vistas / Rutinas</span>
                      <span className="font-bold text-fg text-sm">
                        {backupSummary.total_views + backupSummary.total_routines}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[11px] block">Filas Volcadas</span>
                      <span className="font-bold text-fg text-sm">
                        {backupSummary.total_rows_exported.toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[11px] block">Tamaño Archivo</span>
                      <span className="font-bold text-fg text-sm">
                        {formatBytes(backupSummary.file_size_bytes)}
                      </span>
                    </div>
                  </div>

                  {backupSummary.file_path && (
                    <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted block text-[11px]">Guardado en:</span>
                      <span className="text-success select-all">{backupSummary.file_path}</span>
                    </div>
                  )}

                  {/* Snapshot status and Binlog coordinates */}
                  {backupSummary.consistent_snapshot && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium bg-accent-soft text-accent-text border border-accent/20">
                        <ShieldCheck className="w-3 h-3 text-accent-text" />
                        Snapshot consistente (InnoDB)
                      </span>
                      {backupSummary.binlog_coordinates && (
                        <span className="font-mono text-fg-muted truncate max-w-full" title={backupSummary.binlog_coordinates}>
                          Binlog: {backupSummary.binlog_coordinates}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Non-transactional tables warning */}
                  {backupSummary.non_transactional_tables && backupSummary.non_transactional_tables.length > 0 && (
                    <div className="p-2.5 rounded-lg border border-line bg-surface text-warning text-xs flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <span className="font-semibold block mb-0.5">Tablas no transaccionales detectadas</span>
                        <span className="text-[11px] text-fg-muted block">
                          Las tablas <span className="font-mono text-fg font-medium">{backupSummary.non_transactional_tables.join(", ")}</span> usan motores sin soporte transaccional (MyISAM/Aria). Sus datos se exportaron pero no participan en el snapshot consistente.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Phase 4 Directory Backup Success Summary */}
              {dirBackupSummary && (
                <div className="p-4 rounded-lg border border-line text-fg text-xs space-y-2.5">
                  <div className="flex items-center justify-between border-b border-line pb-2">
                    <div className="flex items-center space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span className="font-bold text-success text-sm">
                        ¡Respaldo estructurado completado con éxito!
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-success/80">
                      {dirBackupSummary.duration_ms} ms
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[11px] block">Tablas</span>
                      <span className="font-bold text-fg text-sm">
                        {dirBackupSummary.total_tables}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[11px] block">Bloques (Chunks)</span>
                      <span className="font-bold text-fg text-sm">
                        {dirBackupSummary.total_chunks}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[11px] block">Filas Volcadas</span>
                      <span className="font-bold text-fg text-sm">
                        {dirBackupSummary.total_rows.toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[11px] block">Compresión</span>
                      <span className="font-bold text-fg text-sm uppercase">
                        {dirBackupSummary.compression} ({dirBackupSummary.compression_ratio.toFixed(2)}x)
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted block text-[11px]">Tamaño Comprimido:</span>
                      <span className="font-bold text-fg">{formatBytes(dirBackupSummary.total_bytes)}</span>
                      <span className="text-fg-muted text-[10px] ml-1">
                        (de {formatBytes(dirBackupSummary.total_uncompressed_bytes)} sin comprimir)
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line flex items-center justify-between">
                      <div>
                        <span className="text-fg-muted block text-[11px]">Manifest ID:</span>
                        <span className="text-fg font-medium truncate max-w-[140px] block" title={dirBackupSummary.manifest_id}>
                          {dirBackupSummary.manifest_id}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setVerifyDir(dirBackupSummary.target_dir);
                          setActiveTab("verify");
                        }}
                        className="text-[11px] px-2 py-1 rounded bg-raised border border-line hover:bg-hover text-accent-text shrink-0"
                      >
                        Verificar integridad
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted block text-[11px]">Directorio de respaldo:</span>
                    <span className="text-success select-all">{dirBackupSummary.target_dir}</span>
                  </div>

                  {dirBackupSummary.consistent_snapshot && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium bg-accent-soft text-accent-text border border-accent/20">
                        <ShieldCheck className="w-3 h-3 text-accent-text" />
                        Snapshot consistente (InnoDB)
                      </span>
                      {dirBackupSummary.binlog_coordinates && (
                        <span className="font-mono text-fg-muted truncate max-w-full" title={dirBackupSummary.binlog_coordinates}>
                          Binlog: {dirBackupSummary.binlog_coordinates}
                        </span>
                      )}
                    </div>
                  )}

                  {dirBackupSummary.non_transactional_tables && dirBackupSummary.non_transactional_tables.length > 0 && (
                    <div className="p-2.5 rounded-lg border border-line bg-surface text-warning text-xs flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <span className="font-semibold block mb-0.5">Tablas no transaccionales detectadas</span>
                        <span className="text-[11px] text-fg-muted block">
                          Las tablas <span className="font-mono text-fg font-medium">{dirBackupSummary.non_transactional_tables.join(", ")}</span> usan motores sin soporte transaccional (MyISAM/Aria). Sus datos se exportaron pero no participan en el snapshot consistente.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Phase 4.2 Binlog Incremental Backup Success Summary */}
              {binlogBackupSummary && (
                <div className="p-4 rounded-lg border border-line text-fg text-xs space-y-2.5">
                  <div className="flex items-center justify-between border-b border-line pb-2">
                    <div className="flex items-center space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span className="font-bold text-success text-sm">
                        ¡Respaldo incremental binlog completado!
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-success/80">
                      {binlogBackupSummary.duration_ms} ms
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[11px] block">Base de Datos</span>
                      <span className="font-bold text-fg text-sm">{binlogBackupSummary.database}</span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[11px] block">Eventos Binlog</span>
                      <span className="font-bold text-fg text-sm">{binlogBackupSummary.total_events.toLocaleString()}</span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[11px] block">Tamaño Comprimido</span>
                      <span className="font-bold text-fg text-sm">{formatBytes(binlogBackupSummary.total_compressed_bytes)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted block text-[11px]">Coordenadas Iniciales:</span>
                      <span className="text-fg font-medium truncate block" title={binlogBackupSummary.start_coordinates}>
                        {binlogBackupSummary.start_coordinates}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted block text-[11px]">Coordenadas Finales:</span>
                      <span className="text-fg font-medium truncate block" title={binlogBackupSummary.end_coordinates}>
                        {binlogBackupSummary.end_coordinates}
                      </span>
                    </div>
                  </div>

                  <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2 rounded border border-line flex items-center justify-between">
                    <div>
                      <span className="text-fg-muted block text-[11px]">Backup ID:</span>
                      <span className="text-success select-all">{binlogBackupSummary.backup_id}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setVerifyDir(binlogBackupSummary.target_dir);
                        setActiveTab("verify");
                      }}
                      className="text-[11px] px-2 py-1 rounded bg-raised border border-line hover:bg-hover text-accent-text shrink-0"
                    >
                      Verificar integridad
                    </button>
                  </div>
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

              {/* Backup Format: Single SQL File vs High-Performance Directory */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-fg">
                  Formato del Respaldo
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setBackupFormat("file")}
                    disabled={isBusy}
                    className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                      backupFormat === "file"
                        ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                        : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                    }`}
                  >
                    <Save
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        backupFormat === "file" ? "text-accent-text" : "text-fg-subtle"
                      }`}
                    />
                    <div>
                      <div className="font-semibold text-xs text-fg">
                        Archivo SQL Único (.sql)
                      </div>
                      <div className="text-[11px] text-fg-muted mt-0.5">
                        Volcado estándar en un solo archivo de texto SQL plano.
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBackupFormat("directory")}
                    disabled={isBusy}
                    className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                      backupFormat === "directory"
                        ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                        : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                    }`}
                  >
                    <HardDrive
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        backupFormat === "directory" ? "text-accent-text" : "text-fg-subtle"
                      }`}
                    />
                    <div>
                      <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                        <span>Directorio Estructurado</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-accent-soft text-accent-text border border-accent/20">Fase 4</span>
                      </div>
                      <div className="text-[11px] text-fg-muted mt-0.5">
                        Particionado en bloques, compresión Zstandard y verificación SHA-256 por bloque.
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Directory-specific settings */}
              {backupFormat === "directory" && (
                <div className="p-3.5 bg-raised rounded-xl border border-line space-y-3">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-fg pb-2 border-b border-line">
                    <HardDrive className="w-4 h-4 text-accent-text" />
                    <span>Configuración de Respaldo Estructurado</span>
                  </div>

                  {/* Destination Directory */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-fg-muted">
                      Directorio de Destino
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={backupDir}
                        onChange={(e) => setBackupDir(e.target.value)}
                        placeholder="Ruta absoluta de la carpeta de destino..."
                        disabled={isBusy}
                        className="flex-1 bg-surface border border-line rounded-lg px-3 py-1.5 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                      />
                      <button
                        type="button"
                        onClick={handlePickBackupDir}
                        disabled={isBusy}
                        className="px-3 py-1.5 rounded-lg bg-surface border border-line hover:bg-hover text-fg text-xs font-medium flex items-center space-x-1.5 shrink-0"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-fg-muted" />
                        <span>Examinar...</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    {/* Compression */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-fg-muted">
                        Compresión de Bloques
                      </label>
                      <select
                        value={compression}
                        onChange={(e) => setCompression(e.target.value as BackupCompressionFormat)}
                        disabled={isBusy}
                        className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-accent"
                      >
                        <option value="zstd">Zstandard (Ultra rápido)</option>
                        <option value="gzip">Gzip (Estándar)</option>
                        <option value="none">Sin compresión</option>
                      </select>
                    </div>

                    {/* Chunk Size */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-fg-muted">
                        Tamaño de Bloque
                      </label>
                      <select
                        value={chunkSizeRows}
                        onChange={(e) => setChunkSizeRows(Number(e.target.value))}
                        disabled={isBusy}
                        className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-accent"
                      >
                        <option value={25000}>25,000 filas / chunk</option>
                        <option value={50000}>50,000 filas / chunk (Recomendado)</option>
                        <option value={100000}>100,000 filas / chunk</option>
                        <option value={250000}>250,000 filas / chunk</option>
                      </select>
                    </div>

                    {/* Zstd Level (only if zstd) */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-fg-muted">
                        Nivel Zstd ({zstdLevel})
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={19}
                        value={zstdLevel}
                        onChange={(e) => setZstdLevel(Number(e.target.value))}
                        disabled={isBusy || compression !== "zstd"}
                        className="w-full mt-2 accent-accent"
                      />
                    </div>
                  </div>

                  {/* Structured Backup Strategy: Full vs Differential */}
                  <div className="space-y-1.5 pt-1">
                    <label className="text-[11px] font-semibold text-fg-muted">
                      Estrategia de Respaldo Estructurado
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setStructuredBackupType("full")}
                        disabled={isBusy}
                        className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                          structuredBackupType === "full"
                            ? "bg-accent-soft border-accent/60 text-fg ring-1 ring-accent/30 font-semibold"
                            : "bg-surface border-line text-fg-muted hover:text-fg"
                        }`}
                      >
                        <div>Completo (Full)</div>
                        <div className="text-[10px] text-fg-muted font-normal mt-0.5">
                          Vuelca todas las tablas y sus datos en bloques nuevos.
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setStructuredBackupType("differential")}
                        disabled={isBusy}
                        className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                          structuredBackupType === "differential"
                            ? "bg-accent-soft border-accent/60 text-fg ring-1 ring-accent/30 font-semibold"
                            : "bg-surface border-line text-fg-muted hover:text-fg"
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <span>Diferencial</span>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-accent-soft text-accent-text border border-accent/30">Fase 4.3</span>
                        </div>
                        <div className="text-[10px] text-fg-muted font-normal mt-0.5">
                          Calcula CHECKSUM TABLE y solo exporta tablas modificadas.
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setStructuredBackupType("incremental_binlog");
                          if (!binlogReq) {
                            void handleCheckBinlogReq();
                          }
                        }}
                        disabled={isBusy}
                        className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                          structuredBackupType === "incremental_binlog"
                            ? "bg-accent-soft border-accent/60 text-fg ring-1 ring-accent/30 font-semibold"
                            : "bg-surface border-line text-fg-muted hover:text-fg"
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <span>Incremental (Binlog)</span>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-accent-soft text-accent-text border border-accent/30">Fase 4.2</span>
                        </div>
                        <div className="text-[10px] text-fg-muted font-normal mt-0.5">
                          Captura eventos del binary log para point-in-time recovery.
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Binlog Requirements Status & Base Backup Picker for Incremental Binlog */}
                  {structuredBackupType === "incremental_binlog" && (
                    <div className="space-y-3 pt-1 bg-surface p-3 rounded-lg border border-line">
                      <div className="flex items-center justify-between border-b border-line pb-2">
                        <div className="flex items-center space-x-2">
                          <GitBranch className="w-4 h-4 text-accent-text" />
                          <span className="font-semibold text-xs text-fg">
                            Estado del Binary Log en el Servidor
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleCheckBinlogReq}
                          disabled={isLoadingBinlogReq}
                          className="text-[11px] px-2 py-0.5 rounded bg-raised border border-line hover:bg-hover text-accent-text flex items-center space-x-1"
                        >
                          <RefreshCw className={`w-3 h-3 ${isLoadingBinlogReq ? "animate-spin" : ""}`} />
                          <span>Comprobar</span>
                        </button>
                      </div>

                      {isLoadingBinlogReq ? (
                        <div className="py-2 flex items-center justify-center space-x-2 text-xs text-fg-muted">
                          <Loader2 className="w-4 h-4 animate-spin text-accent-text" />
                          <span>Consultando variables del servidor binlog...</span>
                        </div>
                      ) : binlogReq ? (
                        <div className="space-y-2.5">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                            <div className="bg-canvas p-2 rounded border border-line">
                              <span className="text-fg-muted text-[10px] block font-sans">log_bin</span>
                              <span className={`font-bold ${binlogReq.log_bin_enabled ? "text-success" : "text-danger"}`}>
                                {binlogReq.log_bin_enabled ? "Activo (ON)" : "Inactivo (OFF)"}
                              </span>
                            </div>
                            <div className="bg-canvas p-2 rounded border border-line">
                              <span className="text-fg-muted text-[10px] block font-sans">Formato</span>
                              <span className="font-bold text-fg">{binlogReq.binlog_format}</span>
                            </div>
                            <div className="bg-canvas p-2 rounded border border-line">
                              <span className="text-fg-muted text-[10px] block font-sans">Privilegios Repl</span>
                              <span className={`font-bold ${binlogReq.has_replication_client ? "text-success" : "text-warning"}`}>
                                {binlogReq.has_replication_client ? "Otorgados" : "Limitados"}
                              </span>
                            </div>
                            <div className="bg-canvas p-2 rounded border border-line">
                              <span className="text-fg-muted text-[10px] block font-sans">Logs Disponibles</span>
                              <span className="font-bold text-fg">{binlogReq.available_logs_count} archivos</span>
                            </div>
                          </div>

                          {binlogReq.current_binlog_file && (
                            <div className="text-[11px] font-mono bg-canvas p-2 rounded border border-line flex items-center justify-between">
                              <span className="text-fg-muted">Coordenadas activas:</span>
                              <span className="text-accent-text font-bold">
                                {binlogReq.current_binlog_file}:{binlogReq.current_binlog_pos || 0}
                              </span>
                            </div>
                          )}

                          {binlogReq.suggestions.length > 0 && (
                            <div className="p-2.5 rounded bg-canvas border border-line text-[11px] text-warning space-y-1">
                              <span className="font-semibold block">Recomendaciones de configuración:</span>
                              <ul className="list-disc list-inside space-y-0.5 text-fg-muted">
                                {binlogReq.suggestions.map((s, idx) => (
                                  <li key={idx}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ) : null}

                      {/* Base Backup Dir Picker */}
                      <div className="space-y-1.5 pt-2 border-t border-line">
                        <label className="text-[11px] font-semibold text-fg-muted flex items-center justify-between">
                          <span>Directorio del Respaldo Base</span>
                          <span className="text-[10px] text-accent-text">Origen para continuar la cadena binlog</span>
                        </label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            value={baseBackupDir}
                            onChange={(e) => {
                              setBaseBackupDir(e.target.value);
                              if (e.target.value.trim()) {
                                void handleVerifyChain(e.target.value);
                              }
                            }}
                            placeholder="Carpeta del respaldo base (contiene manifest.json)..."
                            disabled={isBusy}
                            className="flex-1 bg-raised border border-line rounded-lg px-3 py-1.5 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                          />
                          <button
                            type="button"
                            onClick={handlePickBaseBackupDir}
                            disabled={isBusy}
                            className="px-3 py-1.5 rounded-lg bg-raised border border-line hover:bg-hover text-fg text-xs font-medium flex items-center space-x-1.5 shrink-0"
                          >
                            <FolderOpen className="w-3.5 h-3.5 text-fg-muted" />
                            <span>Examinar...</span>
                          </button>
                        </div>

                        {/* Chain Verification Status */}
                        {isCheckingChain ? (
                          <div className="flex items-center space-x-2 text-[11px] text-fg-muted py-1">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-text" />
                            <span>Verificando continuidad de la cadena binlog...</span>
                          </div>
                        ) : binlogChainCheck ? (
                          <div
                            className={`p-2 rounded text-[11px] font-mono flex items-start space-x-2 border ${
                              binlogChainCheck.is_valid
                                ? "bg-canvas border-line text-success"
                                : "bg-canvas border-line text-warning"
                            }`}
                          >
                            {binlogChainCheck.is_valid ? (
                              <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                            )}
                            <div>
                              <span className="font-semibold block font-sans">
                                {binlogChainCheck.is_valid
                                  ? "Cadena de replicación continua e íntegra"
                                  : "Atención con la cadena binlog"}
                              </span>
                              <span className="text-[10px] text-fg-muted block">
                                {binlogChainCheck.message}
                              </span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {/* Base Backup Dir for Differential */}
                  {structuredBackupType === "differential" && (
                    <div className="space-y-1.5 pt-1 bg-surface p-2.5 rounded-lg border border-line">
                      <label className="text-[11px] font-semibold text-fg-muted flex items-center justify-between">
                        <span>Directorio del Respaldo Base</span>
                        <span className="text-[10px] text-accent-text">Requerido para comparar checksums</span>
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={baseBackupDir}
                          onChange={(e) => setBaseBackupDir(e.target.value)}
                          placeholder="Carpeta del respaldo base (contiene manifest.json)..."
                          disabled={isBusy}
                          className="flex-1 bg-raised border border-line rounded-lg px-3 py-1.5 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={handlePickBaseBackupDir}
                          disabled={isBusy}
                          className="px-3 py-1.5 rounded-lg bg-raised border border-line hover:bg-hover text-fg text-xs font-medium flex items-center space-x-1.5 shrink-0"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-fg-muted" />
                          <span>Examinar...</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
      )}

          {/* ========================================================================= */}
          {/* TAB 3: VERIFY INTEGRITY / VERIFICAR INTEGRIDAD */}
          {/* ========================================================================= */}
          {activeTab === "verify" && (
            <div className="space-y-5">
              {/* Verification Error */}
              {verifyError && (
                <div className="p-3.5 rounded-lg border border-line text-danger text-xs flex items-start space-x-2.5">
                  <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold block mb-0.5">Error en la verificación</span>
                    <span className="font-mono text-[11px] break-all">{verifyError}</span>
                  </div>
                </div>
              )}

              {/* Verify Result */}
              {verifyResult && (
                <div className="p-4 rounded-xl border border-line text-fg text-xs space-y-3">
                  <div className="flex items-center justify-between border-b border-line pb-2">
                    <div className="flex items-center space-x-2">
                      {verifyResult.valid ? (
                        <CheckCircle2 className="w-4 h-4 text-success" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-danger" />
                      )}
                      <span className={`font-bold text-sm ${verifyResult.valid ? "text-success" : "text-danger"}`}>
                        {verifyResult.valid ? "¡Respaldo íntegro y verificado!" : "Respaldo con inconsistencias o archivos corruptos"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                    <div className="bg-canvas p-2.5 rounded border border-line">
                      <span className="text-fg-muted block">Total Archivos</span>
                      <span className="font-bold text-fg text-sm">{verifyResult.total_files}</span>
                    </div>
                    <div className="bg-canvas p-2.5 rounded border border-line">
                      <span className="text-fg-muted block">Archivos Verificados</span>
                      <span className="font-bold text-success text-sm">{verifyResult.verified_files}</span>
                    </div>
                    <div className="bg-canvas p-2.5 rounded border border-line">
                      <span className="text-fg-muted block">Corruptos / Faltantes</span>
                      <span
                        className={`font-bold text-sm ${
                          verifyResult.corrupted_files.length + verifyResult.missing_files.length > 0
                            ? "text-danger"
                            : "text-fg"
                        }`}
                      >
                        {verifyResult.corrupted_files.length + verifyResult.missing_files.length}
                      </span>
                    </div>
                  </div>

                  {verifyResult.corrupted_files.length > 0 && (
                    <div className="p-2.5 bg-canvas rounded border border-line text-danger space-y-1">
                      <span className="font-semibold block">Archivos con hash SHA-256 alterado:</span>
                      <ul className="list-disc list-inside font-mono text-[11px]">
                        {verifyResult.corrupted_files.map((file) => (
                          <li key={file}>{file}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {verifyResult.decompression_errors.length > 0 && (
                    <div className="p-2.5 bg-canvas rounded border border-line text-danger space-y-1">
                      <span className="font-semibold block">Errores de descompresión:</span>
                      <ul className="list-disc list-inside font-mono text-[11px]">
                        {verifyResult.decompression_errors.map((err) => (
                          <li key={err}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {verifyResult.missing_files.length > 0 && (
                    <div className="p-2.5 bg-canvas rounded border border-line text-danger space-y-1">
                      <span className="font-semibold block">Archivos declarados en el manifest no encontrados en disco:</span>
                      <ul className="list-disc list-inside font-mono text-[11px]">
                        {verifyResult.missing_files.map((file) => (
                          <li key={file}>{file}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Directory Selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-fg">Directorio del Respaldo a Verificar</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={verifyDir}
                    onChange={(e) => setVerifyDir(e.target.value)}
                    placeholder="Ruta absoluta de la carpeta que contiene manifest.json..."
                    disabled={isBusy}
                    className="flex-1 bg-surface border border-line rounded-lg px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={handlePickVerifyDir}
                    disabled={isBusy}
                    className="px-3 py-2 rounded-lg bg-raised border border-line hover:bg-hover text-fg text-xs font-medium flex items-center space-x-1.5 shrink-0"
                  >
                    <FolderOpen className="w-4 h-4 text-fg-muted" />
                    <span>Examinar...</span>
                  </button>
                </div>
                <p className="text-[11px] text-fg-muted">
                  PyroStudio leerá el <span className="font-mono text-fg">manifest.json</span>, recalculará los hashes criptográficos SHA-256 de cada bloque particionado y verificará la integridad de la descompresión Zstandard o Gzip sin cargar los datos en el motor.
                </p>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: PERFILES Y PROGRAMACIÓN AUTOMÁTICA */}
          {/* ========================================================================= */}
          {activeTab === "profiles" && (
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
          )}

          {/* ========================================================================= */}
          {/* TAB 5: HISTORIAL DE EJECUCIONES */}
          {/* ========================================================================= */}
          {activeTab === "history" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-fg">
                    Historial de Ejecuciones ({historyRecords.length})
                  </h3>
                  <p className="text-[11px] text-fg-muted">
                    Registro de auditoría de todas las copias de seguridad ejecutadas manual o automáticamente.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={loadHistory}
                    disabled={isLoadingHistory}
                    className={secondaryBtn}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoadingHistory ? "animate-spin" : ""}`} />
                    Actualizar
                  </button>
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    disabled={historyRecords.length === 0 || isLoadingHistory}
                    className={dangerGhostBtn}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Limpiar historial
                  </button>
                </div>
              </div>

              {isLoadingHistory ? (
                <div className="py-12 flex justify-center">
                  <Spinner className="w-6 h-6" />
                </div>
              ) : historyRecords.length === 0 ? (
                <EmptyState
                  icon={<HistoryIcon className="w-8 h-8" />}
                  title="Sin registros de ejecución"
                  description="Las ejecuciones automáticas programadas y manuales aparecerán aquí con sus métricas completas de tiempo, filas y bytes transferidos."
                />
              ) : (
                <div className="border border-line rounded-lg overflow-hidden bg-surface">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-raised border-b border-line text-[11px] text-fg-muted font-medium">
                      <tr>
                        <th className="py-2.5 px-3">Estado</th>
                        <th className="py-2.5 px-3">Fecha y Hora</th>
                        <th className="py-2.5 px-3">Perfil / Origen</th>
                        <th className="py-2.5 px-3">Base de Datos</th>
                        <th className="py-2.5 px-3">Formato</th>
                        <th className="py-2.5 px-3 text-right">Filas / Tablas</th>
                        <th className="py-2.5 px-3 text-right">Tamaño</th>
                        <th className="py-2.5 px-3 text-right">Duración</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line font-mono text-[11px]">
                      {historyRecords.map((record) => (
                        <tr key={record.id} className="hover:bg-hover transition-colors">
                          <td className="py-2 px-3">
                            {record.status === "success" ? (
                              <CheckCircle2 className="w-4 h-4 text-success" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-danger" />
                            )}
                          </td>
                          <td className="py-2 px-3 text-fg whitespace-nowrap">
                            {new Date(record.started_at).toLocaleString()}
                          </td>
                          <td className="py-2 px-3 font-sans">
                            <span className="font-semibold text-fg text-xs block">
                              {record.profile_name || "(Manual)"}
                            </span>
                            <span className="text-[10px] text-fg-muted">
                              {record.profile_id ? "Programado" : "Manual"}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-fg font-medium">
                            {record.database}
                          </td>
                          <td className="py-2 px-3">
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-canvas border border-line text-fg-muted">
                              {record.backup_format.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-fg">
                            {record.total_rows.toLocaleString()} f ({record.total_tables} t)
                          </td>
                          <td className="py-2 px-3 text-right text-fg font-medium">
                            {formatBytes(record.total_bytes)}
                          </td>
                          <td className="py-2 px-3 text-right text-fg-muted">
                            {record.duration_ms} ms
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-raised border-t border-line flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={closeBackupRestoreModal}
            disabled={isBusy}
            className={secondaryBtn}
          >
            Cerrar
          </button>

          {activeTab === "profiles" ? (
            editingProfile ? (
              <div className="flex items-center gap-2">
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
                  <Save className="w-4 h-4 mr-1.5" />
                  Guardar Perfil
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleNewProfile}
                className={primaryBtn}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Nuevo Perfil
              </button>
            )
          ) : activeTab === "history" ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadHistory}
                disabled={isLoadingHistory}
                className={secondaryBtn}
              >
                <RefreshCw className={`w-4 h-4 mr-1.5 ${isLoadingHistory ? "animate-spin" : ""}`} />
                Actualizar
              </button>
            </div>
          ) : activeTab === "verify" ? (
            <button
              type="button"
              onClick={handleStartVerify}
              disabled={isBusy || !verifyDir.trim()}
              className={primaryBtn}
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verificando Integridad SHA-256...</span>
                </>
              ) : (
                <>
                  <FileCheck className="w-4 h-4" />
                  <span>Verificar Integridad de Respaldo</span>
                </>
              )}
            </button>
          ) : activeTab === "backup" ? (
            <button
              type="button"
              onClick={handleStartBackup}
              disabled={isBusy || (!isSqlite && !backupDb)}
              className={primaryBtn}
            >
              {isBackingUp ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {isSqlite
                      ? "Creando copia SQLite..."
                      : backupFormat === "directory"
                      ? structuredBackupType === "incremental_binlog"
                        ? "Generando Respaldo Incremental (Binlog)..."
                        : "Generando Respaldo Estructurado..."
                      : "Generando Respaldo..."}
                  </span>
                </>
              ) : (
                <>
                  <Archive className="w-4 h-4" />
                  <span>
                    {isSqlite
                      ? "Crear copia SQLite (.sqlite3)"
                      : backupFormat === "directory"
                      ? structuredBackupType === "incremental_binlog"
                        ? "Iniciar Respaldo Incremental (Binlog)"
                        : "Iniciar Respaldo Estructurado"
                      : "Iniciar Respaldo (.sql)"}
                  </span>
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
                (restoreFormat === "file"
                  ? !restoreFilePath
                  : restoreStrategy === "point_in_time"
                  ? !restoreBaseBackupDir.trim() || restoreIncrementalDirs.length === 0
                  : !restoreBackupDir.trim()) ||
                (restoreTargetType === "new" ? !newDatabaseName.trim() : !restoreTargetDb.trim())
              }
              className={primaryBtn}
            >
              {isRestoring ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {restoreFormat === "directory"
                      ? restoreStrategy === "point_in_time"
                        ? "Restaurando Point-in-Time..."
                        : "Restaurando Directorio Estructurado..."
                      : "Restaurando Base de Datos..."}
                  </span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" />
                  <span>
                    {restoreFormat === "directory"
                      ? restoreStrategy === "point_in_time"
                        ? "Iniciar Recuperación Point-in-Time"
                        : "Iniciar Restauración Estructurada"
                      : "Iniciar Restauración (.sql)"}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
    </Modal>
  );
};
