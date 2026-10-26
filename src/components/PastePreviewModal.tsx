import React, { useEffect } from "react";
import { ClipboardCheck, AlertTriangle, AlertCircle, X, Check } from "lucide-react";
import { useIsLightTheme } from "../stores/preferenceStore";
import type { PasteValidationResult } from "../utils/pasteParser";

interface PastePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  validation: PasteValidationResult;
  targetTableName: string;
}

export const PastePreviewModal: React.FC<PastePreviewModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  validation,
  targetTableName,
}) => {
  const isLight = useIsLightTheme();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && validation.errors.length === 0 && !e.shiftKey) {
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, onConfirm, validation.errors.length]);

  if (!isOpen) return null;

  const hasErrors = validation.errors.length > 0;
  const hasPkModification = validation.pkColumnsAffected.length > 0;
  const previewSlice = validation.changes.slice(0, 50);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-2xl max-h-[85vh] rounded-xl border flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 shadow-2xl ${
          isLight
            ? "bg-white border-slate-200 text-slate-800 shadow-slate-300/60"
            : "bg-surface border-line text-neutral-100 shadow-black/80"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          className={`px-5 py-3.5 border-b flex items-center justify-between shrink-0 ${
            isLight ? "bg-slate-50 border-slate-200" : "bg-raised border-line"
          }`}
        >
          <div className="flex items-center space-x-2.5">
            <div
              className={`p-1.5 rounded-lg border ${
                hasPkModification
                  ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                  : "bg-orange-500/15 text-orange-500 border-orange-500/30"
              }`}
            >
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className={`font-semibold text-sm ${isLight ? "text-slate-900" : "text-neutral-100"}`}>
                Vista Previa de Pegado en Bloque
              </h3>
              <p className={`text-[11px] font-mono ${isLight ? "text-slate-500" : "text-neutral-400"}`}>
                Tabla: <strong className="text-orange-400">{targetTableName}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isLight
                ? "text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800/60"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* Metrics summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              className={`p-2.5 rounded-lg border flex flex-col ${
                isLight ? "bg-slate-50 border-slate-200" : "bg-raised border-line"
              }`}
            >
              <span className="text-[10px] uppercase font-mono text-neutral-400">Total Celdas</span>
              <span className="text-lg font-bold font-mono text-orange-400">{validation.totalCells}</span>
            </div>
            <div
              className={`p-2.5 rounded-lg border flex flex-col ${
                isLight ? "bg-slate-50 border-slate-200" : "bg-raised border-line"
              }`}
            >
              <span className="text-[10px] uppercase font-mono text-neutral-400">Filas Afectadas</span>
              <span className="text-lg font-bold font-mono text-sky-400">{validation.affectedRowsCount}</span>
            </div>
            <div
              className={`p-2.5 rounded-lg border flex flex-col ${
                hasPkModification
                  ? isLight
                    ? "bg-amber-50 border-amber-300"
                    : "bg-amber-950/30 border-amber-800/50"
                  : isLight
                  ? "bg-slate-50 border-slate-200"
                  : "bg-raised border-line"
              }`}
            >
              <span className="text-[10px] uppercase font-mono text-neutral-400">Claves Primarias</span>
              <span
                className={`text-lg font-bold font-mono ${
                  hasPkModification ? "text-amber-400" : "text-emerald-400"
                }`}
              >
                {validation.pkColumnsAffected.length > 0
                  ? validation.pkColumnsAffected.length
                  : "0"}
              </span>
            </div>
            <div
              className={`p-2.5 rounded-lg border flex flex-col ${
                validation.warnings.length > 0
                  ? isLight
                    ? "bg-amber-50 border-amber-300"
                    : "bg-amber-950/30 border-amber-800/50"
                  : isLight
                  ? "bg-slate-50 border-slate-200"
                  : "bg-raised border-line"
              }`}
            >
              <span className="text-[10px] uppercase font-mono text-neutral-400">Advertencias</span>
              <span
                className={`text-lg font-bold font-mono ${
                  validation.warnings.length > 0 ? "text-amber-400" : "text-emerald-400"
                }`}
              >
                {validation.warnings.length}
              </span>
            </div>
          </div>

          {/* Blocking Errors */}
          {hasErrors && (
            <div
              className={`p-3.5 rounded-lg border space-y-1.5 ${
                isLight
                  ? "bg-rose-50 border-rose-300 text-rose-900"
                  : "bg-rose-950/40 border-rose-800/60 text-rose-300"
              }`}
            >
              <div className="flex items-center space-x-2 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                <span>No se puede completar el pegado por los siguientes errores:</span>
              </div>
              <ul className="text-xs list-disc list-inside space-y-0.5 opacity-90">
                {validation.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings */}
          {validation.warnings.length > 0 && !hasErrors && (
            <div
              className={`p-3 rounded-lg border space-y-1.5 max-h-36 overflow-y-auto ${
                isLight
                  ? "bg-amber-50 border-amber-200 text-amber-900"
                  : "bg-amber-950/30 border-amber-800/50 text-amber-300"
              }`}
            >
              <div className="flex items-center space-x-2 text-xs font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>Advertencias de validación:</span>
              </div>
              <ul className="text-[11px] font-mono list-disc list-inside space-y-0.5 opacity-90">
                {validation.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Proposed changes sample table */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium text-neutral-400">
              <span>Cambios que se encolarán:</span>
              <span className="text-[11px] font-mono">
                Mostrando {previewSlice.length} de {validation.changes.length} celda(s)
              </span>
            </div>

            <div
              className={`rounded-lg border overflow-hidden max-h-56 overflow-y-auto ${
                isLight ? "border-slate-200 bg-white" : "border-line bg-canvas"
              }`}
            >
              <table className="w-full text-left text-xs font-mono">
                <thead
                  className={`sticky top-0 text-[10px] uppercase border-b ${
                    isLight
                      ? "bg-slate-100 text-slate-600 border-slate-200"
                      : "bg-raised text-neutral-400 border-line"
                  }`}
                >
                  <tr>
                    <th className="px-3 py-1.5">Fila</th>
                    <th className="px-3 py-1.5">Columna</th>
                    <th className="px-3 py-1.5">Valor Actual</th>
                    <th className="px-3 py-1.5">Nuevo Valor</th>
                    <th className="px-3 py-1.5 text-right">Tipo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/40">
                  {previewSlice.map((ch, idx) => (
                    <tr
                      key={idx}
                      className={
                        isLight
                          ? "hover:bg-slate-50 transition-colors"
                          : "hover:bg-neutral-800/30 transition-colors"
                      }
                    >
                      <td className="px-3 py-1.5 text-neutral-400">#{ch.row + 1}</td>
                      <td className="px-3 py-1.5 font-semibold flex items-center space-x-1">
                        {ch.isPk && <span title="Clave Primaria">🔑</span>}
                        <span>{ch.columnName}</span>
                      </td>
                      <td className="px-3 py-1.5 text-neutral-400 truncate max-w-[140px]">
                        {ch.originalValue === null
                          ? "NULL"
                          : String(ch.originalValue)}
                      </td>
                      <td className="px-3 py-1.5 font-bold text-orange-400 truncate max-w-[160px]">
                        {ch.proposedValue === null ? "NULL" : String(ch.proposedValue)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {ch.isPk ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            PK
                          </span>
                        ) : ch.typeWarning ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            Tipo
                          </span>
                        ) : (
                          <span className="text-[10px] text-neutral-500">Normal</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          className={`px-5 py-3 border-t flex items-center justify-between shrink-0 ${
            isLight ? "bg-slate-50 border-slate-200" : "bg-raised border-line"
          }`}
        >
          <div className="text-[11px] text-neutral-400 font-mono">
            {hasErrors
              ? "Corrige los errores antes de continuar"
              : "Los cambios se agregarán a la cola de pendientes"}
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={onClose}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                isLight
                  ? "bg-white hover:bg-slate-100 text-slate-700 border-slate-300"
                  : "bg-raised hover:bg-hover border-line-strong text-neutral-300"
              }`}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={hasErrors || validation.totalCells === 0}
              onClick={onConfirm}
              className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-accent-fg shadow-md transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Aplicar {validation.totalCells} Cambios</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

