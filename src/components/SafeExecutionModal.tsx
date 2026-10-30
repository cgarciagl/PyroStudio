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
import { iconBtn, modalHeader, modalTitle, secondaryBtn } from "./ui/styles";

interface SafeExecutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  analysis: SqlSafetyAnalysis;
  sql: string;
  estimatedAffectedRows?: number | null;
  /** Active database; in Production, critical statements require typing it. */
  database?: string;
}

/** Text the user must type before a critical statement can run. */
export function requiredConfirmationText(
  isProduction: boolean,
  database: string | undefined,
): string {
  return isProduction && database?.trim() ? database.trim() : "CONFIRMAR";
}

/** Whether `typed` matches the required text (database names are case-sensitive). */
export function confirmationMatches(typed: string, required: string): boolean {
  return required === "CONFIRMAR"
    ? typed.trim().toUpperCase() === required
    : typed.trim() === required;
}

export const SafeExecutionModal: React.FC<SafeExecutionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  analysis,
  sql,
  estimatedAffectedRows,
  database,
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

  const requiredText = requiredConfirmationText(isProduction, database);
  const canExecute = isCritical
    ? needsWordConfirmation
      ? confirmationMatches(confirmationWord, requiredText) && confirmedCheckbox
      : confirmedCheckbox
    : true;

  const handleConfirm = () => {
    if (canExecute) {
      onConfirm();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-line-strong w-full max-w-xl rounded-xl shadow-sm flex flex-col overflow-hidden zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={modalHeader}
        >
          <div className="flex items-center space-x-2.5">
            {isCritical ? (
              <ShieldAlert className="w-5 h-5 text-danger shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
            )}
            <div>
              <h2 className={modalTitle}>
                {isCritical ? "Modo Seguro: Operación Crítica Detectada" : "Modo Seguro: Advertencia de Modificación"}
              </h2>
              <div className="text-[11px] opacity-80 font-mono">
                Operación: <span className="font-semibold">{analysis.operation}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className={iconBtn}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs font-sans text-fg">
          {/* Production Warning Notice */}
          {isProduction && (
            <div className="p-3 rounded-lg border border-line bg-surface text-danger text-xs leading-relaxed flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5 text-danger shrink-0" />
              <div>
                <strong className="text-danger">⚠️ ADVERTENCIA: Entorno de PRODUCCIÓN.</strong>
                <p className="text-[11px] text-danger mt-0.5">
                  Esta consulta se ejecutará directamente contra la base de datos de producción. Cualquier alteración de esquema o eliminación de registros es inmediata.
                </p>
              </div>
            </div>
          )}

          {/* Dry Run / Affected Rows Impact Preview */}
          {estimatedAffectedRows !== undefined && estimatedAffectedRows !== null && (
            <div className="p-3 rounded-xl border border-line bg-surface text-danger text-xs flex items-center space-x-3.5">
              <div className="px-3 py-2 rounded-lg bg-raised border border-line text-danger font-bold text-sm font-mono shrink-0">
                ~{estimatedAffectedRows.toLocaleString()}
              </div>
              <div className="flex-1">
                <span className="text-[11px] font-medium text-danger font-mono block">
                  Impacto Calculado (Dry Run)
                </span>
                <p className="text-xs text-danger mt-0.5 leading-snug">
                  Atención: Esta operación afectará aproximadamente a{" "}
                  <strong className="font-bold underline text-fg font-mono">
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
                ? "bg-surface border-line text-danger"
                : "bg-surface border-line text-warning"
            }`}
          >
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div>{analysis.message}</div>
              {analysis.affected_scope && (
                <div className="text-[11px] font-mono opacity-90">
                  <span className="font-semibold text-fg-muted">Alcance detectado:</span> {analysis.affected_scope}
                </div>
              )}
              {analysis.is_uncertain && (
                <div className="text-[11px] text-warning font-medium">
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
            <div className="p-2.5 rounded-lg border border-line bg-surface text-warning/90 text-[11px] leading-relaxed">
              <strong>Nota del motor MariaDB/MySQL:</strong> Las sentencias de tipo DDL provocan un <code className="bg-raised px-1 py-0.5 rounded text-warning">COMMIT</code> implícito e inmediato. No es posible revertir esta operación mediante <code className="bg-raised px-1 py-0.5 rounded text-warning">ROLLBACK</code>.
            </div>
          )}

          {/* SQL Preview Box */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-fg-muted">
              Sentencia SQL a Ejecutar:
            </div>
            <pre className="p-3 max-h-40 overflow-auto bg-canvas border border-line rounded-lg font-mono text-[11px] text-accent-text whitespace-pre-wrap select-all">
              {sql.trim()}
            </pre>
          </div>


          {/* Explicit Confirmation Controls for Critical queries */}
          {isCritical && (
            <div className="pt-2 border-t border-line space-y-3">
              {needsWordConfirmation && (
                <div className="space-y-1.5">
                  <label className="text-[11px] text-danger font-medium">
                    {requiredText === "CONFIRMAR" ? (
                      <>
                        Escribe <strong className="font-mono text-fg">CONFIRMAR</strong> para habilitar la ejecución masiva:
                      </>
                    ) : (
                      <>
                        Escribe el nombre de la base <strong className="font-mono text-fg">{requiredText}</strong> para confirmar en producción:
                      </>
                    )}
                  </label>
                  <input
                    type="text"
                    value={confirmationWord}
                    onChange={(e) => setConfirmationWord(e.target.value)}
                    placeholder={requiredText}
                    autoComplete="off"
                    spellCheck={false}
                    className={`w-full bg-canvas border border-line-strong focus:border-accent rounded px-3 py-1.5 text-xs text-fg font-mono focus:outline-none ${
                      requiredText === "CONFIRMAR" ? "uppercase" : ""
                    }`}
                  />
                </div>
              )}

              <label className="flex items-start space-x-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmedCheckbox}
                  onChange={(e) => setConfirmedCheckbox(e.target.checked)}
                  className="mt-0.5 rounded border-line-strong text-accent-text focus:ring-0 cursor-pointer"
                />
                <span className="text-[11px] text-fg leading-normal">
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
            className={secondaryBtn}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canExecute}
            onClick={handleConfirm}
            className={`flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-accent-fg shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              isCritical
                ? "bg-danger hover:opacity-90"
                : "bg-accent hover:bg-accent-hover"
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
