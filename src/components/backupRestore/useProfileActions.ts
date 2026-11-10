import type {
  BackupProfile,
} from "../../types/database";
import { dbService } from "../../services/tauriDb";
import { useUIStore } from "../../stores/uiStore";
import { formatBytes } from "./formatBytes";
import type { BackupRestoreBaseState } from "./useBackupRestoreState";

/** Scheduled backup profiles: create, edit, save, delete, run now, retention and history cleanup. */
export function useProfileActions(state: BackupRestoreBaseState) {
  const {
    backupDb,
    backupDir,
    databases,
    editingProfile,
    loadHistory,
    loadProfiles,
    setEditingProfile,
    setEnforcingRetentionId,
    setProfileActionError,
    setProfileActionSuccess,
    setRunningProfileId,
  } = state;

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

  return {
    handleNewProfile,
    handleEditProfile,
    handlePickProfileTargetDir,
    handleSaveProfile,
    handleDeleteProfile,
    handleRunProfile,
    handleEnforceRetention,
    handleClearHistory,
  };
}
