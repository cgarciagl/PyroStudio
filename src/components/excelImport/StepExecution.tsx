import { useTranslation } from "react-i18next";
import { reportError } from "../../utils/errors";
import {
  CheckCircle2,
  AlertCircle,
  Play,
  Loader2,
  Zap,
  XCircle,
} from "lucide-react";
import { primaryBtn } from "../ui/styles";
import { dbService } from "../../services/tauriDb";
import type { ImportWizard } from "./useImportWizard";

/** Paso 5: ejecución, progreso y resumen. */
export function StepExecution({ previewData, targetType, selectedExistingTable, newTableName, importMode, batchSize, dryRun, truncateBeforeImport, isExecuting, progress, executionSummary, executionError, handleExecuteImport }: Pick<ImportWizard, "previewData" | "targetType" | "selectedExistingTable" | "newTableName" | "importMode" | "batchSize" | "dryRun" | "truncateBeforeImport" | "isExecuting" | "progress" | "executionSummary" | "executionError" | "handleExecuteImport">) {
  const { t } = useTranslation("transfer");
  const willTruncate =
    !dryRun && targetType === "existing" && (truncateBeforeImport || importMode === "copy");
  return (
    <div className="space-y-6">
      {!executionSummary && !isExecuting && !executionError && (
        <div className="text-center py-10 space-y-4">
          <div className="w-14 h-14 rounded-xl bg-accent-soft border border-accent/30 flex items-center justify-center mx-auto text-accent-text">
            <Play className="w-7 h-7 fill-current ml-1" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-fg">
              {t("excelImport.stepExecution.readyTitle", { count: previewData?.total_rows.toLocaleString() })}
            </h3>
            <p className="text-xs text-fg-muted mt-1 max-w-md mx-auto">
              {t("excelImport.stepExecution.targetTable")}{" "}
              <strong className="text-accent-text font-mono">
                {targetType === "new" ? newTableName : selectedExistingTable}
              </strong>{" "}
              ({targetType === "new" ? t("excelImport.stepExecution.newTable") : t("excelImport.stepExecution.existingTable")}). {t("excelImport.stepExecution.modeLabel")}{" "}
              <strong className="text-warning font-mono">
                {importMode}
              </strong>.
            </p>
            {willTruncate && (
              <div className="mt-3 max-w-md mx-auto px-3 py-2 rounded-lg border border-line bg-surface flex items-center justify-center gap-2 text-xs text-fg">
                <AlertCircle className="w-4 h-4 text-danger shrink-0" />
                <span>
                  {t("excelImport.stepExecution.truncateWarning", {
                    table: selectedExistingTable,
                  })}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={handleExecuteImport}
            className={primaryBtn}
          >
            {dryRun ? t("excelImport.stepExecution.runDryRun") : t("excelImport.stepExecution.startImport")}
          </button>
        </div>
      )}

      {isExecuting && (
        <div className="py-8 px-6 space-y-5 bg-surface border border-line rounded-xl max-w-xl mx-auto shadow-modal animate-in fade-in">
          {/* Status header */}
          <div className="flex items-center space-x-3 text-left">
            <div className="w-11 h-11 rounded-xl bg-accent-soft border border-accent/30 flex items-center justify-center shrink-0">
              <Loader2 className="w-5 h-5 animate-spin text-fg-muted" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-fg font-mono truncate">
                {progress?.stage || t("excelImport.stepExecution.processing")}
              </h3>
              <p className="text-xs text-fg-muted font-mono mt-0.5 truncate">
                {t("excelImport.stepExecution.destLabel")}{" "}
                <span className="text-accent-text font-bold">
                  {targetType === "new" ? newTableName : selectedExistingTable}
                </span>{" "}
                • {t("excelImport.stepExecution.modeLabel")}{" "}
                <span className="text-warning font-semibold">
                  {importMode}
                </span>
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-lg font-mono font-semibold text-fg">
                {progress ? `${progress.percentage.toFixed(1)}%` : "0.0%"}
              </span>
            </div>
          </div>

          {/* Visual Progress Bar Track */}
          <div className="space-y-1.5">
            <div className="w-full h-3.5 bg-canvas rounded-full overflow-hidden border border-line p-0.5 shadow-inner relative">
              <div
                className="h-full rounded-full bg-accent hover:bg-accent-hover transition-all duration-300 ease-out"
                style={{
                  width: `${Math.max(progress?.percentage || 0, progress ? 1 : 0)}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-fg-muted">
              <span>
                {t("excelImport.stepExecution.processed")}{" "}
                <strong className="text-fg">
                  {(progress?.current_row || 0).toLocaleString()}
                </strong>{" "}
                /{" "}
                {(
                  progress?.total_rows ||
                  previewData?.total_rows ||
                  0
                ).toLocaleString()}{" "}
                {t("excelImport.stepExecution.rowsUnit")}
              </span>
              <span className="text-warning/90 font-medium">
                {t("excelImport.stepExecution.batchesOf", { count: batchSize.toLocaleString() })}
              </span>
            </div>
          </div>

          {/* Live Counters & Speed */}
          <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-line text-left">
            <div className="p-2.5 rounded-lg border border-line flex items-center justify-between">
              <span className="text-[11px] text-success font-mono">
                {t("excelImport.stepExecution.succeeded")}
              </span>
              <span className="text-xs font-bold font-mono text-success">
                {(progress?.successful_rows || 0).toLocaleString()}
              </span>
            </div>
            <div className="p-2.5 rounded-lg border border-line flex items-center justify-between">
              <span className="text-[11px] text-danger font-mono">
                {t("excelImport.stepExecution.errors")}
              </span>
              <span className="text-xs font-bold font-mono text-danger">
                {(progress?.failed_rows || 0).toLocaleString()}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-accent-soft border border-accent/30 flex items-center justify-between">
              <span className="text-[11px] text-accent-text font-mono flex items-center gap-1">
                <Zap className="w-3 h-3 shrink-0 text-fg-muted" />
                {t("excelImport.stepExecution.speed")}
              </span>
              <span className="text-xs font-bold font-mono text-accent-text">
                {progress?.rows_per_sec
                  ? t("excelImport.stepExecution.rowsPerSec", { count: progress.rows_per_sec.toLocaleString() })
                  : "—"}
              </span>
            </div>
          </div>

          {/* Cancel / Abort operation button */}
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={async () => {
                try {
                  await dbService.cancelExcelOperation();
                } catch (err) {
                  reportError(t("excelImport.stepExecution.cancelError"), err);
                }
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg hover:bg-hover border border-line text-danger text-xs font-medium transition-colors cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5 text-danger" />
              <span>{t("excelImport.stepExecution.abortBtn")}</span>
            </button>
          </div>
        </div>
      )}

      {executionError && (
        <div className="p-4 border border-line rounded-xl text-danger text-xs font-mono space-y-2">
          <div className="flex items-center space-x-2 font-bold text-danger">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{t("excelImport.stepExecution.execErrorTitle")}</span>
          </div>
          <p className="whitespace-pre-wrap">{executionError}</p>
          <button
            type="button"
            onClick={handleExecuteImport}
            className="mt-2 px-3 py-1.5 bg-danger hover:opacity-90 text-accent-fg rounded text-xs font-semibold"
          >
            {t("excelImport.stepExecution.retry")}
          </button>
        </div>
      )}

      {executionSummary && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Metric Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-raised border border-line">
              <span className="text-[11px] text-fg-muted block mb-1">
                {t("excelImport.stepExecution.totalProcessed")}
              </span>
              <span className="text-base font-semibold font-mono text-fg">
                {executionSummary.total_processed.toLocaleString()}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-line">
              <span className="text-[11px] text-success block mb-1">
                {dryRun ? t("excelImport.stepExecution.validRowsEst") : t("excelImport.stepExecution.imported")}
              </span>
              <span className="text-base font-semibold font-mono text-success">
                {executionSummary.successful_rows.toLocaleString()}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-line">
              <span className="text-[11px] text-danger block mb-1">
                {t("excelImport.stepExecution.skipped")}
              </span>
              <span className="text-base font-semibold font-mono text-danger">
                {(executionSummary.skipped_rows ?? executionSummary.failed_rows).toLocaleString()}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-raised border border-line">
              <span className="text-[11px] text-fg-muted block mb-1">
                {t("excelImport.stepExecution.errorsDetected")}
              </span>
              <span className="text-base font-semibold font-mono text-accent-text">
                {(executionSummary.error_count ?? executionSummary.errors.length).toLocaleString()}
              </span>
            </div>
          </div>
          <p className="text-right text-[11px] text-fg-subtle">
            {t("excelImport.stepExecution.completedIn", {
              label: dryRun ? t("excelImport.stepExecution.validationLabel") : t("excelImport.stepExecution.importLabel"),
              seconds: (executionSummary.execution_time_ms / 1000).toFixed(2),
            })}
          </p>

          {/* Errors table if any */}
          {executionSummary.errors.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-danger flex items-center space-x-1.5">
                <AlertCircle className="w-4 h-4" />
                <span>
                  {t("excelImport.stepExecution.incidentsLog", { count: executionSummary.errors.length })}
                </span>
              </h4>
              <div className="border border-line rounded-lg overflow-hidden max-h-48 overflow-y-auto bg-canvas">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="text-danger border-b border-line">
                      <th className="py-2 px-3 w-24">{t("excelImport.stepExecution.colExcelRow")}</th>
                      <th className="py-2 px-3">{t("excelImport.stepExecution.colColumn")}</th>
                      <th className="py-2 px-3">{t("excelImport.stepExecution.colValue")}</th>
                      <th className="py-2 px-3">{t("excelImport.stepExecution.colCause")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line text-danger">
                    {executionSummary.errors.map((err, i) => (
                      <tr key={i}>
                        <td className="py-1.5 px-3 font-bold text-danger">
                          #{err.row_index}
                        </td>
                        <td className="py-1.5 px-3">{err.column || "—"}</td>
                        <td className="py-1.5 px-3 max-w-48 truncate">
                          {err.value ?? "—"}
                        </td>
                        <td className="py-1.5 px-3 text-[11px]">
                          {err.error_message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-4 border border-line rounded-xl flex items-center space-x-3 text-xs text-success font-mono">
              <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              <span>
                {dryRun
                  ? t("excelImport.stepExecution.dryRunSuccess", { count: executionSummary.successful_rows.toLocaleString() })
                  : t("excelImport.stepExecution.importSuccess")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
