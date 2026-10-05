import React, { useState } from "react";
import {
  AlertTriangle,
  ShieldAlert,
  X,
  Play,
  Info,
} from "lucide-react";
import type { SqlSafetyAnalysis } from "../types/database";

interface SafeExecutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  analysis: SqlSafetyAnalysis;
  sql: string;
}

export const SafeExecutionModal: React.FC<SafeExecutionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  analysis,
  sql,
}) => {
  const [confirmedCheckbox, setConfirmedCheckbox] = useState(false);
  const [confirmationWord, setConfirmationWord] = useState("");

  if (!isOpen) return null;

  const isCritical = analysis.danger_level === "Critical";
  const needsWordConfirmation = isCritical && analysis.operation.includes("Sin WHERE");

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#10131b] border border-[#2b3347] w-full max-w-xl rounded-xl shadow-2xl shadow-red-950/40 flex flex-col overflow-hidden">
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
          {/* Warning Message Box */}
          <div
            className={`p-3 rounded-lg border text-xs leading-relaxed flex items-start space-x-2.5 ${
              isCritical
                ? "bg-rose-950/20 border-rose-800/40 text-rose-300"
                : "bg-amber-950/20 border-amber-800/40 text-amber-300"
            }`}
          >
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div>{analysis.message}</div>
          </div>

          {/* SQL Preview Box */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Sentencia SQL a Ejecutar:
            </div>
            <pre className="p-3 max-h-40 overflow-auto bg-[#0a0c10] border border-[#1e2434] rounded-lg font-mono text-[11px] text-orange-200 whitespace-pre-wrap select-all">
              {sql.trim()}
            </pre>
          </div>

          {/* Explicit Confirmation Controls for Critical queries */}
          {isCritical && (
            <div className="pt-2 border-t border-[#1e2434] space-y-3">
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
                    className="w-full bg-[#0a0c10] border border-[#2b3347] focus:border-rose-500 rounded px-3 py-1.5 text-xs text-white font-mono uppercase focus:outline-none"
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
        <div className="px-5 py-3 bg-[#0d1017] border-t border-[#1b202e] flex items-center justify-end space-x-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg border border-[#2a3246] hover:bg-[#1a202e] text-neutral-300 text-xs font-medium transition-colors"
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
