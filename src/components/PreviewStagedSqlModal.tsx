import React, { useState } from "react";
import { X, Copy, Check, Terminal, Play, AlertCircle } from "lucide-react";
import { useIsLightTheme } from "../stores/preferenceStore";

interface PreviewStagedSqlModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: () => void;
  sqlStatements: string[];
  database: string;
  table: string;
  isApplying?: boolean;
}

export const PreviewStagedSqlModal: React.FC<PreviewStagedSqlModalProps> = ({
  isOpen,
  onClose,
  onApply,
  sqlStatements,
  database,
  table,
  isApplying = false,
}) => {
  const isLight = useIsLightTheme();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const fullSql = sqlStatements.join("\n\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn("Could not copy SQL:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-2xl rounded-xl border shadow-2xl flex flex-col max-h-[85vh] overflow-hidden ${
          isLight ? "bg-white border-slate-200" : "bg-[#101216] border-[#222734]"
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b ${
            isLight ? "border-slate-200 bg-slate-50" : "border-[#1d2230] bg-[#141720]"
          }`}
        >
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-orange-500/15 text-orange-400 border border-orange-500/20">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h3 className={`font-semibold text-sm ${isLight ? "text-slate-900" : "text-neutral-100"}`}>
                Vista Previa de Sentencias SQL Transaccionales
              </h3>
              <p className={`text-xs ${isLight ? "text-slate-500" : "text-neutral-400"}`}>
                {database}.{table} — {sqlStatements.length} sentencia(s) en cola
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isLight
                ? "text-slate-400 hover:text-slate-700 hover:bg-slate-200"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <div
            className={`p-3 rounded-lg border text-xs flex items-start space-x-2.5 ${
              isLight
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : "bg-amber-500/10 border-amber-500/20 text-amber-200"
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <div>
              Estas sentencias se enviarán agrupadas atómicamente dentro de un bloque{" "}
              <code className="font-mono font-bold">START TRANSACTION ... COMMIT</code>. Si cualquiera
              falla, se aplicará rollback automático garantizando la integridad.
            </div>
          </div>

          <div className="relative">
            <div className="absolute right-2 top-2 z-10">
              <button
                type="button"
                onClick={handleCopy}
                className={`flex items-center space-x-1.5 px-2.5 py-1 text-xs font-mono rounded-md border transition-colors shadow-xs ${
                  isLight
                    ? "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
                    : "bg-[#181c26] border-[#2b3245] text-neutral-300 hover:bg-[#202636]"
                }`}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copiado" : "Copiar SQL"}</span>
              </button>
            </div>

            <pre
              className={`p-4 rounded-xl font-mono text-xs overflow-x-auto border leading-relaxed ${
                isLight
                  ? "bg-slate-900 text-amber-300 border-slate-700"
                  : "bg-[#0b0c10] text-amber-300/90 border-[#1f2433]"
              }`}
            >
              <code>{fullSql || "-- No hay sentencias SQL en cola"}</code>
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-t ${
            isLight ? "border-slate-200 bg-slate-50" : "border-[#1d2230] bg-[#141720]"
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              isLight
                ? "border-slate-300 text-slate-700 hover:bg-slate-200"
                : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onApply();
            }}
            disabled={isApplying || sqlStatements.length === 0}
            className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-orange-600 hover:bg-orange-500 text-white shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Aplicar Cambios a la Base de Datos</span>
          </button>
        </div>
      </div>
    </div>
  );
};
