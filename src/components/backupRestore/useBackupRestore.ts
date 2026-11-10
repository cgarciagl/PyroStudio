import { useBackupRestoreState } from "./useBackupRestoreState";
import { useProfileActions } from "./useProfileActions";
import { useBackupActions } from "./useBackupActions";
import { useRestoreActions } from "./useRestoreActions";

/**
 * State and actions of the backup/restore modal shared by its five tabs:
 * SQL dumps, structured directory backups, restore (incl. point-in-time),
 * verification, scheduled profiles and execution history.
 */
export function useBackupRestore() {
  const base = useBackupRestoreState();
  const profiles = useProfileActions(base);
  const withProfiles = { ...base, ...profiles };
  const backup = useBackupActions(withProfiles);
  const withBackup = { ...withProfiles, ...backup };
  const restore = useRestoreActions(withBackup);
  return { ...withBackup, ...restore };
}

export type BackupRestoreState = ReturnType<typeof useBackupRestore>;
