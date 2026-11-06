import React, { useState } from "react";
import { Check, Copy, Download, FileCode, Play } from "lucide-react";
import { buildIndexAdvisorSqlScript, exportIndexAdvisorSql } from "../services/diagnosticExport";
import type { IndexAdvisorReport, IndexRecommendation } from "../types/database";
import { Modal } from "./ui/Modal";
import { primaryBtn, secondaryBtn } from "./ui/styles";

interface IndexAdvisorScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: IndexAdvisorReport;
  /** Recomendaciones a incluir; por defecto todas las del informe. */
  recommendations?: IndexRecommendation[];
  /** Abre el script en una pestaña de consulta. */
  onOpenInEditor: (sql: string) => void;
  /** Texto que describe el alcance (p. ej. «tabla clientes»). */
  scopeLabel?: string;
}

/** Vista previa del script SQL del Asesor de índices: copiar, descargar o abrir en consulta. */
export const IndexAdvisorScriptModal: React.FC<IndexAdvisorScriptModalProps> = ({
  isOpen,
  onClose,
  report,
  recommendations = report.recommendations,
  onOpenInEditor,
  scopeLabel,
}) => {
  const [copied, setCopied] = useState(false);
  const database = report.database_name;
  const script = isOpen ? buildIndexAdvisorSqlScript(report, recommendations) : "";

  const handleCopy = () => {
    navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Script SQL de recomendaciones"
      subtitle={`${recommendations.length} sentencia(s) · base de datos ${database}${scopeLabel ? ` · ${scopeLabel}` : ""}`}
      icon={<FileCode className="w-4 h-4 text-accent-text" />}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className={secondaryBtn}>
            Cerrar
          </button>
          <button onClick={handleCopy} className={secondaryBtn}>
            {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "Copiado" : "Copiar"}</span>
          </button>
          <button onClick={() => exportIndexAdvisorSql(report, recommendations)} className={secondaryBtn}>
            <Download className="w-3.5 h-3.5" />
            <span>Descargar .sql</span>
          </button>
          <button
            onClick={() => {
              onOpenInEditor(script);
              onClose();
            }}
            className={primaryBtn}
          >
            <Play className="w-3.5 h-3.5" />
            <span>Abrir en consulta</span>
          </button>
        </>
      }
    >
      <p className="text-xs text-fg-muted mb-2">
        El script comienza con <code className="font-mono text-fg">USE</code> para ejecutarse sobre{" "}
        <strong className="font-mono text-fg">{database}</strong>. Nada se ejecuta automáticamente.
      </p>
      <pre className="p-3 bg-canvas border border-line rounded-lg font-mono text-xs text-fg overflow-auto max-h-[60vh] whitespace-pre select-text">
        {script}
      </pre>
    </Modal>
  );
};
