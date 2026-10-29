import React, { useState } from "react";
import { Copy, Check, Terminal, Play, AlertCircle } from "lucide-react";
import { Modal } from "./ui/Modal";

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
    <Modal
      isOpen={true}
      onClose={onClose}
      title={<>Vista Previa de Sentencias SQL Transaccionales</>}
      subtitle={<>{database}.{table} — {sqlStatements.length} sentencia(s) en cola</>}
      icon={<Terminal className="w-4 h-4" />}
      size="md"
      className="max-h-[85vh]"
      bodyClassName="flex flex-col overflow-hidden"
      closeOnBackdrop={false}
      closeOnEscape={false}
    >
      <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <div
            className={`p-3 rounded-lg border text-xs flex items-start space-x-2.5 border-line text-amber-200`}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
            <div>
              Estas sentencias se aplicarán atómicamente dentro de una transacción. Si cualquiera
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
    </Modal>
  );
};
