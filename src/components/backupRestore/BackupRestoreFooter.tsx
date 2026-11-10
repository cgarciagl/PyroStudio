import React from "react";
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
    </>
  );
};
