import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Bot,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Loader2,
  ShieldCheck,
  X,
  Code2,
  RefreshCw,
  Bug,
  TestTube2,
  FileText,
} from "lucide-react";
import { useAiStore } from "../stores/aiStore";
import { aiService } from "../services/aiService";
import type {
  SqlExplanationResult,
  SqlOptimizationResult,
  SqlErrorFixResult,
  SqlTestCasesResult,
  SqlDocumentationResult,
  SqlGenerationResult,
} from "../types/database";

export type CopilotActionType =
  | "explain"
  | "optimize"
  | "fix"
  | "tests"
  | "docs"
  | "generate";

interface SqlCopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  query: string;
  errorMessage?: string;
  initialAction?: CopilotActionType;
  onApplySql: (newSql: string) => void;
}

export const SqlCopilotDrawer: React.FC<SqlCopilotDrawerProps> = ({
  isOpen,
  onClose,
  database,
  query,
  errorMessage,
  initialAction = "explain",
  onApplySql,
}) => {
  const { config, openAiSettings } = useAiStore();

  const [activeAction, setActiveAction] = useState<CopilotActionType>(initialAction);
  const [naturalLanguagePrompt, setNaturalLanguagePrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Results state
  const [explanation, setExplanation] = useState<SqlExplanationResult | null>(null);
  const [optimization, setOptimization] = useState<SqlOptimizationResult | null>(null);
  const [errorFix, setErrorFix] = useState<SqlErrorFixResult | null>(null);
  const [testCases, setTestCases] = useState<SqlTestCasesResult | null>(null);
  const [documentation, setDocumentation] = useState<SqlDocumentationResult | null>(null);
  const [generation, setGeneration] = useState<SqlGenerationResult | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveAction(initialAction);
      if (initialAction === "fix" && errorMessage) {
        runAction("fix");
      } else if (query.trim() && initialAction !== "generate") {
        runAction(initialAction);
      }
    }
  }, [isOpen, initialAction, query, database, errorMessage]);

  if (!isOpen) return null;

  const runAction = async (action: CopilotActionType) => {
    setActiveAction(action);
    setError(null);

    if (!config.enabled) {
      setError("La integración de IA está deshabilitada. Por favor actívala en Ajustes de IA.");
      return;
    }

    if (config.privacy_mode && config.provider !== "ollama" && config.provider !== "mock") {
      setError(
        "Modo Privado (Privacy Mode) ACTIVO: Para usar el Copilot con proveedores en la nube debes desactivar el Modo Privado o configurar Ollama (Local) en Ajustes de IA.",
      );
      return;
    }

    setIsLoading(true);

    try {
      switch (action) {
        case "explain": {
          if (!query.trim()) throw new Error("Ingresa una consulta SQL para explicar.");
          const res = await aiService.explainSqlAi(database, query, config);
          setExplanation(res);
          break;
        }
        case "optimize": {
          if (!query.trim()) throw new Error("Ingresa una consulta SQL para optimizar.");
          const res = await aiService.optimizeSqlAi(database, query, config);
          setOptimization(res);
          break;
        }
        case "fix": {
          if (!query.trim()) throw new Error("Ingresa una consulta SQL para diagnosticar.");
          const res = await aiService.fixSqlErrorAi(
            database,
            query,
            errorMessage || "Error de sintaxis o motor SQL",
            undefined,
            undefined,
            config,
          );
          setErrorFix(res);
          break;
        }
        case "tests": {
          if (!query.trim()) throw new Error("Ingresa una consulta SQL para generar pruebas.");
          const res = await aiService.generateSqlTestsAi(database, query, config);
          setTestCases(res);
          break;
        }
        case "docs": {
          if (!query.trim()) throw new Error("Ingresa una consulta o tabla para documentar.");
          const res = await aiService.generateDocumentationAi(database, "query", "sql_query", config);
          setDocumentation(res);
          break;
        }
        case "generate": {
          if (!naturalLanguagePrompt.trim()) return;
          const res = await aiService.generateSqlAi(database, naturalLanguagePrompt, config);
          setGeneration(res);
          break;
        }
      }
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al ejecutar la acción del Copilot.";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(`¡${label} copiado!`);
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none">
      <div className="bg-[#10131c] border border-[#232a3c] rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-neutral-200">
        {/* Header */}
        <div className="px-6 py-4 bg-[#141824] border-b border-[#202738] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-purple-600/30 to-indigo-600/30 border border-purple-500/40 text-purple-300">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-tight">SQL Copilot Assistant</h2>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-purple-950/40 text-purple-300 border border-purple-800/50">
                  {config.provider.toUpperCase()}
                </span>
                {config.privacy_mode && (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/50 flex items-center space-x-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Modo Privado</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Explicación con EXPLAIN, optimización comparativa, corrección y generación de pruebas.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => runAction(activeAction)}
              disabled={isLoading}
              title="Volver a ejecutar acción"
              className="p-1.5 rounded bg-[#1b2130] hover:bg-[#262f44] text-neutral-400 hover:text-white transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-purple-400" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Action Tabs Bar */}
        <div className="px-6 bg-[#0d1017] border-b border-[#1b2130] flex flex-wrap items-center gap-2 py-2 text-xs font-medium">
          {[
            { id: "explain", label: "Explicar SQL", icon: Bot },
            { id: "optimize", label: "Optimizar Consulta", icon: Zap },
            { id: "fix", label: "Corregir Error", icon: Bug },
            { id: "tests", label: "Casos de Prueba", icon: TestTube2 },
            { id: "docs", label: "Documentar / Comentar", icon: FileText },
            { id: "generate", label: "Lenguaje Natural a SQL", icon: Code2 },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeAction === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => runAction(tab.id as CopilotActionType)}
                className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-colors ${
                  isSelected
                    ? "bg-purple-600/30 text-purple-300 border border-purple-500/50 font-semibold"
                    : "bg-[#141824] text-neutral-400 hover:text-neutral-200 border border-[#1e2536]"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs font-sans">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3 text-neutral-400">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
              <p className="font-mono text-xs">Consultando inteligencia y analizando metadatos...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-red-950/30 border border-red-800/50 text-red-300 font-mono space-y-2">
              <div className="font-bold flex items-center space-x-2 text-red-200">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span>Aviso / Error del Copilot</span>
              </div>
              <p>{error}</p>
              {error.includes("Ajustes") && (
                <button
                  onClick={openAiSettings}
                  className="mt-2 px-3 py-1 bg-purple-600/30 text-purple-200 border border-purple-500/40 rounded text-xs font-semibold"
                >
                  Abrir Ajustes de IA
                </button>
              )}
            </div>
          ) : activeAction === "explain" ? (
            explanation && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-[#141824] border border-[#202738] space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                      <Bot className="w-4 h-4 text-purple-400" />
                      <span>Explicación Detallada de la Consulta</span>
                    </h4>
                    <button
                      onClick={() => handleCopy(explanation.full_markdown, "Explicación")}
                      className="px-2.5 py-1 bg-[#1b2232] hover:bg-[#252f44] text-neutral-300 rounded border border-[#2b364e] text-[11px] flex items-center space-x-1"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copiar Markdown</span>
                    </button>
                  </div>
                  <div className="prose prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap">
                    {explanation.full_markdown}
                  </div>
                </div>
              </div>
            )
          ) : activeAction === "optimize" ? (
            optimization && (
              <div className="space-y-4">
                {/* Comparison Card */}
                <div className="bg-[#141824] border border-[#202738] rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span>Consulta Optimizada Propuesta</span>
                    </h4>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleCopy(optimization.suggested_sql, "SQL optimizado")}
                        className="px-2.5 py-1 bg-[#1b2232] hover:bg-[#252f44] text-neutral-300 rounded border border-[#2b364e] text-[11px] flex items-center space-x-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copiar SQL</span>
                      </button>
                      <button
                        onClick={() => {
                          onApplySql(optimization.suggested_sql);
                          onClose();
                        }}
                        className="px-3 py-1 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded font-semibold text-xs shadow-sm transition-all"
                      >
                        Insertar en Editor
                      </button>
                    </div>
                  </div>

                  <pre className="p-3 bg-[#0c0e14] border border-[#1b2232] rounded text-emerald-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                    {optimization.suggested_sql}
                  </pre>
                </div>

                {/* Why & Risks */}
                <div className="p-4 bg-[#141824] border border-[#202738] rounded-lg space-y-2">
                  <h5 className="font-semibold text-neutral-200">Justificación y Análisis de Rendimiento</h5>
                  <div className="prose prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap text-neutral-300">
                    {optimization.full_markdown}
                  </div>
                </div>
              </div>
            )
          ) : activeAction === "fix" ? (
            errorFix && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-red-950/20 border border-red-800/40 text-red-200 space-y-1">
                  <div className="font-bold text-sm flex items-center space-x-2">
                    <Bug className="w-4 h-4 text-red-400" />
                    <span>Diagnóstico de Error de Ejecución</span>
                  </div>
                  <p className="font-mono text-[11px] text-red-300">{errorFix.error_message}</p>
                </div>

                {errorFix.corrected_sql && (
                  <div className="bg-[#141824] border border-[#202738] rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Consulta Corregida</span>
                      </h4>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleCopy(errorFix.corrected_sql!, "SQL corregido")}
                          className="px-2.5 py-1 bg-[#1b2232] hover:bg-[#252f44] text-neutral-300 rounded border border-[#2b364e] text-[11px] flex items-center space-x-1"
                        >
                          <Copy className="w-3 h-3" />
                          <span>Copiar SQL</span>
                        </button>
                        <button
                          onClick={() => {
                            if (errorFix.corrected_sql) {
                              onApplySql(errorFix.corrected_sql);
                              onClose();
                            }
                          }}
                          className="px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded font-semibold text-xs shadow-sm transition-all"
                        >
                          Aplicar Corrección al Editor
                        </button>
                      </div>
                    </div>

                    <pre className="p-3 bg-[#0c0e14] border border-[#1b2232] rounded text-emerald-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                      {errorFix.corrected_sql}
                    </pre>
                  </div>
                )}

                <div className="p-4 bg-[#141824] border border-[#202738] rounded-lg space-y-2">
                  <h5 className="font-semibold text-neutral-200">Explicación del Problema</h5>
                  <div className="prose prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap text-neutral-300">
                    {errorFix.full_markdown}
                  </div>
                </div>
              </div>
            )
          ) : activeAction === "tests" ? (
            testCases && (
              <div className="space-y-4">
                <div className="bg-[#141824] border border-[#202738] rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                      <TestTube2 className="w-4 h-4 text-cyan-400" />
                      <span>Casos de Prueba para la Consulta</span>
                    </h4>
                    <button
                      onClick={() => handleCopy(testCases.test_cases_markdown, "Casos de prueba")}
                      className="px-2.5 py-1 bg-[#1b2232] hover:bg-[#252f44] text-neutral-300 rounded border border-[#2b364e] text-[11px] flex items-center space-x-1"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copiar Markdown</span>
                    </button>
                  </div>
                  <div className="prose prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap text-neutral-300">
                    {testCases.test_cases_markdown}
                  </div>
                </div>
              </div>
            )
          ) : activeAction === "docs" ? (
            documentation && (
              <div className="space-y-4">
                <div className="bg-[#141824] border border-[#202738] rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                      <FileText className="w-4 h-4 text-purple-400" />
                      <span>Documentación Generada</span>
                    </h4>
                    <button
                      onClick={() => handleCopy(documentation.markdown_doc, "Documentación")}
                      className="px-2.5 py-1 bg-[#1b2232] hover:bg-[#252f44] text-neutral-300 rounded border border-[#2b364e] text-[11px] flex items-center space-x-1"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copiar</span>
                    </button>
                  </div>
                  <div className="prose prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap text-neutral-300">
                    {documentation.markdown_doc}
                  </div>
                </div>
              </div>
            )
          ) : (
            /* Natural Language to SQL generation */
            <div className="space-y-4">
              <div className="p-4 bg-[#141824] border border-[#202738] rounded-lg space-y-3">
                <label className="font-semibold text-neutral-200">
                  Describe en lenguaje natural qué consulta deseas generar:
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={naturalLanguagePrompt}
                    onChange={(e) => setNaturalLanguagePrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runAction("generate");
                      }
                    }}
                    placeholder="Ejemplo: 'Obtén los 10 clientes con mayor total de ventas en el último mes agrupados por país'"
                    className="flex-1 px-3 py-2 bg-[#0c0e14] border border-[#202738] rounded-md text-neutral-200 font-sans text-xs focus:outline-none focus:border-purple-500"
                  />
                  <button
                    type="button"
                    onClick={() => runAction("generate")}
                    disabled={!naturalLanguagePrompt.trim() || isLoading}
                    className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-md font-semibold text-xs transition-all active:scale-95 disabled:opacity-40"
                  >
                    Generar SQL
                  </button>
                </div>
              </div>

              {generation && (
                <div className="bg-[#141824] border border-[#202738] rounded-lg p-4 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                      <Code2 className="w-4 h-4 text-purple-400" />
                      <span>SQL Generado</span>
                    </h4>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleCopy(generation.generated_sql, "SQL generado")}
                        className="px-2.5 py-1 bg-[#1b2232] hover:bg-[#252f44] text-neutral-300 rounded border border-[#2b364e] text-[11px] flex items-center space-x-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copiar</span>
                      </button>
                      <button
                        onClick={() => {
                          onApplySql(generation.generated_sql);
                          onClose();
                        }}
                        className="px-3 py-1 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded font-semibold text-xs shadow-sm transition-all"
                      >
                        Insertar en Editor
                      </button>
                    </div>
                  </div>

                  <pre className="p-3 bg-[#0c0e14] border border-[#1b2232] rounded text-emerald-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                    {generation.generated_sql}
                  </pre>

                  <div className="prose prose-invert max-w-none text-[11px] text-neutral-300 whitespace-pre-wrap">
                    {generation.explanation}
                  </div>
                </div>
              )}
            </div>
          )}

          {copyFeedback && (
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 font-mono text-center">
              {copyFeedback}
            </div>
          )}
        </div>

        {/* Footer */}
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
