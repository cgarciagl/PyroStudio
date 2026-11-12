import type {
  SqlDumpRequest,
  DirectoryBackupOptions,
} from "../../types/database";
import { dbService } from "../../services/tauriDb";
import type { BackupRestoreBaseState } from "./useBackupRestoreState";
import type { useProfileActions } from "./useProfileActions";
import { errorText, reportError } from "../../utils/errors";

/** Backup actions: directory pickers, binlog checks, chain verification and the SQL/directory backup run. */
export function useBackupActions(state: BackupRestoreBaseState & ReturnType<typeof useProfileActions>) {
  const {
    addDropTable,
    backupDb,
    backupDir,
    backupFormat,
    backupScope,
    baseBackupDir,
    chunkSizeRows,
    compression,
    contentMode,
    includeCreateDb,
    includeReplicationCoords,
    includeRoutines,
    includeTriggers,
    includeViews,
    insertBatchSize,
    isSqlite,
    restoreBackupDir,
    restoreBaseBackupDir,
    restoreIncrementalDirs,
    selectedTables,
    setBackupDir,
    setBackupError,
    setBackupSummary,
    setBaseBackupDir,
    setBinlogBackupSummary,
    setBinlogChainCheck,
    setBinlogReq,
    setDirBackupSummary,
    setIsBackingUp,
    setIsCheckingChain,
    setIsLoadingBinlogReq,
    setIsVerifying,
    setRestoreBackupDir,
    setRestoreBaseBackupDir,
    setRestoreError,
    setRestoreIncrementalDirs,
    setSqliteBackupSuccessPath,
    setVerifyDir,
    setVerifyError,
    setVerifyResult,
    structuredBackupType,
    tables,
    verifyDir,
    zstdLevel,
  } = state;

  const currentDbTables = backupDb ? tables[backupDb] || [] : [];

  const handlePickBackupDir = async () => {
    try {
      const dir = await dbService.pickBackupDirectoryDialog(backupDir || undefined);
      if (dir) {
        setBackupDir(dir);
        setBackupError(null);
      }
    } catch (err) {
      reportError("No se pudo abrir el selector de carpetas", err);
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
      reportError("No se pudo abrir el selector de carpetas", err);
    }
  };

  const handleCheckBinlogReq = async () => {
    setIsLoadingBinlogReq(true);
    try {
      const req = await dbService.checkBinlogRequirements();
      setBinlogReq(req);
    } catch (err) {
      reportError("No se pudieron comprobar los requisitos de binlog", err);
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
        message: errorText(err, "Error al verificar cadena binlog."),
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
      reportError("No se pudo abrir el selector de carpetas", err);
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
      reportError("No se pudo abrir el selector de carpetas", err);
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
      reportError("No se pudo abrir el selector de carpetas", err);
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
      reportError("No se pudo abrir el selector de carpetas", err);
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
        errorText(err, "Error al verificar el respaldo.")
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
          errorText(err, "Ocurrió un error al generar la copia de seguridad SQLite.")
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
            errorText(err, "Ocurrió un error al generar el respaldo incremental binlog.")
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
          errorText(err, "Ocurrió un error al generar el respaldo estructurado.")
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
        errorText(err, "Ocurrió un error al generar el respaldo.")
      );
    } finally {
      setIsBackingUp(false);
    }
  };

  return {
    currentDbTables,
    handlePickBackupDir,
    handlePickVerifyDir,
    handleCheckBinlogReq,
    handleVerifyChain,
    handlePickBaseBackupDir,
    handlePickRestoreBackupDir,
    handlePickRestoreBaseDir,
    handlePickRestoreIncrementalDir,
    handleRemoveIncrementalDir,
    handleStartVerify,
    handleStartBackup,
  };
}
