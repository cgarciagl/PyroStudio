import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Bot,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Copy,
  Download,
  Loader2,
  ShieldCheck,
  X,
  Code2,
  RefreshCw,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import type { SqlAssistantDiagnosis, AiDatabaseContext } from "../types/database";
import { iconBtn, modalHeader, modalTitle, secondaryBtn } from "./ui/styles";

interface SqlAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  query: string;
  errorMessage?: string;
  onApplyRewrite?: (newQuery: string) => void;
}

export const SqlAssistantModal: React.FC<SqlAssistantModalProps> = ({
  isOpen,
  onClose,
  database,
  query,
  errorMessage,
  onApplyRewrite,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<"heuristic" | "ai_context">("heuristic");
  const [isLoading, setIsLoading] = useState(false);
  const [diagnosis, setDiagnosis] = useState<SqlAssistantDiagnosis | null>(null);
  const [aiContext, setAiContext] = useState<AiDatabaseContext | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDiagnosis = async () => {
    if (!query.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const diag = await dbService.diagnoseQueryWithMetadata(query, database);
      setDiagnosis(diag);

      const ctx = await dbService.buildSanitizedAiContext(
        database,
        [],
        query,
        errorMessage,
        true,
      );
      setAiContext(ctx);
    } catch (err: unknown) {
      console.error("Diagnosis error:", err);
      setError(
        typeof err === "string" ? err : (err as Error)?.message || "Error al analizar la consulta.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && query.trim()) {
      runDiagnosis();
    }
  }, [isOpen, query, database]);

  if (!isOpen) return null;

  const handleCopyAiPrompt = () => {
    if (!aiContext) return;
    const promptText = `
### Contexto de Base de Datos (MariaDB / MySQL)
- Base de datos: \`${aiContext.database_name}\`
- Versión del Servidor: ${aiContext.server_version}

### Definiciones DDL de Tablas:
\`\`\`sql
${aiContext.selected_tables_ddl.join("\n\n")}
\`\`\`

### Consulta SQL Objetivo:
\`\`\`sql
${aiContext.query || query}
\`\`\`
${
  aiContext.error_message
    ? `\n### Error Detectado:\n\`\`\`text\n${aiContext.error_message}\n\`\`\`\n`
    : ""
}
${
  aiContext.table_statistics
    ? `\n### Estadísticas de Tablas:\n${aiContext.table_statistics}\n`
    : ""
}
### Instrucciones para la IA (Responder en Español):
Por favor diagnostica posibles cuellos de botella de rendimiento, revisa la sintaxis, comprueba el uso de índices y propón una consulta reescrita y optimizada con explicaciones detalladas en español.
`.trim();

    navigator.clipboard.writeText(promptText);
    setCopyFeedback("¡Prompt para IA copiado al portapapeles!");
    setTimeout(() => setCopyFeedback(null), 3500);
  };

  const handleDownloadAiContextJson = () => {
    if (!aiContext) return;
    const blob = new Blob([JSON.stringify(aiContext, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai_context_${database}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
      <div className="bg-surface border border-line rounded-xl shadow-modal w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-fg">
        {/* Modal Header */}
        <div className={modalHeader}>
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-accent-soft border border-accent/30 text-accent-text">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className={modalTitle}>
                  Asistente SQL & Diagnóstico con Metadatos
                </h2>
                <span className="text-[11px] uppercase font-mono px-2 py-0.5 rounded text-success border border-line flex items-center space-x-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Local, sin enviar datos</span>
                </span>
              </div>
              <p className="text-xs text-fg-muted mt-0.5">
                Diagnóstico de anti-patrones, heurísticas de índices y exportación segura para LLMs.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={runDiagnosis}
              disabled={isLoading}
              title="Volver a analizar"
              className="p-1.5 rounded bg-elevated hover:bg-hover text-fg-muted hover:text-fg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-accent-text" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className={iconBtn}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-tab navigation */}
        <div className="px-6 bg-surface border-b border-line flex items-center space-x-4 text-xs font-medium">
          <button
            onClick={() => setActiveSubTab("heuristic")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeSubTab === "heuristic"
                ? "border-accent text-accent-text font-semibold"
                : "border-transparent text-fg-muted hover:text-fg"
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>Diagnóstico heurístico local</span>
          </button>
          <button
            onClick={() => setActiveSubTab("ai_context")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeSubTab === "ai_context"
                ? "border-line text-fg-muted font-semibold"
                : "border-transparent text-fg-muted hover:text-fg"
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>Capa de Contexto para IA (Desacoplada)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 font-sans text-xs select-text">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3 text-fg-muted">
              <Loader2 className="w-8 h-8 animate-spin text-fg-muted" />
              <p className="font-mono text-xs">Analizando sintaxis, claves e índices de la base de datos...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg border border-line text-danger font-mono">
              <div className="font-bold flex items-center space-x-2 text-red-200">
                <AlertTriangle className="w-4 h-4 text-danger" />
                <span>Error en el diagnóstico</span>
              </div>
              <p className="mt-1">{error}</p>
            </div>
          ) : activeSubTab === "heuristic" ? (
            diagnosis && (
              <div className="space-y-4">
                {/* Status Summary Banner */}
                <div
                  className={`p-4 rounded-lg border flex items-start space-x-3 ${
                    diagnosis.issues.length === 0
                      ? "border-line text-success"
                      : "border-line text-amber-200"
                  }`}
                >
                  {diagnosis.issues.length === 0 ? (
                    <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h4 className="font-semibold text-sm">
                      {diagnosis.issues.length === 0
                        ? "Consulta sin problemas estructurales evidentes"
                        : `${diagnosis.issues.length} observación(es) detectada(s)`}
                    </h4>
                    <p className="text-fg mt-1">{diagnosis.explanation}</p>
                  </div>
                </div>

                {/* Detected Issues */}
                {diagnosis.issues.length > 0 && (
                  <div className="bg-raised border border-line rounded-lg p-4 space-y-2">
                    <h5 className="font-semibold text-fg flex items-center space-x-2">
                      <AlertTriangle className="w-4 h-4 text-warning" />
                      <span>Observaciones y Anti-patrones</span>
                    </h5>
                    <ul className="space-y-1.5 pl-6 list-disc text-fg font-mono text-[11px]">
                      {diagnosis.issues.map((issue, idx) => (
                        <li key={idx}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggested Indexes */}
                {diagnosis.suggested_indexes.length > 0 && (
                  <div className="bg-raised border border-line rounded-lg p-4 space-y-3">
                    <h5 className="font-semibold text-fg flex items-center space-x-2">
                      <Lightbulb className="w-4 h-4 text-fg-muted" />
                      <span>Índices Recomendados</span>
                    </h5>
                    <div className="space-y-2">
                      {diagnosis.suggested_indexes.map((sqlIdx, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2.5 bg-surface border border-line rounded font-mono text-xs text-accent-text"
                        >
                          <code className="truncate mr-2">{sqlIdx}</code>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(sqlIdx);
                              setCopyFeedback(`¡Índice #${idx + 1} copiado!`);
                              setTimeout(() => setCopyFeedback(null), 2500);
                            }}
                            className="px-2 py-1 bg-elevated hover:bg-hover text-fg rounded border border-line-strong shrink-0 text-[11px] flex items-center space-x-1"
                          >
                            <Copy className="w-3 h-3" />
                            <span>Copiar</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggested Query Rewrite */}
                {diagnosis.suggested_query_rewrite && (
                  <div className="bg-raised border border-line rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h5 className="font-semibold text-fg flex items-center space-x-2">
                        <Sparkles className="w-4 h-4 text-fg-muted" />
                        <span>Propuesta de Reescritura de Consulta</span>
                      </h5>
                      {onApplyRewrite && (
                        <button
                          onClick={() => {
                            if (diagnosis.suggested_query_rewrite) {
                              onApplyRewrite(diagnosis.suggested_query_rewrite);
                              onClose();
                            }
                          }}
                          className="px-3 py-1 bg-accent/30 hover:bg-hover text-accent-text border border-accent/50 rounded font-semibold text-xs transition-colors"
                        >
                          Aplicar al Editor
                        </button>
                      )}
                    </div>
                    <pre className="p-3 bg-canvas border border-line rounded text-success font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                      {diagnosis.suggested_query_rewrite}
                    </pre>
                  </div>
                )}
              </div>
            )
          ) : (
            /* AI Context Layer Tab */
            aiContext && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-raised border border-line text-fg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 font-bold text-sm">
                      <ShieldCheck className="w-5 h-5 text-fg-muted" />
                      <span>Contexto Sanitizado para Modelos de IA (ChatGPT / Claude / Gemini / Ollama)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={handleCopyAiPrompt}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-raised hover:bg-hover text-fg border border-line rounded text-xs font-semibold transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar instrucción completa</span>
                      </button>
                      <button
                        onClick={handleDownloadAiContextJson}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-elevated hover:bg-hover text-fg border border-line-strong rounded text-xs font-medium transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Descargar JSON</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-fg mt-2 leading-relaxed">
                    PyroStudio no comparte credenciales, contraseñas, URLs ni datos reales de filas. Solo se exporta la estructura DDL de las tablas involucradas y el plan de optimización.
                  </p>
                </div>

                <div className="bg-raised border border-line rounded-lg p-4 space-y-3">
                  <h5 className="font-semibold text-fg">Vista Previa del DDL y Metadatos Involucrados</h5>
                  <pre className="p-3 bg-canvas border border-line rounded text-fg font-mono text-[11px] overflow-x-auto max-h-60 whitespace-pre-wrap">
                    {aiContext.selected_tables_ddl.join("\n\n") || "(No se detectaron tablas específicas)"}
                  </pre>
                </div>

                {copyFeedback && (
                  <div className="p-3 rounded border border-line text-success font-mono text-center">
                    {copyFeedback}
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-raised border-t border-line flex items-center justify-between">
          <span className="text-[11px] text-fg-subtle font-mono">
            Esquema: <strong className="text-fg">{database}</strong>
          </span>
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
