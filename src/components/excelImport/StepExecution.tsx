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
export function StepExecution({ previewData, targetType, selectedExistingTable, newTableName, importMode, batchSize, dryRun, isExecuting, progress, executionSummary, executionError, handleExecuteImport }: Pick<ImportWizard, "previewData" | "targetType" | "selectedExistingTable" | "newTableName" | "importMode" | "batchSize" | "dryRun" | "isExecuting" | "progress" | "executionSummary" | "executionError" | "handleExecuteImport">) {
  return (
    <div className="space-y-6">
      {!executionSummary && !isExecuting && !executionError && (
        <div className="text-center py-10 space-y-4">
          <div className="w-14 h-14 rounded-xl bg-accent-soft border border-accent/30 flex items-center justify-center mx-auto text-accent-text">
            <Play className="w-7 h-7 fill-current ml-1" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-fg">
              Listo para procesar ~{previewData?.total_rows.toLocaleString()} filas
            </h3>
            <p className="text-xs text-fg-muted mt-1 max-w-md mx-auto">
              Tabla destino:{" "}
              <strong className="text-accent-text font-mono">
                {targetType === "new" ? newTableName : selectedExistingTable}
              </strong>{" "}
              ({targetType === "new" ? "Nueva tabla" : "Tabla existente"}). Modo:{" "}
              <strong className="text-warning font-mono">
                {importMode}
              </strong>.
            </p>
          </div>
          <button
            onClick={handleExecuteImport}
            className={primaryBtn}
          >
            {dryRun ? "Ejecutar simulación" : "Iniciar Importación Masiva"}
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
                {progress?.stage || "Procesando importación..."}
              </h3>
              <p className="text-xs text-fg-muted font-mono mt-0.5 truncate">
                Destino:{" "}
                <span className="text-accent-text font-bold">
                  {targetType === "new" ? newTableName : selectedExistingTable}
                </span>{" "}
                • Modo:{" "}
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
                Procesadas:{" "}
                <strong className="text-fg">
                  {(progress?.current_row || 0).toLocaleString()}
                </strong>{" "}
                /{" "}
                {(
                  progress?.total_rows ||
                  previewData?.total_rows ||
                  0
                ).toLocaleString()}{" "}
                filas
              </span>
              <span className="text-warning/90 font-medium">
                Lotes de {batchSize.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Live Counters & Speed */}
          <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-line text-left">
            <div className="p-2.5 rounded-lg border border-line flex items-center justify-between">
              <span className="text-[11px] text-success font-mono">
                Exitosas:
              </span>
              <span className="text-xs font-bold font-mono text-success">
                {(progress?.successful_rows || 0).toLocaleString()}
              </span>
            </div>
            <div className="p-2.5 rounded-lg border border-line flex items-center justify-between">
              <span className="text-[11px] text-danger font-mono">
                Errores:
              </span>
              <span className="text-xs font-bold font-mono text-danger">
                {(progress?.failed_rows || 0).toLocaleString()}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-accent-soft border border-accent/30 flex items-center justify-between">
              <span className="text-[11px] text-accent-text font-mono flex items-center gap-1">
                <Zap className="w-3 h-3 shrink-0 text-fg-muted" />
                Velocidad:
              </span>
              <span className="text-xs font-bold font-mono text-accent-text">
                {progress?.rows_per_sec
                  ? `${progress.rows_per_sec.toLocaleString()} f/s`
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
                  reportError("No se pudo cancelar la importación", err);
                }
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg hover:bg-hover border border-line text-danger text-xs font-medium transition-colors cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5 text-danger" />
              <span>Abortar Importación</span>
            </button>
          </div>
        </div>
      )}

      {executionError && (
        <div className="p-4 border border-line rounded-xl text-danger text-xs font-mono space-y-2">
          <div className="flex items-center space-x-2 font-bold text-danger">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>Error al ejecutar la importación:</span>
          </div>
          <p className="whitespace-pre-wrap">{executionError}</p>
          <button
            type="button"
            onClick={handleExecuteImport}
            className="mt-2 px-3 py-1.5 bg-danger hover:opacity-90 text-accent-fg rounded text-xs font-semibold"
          >
            Reintentar
          </button>
        </div>
      )}

      {executionSummary && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Metric Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-raised border border-line">
              <span className="text-[11px] text-fg-muted block mb-1">
                Total Procesadas
              </span>
              <span className="text-base font-semibold font-mono text-fg">
                {executionSummary.total_processed.toLocaleString()}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-line">
              <span className="text-[11px] text-success block mb-1">
                {dryRun ? "Filas válidas (estimadas)" : "Importadas"}
              </span>
              <span className="text-base font-semibold font-mono text-success">
                {executionSummary.successful_rows.toLocaleString()}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-line">
              <span className="text-[11px] text-danger block mb-1">
                Omitidas
              </span>
              <span className="text-base font-semibold font-mono text-danger">
                {(executionSummary.skipped_rows ?? executionSummary.failed_rows).toLocaleString()}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-raised border border-line">
              <span className="text-[11px] text-fg-muted block mb-1">
                Errores detectados
              </span>
              <span className="text-base font-semibold font-mono text-accent-text">
                {(executionSummary.error_count ?? executionSummary.errors.length).toLocaleString()}
              </span>
            </div>
          </div>
          <p className="text-right text-[11px] text-fg-subtle">
            {dryRun ? "Validación" : "Importación"} completada en{" "}
            {(executionSummary.execution_time_ms / 1000).toFixed(2)} s
          </p>

          {/* Errors table if any */}
          {executionSummary.errors.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-danger flex items-center space-x-1.5">
                <AlertCircle className="w-4 h-4" />
                <span>
                  Registro de incidencias ({executionSummary.errors.length} mostradas):
                </span>
              </h4>
              <div className="border border-line rounded-lg overflow-hidden max-h-48 overflow-y-auto bg-canvas">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="text-danger border-b border-line">
                      <th className="py-2 px-3 w-24">Fila Excel</th>
                      <th className="py-2 px-3">Columna</th>
                      <th className="py-2 px-3">Valor</th>
                      <th className="py-2 px-3">Causa</th>
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
                  ? `Dry Run correcto: ${executionSummary.successful_rows.toLocaleString()} filas listas para importar. No se modificó la base de datos.`
                  : "¡Importación 100% exitosa! Todas las filas se sincronizaron en MariaDB sin inconsistencias."}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
