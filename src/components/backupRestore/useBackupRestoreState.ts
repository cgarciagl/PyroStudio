import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type {
  SqlDumpSummary,
  SqlRestoreProgressEvent,
  SqlRestoreSummary,
  DirectoryBackupSummary,
  DirectoryBackupVerificationResult,
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
import { reportError } from "../../utils/errors";

/** Shared state of the backup/restore modal plus its lifecycle effects (init, events, Escape). */
export function useBackupRestoreState() {
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
      reportError("No se pudieron cargar los perfiles de respaldo", err);
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
      reportError("No se pudo cargar el historial de respaldos", err);
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

  return {
    isBackupRestoreModalOpen,
    backupRestoreInitialTab,
    backupRestoreTargetDatabase,
    closeBackupRestoreModal,
    openConnectModal,
    capabilities,
    isSqlite,
    databases,
    selectedDatabase,
    tables,
    loadDatabases,
    loadSchemaObjects,
    activeTab,
    setActiveTab,
    backupDb,
    setBackupDb,
    backupScope,
    setBackupScope,
    selectedTables,
    setSelectedTables,
    contentMode,
    setContentMode,
    includeCreateDb,
    setIncludeCreateDb,
    addDropTable,
    setAddDropTable,
    includeViews,
    setIncludeViews,
    includeRoutines,
    setIncludeRoutines,
    includeTriggers,
    setIncludeTriggers,
    disableFkChecks,
    setDisableFkChecks,
    insertBatchSize,
    setInsertBatchSize,
    includeReplicationCoords,
    setIncludeReplicationCoords,
    isBackingUp,
    setIsBackingUp,
    backupError,
    setBackupError,
    backupSummary,
    setBackupSummary,
    sqliteBackupSuccessPath,
    setSqliteBackupSuccessPath,
    backupFormat,
    setBackupFormat,
    structuredBackupType,
    setStructuredBackupType,
    backupDir,
    setBackupDir,
    baseBackupDir,
    setBaseBackupDir,
    compression,
    setCompression,
    chunkSizeRows,
    setChunkSizeRows,
    zstdLevel,
    setZstdLevel,
    dirBackupSummary,
    setDirBackupSummary,
    binlogReq,
    setBinlogReq,
    isLoadingBinlogReq,
    setIsLoadingBinlogReq,
    binlogChainCheck,
    setBinlogChainCheck,
    isCheckingChain,
    setIsCheckingChain,
    binlogBackupSummary,
    setBinlogBackupSummary,
    verifyDir,
    setVerifyDir,
    isVerifying,
    setIsVerifying,
    verifyError,
    setVerifyError,
    verifyResult,
    setVerifyResult,
    restoreFormat,
    setRestoreFormat,
    restoreStrategy,
    setRestoreStrategy,
    restoreFilePath,
    setRestoreFilePath,
    restoreBackupDir,
    setRestoreBackupDir,
    restoreBaseBackupDir,
    setRestoreBaseBackupDir,
    restoreIncrementalDirs,
    setRestoreIncrementalDirs,
    restoreTargetTimestamp,
    setRestoreTargetTimestamp,
    restoreTargetType,
    setRestoreTargetType,
    restoreTargetDb,
    setRestoreTargetDb,
    newDatabaseName,
    setNewDatabaseName,
    restoreDisableFk,
    setRestoreDisableFk,
    restoreStopOnError,
    setRestoreStopOnError,
    isRestoring,
    setIsRestoring,
    restoreProgress,
    setRestoreProgress,
    dirRestoreProgress,
    setDirRestoreProgress,
    restoreError,
    setRestoreError,
    restoreSummary,
    setRestoreSummary,
    dirRestoreSummary,
    setDirRestoreSummary,
    pointInTimeSummary,
    setPointInTimeSummary,
    profiles,
    setProfiles,
    isLoadingProfiles,
    setIsLoadingProfiles,
    editingProfile,
    setEditingProfile,
    runningProfileId,
    setRunningProfileId,
    enforcingRetentionId,
    setEnforcingRetentionId,
    profileActionError,
    setProfileActionError,
    profileActionSuccess,
    setProfileActionSuccess,
    historyRecords,
    setHistoryRecords,
    isLoadingHistory,
    setIsLoadingHistory,
    loadProfiles,
    loadHistory,
    isBusy,
  };
}

export type BackupRestoreBaseState = ReturnType<typeof useBackupRestoreState>;
