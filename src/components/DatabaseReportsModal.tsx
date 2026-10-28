import React, { useState, useEffect } from "react";
import {
  FileText,
  Download,
  Copy,
  Loader2,
  X,
  Activity,
  Table,
  Eye,
  Code,
  Check,
} from "lucide-react";
import { useAiStore } from "../stores/aiStore";
import { aiService } from "../services/aiService";
import type { GeneratedReport } from "../types/database";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { primaryBtn, secondaryBtn } from "./ui/styles";

interface DatabaseReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
}

export const DatabaseReportsModal: React.FC<DatabaseReportsModalProps> = ({
  isOpen,
  onClose,
  database,
}) => {
  const { config } = useAiStore();
  const [reportType, setReportType] = useState<"health" | "schema">("health");
  const [format, setFormat] = useState<"markdown" | "html" | "json">("markdown");
  const [viewMode, setViewMode] = useState<"rendered" | "raw">("rendered");
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const generateReport = async (type: "health" | "schema") => {
    setReportType(type);
    setIsLoading(true);
    try {
      const res = await aiService.generateDatabaseReportAi(
        database,
        type,
        config.enabled ? config : undefined,
      );
      setReport(res);
    } catch (err) {
      console.error("Report generation error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      generateReport("health");
    }
  }, [isOpen, database]);

  if (!isOpen) return null;

  const handleCopyContent = () => {
    if (!report) return;
    const textToCopy =
      format === "markdown"
        ? report.markdown
        : format === "html"
        ? report.html
        : JSON.stringify(report.json_data, null, 2);
    navigator.clipboard.writeText(textToCopy);
    setCopyFeedback(`¡Informe (${format.toUpperCase()}) copiado!`);
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  const handleDownloadReport = () => {
    if (!report) return;
    const extension = format === "markdown" ? "md" : format === "html" ? "html" : "json";
    const mime =
      format === "markdown"
        ? "text/markdown"
        : format === "html"
        ? "text/html"
        : "application/json";
    const text =
      format === "markdown"
        ? report.markdown
        : format === "html"
        ? report.html
        : JSON.stringify(report.json_data, null, 2);

    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte_${database}_${reportType}_${Date.now()}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
      <div className="bg-surface border border-line rounded-xl shadow-modal w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-fg">
        {/* Header */}
        <div className="px-6 py-4 bg-raised border-b border-line flex items-center justify-between select-none">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-accent-soft border border-accent/30 text-accent-text">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-fg tracking-tight">
                Generador de Informes Profesionales
              </h2>
              <p className="text-xs text-fg-muted mt-0.5">
                Exporta reportes de salud, rendimiento y diccionario de datos en Markdown, HTML o JSON.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-hover text-fg-muted hover:text-fg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-2.5 bg-surface border-b border-line flex flex-wrap items-center justify-between gap-3 text-xs select-none">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => generateReport("health")}
              className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-colors ${
                reportType === "health"
                  ? "bg-accent/30 text-accent-text border border-accent/50 font-semibold"
                  : "bg-raised text-fg-muted hover:text-fg border border-line"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Informe de Salud</span>
            </button>
            <button
              onClick={() => generateReport("schema")}
              className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-colors ${
                reportType === "schema"
                  ? "bg-accent/30 text-accent-text border border-accent/50 font-semibold"
                  : "bg-raised text-fg-muted hover:text-fg border border-line"
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Diccionario de Datos</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            {/* Format toggle */}
            <div className="flex items-center bg-raised border border-line rounded-md p-0.5 font-mono text-[11px]">
              {(["markdown", "html", "json"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setFormat(fmt)}
                  className={`px-2.5 py-1 rounded transition-colors uppercase ${
                    format === fmt
                      ? "bg-accent text-accent-fg font-semibold"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            {/* View Mode Toggle (Rendered vs Code) for markdown */}
            {format === "markdown" && (
              <div className="flex items-center bg-raised border border-line rounded-md p-0.5 text-[11px]">
                <button
                  onClick={() => setViewMode("rendered")}
                  title="Ver contenido formateado"
                  className={`px-2 py-1 rounded flex items-center space-x-1 transition-colors ${
                    viewMode === "rendered"
                      ? "bg-elevated text-accent-text font-semibold shadow-xs"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>Formato</span>
                </button>
                <button
                  onClick={() => setViewMode("raw")}
                  title="Ver código fuente Markdown"
                  className={`px-2 py-1 rounded flex items-center space-x-1 transition-colors ${
                    viewMode === "raw"
                      ? "bg-elevated text-accent-text font-semibold shadow-xs"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  <Code className="w-3 h-3" />
                  <span>Código</span>
                </button>
              </div>
            )}

            <button
              onClick={handleCopyContent}
              disabled={!report || isLoading}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-raised hover:bg-hover text-fg border border-line-strong rounded-md font-medium transition-colors disabled:opacity-50"
            >
              {copyFeedback ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copyFeedback ? "¡Copiado!" : "Copiar"}</span>
            </button>

            <button
              onClick={handleDownloadReport}
              disabled={!report || isLoading}
              className={primaryBtn}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar Archivo</span>
            </button>
          </div>
        </div>

        {/* Content Preview */}
        <div className="flex-1 overflow-y-auto p-6 text-xs select-text">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3 text-fg-muted select-none">
              <Loader2 className="w-8 h-8 animate-spin text-fg-muted" />
              <p className="font-mono">Generando informe estructurado...</p>
            </div>
          ) : report ? (
            format === "markdown" && viewMode === "rendered" ? (
              <div className="p-5 bg-canvas border border-line rounded-lg select-text min-h-[300px]">
                <MarkdownRenderer content={report.markdown} />
              </div>
            ) : (
              <pre className="p-4 bg-canvas border border-line rounded-lg text-fg font-mono whitespace-pre-wrap overflow-x-auto select-text cursor-text max-h-[60vh]">
                {format === "markdown"
                  ? report.markdown
                  : format === "html"
                  ? report.html
                  : JSON.stringify(report.json_data, null, 2)}
              </pre>
            )
          ) : null}

          {copyFeedback && (
            <div className="mt-3 p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-success font-mono text-center select-none">
              {copyFeedback}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-raised border-t border-line flex items-center justify-between text-[11px] text-fg-subtle font-mono">
          <span>Esquema: {database}</span>
          <button
            onClick={onClose}
            className={secondaryBtn}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
