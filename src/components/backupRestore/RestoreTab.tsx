import React from "react";
import { useTranslation } from "react-i18next";
import {
  RotateCcw,
  Database,
  ShieldAlert,
  Sparkles,
  Save,
  HardDrive,
} from "lucide-react";


import { RestoreSourcePicker } from "./RestoreSourcePicker";
import { RestoreResults } from "./RestoreResults";
import type { BackupRestoreState } from "./useBackupRestore";

export const RestoreTab: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const { t } = useTranslation("backup");
  const {
    databases,
    isBusy,
    isSqlite,
    newDatabaseName,
    restoreDisableFk,
    restoreFormat,
    restoreStopOnError,
    restoreTargetDb,
    restoreTargetType,
    setNewDatabaseName,
    setRestoreDisableFk,
    setRestoreFormat,
    setRestoreStopOnError,
    setRestoreTargetDb,
    setRestoreTargetType,
  } = state;

  return (
    <>
          <div className="space-y-5">
            <RestoreResults state={state} />

            {isSqlite ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-line bg-raised space-y-3">
                  <div className="flex items-center space-x-2.5">
                    <RotateCcw className="w-5 h-5 text-accent-text shrink-0" />
                    <div>
                      <h4 className="text-xs font-semibold text-fg">{t("restoreTab.sqliteTitle")}</h4>
                      <p className="text-[11px] text-fg-muted">
                        {t("restoreTab.sqliteSubtitle")}
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-fg-muted space-y-3 border-t border-line pt-3 leading-relaxed">
                    <p>
                      {t("restoreTab.sqliteIntro")}
                    </p>
                    <div className="space-y-2">
                      <div className="p-3 bg-surface border border-line rounded-lg">
                        <span className="font-semibold text-fg block text-xs mb-1">{t("restoreTab.option1Title")}</span>
                        <span className="text-[11px] text-fg-muted block">
                          {t("restoreTab.option1Desc")}
                        </span>
                      </div>
                      <div className="p-3 bg-surface border border-line rounded-lg">
                        <span className="font-semibold text-fg block text-xs mb-1">{t("restoreTab.option2Title")}</span>
                        <span className="text-[11px] text-fg-muted block">
                          {t("restoreTab.option2Desc")}
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
                {t("restoreTab.restoreFormat")}
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
                    <div className="font-semibold text-xs text-fg">{t("restoreTab.sqlFileTitle")}</div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      {t("restoreTab.sqlFileDesc")}
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
                      <span>{t("restoreTab.structuredDirTitle")}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-accent-soft text-accent-text border border-accent/20">{t("restoreTab.phase4Badge")}</span>
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      {t("restoreTab.structuredDirDesc")}
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <RestoreSourcePicker state={state} />

            {/* Target Database Config */}
            <div className="space-y-3 bg-raised p-4 rounded-xl border border-line">
              <div className="flex items-center space-x-2 text-xs font-semibold text-fg pb-2 border-b border-line">
                <Database className="w-4 h-4 text-fg-muted" />
                <span>{t("restoreTab.targetDbHeader")}</span>
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
                      {t("restoreTab.existingDbTitle")}
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      {t("restoreTab.existingDbDesc")}
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
                      {t("restoreTab.newDbTitle")}
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      {t("restoreTab.newDbDesc")}
                    </div>
                  </div>
                </button>
              </div>

              {restoreTargetType === "existing" ? (
                <div className="pt-2 animate-in fade-in">
                  <label className="text-[11px] font-semibold text-fg-muted block mb-1">
                    {t("restoreTab.selectExistingDb")}
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
                    {t("restoreTab.newDbNameLabel")}
                  </label>
                  <input
                    type="text"
                    value={newDatabaseName}
                    onChange={(e) => setNewDatabaseName(e.target.value)}
                    placeholder={t("restoreTab.newDbPlaceholder")}
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
                <span>{t("restoreTab.execControlHeader")}</span>
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
                  <span>{t("restoreTab.disableFk")}</span>
                </label>

                <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                  <input
                    type="checkbox"
                    checked={restoreStopOnError}
                    onChange={(e) => setRestoreStopOnError(e.target.checked)}
                    disabled={isBusy}
                    className="w-4 h-4 rounded bg-surface border-line-strong text-fg-muted focus:"
                  />
                  <span>{t("restoreTab.stopOnError")}</span>
                </label>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};
