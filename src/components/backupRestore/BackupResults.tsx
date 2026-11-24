import React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";


import { formatBytes } from "./formatBytes";
import type { BackupRestoreState } from "./useBackupRestore";

/** Result of the last backup run: error, SQL dump, directory, binlog incremental or SQLite summaries. */
export const BackupResults: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const { t } = useTranslation("backup");
  const {
    backupError,
    backupSummary,
    binlogBackupSummary,
    dirBackupSummary,
    setActiveTab,
    setVerifyDir,
    sqliteBackupSuccessPath,
  } = state;

  return (
    <>
      {/* Backup Error */}
      {backupError && (
        <div className="p-3.5 rounded-lg border border-line text-danger text-xs flex items-start space-x-2.5">
          <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block mb-0.5">{t("backupResults.errorHeader")}</span>
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
                {t("backupResults.sqlSuccess")}
              </span>
            </div>
            <span className="text-[11px] font-mono text-success/80">
              {backupSummary.duration_ms} ms
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("backupResults.tables")}</span>
              <span className="font-bold text-fg text-sm">
                {backupSummary.total_tables}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("backupResults.viewsRoutines")}</span>
              <span className="font-bold text-fg text-sm">
                {backupSummary.total_views + backupSummary.total_routines}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("backupResults.rowsDumped")}</span>
              <span className="font-bold text-fg text-sm">
                {backupSummary.total_rows_exported.toLocaleString()}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("backupResults.fileSize")}</span>
              <span className="font-bold text-fg text-sm">
                {formatBytes(backupSummary.file_size_bytes)}
              </span>
            </div>
          </div>

          {backupSummary.file_path && (
            <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted block text-[11px]">{t("backupResults.savedTo")}</span>
              <span className="text-success select-all">{backupSummary.file_path}</span>
            </div>
          )}

          {/* Snapshot status and Binlog coordinates */}
          {backupSummary.consistent_snapshot && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium bg-accent-soft text-accent-text border border-accent/20">
                <ShieldCheck className="w-3 h-3 text-accent-text" />
                {t("backupResults.consistentSnapshot")}
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
                <span className="font-semibold block mb-0.5">{t("backupResults.nonTransactionalTitle")}</span>
                <span className="text-[11px] text-fg-muted block">
                  {t("backupResults.nonTransactionalDesc", { tables: backupSummary.non_transactional_tables.join(", ") })}
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
                {t("backupResults.dirSuccess")}
              </span>
            </div>
            <span className="text-[11px] font-mono text-success/80">
              {dirBackupSummary.duration_ms} ms
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("backupResults.tables")}</span>
              <span className="font-bold text-fg text-sm">
                {dirBackupSummary.total_tables}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("backupResults.chunks")}</span>
              <span className="font-bold text-fg text-sm">
                {dirBackupSummary.total_chunks}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("backupResults.rowsDumped")}</span>
              <span className="font-bold text-fg text-sm">
                {dirBackupSummary.total_rows.toLocaleString()}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("backupResults.compression")}</span>
              <span className="font-bold text-fg text-sm uppercase">
                {dirBackupSummary.compression} ({dirBackupSummary.compression_ratio.toFixed(2)}x)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted block text-[11px]">{t("backupResults.compressedSize")}</span>
              <span className="font-bold text-fg">{formatBytes(dirBackupSummary.total_bytes)}</span>
              <span className="text-fg-muted text-[10px] ml-1">
                {t("backupResults.uncompressedOf", { size: formatBytes(dirBackupSummary.total_uncompressed_bytes) })}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line flex items-center justify-between">
              <div>
                <span className="text-fg-muted block text-[11px]">{t("backupResults.manifestId")}</span>
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
                {t("backupResults.verifyIntegrity")}
              </button>
            </div>
          </div>

          <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2 rounded border border-line">
            <span className="text-fg-muted block text-[11px]">{t("backupResults.backupDir")}</span>
            <span className="text-success select-all">{dirBackupSummary.target_dir}</span>
          </div>

          {dirBackupSummary.consistent_snapshot && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium bg-accent-soft text-accent-text border border-accent/20">
                <ShieldCheck className="w-3 h-3 text-accent-text" />
                {t("backupResults.consistentSnapshot")}
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
                <span className="font-semibold block mb-0.5">{t("backupResults.nonTransactionalTitle")}</span>
                <span className="text-[11px] text-fg-muted block">
                  {t("backupResults.nonTransactionalDesc", { tables: dirBackupSummary.non_transactional_tables.join(", ") })}
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
                {t("backupResults.binlogSuccess")}
              </span>
            </div>
            <span className="text-[11px] font-mono text-success/80">
              {binlogBackupSummary.duration_ms} ms
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("backupResults.database")}</span>
              <span className="font-bold text-fg text-sm">{binlogBackupSummary.database}</span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("backupResults.binlogEvents")}</span>
              <span className="font-bold text-fg text-sm">{binlogBackupSummary.total_events.toLocaleString()}</span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("backupResults.compressedSize")}</span>
              <span className="font-bold text-fg text-sm">{formatBytes(binlogBackupSummary.total_compressed_bytes)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted block text-[11px]">{t("backupResults.startCoords")}</span>
              <span className="text-fg font-medium truncate block" title={binlogBackupSummary.start_coordinates}>
                {binlogBackupSummary.start_coordinates}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted block text-[11px]">{t("backupResults.endCoords")}</span>
              <span className="text-fg font-medium truncate block" title={binlogBackupSummary.end_coordinates}>
                {binlogBackupSummary.end_coordinates}
              </span>
            </div>
          </div>

          <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2 rounded border border-line flex items-center justify-between">
            <div>
              <span className="text-fg-muted block text-[11px]">{t("backupResults.backupId")}</span>
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
              {t("backupResults.verifyIntegrity")}
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
              {t("backupResults.sqliteSuccess")}
            </span>
          </div>

          <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2.5 rounded border border-line">
            <span className="text-fg-muted block text-[11px]">{t("backupResults.savedTo")}</span>
            <span className="text-fg select-all">{sqliteBackupSuccessPath}</span>
          </div>

          <p className="text-[11px] text-fg-muted pt-1 leading-relaxed">
            {t("backupResults.sqliteNote1")} <code className="text-accent-text font-mono">VACUUM INTO</code> {t("backupResults.sqliteNote2")}
          </p>
        </div>
      )}
    </>
  );
};
