import React, { useState } from "react";
import { X, Copy, Check, Terminal, Play, AlertCircle } from "lucide-react";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
      <div
        className={`w-full max-w-2xl rounded-xl border shadow-modal flex flex-col max-h-[85vh] overflow-hidden bg-surface border-line`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b border-line bg-raised`}
        >
          <div className="flex items-center space-x-2.5">
            <div className="text-fg-muted">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h3 className={`font-semibold text-sm text-fg`}>
                Vista Previa de Sentencias SQL Transaccionales
              </h3>
              <p className={`text-xs text-fg-muted`}>
                {database}.{table} — {sqlStatements.length} sentencia(s) en cola
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors text-fg-muted hover:text-fg hover:bg-hover`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <div
            className={`p-3 rounded-lg border text-xs flex items-start space-x-2.5 bg-amber-500/10 border-amber-500/20 text-amber-200`}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
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
                className={`flex items-center space-x-1.5 px-2.5 py-1 text-xs font-mono rounded-md border transition-colors shadow-xs bg-raised border-line-strong text-fg hover:bg-hover`}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copiado" : "Copiar SQL"}</span>
              </button>
            </div>

            <pre
              className={`p-4 rounded-xl font-mono text-xs overflow-x-auto border leading-relaxed bg-canvas text-warning/90 border-line`}
            >
              <code className={!fullSql ? ("text-fg-subtle italic") : ""}>
                {fullSql || "-- No hay sentencias SQL en cola"}
              </code>
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-t border-line bg-raised`}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors border-line-strong text-fg hover:bg-hover`}
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
            className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-accent hover:bg-accent-hover text-accent-fg shadow-md transition-all disabled:opacity-50 disabled:pointer-events-none"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Aplicar Cambios a la Base de Datos</span>
          </button>
        </div>
      </div>
    </div>
  );
};
