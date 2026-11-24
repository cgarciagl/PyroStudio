import React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";


import { formatBytes } from "./formatBytes";
import type { BackupRestoreState } from "./useBackupRestore";

/** Restore progress (SQL or directory) and the summary of the last restore, including point-in-time. */
export const RestoreResults: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const { t } = useTranslation("backup");
  const {
    dirRestoreProgress,
    dirRestoreSummary,
    isRestoring,
    pointInTimeSummary,
    restoreError,
    restoreProgress,
    restoreSummary,
  } = state;

  return (
    <>
      {/* Restore Error */}
      {restoreError && (
        <div className="p-3.5 rounded-lg border border-line text-danger text-xs flex items-start space-x-2.5">
          <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block mb-0.5">{t("restoreResults.errorHeader")}</span>
            <span className="font-mono text-[11px] break-all">{restoreError}</span>
          </div>
        </div>
      )}

      {/* Restore Progress Display */}
      {isRestoring && restoreProgress && (
        <div className="p-4 rounded-xl bg-raised border border-line text-fg text-xs space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin text-fg-muted" />
              <span className="font-bold text-fg text-sm">{restoreProgress.stage}</span>
            </div>
            <span className="font-mono text-fg font-bold">
              {restoreProgress.percent_complete.toFixed(1)}%
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2 bg-raised rounded-full overflow-hidden border border-line">
            <div
              className="h-full bg-raised hover:bg-hover transition-all duration-150 rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, restoreProgress.percent_complete))}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-fg-muted font-mono">
            <span>{t("restoreResults.stmtsExecuted", { count: restoreProgress.statements_executed.toLocaleString() })}</span>
            <span>
              {formatBytes(restoreProgress.bytes_read)} / {formatBytes(restoreProgress.total_bytes)}
            </span>
          </div>

          {restoreProgress.current_statement_preview && (
            <div className="p-2 rounded bg-canvas border border-line font-mono text-[11px] text-fg truncate">
              {restoreProgress.current_statement_preview}
            </div>
          )}
        </div>
      )}

      {/* Directory Restore Progress Display */}
      {isRestoring && dirRestoreProgress && (
        <div className="p-4 rounded-xl bg-raised border border-line text-fg text-xs space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin text-accent-text" />
              <span className="font-bold text-fg text-sm">{dirRestoreProgress.stage}</span>
            </div>
            <span className="font-mono text-accent-text font-bold">
              {dirRestoreProgress.percent_complete.toFixed(1)}%
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2 bg-surface rounded-full overflow-hidden border border-line">
            <div
              className="h-full bg-accent transition-all duration-150 rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, dirRestoreProgress.percent_complete))}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-fg-muted font-mono">
            <span>
              {dirRestoreProgress.current_table ? t("restoreResults.tablePrefix", { table: dirRestoreProgress.current_table }) : t("restoreResults.processingMetadata")}
            </span>
            <span>
              {t("restoreResults.rowsRestored", { count: dirRestoreProgress.rows_restored.toLocaleString() })}
            </span>
          </div>
        </div>
      )}

      {/* Restore Success / Complete Summary */}
      {restoreSummary && !isRestoring && (
        <div
          className={`p-4 rounded-xl border text-xs space-y-3 animate-in fade-in ${
            restoreSummary.failed_statements === 0
              ? "border-line text-success"
              : "border-line text-warning"
          }`}
        >
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div className="flex items-center space-x-2">
              {restoreSummary.failed_statements === 0 ? (
                <CheckCircle2 className="w-4 h-4 text-success" />
              ) : (
                <AlertCircle className="w-4 h-4 text-warning" />
              )}
              <span className="font-bold text-fg text-sm">
                {restoreSummary.failed_statements === 0
                  ? t("restoreResults.sqlSuccess")
                  : t("restoreResults.sqlWarnings")}
              </span>
            </div>
            <span className="text-[11px] font-mono text-fg-muted">
              {restoreSummary.duration_ms} ms
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("restoreResults.targetDb")}</span>
              <span className="font-bold text-fg text-sm truncate block">
                {restoreSummary.target_database}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("restoreResults.totalStmts")}</span>
              <span className="font-bold text-fg text-sm">
                {restoreSummary.total_statements.toLocaleString()}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("restoreResults.succeeded")}</span>
              <span className="font-bold text-success text-sm">
                {restoreSummary.successful_statements.toLocaleString()}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("restoreResults.failed")}</span>
              <span
                className={`font-bold text-sm ${
                  restoreSummary.failed_statements === 0
                    ? "text-fg-muted"
                    : "text-danger"
                }`}
              >
                {restoreSummary.failed_statements.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Errors details list if any failed */}
          {restoreSummary.errors.length > 0 && (
            <div className="mt-2 p-2.5 rounded bg-canvas border border-line space-y-1">
              <span className="text-danger font-semibold text-[11px] block">
                {t("restoreResults.errorDetails", { count: restoreSummary.errors.length })}
              </span>
              <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] font-mono text-danger">
                {restoreSummary.errors.map((err, idx) => (
                  <div key={idx} className="p-1.5 rounded border border-line break-all">
                    {err}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Directory Restore Success Summary */}
      {dirRestoreSummary && !isRestoring && (
        <div className="p-4 rounded-xl border border-line text-xs space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span className="font-bold text-fg text-sm">
                {t("restoreResults.dirSuccess")}
              </span>
            </div>
            <span className="text-[11px] font-mono text-fg-muted">
              {dirRestoreSummary.duration_ms} ms
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("restoreResults.targetDb")}</span>
              <span className="font-bold text-fg text-sm truncate block">
                {dirRestoreSummary.target_database}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("restoreResults.tables")}</span>
              <span className="font-bold text-fg text-sm">
                {dirRestoreSummary.total_tables.toLocaleString()}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("restoreResults.chunks")}</span>
              <span className="font-bold text-fg text-sm">
                {dirRestoreSummary.total_chunks.toLocaleString()}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block">{t("restoreResults.insertedRows")}</span>
              <span className="font-bold text-success text-sm">
                {dirRestoreSummary.total_rows.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="text-[11px] text-fg-muted font-mono bg-canvas p-2 rounded border border-line flex items-center justify-between">
            <span>{t("restoreResults.processedBytes")}</span>
            <span className="font-bold text-fg">{formatBytes(dirRestoreSummary.bytes_processed)}</span>
          </div>
        </div>
      )}

      {/* Point-In-Time Restore Success Summary */}
      {pointInTimeSummary && !isRestoring && (
        <div className="p-4 rounded-xl border border-line text-xs space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span className="font-bold text-fg text-sm">
                {t("restoreResults.pitSuccess")}
              </span>
            </div>
            <span className="text-[11px] font-mono text-fg-muted">
              {pointInTimeSummary.duration_ms} ms
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block font-sans">{t("restoreResults.targetDb")}</span>
              <span className="font-bold text-fg text-sm truncate block">
                {pointInTimeSummary.target_database}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block font-sans">{t("restoreResults.baseTables")}</span>
              <span className="font-bold text-fg text-sm">
                {pointInTimeSummary.base_tables_restored.toLocaleString()}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block font-sans">{t("restoreResults.incrementals")}</span>
              <span className="font-bold text-fg text-sm">
                {t("restoreResults.appliedCount", { count: pointInTimeSummary.incrementals_applied })}
              </span>
            </div>
            <div className="bg-canvas p-2 rounded border border-line">
              <span className="text-fg-muted text-[11px] block font-sans">{t("restoreResults.binlogEvents")}</span>
              <span className="font-bold text-success text-sm">
                {pointInTimeSummary.events_replayed.toLocaleString()}
              </span>
            </div>
          </div>

          {pointInTimeSummary.point_in_time_reached && (
            <div className="text-[11px] text-fg font-mono bg-canvas p-2 rounded border border-line flex items-center justify-between">
              <span className="text-fg-muted">{t("restoreResults.pitReached")}</span>
              <span className="font-bold text-accent-text">{pointInTimeSummary.point_in_time_reached}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
};
