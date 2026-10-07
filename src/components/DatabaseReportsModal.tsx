import React, { useState, useEffect } from "react";
import {
  FileText,
  Download,
  Copy,
  Loader2,
  X,
  Activity,
  Table,
} from "lucide-react";
import { useAiStore } from "../stores/aiStore";
import { aiService } from "../services/aiService";
import type { GeneratedReport } from "../types/database";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none">
      <div className="bg-[#10131c] border border-[#232a3c] rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-neutral-200">
        {/* Header */}
        <div className="px-6 py-4 bg-[#141824] border-b border-[#202738] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-orange-600/20 border border-orange-500/30 text-orange-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Generador de Informes Profesionales
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Exporta reportes de salud, rendimiento y diccionario de datos en Markdown, HTML o JSON.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-2.5 bg-[#0d1017] border-b border-[#1b2130] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => generateReport("health")}
              className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-colors ${
                reportType === "health"
                  ? "bg-orange-600/30 text-orange-300 border border-orange-500/50 font-semibold"
                  : "bg-[#141824] text-neutral-400 hover:text-neutral-200 border border-[#1e2536]"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Informe de Salud</span>
            </button>
            <button
              onClick={() => generateReport("schema")}
              className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-colors ${
                reportType === "schema"
                  ? "bg-orange-600/30 text-orange-300 border border-orange-500/50 font-semibold"
                  : "bg-[#141824] text-neutral-400 hover:text-neutral-200 border border-[#1e2536]"
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Diccionario de Datos</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            {/* Format toggle */}
            <div className="flex items-center bg-[#141824] border border-[#202738] rounded-md p-0.5 font-mono text-[11px]">
              {(["markdown", "html", "json"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setFormat(fmt)}
                  className={`px-2.5 py-1 rounded transition-colors uppercase ${
                    format === fmt
                      ? "bg-orange-600 text-white font-semibold"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            <button
              onClick={handleCopyContent}
              disabled={!report || isLoading}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#171b26] hover:bg-[#202737] text-neutral-300 border border-[#273044] rounded-md font-medium transition-colors disabled:opacity-50"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copiar</span>
            </button>

            <button
              onClick={handleDownloadReport}
              disabled={!report || isLoading}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-md font-semibold transition-all active:scale-95 disabled:opacity-50 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar Archivo</span>
            </button>
          </div>
        </div>

        {/* Content Preview */}
        <div className="flex-1 overflow-y-auto p-6 font-mono text-xs">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3 text-neutral-400">
              <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
              <p>Generando informe estructurado...</p>
            </div>
          ) : report ? (
            <pre className="p-4 bg-[#0a0c10] border border-[#1d2334] rounded-lg text-neutral-300 whitespace-pre-wrap overflow-x-auto max-h-[60vh]">
              {format === "markdown"
                ? report.markdown
                : format === "html"
                ? report.html
                : JSON.stringify(report.json_data, null, 2)}
            </pre>
          ) : null}

          {copyFeedback && (
            <div className="mt-3 p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 font-mono text-center">
              {copyFeedback}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#141824] border-t border-[#202738] flex items-center justify-between text-[11px] text-neutral-500 font-mono">
          <span>Esquema: {database}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#1e2434] hover:bg-[#283146] text-neutral-300 rounded text-xs font-medium transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
