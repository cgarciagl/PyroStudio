import type {
  SqlRestoreRequest,
  DirectoryRestoreRequest,
} from "../../types/database";
import { dbService } from "../../services/tauriDb";
import type { BackupRestoreBaseState } from "./useBackupRestoreState";
import type { useProfileActions } from "./useProfileActions";
import type { useBackupActions } from "./useBackupActions";

/** Restore actions: file picker and the SQL, structured-directory or point-in-time restore run. */
export function useRestoreActions(state: BackupRestoreBaseState & ReturnType<typeof useProfileActions> & ReturnType<typeof useBackupActions>) {
  const {
    loadDatabases,
    loadSchemaObjects,
    newDatabaseName,
    restoreBackupDir,
    restoreBaseBackupDir,
    restoreDisableFk,
    restoreFilePath,
    restoreFormat,
    restoreIncrementalDirs,
    restoreStopOnError,
    restoreStrategy,
    restoreTargetDb,
    restoreTargetTimestamp,
    restoreTargetType,
    setDirRestoreProgress,
    setDirRestoreSummary,
    setIsRestoring,
    setPointInTimeSummary,
    setRestoreError,
    setRestoreFilePath,
    setRestoreProgress,
    setRestoreSummary,
  } = state;

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
    handlePickRestoreFile,
    handleStartRestore,
  };
}
