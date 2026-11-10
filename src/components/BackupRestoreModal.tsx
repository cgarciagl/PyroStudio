import React from "react";
import {
  Archive,
  RotateCcw,
  FileCheck,
  Calendar,
  History as HistoryIcon,
} from "lucide-react";
import { Modal, } from "./ui/Modal";
import { useBackupRestore } from "./backupRestore/useBackupRestore";
import { BackupTab } from "./backupRestore/BackupTab";
import { RestoreTab } from "./backupRestore/RestoreTab";
import { VerifyTab } from "./backupRestore/VerifyTab";
import { ProfilesTab } from "./backupRestore/ProfilesTab";
import { HistoryTab } from "./backupRestore/HistoryTab";
import { BackupRestoreFooter } from "./backupRestore/BackupRestoreFooter";


export const BackupRestoreModal: React.FC = () => {
  const state = useBackupRestore();
  const {
    activeTab,
    closeBackupRestoreModal,
    isBackupRestoreModalOpen,
    isBusy,
    isSqlite,
    loadHistory,
    loadProfiles,
    setActiveTab,
    setEditingProfile,
  } = state;
  if (!isBackupRestoreModalOpen) return null;

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
          {activeTab === "backup" && <BackupTab state={state} />}

          {/* ========================================================================= */}
          {/* TAB 2: RESTORE / RESTAURAR */}
          {/* ========================================================================= */}
          {activeTab === "restore" && <RestoreTab state={state} />}

          {/* ========================================================================= */}
          {/* TAB 3: VERIFY INTEGRITY / VERIFICAR INTEGRIDAD */}
          {/* ========================================================================= */}
          {activeTab === "verify" && <VerifyTab state={state} />}

          {/* ========================================================================= */}
          {/* TAB 4: PERFILES Y PROGRAMACIÓN AUTOMÁTICA */}
          {/* ========================================================================= */}
          {activeTab === "profiles" && <ProfilesTab state={state} />}

          {/* ========================================================================= */}
          {/* TAB 5: HISTORIAL DE EJECUCIONES */}
          {/* ========================================================================= */}
          {activeTab === "history" && <HistoryTab state={state} />}
        </div>

        {/* Modal Footer */}
        <BackupRestoreFooter state={state} />
    </Modal>
  );
};
