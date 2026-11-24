import React from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  RotateCcw,
  Loader2,
  FolderOpen,
  Save,
  FileCheck,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  primaryBtn,
  secondaryBtn,
} from "../ui/styles";


import type { BackupRestoreState } from "./useBackupRestore";

export const BackupRestoreFooter: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const { t } = useTranslation("backup");
  const {
    activeTab,
    backupDb,
    backupFormat,
    closeBackupRestoreModal,
    editingProfile,
    handleNewProfile,
    handleSaveProfile,
    handleStartBackup,
    handleStartRestore,
    handleStartVerify,
    isBackingUp,
    isBusy,
    isLoadingHistory,
    isRestoring,
    isSqlite,
    isVerifying,
    loadHistory,
    newDatabaseName,
    openConnectModal,
    restoreBackupDir,
    restoreBaseBackupDir,
    restoreFilePath,
    restoreFormat,
    restoreIncrementalDirs,
    restoreStrategy,
    restoreTargetDb,
    restoreTargetType,
    setEditingProfile,
    structuredBackupType,
    verifyDir,
  } = state;

  return (
    <>
      <div className="px-6 py-4 bg-raised border-t border-line flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={closeBackupRestoreModal}
          disabled={isBusy}
          className={secondaryBtn}
        >
          {t("footer.close")}
        </button>

        {activeTab === "profiles" ? (
          editingProfile ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingProfile(null)}
                className={secondaryBtn}
              >
                {t("footer.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                className={primaryBtn}
              >
                <Save className="w-4 h-4 mr-1.5" />
                {t("footer.saveProfile")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleNewProfile}
              className={primaryBtn}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              {t("footer.newProfile")}
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
              {t("footer.refresh")}
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
                <span>{t("footer.verifyingSha")}</span>
              </>
            ) : (
              <>
                <FileCheck className="w-4 h-4" />
                <span>{t("footer.verifyBackup")}</span>
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
                    ? t("footer.creatingSqlite")
                    : backupFormat === "directory"
                    ? structuredBackupType === "incremental_binlog"
                      ? t("footer.generatingIncremental")
                      : t("footer.generatingStructured")
                    : t("footer.generatingBackup")}
                </span>
              </>
            ) : (
              <>
                <Archive className="w-4 h-4" />
                <span>
                  {isSqlite
                    ? t("footer.createSqliteCopy")
                    : backupFormat === "directory"
                    ? structuredBackupType === "incremental_binlog"
                      ? t("footer.startIncremental")
                      : t("footer.startStructured")
                    : t("footer.startSqlBackup")}
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
            <span>{t("footer.manageSqlite")}</span>
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
                      ? t("footer.restoringPit")
                      : t("footer.restoringStructured")
                    : t("footer.restoringDb")}
                </span>
              </>
            ) : (
              <>
                <RotateCcw className="w-4 h-4" />
                <span>
                  {restoreFormat === "directory"
                    ? restoreStrategy === "point_in_time"
                      ? t("footer.startPit")
                      : t("footer.startStructuredRestore")
                    : t("footer.startSqlRestore")}
                </span>
              </>
            )}
          </button>
        )}
      </div>
    </>
  );
};
