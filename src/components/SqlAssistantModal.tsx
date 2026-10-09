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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none">
      <div className="bg-[#10131c] border border-[#232a3c] rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-neutral-200">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#141824] border-b border-[#202738] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-orange-600/20 border border-orange-500/30 text-orange-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Asistente SQL & Diagnóstico con Metadatos
                </h2>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/50 flex items-center space-x-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Offline / Sin Fuga de Datos</span>
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Diagnóstico de anti-patrones, heurísticas de índices y exportación segura para LLMs.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={runDiagnosis}
              disabled={isLoading}
              title="Volver a analizar"
              className="p-1.5 rounded bg-[#1b2130] hover:bg-[#262f44] text-neutral-400 hover:text-white transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-orange-400" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-tab navigation */}
        <div className="px-6 bg-[#0d1017] border-b border-[#1b2130] flex items-center space-x-4 text-xs font-medium">
          <button
            onClick={() => setActiveSubTab("heuristic")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeSubTab === "heuristic"
                ? "border-orange-500 text-orange-400 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>Diagnóstico Heurístico Offline</span>
          </button>
          <button
            onClick={() => setActiveSubTab("ai_context")}
            className={`py-2.5 px-1 border-b-2 flex items-center space-x-2 transition-colors ${
              activeSubTab === "ai_context"
                ? "border-purple-500 text-purple-400 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>Capa de Contexto para IA (Desacoplada)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 font-sans text-xs">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3 text-neutral-400">
              <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
              <p className="font-mono text-xs">Analizando sintaxis, claves e índices de la base de datos...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-red-950/30 border border-red-800/50 text-red-300 font-mono">
              <div className="font-bold flex items-center space-x-2 text-red-200">
                <AlertTriangle className="w-4 h-4 text-red-400" />
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
                      ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300"
                      : "bg-amber-950/20 border-amber-800/40 text-amber-200"
                  }`}
                >
                  {diagnosis.issues.length === 0 ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h4 className="font-semibold text-sm">
                      {diagnosis.issues.length === 0
                        ? "Consulta sin problemas estructurales evidentes"
                        : `${diagnosis.issues.length} observación(es) detectada(s)`}
                    </h4>
                    <p className="text-neutral-300 mt-1">{diagnosis.explanation}</p>
                  </div>
                </div>

                {/* Detected Issues */}
                {diagnosis.issues.length > 0 && (
                  <div className="bg-[#141824] border border-[#202738] rounded-lg p-4 space-y-2">
                    <h5 className="font-semibold text-neutral-200 flex items-center space-x-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <span>Observaciones y Anti-patrones</span>
                    </h5>
                    <ul className="space-y-1.5 pl-6 list-disc text-neutral-300 font-mono text-[11px]">
                      {diagnosis.issues.map((issue, idx) => (
                        <li key={idx}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggested Indexes */}
                {diagnosis.suggested_indexes.length > 0 && (
                  <div className="bg-[#141824] border border-[#202738] rounded-lg p-4 space-y-3">
                    <h5 className="font-semibold text-neutral-200 flex items-center space-x-2">
                      <Lightbulb className="w-4 h-4 text-amber-400" />
                      <span>Índices Recomendados</span>
                    </h5>
                    <div className="space-y-2">
                      {diagnosis.suggested_indexes.map((sqlIdx, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2.5 bg-[#0e1017] border border-[#1b2130] rounded font-mono text-xs text-orange-300"
                        >
                          <code className="truncate mr-2">{sqlIdx}</code>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(sqlIdx);
                              setCopyFeedback(`¡Índice #${idx + 1} copiado!`);
                              setTimeout(() => setCopyFeedback(null), 2500);
                            }}
                            className="px-2 py-1 bg-[#181d2a] hover:bg-[#22293b] text-neutral-300 rounded border border-[#293248] shrink-0 text-[11px] flex items-center space-x-1"
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
                  <div className="bg-[#141824] border border-[#202738] rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h5 className="font-semibold text-neutral-200 flex items-center space-x-2">
                        <Sparkles className="w-4 h-4 text-orange-400" />
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
                          className="px-3 py-1 bg-orange-600/30 hover:bg-orange-600/50 text-orange-300 border border-orange-500/50 rounded font-semibold text-xs transition-colors"
                        >
                          Aplicar al Editor
                        </button>
                      )}
                    </div>
                    <pre className="p-3 bg-[#0c0e14] border border-[#1d2334] rounded text-emerald-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
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
                <div className="p-4 rounded-lg bg-purple-950/20 border border-purple-800/40 text-purple-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 font-bold text-sm">
                      <ShieldCheck className="w-5 h-5 text-purple-400" />
                      <span>Contexto Sanitizado para Modelos de IA (ChatGPT / Claude / Gemini / Ollama)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={handleCopyAiPrompt}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 rounded text-xs font-semibold transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar Prompt Completo</span>
                      </button>
                      <button
                        onClick={handleDownloadAiContextJson}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#181d2a] hover:bg-[#22293b] text-neutral-300 border border-[#283248] rounded text-xs font-medium transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Descargar JSON</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-neutral-300 mt-2 leading-relaxed">
                    PyroStudio no comparte credenciales, contraseñas, URLs ni datos reales de filas. Solo se exporta la estructura DDL de las tablas involucradas y el plan de optimización.
                  </p>
                </div>

                <div className="bg-[#141824] border border-[#202738] rounded-lg p-4 space-y-3">
                  <h5 className="font-semibold text-neutral-200">Vista Previa del DDL y Metadatos Involucrados</h5>
                  <pre className="p-3 bg-[#0c0e14] border border-[#1d2334] rounded text-neutral-300 font-mono text-[11px] overflow-x-auto max-h-60 whitespace-pre-wrap">
                    {aiContext.selected_tables_ddl.join("\n\n") || "(No se detectaron tablas específicas)"}
                  </pre>
                </div>

                {copyFeedback && (
                  <div className="p-3 rounded bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 font-mono text-center">
                    {copyFeedback}
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-[#141824] border-t border-[#202738] flex items-center justify-between">
          <span className="text-[11px] text-neutral-500 font-mono">
            Esquema: <strong className="text-neutral-300">{database}</strong>
          </span>
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
