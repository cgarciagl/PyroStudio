import {
  AlertCircle,
  FileUp,
  Loader2,
} from "lucide-react";
import type { ImportWizard } from "./useImportWizard";

/** Paso 1: elegir el archivo (o soltarlo) y previsualizar hojas y filas. */
export function StepFile({ filePath, setFilePath, selectedSheet, setSelectedSheet, previewData, isLoadingPreview, previewError, isDraggingFile, handleDragOver, handleDragLeave, handleDrop, handlePickFile, loadPreview }: Pick<ImportWizard, "filePath" | "setFilePath" | "selectedSheet" | "setSelectedSheet" | "previewData" | "isLoadingPreview" | "previewError" | "isDraggingFile" | "handleDragOver" | "handleDragLeave" | "handleDrop" | "handlePickFile" | "loadPreview">) {
  return (
    <div className="space-y-5">
      {/* Drag and Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handlePickFile}
        className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer ${
          isDraggingFile
            ? "border-accent bg-accent-soft"
            : "border-line hover:border-accent/50 bg-surface/60 hover:bg-hover"
        }`}
      >
        <div className="flex flex-col items-center justify-center space-y-2 pointer-events-none">
          <div
            className={`p-2.5 rounded-full ${
              isDraggingFile
                ? "bg-accent-soft text-accent-text"
                : "bg-raised text-fg-muted"
            }`}
          >
            <FileUp className="w-5 h-5 text-fg-muted" />
          </div>
          <div>
            <p className="text-xs font-semibold text-fg">
              Arrastra y suelta tu archivo{" "}
              <span className="text-accent-text font-mono">.xlsx</span>,{" "}
              <span className="text-warning font-mono">.csv</span> o{" "}
              <span className="text-fg-muted font-mono">.xls</span> aquí
            </p>
            <p className="text-[11px] text-fg-subtle mt-0.5">
              o haz clic para examinar archivos en tu sistema
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-3 sm:space-y-0 sm:space-x-3">
        <input
          type="text"
          placeholder="Ruta del archivo (.xlsx, .xls, .csv, .tsv, .json, .jsonl)..."
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          className="flex-1 px-3 py-2 bg-raised border border-line rounded-lg text-fg font-mono text-xs placeholder:text-fg-subtle focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={handlePickFile}
          className="flex items-center justify-center space-x-2 px-4 py-2 bg-elevated hover:bg-hover border border-line-strong rounded-lg text-fg text-xs font-medium transition-colors"
        >
          <FileUp className="w-4 h-4 text-fg-muted" />
          <span>Examinar...</span>
        </button>
        {filePath && !isLoadingPreview && (
          <button
            type="button"
            onClick={() => loadPreview(filePath, selectedSheet)}
            className="flex items-center justify-center space-x-1 px-3 py-2 bg-accent-soft hover:bg-hover border border-accent/40 rounded-lg text-accent-text text-xs font-medium transition-colors"
          >
            <span>Cargar</span>
          </button>
        )}
      </div>

      {previewError && (
        <div className="p-3 border border-line rounded-lg text-danger text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-danger" />
          <span>{previewError}</span>
        </div>
      )}

      {isLoadingPreview && (
        <div className="flex flex-col items-center justify-center py-16 space-y-3 text-fg-muted text-xs font-mono">
          <Loader2 className="w-8 h-8 animate-spin text-fg-muted" />
          <span>Leyendo el archivo...</span>
        </div>
      )}

      {previewData && !isLoadingPreview && (
        <div className="space-y-4">
          {/* Sheet switcher and metrics */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            {/\.(csv|tsv|txt|json|jsonl|ndjson)$/i.test(filePath) ? (
              <div className="flex items-center space-x-2">
                <span className="text-fg-muted">Formato detectado:</span>
                <span className="text-fg font-mono">{previewData.selected_sheet}</span>
              </div>
            ) : (
            <div className="flex items-center space-x-2">
              <span className="text-fg-muted">Hoja activa:</span>
              <select
                value={selectedSheet}
                onChange={(e) => {
                  const sheet = e.target.value;
                  setSelectedSheet(sheet);
                  loadPreview(filePath, sheet);
                }}
                className="px-2.5 py-1 bg-raised border border-line rounded text-fg font-mono text-xs focus:outline-none"
              >
                {previewData.sheets.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </select>
            </div>
            )}

            <div className="flex items-center space-x-3 text-fg-muted font-mono text-[11px]">
              <span>{previewData.headers.length} columnas detectadas</span>
              <span>•</span>
              <span className="text-success font-semibold">
                ~{previewData.total_rows.toLocaleString()} filas de datos
              </span>
            </div>
          </div>

          {/* 50-row preview table */}
          <div className="border border-line rounded-lg overflow-x-auto max-h-72 bg-surface">
            <table className="w-full text-left text-xs border-collapse font-mono">
              <thead>
                <tr className="bg-raised text-accent-text font-semibold border-b border-line sticky top-0">
                  <th className="py-2 px-3 w-10 text-center text-fg-subtle">
                    #
                  </th>
                  {previewData.headers.map((h, i) => (
                    <th key={i} className="py-2 px-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {previewData.preview_rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-hover">
                    <td className="py-1.5 px-3 text-center text-fg-subtle text-[11px]">
                      {rowIdx + 1}
                    </td>
                    {row.map((cell, cellIdx) => (
                      <td
                        key={cellIdx}
                        className="py-1.5 px-3 text-fg whitespace-nowrap max-w-xs truncate"
                      >
                        {cell === null ? (
                          <span className="text-fg-subtle italic">
                            NULL
                          </span>
                        ) : (
                          String(cell)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-fg-subtle italic">
            * Mostrando muestra de las primeras 50 filas para verificar estructura y tipos antes de importar.
          </div>
        </div>
      )}
    </div>
  );
}
