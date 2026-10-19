import React, { useState } from "react";
import {
  AlertTriangle,
  ShieldAlert,
  X,
  Play,
  Info,
} from "lucide-react";
import type { SqlSafetyAnalysis } from "../types/database";
import { useConnectionStore } from "../stores/connectionStore";

interface SafeExecutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  analysis: SqlSafetyAnalysis;
  sql: string;
  estimatedAffectedRows?: number | null;
}

export const SafeExecutionModal: React.FC<SafeExecutionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  analysis,
  sql,
  estimatedAffectedRows,
}) => {
  const [confirmedCheckbox, setConfirmedCheckbox] = useState(false);
  const [confirmationWord, setConfirmationWord] = useState("");

  const { connectionStatus } = useConnectionStore();
  const isProduction = connectionStatus.config?.environment === "production";

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isCritical = analysis.danger_level === "Critical" || isProduction;
  const needsWordConfirmation =
    (analysis.danger_level === "Critical" && analysis.operation.includes("Sin WHERE")) ||
    (isProduction && analysis.danger_level === "Critical");

  const canExecute = isCritical
    ? needsWordConfirmation
      ? confirmationWord.trim().toUpperCase() === "CONFIRMAR" && confirmedCheckbox
      : confirmedCheckbox
    : true;

  const handleConfirm = () => {
    if (canExecute) {
      onConfirm();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-line-strong w-full max-w-xl rounded-xl shadow-2xl shadow-red-950/40 flex flex-col overflow-hidden pyro-ember zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 flex items-center justify-between border-b ${
            isCritical
              ? "bg-rose-950/40 border-rose-900/50 text-rose-200"
              : "bg-amber-950/40 border-amber-900/50 text-amber-200"
          }`}
        >
          <div className="flex items-center space-x-2.5">
            {isCritical ? (
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 animate-pulse" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            )}
            <div>
              <h2 className="text-sm font-bold tracking-wide">
                {isCritical ? "Modo Seguro: Operación Crítica Detectada" : "Modo Seguro: Advertencia de Modificación"}
              </h2>
              <div className="text-[11px] opacity-80 font-mono">
                Operación: <span className="font-semibold">{analysis.operation}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs font-sans text-neutral-300">
          {/* Production Warning Notice */}
          {isProduction && (
            <div className="p-3 rounded-lg border border-rose-800/80 bg-rose-950/40 text-rose-200 text-xs leading-relaxed flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
              <div>
                <strong className="text-rose-300">⚠️ ADVERTENCIA: Entorno de PRODUCCIÓN.</strong>
                <p className="text-[11px] text-rose-200/90 mt-0.5">
                  Esta consulta se ejecutará directamente contra la base de datos de producción. Cualquier alteración de esquema o eliminación de registros es inmediata.
                </p>
              </div>
            </div>
          )}

          {/* Dry Run / Affected Rows Impact Preview */}
          {estimatedAffectedRows !== undefined && estimatedAffectedRows !== null && (
            <div className="p-3 rounded-xl border border-rose-500/50 bg-rose-950/40 text-rose-200 text-xs flex items-center space-x-3.5 shadow-lg">
              <div className="px-3 py-2 rounded-lg bg-rose-600/30 border border-rose-500/40 text-rose-300 font-extrabold text-base font-mono shrink-0">
                ~{estimatedAffectedRows.toLocaleString()}
              </div>
              <div className="flex-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 font-mono block">
                  Impacto Calculado (Dry Run)
                </span>
                <p className="text-xs text-rose-200 mt-0.5 leading-snug">
                  Atención: Esta operación afectará aproximadamente a{" "}
                  <strong className="font-bold underline text-white font-mono">
                    {estimatedAffectedRows.toLocaleString()} registro(s)
                  </strong>{" "}
                  en la tabla. ¿Confirmas la ejecución?
                </p>
              </div>
            </div>
          )}

          {/* Warning Message Box */}
          <div
            className={`p-3 rounded-lg border text-xs leading-relaxed flex items-start space-x-2.5 ${
              isCritical
                ? "bg-rose-950/20 border-rose-800/40 text-rose-300"
                : "bg-amber-950/20 border-amber-800/40 text-amber-300"
            }`}
          >
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div>{analysis.message}</div>
              {analysis.affected_scope && (
                <div className="text-[11px] font-mono opacity-90">
                  <span className="font-semibold text-neutral-400">Alcance detectado:</span> {analysis.affected_scope}
                </div>
              )}
              {analysis.is_uncertain && (
                <div className="text-[11px] text-amber-300 font-medium">
                  ⚠️ Advertencia de ambigüedad: La sentencia contiene elementos que no pueden ser evaluados estáticamente con total certeza.
                </div>
              )}
            </div>
          </div>

          {/* Technical Engine Notice (DDL autocommit & Rollback limit) */}
          {(analysis.operation.includes("DROP") ||
            analysis.operation.includes("TRUNCATE") ||
            analysis.operation.includes("ALTER") ||
            analysis.operation.includes("RENAME")) && (
            <div className="p-2.5 rounded-lg border border-amber-900/40 bg-amber-950/20 text-amber-300/90 text-[11px] leading-relaxed">
              <strong>Nota del motor MariaDB/MySQL:</strong> Las sentencias de tipo DDL provocan un <code className="bg-black/40 px-1 py-0.5 rounded text-amber-200">COMMIT</code> implícito e inmediato. No es posible revertir esta operación mediante <code className="bg-black/40 px-1 py-0.5 rounded text-amber-200">ROLLBACK</code>.
            </div>
          )}

          {/* SQL Preview Box */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Sentencia SQL a Ejecutar:
            </div>
            <pre className="p-3 max-h-40 overflow-auto bg-canvas border border-line rounded-lg font-mono text-[11px] text-orange-200 whitespace-pre-wrap select-all">
              {sql.trim()}
            </pre>
          </div>


          {/* Explicit Confirmation Controls for Critical queries */}
          {isCritical && (
            <div className="pt-2 border-t border-line space-y-3">
              {needsWordConfirmation && (
                <div className="space-y-1.5">
                  <label className="text-[11px] text-rose-300 font-medium">
                    Escribe <strong className="font-mono text-white">CONFIRMAR</strong> para habilitar la ejecución masiva:
                  </label>
                  <input
                    type="text"
                    value={confirmationWord}
                    onChange={(e) => setConfirmationWord(e.target.value)}
                    placeholder="CONFIRMAR"
                    className="w-full bg-canvas border border-line-strong focus:border-rose-500 rounded px-3 py-1.5 text-xs text-white font-mono uppercase focus:outline-none"
                  />
                </div>
              )}

              <label className="flex items-start space-x-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmedCheckbox}
                  onChange={(e) => setConfirmedCheckbox(e.target.checked)}
                  className="mt-0.5 rounded border-neutral-700 text-orange-600 focus:ring-0 cursor-pointer"
                />
                <span className="text-[11px] text-neutral-300 leading-normal">
                  Comprendo los riesgos y deseo ejecutar esta consulta destructiva en la base de datos.
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="px-5 py-3 bg-surface border-t border-line flex items-center justify-end space-x-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg border border-line-strong hover:bg-hover text-neutral-300 text-xs font-medium transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canExecute}
            onClick={handleConfirm}
            className={`flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white shadow-lg transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
              isCritical
                ? "bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 shadow-rose-950/50"
                : "bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 shadow-orange-950/50"
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Ejecutar de Todos Modos</span>
          </button>
        </div>
      </div>
    </div>
  );
};
