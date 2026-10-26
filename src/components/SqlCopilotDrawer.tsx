import React, { useState, useEffect, useMemo } from "react";
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
  LayoutGrid,
  Eye,
  ArrowRight,
  Info,
  Sliders,
  Database,
  Plus,
  Terminal,
} from "lucide-react";
import { useAiStore } from "../stores/aiStore";
import { useSchemaStore } from "../stores/schemaStore";
import { aiService } from "../services/aiService";
import { dbService } from "../services/tauriDb";
import type {
  SqlExplanationResult,
  SqlOptimizationResult,
  SqlErrorFixResult,
  SqlTestCasesResult,
  SqlDocumentationResult,
  SqlGenerationResult,
} from "../types/database";
import { MarkdownRenderer } from "./MarkdownRenderer";

export type CopilotActionType =
  | "menu"
  | "explain"
  | "optimize"
  | "create_view"
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

/**
 * Genera un nombre sugerido para la vista a partir de la consulta SQL
 */
function suggestViewName(sql: string): string {
  if (!sql.trim()) return "v_nueva_vista";
  const match = sql.match(/(?:from|join)\s+[`"']?([a-zA-Z0-9_]+)[`"']?/i);
  if (match && match[1]) {
    const raw = match[1].toLowerCase();
    const clean = raw.startsWith("v_") ? `${raw}_resumen` : `v_${raw}`;
    return clean.slice(0, 32);
  }
  return `v_consulta_${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
}

export const SqlCopilotDrawer: React.FC<SqlCopilotDrawerProps> = ({
  isOpen,
  onClose,
  database,
  query,
  errorMessage,
  initialAction = "menu",
  onApplySql,
}) => {
  const { config, openAiSettings } = useAiStore();
  const { databases, loadSchemaObjects } = useSchemaStore();

  const [activeAction, setActiveAction] = useState<CopilotActionType>(initialAction);
  const [workingSql, setWorkingSql] = useState<string>(query);
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

  // View creation state
  const [viewName, setViewName] = useState<string>(() => suggestViewName(query));
  const [viewOrReplace, setViewOrReplace] = useState<boolean>(true);
  const [viewTargetDb, setViewTargetDb] = useState<string>(database);
  const [isCreatingView, setIsCreatingView] = useState<boolean>(false);
  const [createViewSuccess, setCreateViewSuccess] = useState<{
    viewName: string;
    db: string;
    ddl: string;
  } | null>(null);
  const [createViewError, setCreateViewError] = useState<string | null>(null);

  // Keep workingSql in sync when drawer opens with fresh query
  useEffect(() => {
    if (isOpen) {
      setActiveAction(initialAction);
      setWorkingSql(query);
      setViewName(suggestViewName(query));
      setViewTargetDb(database);
      setCreateViewSuccess(null);
      setCreateViewError(null);

      // Only auto-run if user specifically clicked a targeted quick action (e.g. from error banner)
      if (initialAction === "fix" && errorMessage) {
        runAction("fix", query);
      } else if (
        initialAction !== "menu" &&
        initialAction !== "generate" &&
        initialAction !== "create_view" &&
        query.trim()
      ) {
        runAction(initialAction, query);
      }
    }
  }, [isOpen, initialAction, query, database, errorMessage]);

  // Clean SQL definition for the view (removes trailing semicolon)
  const cleanViewSql = useMemo(() => {
    return workingSql.trim().replace(/;+\s*$/, "");
  }, [workingSql]);

  // Complete DDL statement for creating the view
  const generatedViewDdl = useMemo(() => {
    const cleanName = viewName.trim() || "v_mi_vista";
    const targetDb = viewTargetDb.trim() || database;
    const replaceClause = viewOrReplace ? "CREATE OR REPLACE" : "CREATE";
    return `${replaceClause} VIEW \`${targetDb}\`.\`${cleanName}\` AS\n${cleanViewSql};`;
  }, [viewName, viewTargetDb, database, viewOrReplace, cleanViewSql]);

  if (!isOpen) return null;

  const runAction = async (action: CopilotActionType, sqlOverride?: string) => {
    setActiveAction(action);
    setError(null);

    // Actions that do not use AI completion
    if (action === "menu" || action === "create_view") {
      return;
    }

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

    const currentSql = sqlOverride ?? workingSql;
    setIsLoading(true);

    try {
      switch (action) {
        case "explain": {
          if (!currentSql.trim()) throw new Error("Ingresa una consulta SQL para explicar.");
          const res = await aiService.explainSqlAi(database, currentSql, config);
          setExplanation(res);
          break;
        }
        case "optimize": {
          if (!currentSql.trim()) throw new Error("Ingresa una consulta SQL para optimizar.");
          const res = await aiService.optimizeSqlAi(database, currentSql, config);
          setOptimization(res);
          break;
        }
        case "fix": {
          if (!currentSql.trim()) throw new Error("Ingresa una consulta SQL para diagnosticar.");
          const res = await aiService.fixSqlErrorAi(
            database,
            currentSql,
            errorMessage || "Error de sintaxis o motor SQL",
            undefined,
            undefined,
            config,
          );
          setErrorFix(res);
          break;
        }
        case "tests": {
          if (!currentSql.trim()) throw new Error("Ingresa una consulta SQL para generar pruebas.");
          const res = await aiService.generateSqlTestsAi(database, currentSql, config);
          setTestCases(res);
          break;
        }
        case "docs": {
          if (!currentSql.trim()) throw new Error("Ingresa una consulta o tabla para documentar.");
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

  const handleSelectTab = (action: CopilotActionType) => {
    setActiveAction(action);
    setError(null);

    // If user selects an AI action that has no result yet, execute it automatically if we have SQL
    if (action === "explain" && !explanation && workingSql.trim()) {
      runAction("explain");
    } else if (action === "optimize" && !optimization && workingSql.trim()) {
      runAction("optimize");
    } else if (action === "fix" && !errorFix && workingSql.trim()) {
      runAction("fix");
    } else if (action === "tests" && !testCases && workingSql.trim()) {
      runAction("tests");
    } else if (action === "docs" && !documentation && workingSql.trim()) {
      runAction("docs");
    }
  };

  const handleCreateViewInDb = async () => {
    const cleanName = viewName.trim();
    if (!cleanName) {
      setCreateViewError("Por favor ingresa un nombre para la vista.");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(cleanName)) {
      setCreateViewError("El nombre de la vista solo puede contener letras, números y guiones bajos (_).");
      return;
    }
    if (!cleanViewSql) {
      setCreateViewError("La consulta SQL para definir la vista está vacía.");
      return;
    }

    setIsCreatingView(true);
    setCreateViewError(null);

    try {
      const targetDb = viewTargetDb.trim() || database;
      await dbService.executeQuery(generatedViewDdl, targetDb);
      // Reload sidebar schema objects to display the new view immediately
      await loadSchemaObjects(targetDb);
      setCreateViewSuccess({
        viewName: cleanName,
        db: targetDb,
        ddl: generatedViewDdl,
      });
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al crear la vista en la base de datos.";
      setCreateViewError(msg);
    } finally {
      setIsCreatingView(false);
    }
  };

  const handleCopy = (text: string, label: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      });
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }
    setCopyFeedback(`¡${label} copiado al portapapeles!`);
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  const hasSql = Boolean(workingSql.trim());
  const linesCount = hasSql ? workingSql.trim().split("\n").length : 0;
  const charsCount = hasSql ? workingSql.trim().length : 0;

  // Tabs configuration
  const tabs: Array<{
    id: CopilotActionType;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    hasResult?: boolean;
    color: string;
  }> = [
    { id: "menu", label: "Hub de Acciones", icon: LayoutGrid, color: "text-fg-muted" },
    { id: "explain", label: "Explicar", icon: Bot, hasResult: !!explanation, color: "text-fg-muted" },
    { id: "optimize", label: "Optimizar", icon: Zap, hasResult: !!optimization, color: "text-amber-400" },
    { id: "create_view", label: "Crear Vista", icon: Eye, hasResult: !!createViewSuccess, color: "text-fg-muted" },
    { id: "fix", label: "Corregir Error", icon: Bug, hasResult: !!errorFix, color: "text-rose-400" },
    { id: "tests", label: "Pruebas QA", icon: TestTube2, hasResult: !!testCases, color: "text-fg-muted" },
    { id: "docs", label: "Documentar", icon: FileText, hasResult: !!documentation, color: "text-emerald-400" },
    { id: "generate", label: "Lenguaje Natural", icon: Code2, hasResult: !!generation, color: "text-fg-muted" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-surface border border-line rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden text-neutral-200">
        {/* Header */}
        <div className="px-6 py-3.5 bg-raised border-b border-line flex items-center justify-between select-none">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-raised hover:bg-hover border border-line text-fg shadow-sm">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-tight">SQL Copilot Assistant</h2>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-raised text-fg border border-line">
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
                Centro de inteligencia para análisis, optimización, creación de vistas y generación SQL.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {activeAction !== "menu" && (
              <button
                onClick={() => runAction(activeAction)}
                disabled={isLoading}
                title="Volver a ejecutar esta acción"
                className="p-1.5 rounded bg-elevated hover:bg-hover text-neutral-400 hover:text-white transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-fg-muted" : ""}`} />
              </button>
            )}
            <button
              onClick={openAiSettings}
              title="Ajustes de Inteligencia Artificial (Modelo, Proveedor, Privacidad)"
              className="p-1.5 rounded bg-elevated hover:bg-hover text-neutral-400 hover:text-white transition-colors"
            >
              <Sliders className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              title="Cerrar ventana (Esc)"
              className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Action Tabs Bar */}
        <div className="px-6 bg-surface border-b border-line flex flex-wrap items-center gap-1.5 py-2 text-xs font-medium select-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeAction === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleSelectTab(tab.id)}
                className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all text-xs ${
                  isSelected
                    ? "bg-raised text-fg border border-line font-semibold shadow-xs"
                    : "bg-raised text-neutral-400 hover:text-neutral-200 border border-line hover:bg-hover"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${tab.color}`} />
                <span>{tab.label}</span>
                {tab.hasResult && !isSelected && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-xs"
                    title="Resultados disponibles"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs font-sans select-text">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3 text-neutral-400 select-none">
              <Loader2 className="w-8 h-8 animate-spin text-fg-muted" />
              <p className="font-mono text-xs">Consultando al modelo de IA y analizando el esquema...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-red-950/30 border border-red-800/50 text-red-300 font-mono space-y-2 select-text">
              <div className="font-bold flex items-center justify-between text-red-200">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span>Aviso / Error del Copilot</span>
                </div>
                <button
                  onClick={() => handleCopy(error, "Mensaje de error")}
                  className="px-2 py-0.5 bg-red-900/40 hover:bg-red-800/50 text-red-200 rounded border border-red-700/50 text-[11px] flex items-center space-x-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copiar Error</span>
                </button>
              </div>
              <p className="select-text whitespace-pre-wrap">{error}</p>
              <div className="flex items-center space-x-3 pt-2">
                {error.includes("Ajustes") && (
                  <button
                    onClick={openAiSettings}
                    className="px-3 py-1 bg-raised hover:bg-hover text-fg border border-line rounded text-xs font-semibold select-none transition-colors"
                  >
                    Abrir Ajustes de IA
                  </button>
                )}
                <button
                  onClick={() => setActiveAction("menu")}
                  className="px-3 py-1 bg-elevated hover:bg-hover text-neutral-200 border border-line-strong rounded text-xs select-none transition-colors"
                >
                  Volver al Hub
                </button>
              </div>
            </div>
          ) : activeAction === "menu" ? (
            /* HUB DE ACCIONES / PANTALLA PRINCIPAL */
            <div className="space-y-5 animate-in fade-in duration-150">
              {/* Context bar */}
              <div className="p-4 rounded-xl bg-surface border border-line space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-elevated border border-line-strong text-[11px] font-mono text-fg">
                      <Database className="w-3.5 h-3.5 text-fg-muted" />
                      <span>{database || "Sin base de datos activa"}</span>
                    </span>

                    {hasSql ? (
                      <span className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-elevated border border-line-strong text-[11px] font-mono text-neutral-300">
                        <Terminal className="w-3.5 h-3.5 text-fg-muted" />
                        <span>
                          {linesCount} {linesCount === 1 ? "línea" : "líneas"} · {charsCount} caracteres
                        </span>
                      </span>
                    ) : (
                      <span className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-amber-950/30 border border-amber-800/40 text-[11px] text-amber-300">
                        <Info className="w-3.5 h-3.5 text-fg-muted" />
                        <span>Sin consulta en el editor</span>
                      </span>
                    )}
                  </div>

                  {!config.enabled && (
                    <button
                      onClick={openAiSettings}
                      className="px-2.5 py-1 rounded bg-amber-950/40 border border-amber-700/60 text-amber-300 hover:text-amber-200 text-[11px] flex items-center space-x-1 transition-colors"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>IA desactivada - Clic para configurar</span>
                    </button>
                  )}
                </div>

                {hasSql && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold text-neutral-400">Consulta actual:</span>
                    <pre className="p-2.5 bg-canvas border border-line rounded-lg text-emerald-300 font-mono text-[11px] max-h-20 overflow-y-auto whitespace-pre-wrap select-text">
                      {workingSql.trim()}
                    </pre>
                  </div>
                )}
              </div>

              {/* Error notice if last run failed */}
              {errorMessage && (
                <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-800/60 flex items-center justify-between gap-3 text-red-200 animate-in fade-in">
                  <div className="flex items-start space-x-2.5">
                    <Bug className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-xs text-red-200">
                        Error detectado en la última ejecución:
                      </span>
                      <p className="text-[11px] font-mono text-red-300 line-clamp-1 mt-0.5">
                        {errorMessage}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => runAction("fix")}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-accent-fg font-semibold text-xs flex items-center space-x-1.5 transition-all shadow-sm"
                  >
                    <span>Diagnosticar con IA</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Quick Prompt Bar for natural language */}
              <div className="p-3.5 rounded-xl bg-raised border border-line space-y-2">
                <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
                  <span>¿Prefieres describir lo que necesitas generar?</span>
                  <span className="text-[11px] text-neutral-500 font-normal">Presiona Enter para generar</span>
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={naturalLanguagePrompt}
                    onChange={(e) => setNaturalLanguagePrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && naturalLanguagePrompt.trim()) {
                        e.preventDefault();
                        runAction("generate");
                      }
                    }}
                    placeholder="Ejemplo: 'Ventas de clientes de España en los últimos 6 meses agrupadas por producto'..."
                    className="flex-1 px-3 py-2 bg-canvas border border-line rounded-lg text-neutral-200 font-sans text-xs focus:outline-none focus:border-line transition-colors select-text"
                  />
                  <button
                    type="button"
                    onClick={() => runAction("generate")}
                    disabled={!naturalLanguagePrompt.trim() || isLoading}
                    className="px-4 py-2 bg-raised hover:bg-hover text-white rounded-lg font-semibold text-xs transition-all disabled:opacity-40 flex items-center space-x-1.5 select-none shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Generar SQL</span>
                  </button>
                </div>
              </div>

              {/* Action Cards Grid */}
              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Opciones disponibles para tu consulta:
                </span>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {/* Card: Explain */}
                  <div
                    onClick={() => {
                      if (hasSql) {
                        if (explanation) setActiveAction("explain");
                        else runAction("explain");
                      }
                    }}
                    className={`p-4 rounded-xl border flex flex-col justify-between transition-all group duration-150 ${
                      hasSql
                        ? "bg-raised hover:bg-hover border-line hover:border-line cursor-pointer shadow-sm"
                        : "bg-raised border-line opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg bg-raised border border-line text-fg transition-transform">
                          <Bot className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-semibold text-fg bg-raised px-2 py-0.5 rounded border border-line">
                          Comprensión
                        </span>
                      </div>
                      <h3 className="font-bold text-sm text-white group-hover:text-fg transition-colors">
                        Explicar Consulta
                      </h3>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        Desglosa paso a paso la lógica, filtros, uniones JOIN y subconsultas en lenguaje claro y accesible.
                      </p>
                    </div>
                    <div className="pt-3 mt-2 border-t border-line flex items-center justify-between text-xs font-semibold text-fg-muted">
                      <span>{hasSql ? (explanation ? "Ver explicación" : "Explicar ahora") : "Requiere SQL"}</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>

                  {/* Card: Optimize */}
                  <div
                    onClick={() => {
                      if (hasSql) {
                        if (optimization) setActiveAction("optimize");
                        else runAction("optimize");
                      }
                    }}
                    className={`p-4 rounded-xl border flex flex-col justify-between transition-all group duration-150 ${
                      hasSql
                        ? "bg-raised hover:bg-hover border-line hover:border-amber-500/60 cursor-pointer shadow-sm"
                        : "bg-raised border-line opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-800/40 text-amber-300 transition-transform">
                          <Zap className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-semibold text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40">
                          Rendimiento
                        </span>
                      </div>
                      <h3 className="font-bold text-sm text-white group-hover:text-amber-300 transition-colors">
                        Optimizar Rendimiento
                      </h3>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        Detecta lentitud, propone índices ausentes y reescribe la consulta para acelerar su ejecución.
                      </p>
                    </div>
                    <div className="pt-3 mt-2 border-t border-line flex items-center justify-between text-xs font-semibold text-amber-400">
                      <span>{hasSql ? (optimization ? "Ver optimización" : "Optimizar ahora") : "Requiere SQL"}</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>

                  {/* Card: Convert to View (Direct user request!) */}
                  <div
                    onClick={() => {
                      if (hasSql) {
                        setActiveAction("create_view");
                      }
                    }}
                    className={`p-4 rounded-xl border flex flex-col justify-between transition-all group duration-150 ${
                      hasSql
                        ? "bg-raised hover:bg-hover border-line hover:border-line cursor-pointer shadow-sm"
                        : "bg-raised border-line opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg bg-raised border border-line text-fg transition-transform">
                          <Eye className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-semibold text-fg bg-raised px-2 py-0.5 rounded border border-line">
                          Estructura BD
                        </span>
                      </div>
                      <h3 className="font-bold text-sm text-white group-hover:text-fg transition-colors">
                        Convertir en Vista de BD
                      </h3>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        Transforma esta consulta en una Vista persistente (<code className="text-fg font-mono">CREATE OR REPLACE VIEW</code>) para reutilizarla fácilmente.
                      </p>
                    </div>
                    <div className="pt-3 mt-2 border-t border-line flex items-center justify-between text-xs font-semibold text-fg-muted">
                      <span>{hasSql ? "Crear vista en la BD" : "Requiere SQL"}</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>

                  {/* Card: Fix Error */}
                  <div
                    onClick={() => {
                      if (hasSql || errorMessage) {
                        if (errorFix) setActiveAction("fix");
                        else runAction("fix");
                      }
                    }}
                    className={`p-4 rounded-xl border flex flex-col justify-between transition-all group duration-150 ${
                      errorMessage
                        ? "bg-red-950/20 hover:bg-red-950/30 border-red-700/60 hover:border-red-500 cursor-pointer shadow-sm"
                        : hasSql
                        ? "bg-raised hover:bg-hover border-line hover:border-rose-500/60 cursor-pointer shadow-sm"
                        : "bg-raised border-line opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-800/40 text-rose-300 transition-transform">
                          <Bug className="w-4 h-4" />
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                          errorMessage
                            ? "bg-red-900/40 text-red-200 border-red-700/60 animate-pulse"
                            : "bg-rose-950/40 text-rose-300 border-rose-800/40"
                        }`}>
                          {errorMessage ? "Error detectado" : "Corrección"}
                        </span>
                      </div>
                      <h3 className="font-bold text-sm text-white group-hover:text-rose-300 transition-colors">
                        Diagnosticar y Corregir
                      </h3>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        {errorMessage
                          ? "Corrige el error de ejecución y genera una versión funcional de la consulta."
                          : "Detecta posibles fallos sintácticos, columnas ambiguas o tipos incompatibles."}
                      </p>
                    </div>
                    <div className="pt-3 mt-2 border-t border-line flex items-center justify-between text-xs font-semibold text-rose-400">
                      <span>{errorFix ? "Ver corrección" : "Diagnosticar"}</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>

                  {/* Card: Test cases */}
                  <div
                    onClick={() => {
                      if (hasSql) {
                        if (testCases) setActiveAction("tests");
                        else runAction("tests");
                      }
                    }}
                    className={`p-4 rounded-xl border flex flex-col justify-between transition-all group duration-150 ${
                      hasSql
                        ? "bg-raised hover:bg-hover border-line hover:border-line cursor-pointer shadow-sm"
                        : "bg-raised border-line opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg bg-raised border border-line text-fg transition-transform">
                          <TestTube2 className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-semibold text-fg bg-raised px-2 py-0.5 rounded border border-line">
                          QA & Pruebas
                        </span>
                      </div>
                      <h3 className="font-bold text-sm text-white group-hover:text-fg transition-colors">
                        Casos de Prueba
                      </h3>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        Crea escenarios de validación, casos de borde y aserciones para verificar la integridad de los datos.
                      </p>
                    </div>
                    <div className="pt-3 mt-2 border-t border-line flex items-center justify-between text-xs font-semibold text-fg-muted">
                      <span>{hasSql ? (testCases ? "Ver pruebas" : "Generar pruebas") : "Requiere SQL"}</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>

                  {/* Card: Documentation */}
                  <div
                    onClick={() => {
                      if (hasSql) {
                        if (documentation) setActiveAction("docs");
                        else runAction("docs");
                      }
                    }}
                    className={`p-4 rounded-xl border flex flex-col justify-between transition-all group duration-150 ${
                      hasSql
                        ? "bg-raised hover:bg-hover border-line hover:border-emerald-500/60 cursor-pointer shadow-sm"
                        : "bg-raised border-line opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 transition-transform">
                          <FileText className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
                          Documentación
                        </span>
                      </div>
                      <h3 className="font-bold text-sm text-white group-hover:text-emerald-300 transition-colors">
                        Documentar y Comentar
                      </h3>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        Genera comentarios técnicos limpios, explicación de parámetros y diccionario de columnas en Markdown.
                      </p>
                    </div>
                    <div className="pt-3 mt-2 border-t border-line flex items-center justify-between text-xs font-semibold text-emerald-400">
                      <span>{hasSql ? (documentation ? "Ver documentación" : "Documentar ahora") : "Requiere SQL"}</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : activeAction === "create_view" ? (
            /* CONVERTIR CONSULTA EN VISTA DE LA BD */
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="p-4 rounded-xl bg-raised border border-line space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-raised border border-line text-fg-muted">
                      <Eye className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Convertir Consulta en Vista de la BD</h3>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Transforma esta consulta en una Vista persistente en MariaDB/MySQL para reutilizarla con facilidad.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveAction("menu")}
                    className="px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200 bg-elevated rounded border border-line-strong transition-colors"
                  >
                    ← Volver al Hub
                  </button>
                </div>

                {createViewSuccess ? (
                  <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/60 space-y-3 animate-in fade-in">
                    <div className="flex items-center space-x-2.5 text-emerald-300">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      <div>
                        <h4 className="font-bold text-sm text-emerald-200">¡Vista creada exitosamente!</h4>
                        <p className="text-xs text-emerald-300/90 mt-0.5">
                          La vista <strong className="font-mono text-emerald-200">{createViewSuccess.viewName}</strong> fue registrada en la base de datos <strong className="font-mono text-emerald-200">{createViewSuccess.db}</strong>.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1 select-none">
                      <button
                        onClick={() => {
                          onApplySql(`SELECT * FROM \`${createViewSuccess.viewName}\` LIMIT 100;`);
                          onClose();
                        }}
                        className="px-3.5 py-1.5 bg-raised hover:bg-hover text-white rounded-md font-semibold text-xs shadow-sm transition-all"
                      >
                        Consultar Vista en Editor (SELECT * LIMIT 100)
                      </button>
                      <button
                        onClick={() => handleCopy(createViewSuccess.ddl, "DDL de la vista")}
                        className="px-3 py-1.5 bg-elevated hover:bg-hover text-neutral-300 rounded-md border border-line-strong text-xs flex items-center space-x-1.5 transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar DDL</span>
                      </button>
                      <button
                        onClick={() => setCreateViewSuccess(null)}
                        className="px-3 py-1.5 bg-raised hover:bg-hover text-neutral-400 hover:text-neutral-200 rounded-md border border-line text-xs transition-colors"
                      >
                        Crear otra vista
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {createViewError && (
                      <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-red-200 text-xs font-mono flex items-start space-x-2">
                        <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                        <span className="flex-1">{createViewError}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* View Name */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
                          <span>Nombre de la Vista:</span>
                          <span className="text-[10px] text-neutral-500 font-mono">Prefijo recomendado: v_</span>
                        </label>
                        <input
                          type="text"
                          value={viewName}
                          onChange={(e) => setViewName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                          placeholder="v_mi_vista"
                          className="w-full px-3 py-2 bg-canvas border border-line rounded-md text-fg font-mono text-xs focus:outline-none focus:border-line transition-colors select-text"
                        />
                      </div>

                      {/* Target Database */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-neutral-300">
                          Base de Datos Destino:
                        </label>
                        <select
                          value={viewTargetDb}
                          onChange={(e) => setViewTargetDb(e.target.value)}
                          className="w-full px-3 py-2 bg-canvas border border-line rounded-md text-neutral-200 font-mono text-xs focus:outline-none focus:border-line transition-colors"
                        >
                          {databases.map((db) => (
                            <option key={db.name} value={db.name}>
                              {db.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Options */}
                    <div className="flex items-center space-x-2 pt-1 select-none">
                      <input
                        type="checkbox"
                        id="viewOrReplace"
                        checked={viewOrReplace}
                        onChange={(e) => setViewOrReplace(e.target.checked)}
                        className="rounded border-line-strong bg-canvas text-fg-muted focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                      <label htmlFor="viewOrReplace" className="text-xs text-neutral-300 cursor-pointer">
                        Reemplazar si ya existe (<code className="font-mono text-fg">CREATE OR REPLACE VIEW</code>)
                      </label>
                    </div>

                    {/* DDL Preview */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-neutral-400">
                          Vista previa de la sentencia DDL a ejecutar:
                        </span>
                        <button
                          onClick={() => handleCopy(generatedViewDdl, "DDL")}
                          className="px-2 py-0.5 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] flex items-center space-x-1 select-none transition-colors"
                        >
                          <Copy className="w-3 h-3" />
                          <span>Copiar DDL</span>
                        </button>
                      </div>
                      <pre className="p-3 bg-canvas border border-line rounded-lg text-fg font-mono text-xs overflow-x-auto whitespace-pre-wrap select-text max-h-48 cursor-text">
                        {generatedViewDdl}
                      </pre>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line select-none">
                      <button
                        onClick={() => {
                          onApplySql(generatedViewDdl);
                          onClose();
                        }}
                        className="px-3.5 py-1.5 bg-elevated hover:bg-hover text-neutral-300 rounded-md border border-line-strong text-xs font-medium transition-colors"
                      >
                        Insertar DDL en Editor SQL
                      </button>

                      <button
                        onClick={handleCreateViewInDb}
                        disabled={isCreatingView || !viewName.trim() || !cleanViewSql}
                        className="px-4 py-2 bg-raised hover:bg-hover text-white rounded-md font-semibold text-xs shadow-md transition-all disabled:opacity-40 flex items-center space-x-2"
                      >
                        {isCreatingView ? (
                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                        ) : (
                          <Plus className="w-4 h-4" />
                        )}
                        <span>Crear Vista en la Base de Datos</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : activeAction === "explain" ? (
            explanation ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-raised border border-line space-y-2 select-text">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                      <Bot className="w-4 h-4 text-fg-muted" />
                      <span>Explicación Detallada de la Consulta</span>
                    </h4>
                    <div className="flex items-center space-x-2 select-none">
                      <button
                        onClick={() => setActiveAction("menu")}
                        className="px-2.5 py-1 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] transition-colors"
                      >
                        ← Hub
                      </button>
                      <button
                        onClick={() => handleCopy(explanation.full_markdown, "Explicación")}
                        className="px-2.5 py-1 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] flex items-center space-x-1 transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copiar Markdown</span>
                      </button>
                    </div>
                  </div>
                  <MarkdownRenderer content={explanation.full_markdown} />
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-neutral-400 space-y-3">
                <p>No se ha generado la explicación de la consulta aún.</p>
                <button
                  onClick={() => runAction("explain")}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-fg rounded font-semibold text-xs transition-colors"
                >
                  Explicar Consulta Ahora
                </button>
              </div>
            )
          ) : activeAction === "optimize" ? (
            optimization ? (
              <div className="space-y-4">
                {/* Comparison Card */}
                <div className="bg-raised border border-line rounded-lg p-4 space-y-3 select-text">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                      <Zap className="w-4 h-4 text-fg-muted" />
                      <span>Consulta Optimizada Propuesta</span>
                    </h4>
                    <div className="flex items-center space-x-2 select-none">
                      <button
                        onClick={() => {
                          setWorkingSql(optimization.suggested_sql);
                          setViewName(suggestViewName(optimization.suggested_sql));
                          setActiveAction("create_view");
                        }}
                        className="px-2.5 py-1 bg-raised hover:bg-hover text-fg rounded border border-line text-[11px] flex items-center space-x-1 transition-colors"
                        title="Convertir esta consulta optimizada en una Vista"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Convertir en Vista</span>
                      </button>
                      <button
                        onClick={() => handleCopy(optimization.suggested_sql, "SQL optimizado")}
                        className="px-2.5 py-1 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] flex items-center space-x-1 transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copiar SQL</span>
                      </button>
                      <button
                        onClick={() => {
                          onApplySql(optimization.suggested_sql);
                          onClose();
                        }}
                        className="px-3 py-1 bg-accent hover:bg-accent-hover text-accent-fg rounded font-semibold text-xs shadow-sm transition-all"
                      >
                        Insertar en Editor
                      </button>
                    </div>
                  </div>

                  <pre className="p-3 bg-canvas border border-line rounded text-emerald-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap select-text cursor-text">
                    {optimization.suggested_sql}
                  </pre>
                </div>

                {/* Why & Risks */}
                <div className="p-4 bg-raised border border-line rounded-lg space-y-2 select-text">
                  <div className="flex items-center justify-between">
                    <h5 className="font-semibold text-neutral-200">Justificación y Análisis de Rendimiento</h5>
                    <div className="flex items-center space-x-2 select-none">
                      <button
                        onClick={() => setActiveAction("menu")}
                        className="px-2.5 py-1 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] transition-colors"
                      >
                        ← Hub
                      </button>
                      <button
                        onClick={() => handleCopy(optimization.full_markdown, "Análisis de rendimiento")}
                        className="px-2 py-0.5 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] flex items-center space-x-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copiar Análisis</span>
                      </button>
                    </div>
                  </div>
                  <MarkdownRenderer content={optimization.full_markdown} />
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-neutral-400 space-y-3">
                <p>No se ha ejecutado la optimización de la consulta aún.</p>
                <button
                  onClick={() => runAction("optimize")}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-accent-fg rounded font-semibold text-xs transition-colors"
                >
                  Optimizar Consulta Ahora
                </button>
              </div>
            )
          ) : activeAction === "fix" ? (
            errorFix ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-red-950/20 border border-red-800/40 text-red-200 space-y-1 select-text">
                  <div className="font-bold text-sm flex items-center space-x-2">
                    <Bug className="w-4 h-4 text-red-400" />
                    <span>Diagnóstico de Error de Ejecución</span>
                  </div>
                  <p className="font-mono text-[11px] text-red-300 select-text cursor-text">{errorFix.error_message}</p>
                </div>

                {errorFix.corrected_sql && (
                  <div className="bg-raised border border-line rounded-lg p-4 space-y-3 select-text">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Consulta Corregida</span>
                      </h4>
                      <div className="flex items-center space-x-2 select-none">
                        <button
                          onClick={() => {
                            setWorkingSql(errorFix.corrected_sql!);
                            setViewName(suggestViewName(errorFix.corrected_sql!));
                            setActiveAction("create_view");
                          }}
                          className="px-2.5 py-1 bg-raised hover:bg-hover text-fg rounded border border-line text-[11px] flex items-center space-x-1 transition-colors"
                          title="Convertir esta consulta corregida en una Vista"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Convertir en Vista</span>
                        </button>
                        <button
                          onClick={() => handleCopy(errorFix.corrected_sql!, "SQL corregido")}
                          className="px-2.5 py-1 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] flex items-center space-x-1"
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
                          className="px-3 py-1 bg-raised hover:bg-hover text-white rounded font-semibold text-xs shadow-sm transition-all"
                        >
                          Aplicar Corrección al Editor
                        </button>
                      </div>
                    </div>

                    <pre className="p-3 bg-canvas border border-line rounded text-emerald-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap select-text cursor-text">
                      {errorFix.corrected_sql}
                    </pre>
                  </div>
                )}

                <div className="p-4 bg-raised border border-line rounded-lg space-y-2 select-text">
                  <div className="flex items-center justify-between">
                    <h5 className="font-semibold text-neutral-200">Explicación del Problema</h5>
                    <div className="flex items-center space-x-2 select-none">
                      <button
                        onClick={() => setActiveAction("menu")}
                        className="px-2.5 py-1 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] transition-colors"
                      >
                        ← Hub
                      </button>
                      <button
                        onClick={() => handleCopy(errorFix.full_markdown, "Explicación del problema")}
                        className="px-2 py-0.5 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] flex items-center space-x-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copiar Explicación</span>
                      </button>
                    </div>
                  </div>
                  <MarkdownRenderer content={errorFix.full_markdown} />
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-neutral-400 space-y-3">
                <p>No se ha ejecutado el diagnóstico de error aún.</p>
                <button
                  onClick={() => runAction("fix")}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-accent-fg rounded font-semibold text-xs transition-colors"
                >
                  Diagnosticar Error Ahora
                </button>
              </div>
            )
          ) : activeAction === "tests" ? (
            testCases ? (
              <div className="space-y-4">
                <div className="bg-raised border border-line rounded-lg p-4 space-y-2 select-text">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                      <TestTube2 className="w-4 h-4 text-fg-muted" />
                      <span>Casos de Prueba para la Consulta</span>
                    </h4>
                    <div className="flex items-center space-x-2 select-none">
                      <button
                        onClick={() => setActiveAction("menu")}
                        className="px-2.5 py-1 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] transition-colors"
                      >
                        ← Hub
                      </button>
                      <button
                        onClick={() => handleCopy(testCases.test_cases_markdown, "Casos de prueba")}
                        className="px-2.5 py-1 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] flex items-center space-x-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copiar Markdown</span>
                      </button>
                    </div>
                  </div>
                  <MarkdownRenderer content={testCases.test_cases_markdown} />
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-neutral-400 space-y-3">
                <p>No se han generado los casos de prueba aún.</p>
                <button
                  onClick={() => runAction("tests")}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-fg rounded font-semibold text-xs transition-colors"
                >
                  Generar Casos de Prueba
                </button>
              </div>
            )
          ) : activeAction === "docs" ? (
            documentation ? (
              <div className="space-y-4">
                <div className="bg-raised border border-line rounded-lg p-4 space-y-2 select-text">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                      <FileText className="w-4 h-4 text-fg-muted" />
                      <span>Documentación Generada</span>
                    </h4>
                    <div className="flex items-center space-x-2 select-none">
                      <button
                        onClick={() => setActiveAction("menu")}
                        className="px-2.5 py-1 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] transition-colors"
                      >
                        ← Hub
                      </button>
                      <button
                        onClick={() => handleCopy(documentation.markdown_doc, "Documentación")}
                        className="px-2.5 py-1 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] flex items-center space-x-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copiar</span>
                      </button>
                    </div>
                  </div>
                  <MarkdownRenderer content={documentation.markdown_doc} />
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-neutral-400 space-y-3">
                <p>No se ha generado la documentación aún.</p>
                <button
                  onClick={() => runAction("docs")}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-accent-fg rounded font-semibold text-xs transition-colors"
                >
                  Generar Documentación
                </button>
              </div>
            )
          ) : (
            /* LENGUAJE NATURAL A SQL */
            <div className="space-y-4">
              <div className="p-4 bg-raised border border-line rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-neutral-200">
                    Describe en lenguaje natural qué consulta deseas generar:
                  </label>
                  <button
                    onClick={() => setActiveAction("menu")}
                    className="px-2.5 py-0.5 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] transition-colors"
                  >
                    ← Hub
                  </button>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={naturalLanguagePrompt}
                    onChange={(e) => setNaturalLanguagePrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && naturalLanguagePrompt.trim()) {
                        e.preventDefault();
                        runAction("generate");
                      }
                    }}
                    placeholder="Ejemplo: 'Obtén los 10 clientes con mayor total de ventas en el último mes agrupados por país'"
                    className="flex-1 px-3 py-2 bg-canvas border border-line rounded-md text-neutral-200 font-sans text-xs focus:outline-none focus:border-line select-text"
                  />
                  <button
                    type="button"
                    onClick={() => runAction("generate")}
                    disabled={!naturalLanguagePrompt.trim() || isLoading}
                    className="px-4 py-2 bg-raised hover:bg-hover text-white rounded-md font-semibold text-xs transition-all disabled:opacity-40 select-none shrink-0"
                  >
                    Generar SQL
                  </button>
                </div>
              </div>

              {generation && (
                <div className="bg-raised border border-line rounded-lg p-4 space-y-3 animate-in fade-in select-text">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-white flex items-center space-x-2">
                      <Code2 className="w-4 h-4 text-fg-muted" />
                      <span>SQL Generado</span>
                    </h4>
                    <div className="flex items-center space-x-2 select-none">
                      <button
                        onClick={() => {
                          setWorkingSql(generation.generated_sql);
                          setViewName(suggestViewName(generation.generated_sql));
                          setActiveAction("create_view");
                        }}
                        className="px-2.5 py-1 bg-raised hover:bg-hover text-fg rounded border border-line text-[11px] flex items-center space-x-1 transition-colors"
                        title="Convertir esta consulta generada en una Vista"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Convertir en Vista</span>
                      </button>
                      <button
                        onClick={() => handleCopy(generation.generated_sql, "SQL generado")}
                        className="px-2.5 py-1 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[11px] flex items-center space-x-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copiar SQL</span>
                      </button>
                      <button
                        onClick={() => {
                          onApplySql(generation.generated_sql);
                          onClose();
                        }}
                        className="px-3 py-1 bg-accent hover:bg-accent-hover text-accent-fg rounded font-semibold text-xs shadow-sm transition-all"
                      >
                        Insertar en Editor
                      </button>
                    </div>
                  </div>

                  <pre className="p-3 bg-canvas border border-line rounded text-emerald-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap select-text cursor-text">
                    {generation.generated_sql}
                  </pre>

                  {generation.explanation && (
                    <div className="p-3 bg-raised rounded border border-line space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-neutral-400 text-[11px]">Explicación:</span>
                        <button
                          onClick={() => handleCopy(generation.explanation!, "Explicación de SQL generado")}
                          className="px-2 py-0.5 bg-elevated hover:bg-hover text-neutral-300 rounded border border-line-strong text-[10px] flex items-center space-x-1 select-none"
                        >
                          <Copy className="w-2.5 h-2.5" />
                          <span>Copiar</span>
                        </button>
                      </div>
                      <MarkdownRenderer content={generation.explanation} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {copyFeedback && (
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 font-mono text-center select-none animate-in fade-in">
              {copyFeedback}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-raised border-t border-line flex items-center justify-between select-none">
          <div className="flex items-center space-x-2 text-[11px] text-neutral-500 font-mono">
            <span>Esquema activo:</span>
            <strong className="text-neutral-300">{database}</strong>
          </div>
          <div className="flex items-center space-x-2">
            {activeAction !== "menu" && (
              <button
                onClick={() => setActiveAction("menu")}
                className="px-3 py-1.5 bg-elevated hover:bg-hover text-neutral-300 rounded text-xs font-medium transition-colors"
              >
                ← Menú de Opciones
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-elevated hover:bg-hover text-neutral-300 rounded text-xs font-medium transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
