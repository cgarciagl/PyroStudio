import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Sparkles,
  Bot,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Copy,
  ShieldCheck,
  X,
  RefreshCw,
  Bug,
  TestTube2,
  FileText,
  Eye,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Sliders,
  Database,
  Plus,
  Play,
  CornerDownLeft,
  History,
  Trash2,
  Check,
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
import { Spinner } from "./ui/Modal";
import {
  modalBackdrop,
  primaryBtn,
  secondaryBtn,
  ghostBtn,
  iconBtn,
  inputClass,
  fieldLabel,
  sectionLabel,
  menuItem,
  menuIcon,
} from "./ui/styles";

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
  /** Inserta el SQL en el editor y lo ejecuta (pasando por Modo Seguro). */
  onRunSql?: (sql: string) => void;
  /** Acoplado al panel derecho del editor en lugar de abrirse como modal. */
  docked?: boolean;
}

/** One natural-language request and its answer, kept as a short thread. */
interface GenerationTurn {
  id: number;
  request: string;
  context: ContextSource;
  result?: SqlGenerationResult;
  error?: string;
}

/** What the next natural-language request builds on. */
type ContextSource = "none" | "editor" | "last";

const PROMPT_HISTORY_KEY = "pyro.copilot.promptHistory";
const PROMPT_HISTORY_MAX = 10;

const PROMPT_STARTERS = [
  "Los 10 clientes con mayor importe total de ventas este año, con su país",
  "Registros duplicados por email en la tabla de usuarios",
  "Ventas mensuales de los últimos 12 meses comparadas con el año anterior",
  "Tablas con columnas sin índice usadas como clave foránea",
];

function loadPromptHistory(): string[] {
  try {
    const raw = localStorage.getItem(PROMPT_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function savePromptHistory(history: string[]) {
  try {
    localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // History is a convenience; ignore quota or privacy-mode failures.
  }
}

/**
 * Builds the request sent to the model. When the user refines a previous
 * answer or the editor's query, that SQL travels along as the starting point.
 */
export function buildGenerationPrompt(request: string, baseSql?: string): string {
  const clean = request.trim();
  if (!baseSql?.trim()) return clean;
  return `${clean}\n\nToma como punto de partida la siguiente consulta SQL y modifícala según lo pedido (devuelve la consulta completa):\n${baseSql.trim()}`;
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

const SqlBlock: React.FC<{ sql: string }> = ({ sql }) => (
  <pre className="p-3 bg-canvas border border-line rounded-md text-fg font-mono text-xs overflow-x-auto whitespace-pre-wrap select-text cursor-text">
    {sql}
  </pre>
);

/** Titled result section with right-aligned ghost actions. */
const ResultSection: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon: Icon, iconClass = "text-fg-muted", title, actions, children }) => (
  <section className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-xs font-medium text-fg flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${iconClass}`} />
        <span>{title}</span>
      </h4>
      {actions && <div className="flex items-center gap-0.5 select-none">{actions}</div>}
    </div>
    {children}
  </section>
);

export const SqlCopilotDrawer: React.FC<SqlCopilotDrawerProps> = ({
  isOpen,
  onClose,
  database,
  query,
  errorMessage,
  initialAction = "menu",
  onApplySql,
  onRunSql,
  docked = false,
}) => {
  const { config, openAiSettings } = useAiStore();
  const { databases, loadSchemaObjects } = useSchemaStore();

  const [activeAction, setActiveAction] = useState<CopilotActionType>(initialAction);
  const [workingSql, setWorkingSql] = useState<string>(query);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Natural language composer
  const [prompt, setPrompt] = useState("");
  const [contextSource, setContextSource] = useState<ContextSource>("none");
  const [turns, setTurns] = useState<GenerationTurn[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptHistory, setPromptHistory] = useState<string[]>(loadPromptHistory);
  const [showHistory, setShowHistory] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const turnIdRef = useRef(0);

  // Results state
  const [explanation, setExplanation] = useState<SqlExplanationResult | null>(null);
  const [optimization, setOptimization] = useState<SqlOptimizationResult | null>(null);
  const [errorFix, setErrorFix] = useState<SqlErrorFixResult | null>(null);
  const [testCases, setTestCases] = useState<SqlTestCasesResult | null>(null);
  const [documentation, setDocumentation] = useState<SqlDocumentationResult | null>(null);

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
      const action = initialAction === "generate" ? "menu" : initialAction;
      setActiveAction(action);
      setWorkingSql(query);
      setViewName(suggestViewName(query));
      setViewTargetDb(database);
      setCreateViewSuccess(null);
      setCreateViewError(null);

      // Only auto-run if user specifically clicked a targeted quick action (e.g. from error banner)
      if (initialAction === "fix" && errorMessage) {
        runAction("fix", query);
      } else if (action !== "menu" && action !== "create_view" && query.trim()) {
        runAction(action, query);
      }
    }
  }, [isOpen, initialAction, query, database, errorMessage]);

  // The composer is the main entry point: focus it whenever the hub is shown.
  useEffect(() => {
    if (isOpen && activeAction === "menu") composerRef.current?.focus();
  }, [isOpen, activeAction]);

  // Auto-grow the composer with its content, up to a comfortable height.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [prompt, activeAction]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, isGenerating]);

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

  /** Returns a user-facing reason why AI calls are blocked, or null. */
  const aiBlockedReason = (): string | null => {
    if (!config.enabled) {
      return "La integración de IA está deshabilitada. Actívala en Ajustes de IA.";
    }
    if (config.privacy_mode && config.provider !== "ollama" && config.provider !== "mock") {
      return "El Modo Privado está activo: para usar proveedores en la nube desactívalo o configura Ollama (local) en Ajustes de IA.";
    }
    return null;
  };

  const runAction = async (action: CopilotActionType, sqlOverride?: string) => {
    setActiveAction(action);
    setError(null);

    // Actions that do not use AI completion
    if (action === "menu" || action === "create_view" || action === "generate") {
      return;
    }

    const blocked = aiBlockedReason();
    if (blocked) {
      setError(blocked);
      return;
    }

    const currentSql = sqlOverride ?? workingSql;
    setIsLoading(true);

    try {
      switch (action) {
        case "explain": {
          if (!currentSql.trim()) throw new Error("Ingresa una consulta SQL para explicar.");
          setExplanation(await aiService.explainSqlAi(database, currentSql, config));
          break;
        }
        case "optimize": {
          if (!currentSql.trim()) throw new Error("Ingresa una consulta SQL para optimizar.");
          setOptimization(await aiService.optimizeSqlAi(database, currentSql, config));
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
          setTestCases(await aiService.generateSqlTestsAi(database, currentSql, config));
          break;
        }
        case "docs": {
          if (!currentSql.trim()) throw new Error("Ingresa una consulta o tabla para documentar.");
          setDocumentation(await aiService.generateDocumentationAi(database, "query", "sql_query", config));
          break;
        }
      }
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al ejecutar la acción del asistente.";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const lastGeneratedSql = [...turns].reverse().find((t) => t.result)?.result?.generated_sql;
  const hasSql = Boolean(workingSql.trim());

  const handleGenerate = async (requestOverride?: string) => {
    const request = (requestOverride ?? prompt).trim();
    if (!request || isGenerating) return;

    const blocked = aiBlockedReason();
    if (blocked) {
      setError(blocked);
      return;
    }
    setError(null);

    const baseSql =
      contextSource === "editor" ? workingSql : contextSource === "last" ? lastGeneratedSql : undefined;
    const turn: GenerationTurn = { id: ++turnIdRef.current, request, context: baseSql ? contextSource : "none" };
    setTurns((prev) => [...prev, turn]);
    setPrompt("");
    setShowHistory(false);

    const nextHistory = [request, ...promptHistory.filter((p) => p !== request)].slice(0, PROMPT_HISTORY_MAX);
    setPromptHistory(nextHistory);
    savePromptHistory(nextHistory);

    setIsGenerating(true);
    try {
      const result = await aiService.generateSqlAi(database, buildGenerationPrompt(request, baseSql), config);
      setTurns((prev) => prev.map((t) => (t.id === turn.id ? { ...t, result } : t)));
      // Follow-ups refine the answer just produced unless the user says otherwise.
      setContextSource("last");
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "No se pudo generar el SQL.";
      setTurns((prev) => prev.map((t) => (t.id === turn.id ? { ...t, error: msg } : t)));
    } finally {
      setIsGenerating(false);
      composerRef.current?.focus();
    }
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleGenerate();
    } else if (e.key === "ArrowUp" && !prompt && promptHistory.length > 0) {
      e.preventDefault();
      setPrompt(promptHistory[0]);
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
      await dbService.executeConfirmedQuery(generatedViewDdl, targetDb);
      // Reload sidebar schema objects to display the new view immediately
      await loadSchemaObjects(targetDb);
      setCreateViewSuccess({ viewName: cleanName, db: targetDb, ddl: generatedViewDdl });
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
    const fallback = () => {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    };
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else {
      fallback();
    }
    setCopyFeedback(`${label} copiado`);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const openAsView = (sql: string) => {
    setWorkingSql(sql);
    setViewName(suggestViewName(sql));
    setCreateViewSuccess(null);
    setActiveAction("create_view");
  };

  /** Actions shared by every SQL the copilot proposes. */
  const sqlActions = (sql: string, label: string, applyLabel = "Insertar") => (
    <>
      <button onClick={() => handleCopy(sql, label)} title="Copiar SQL" className={iconBtn}>
        <Copy className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => openAsView(sql)} title="Convertir en vista" className={iconBtn}>
        <Eye className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => {
          onApplySql(sql);
          onClose();
        }}
        title="Reemplazar el contenido del editor con este SQL"
        className={ghostBtn}
      >
        <CornerDownLeft className="w-3.5 h-3.5" />
        <span>{applyLabel}</span>
      </button>
      {onRunSql && (
        <button
          onClick={() => {
            onRunSql(sql);
            onClose();
          }}
          title="Insertar en el editor y ejecutar (respeta el Modo Seguro)"
          className={ghostBtn}
        >
          <Play className="w-3.5 h-3.5" />
          <span>Ejecutar</span>
        </button>
      )}
    </>
  );

  const backButton = (
    <button onClick={() => setActiveAction("menu")} className={ghostBtn}>
      <ArrowLeft className="w-3.5 h-3.5" />
      <span>Volver</span>
    </button>
  );

  // Tools that work on the SQL already in the editor.
  const tools: Array<{
    id: CopilotActionType;
    label: string;
    hint: string;
    icon: React.ComponentType<{ className?: string }>;
    iconClass?: string;
    done: boolean;
    enabled: boolean;
  }> = [
    { id: "explain", label: "Explicar", hint: "Lógica, filtros y uniones en lenguaje claro", icon: Bot, done: !!explanation, enabled: hasSql },
    { id: "optimize", label: "Optimizar", hint: "Índices y reescritura para ir más rápido", icon: Zap, done: !!optimization, enabled: hasSql },
    { id: "fix", label: "Diagnosticar y corregir", hint: "Errores, ambigüedades y tipos incompatibles", icon: Bug, iconClass: errorMessage ? "text-danger" : undefined, done: !!errorFix, enabled: hasSql },
    { id: "create_view", label: "Convertir en vista", hint: "CREATE OR REPLACE VIEW reutilizable", icon: Eye, done: !!createViewSuccess, enabled: hasSql },
    { id: "tests", label: "Casos de prueba", hint: "Escenarios, bordes y aserciones", icon: TestTube2, done: !!testCases, enabled: hasSql },
    { id: "docs", label: "Documentar", hint: "Comentarios y diccionario de columnas", icon: FileText, done: !!documentation, enabled: hasSql },
  ];

  const openTool = (id: CopilotActionType) => {
    const hasResult = tools.find((t) => t.id === id)?.done;
    if (id === "create_view" || hasResult) {
      setError(null);
      setActiveAction(id);
    } else {
      void runAction(id);
    }
  };

  const contextOptions: Array<{ id: ContextSource; label: string; available: boolean; title: string }> = [
    { id: "none", label: "Nueva consulta", available: true, title: "Generar desde cero usando solo el esquema" },
    { id: "editor", label: "Consulta del editor", available: hasSql, title: "Modificar la consulta que tienes en el editor" },
    { id: "last", label: "Último resultado", available: !!lastGeneratedSql, title: "Refinar el último SQL generado" },
  ];

  const renderComposer = () => (
    <div className="rounded-lg border border-line bg-canvas focus-within:border-accent transition-colors">
      <textarea
        ref={composerRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleComposerKeyDown}
        rows={4}
        placeholder={
          contextSource === "last"
            ? "¿Qué quieres cambiar? Ej.: «agrupa por mes y ordena de mayor a menor»"
            : "Describe con tus palabras los datos que necesitas. Puedes ser tan detallado como quieras: tablas, filtros, agrupaciones, orden, formato de las columnas…"
        }
        className="block w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-xs leading-relaxed text-fg placeholder:text-fg-subtle focus:outline-none select-text"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2 pt-1">
        <div className="flex flex-wrap items-center gap-0.5" role="radiogroup" aria-label="Punto de partida">
          {contextOptions
            .filter((o) => o.available)
            .map((o) => (
              <button
                key={o.id}
                role="radio"
                aria-checked={contextSource === o.id}
                onClick={() => setContextSource(o.id)}
                title={o.title}
                className={`px-2 py-0.5 rounded-md text-[11px] transition-colors ${
                  contextSource === o.id ? "bg-hover text-fg font-medium" : "text-fg-muted hover:text-fg"
                }`}
              >
                {o.label}
              </button>
            ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[11px] text-fg-subtle hidden @sm:inline">Ctrl+Enter</span>
          <button
            onClick={() => void handleGenerate()}
            disabled={!prompt.trim() || isGenerating}
            title="Generar SQL (Ctrl+Enter)"
            className={`${primaryBtn} px-2`}
            aria-label="Generar SQL"
          >
            {isGenerating ? <Spinner className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );

  const renderThread = () => (
    <div className="space-y-5">
      {turns.map((turn) => (
        <div key={turn.id} className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-fg whitespace-pre-wrap select-text flex-1">{turn.request}</p>
            <button
              onClick={() => {
                setPrompt(turn.request);
                composerRef.current?.focus();
              }}
              title="Editar y volver a enviar"
              className={iconBtn}
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          {turn.context !== "none" && (
            <p className="text-[11px] text-fg-subtle">
              Partiendo de {turn.context === "editor" ? "la consulta del editor" : "el resultado anterior"}
            </p>
          )}
          {turn.error ? (
            <p className="text-xs text-fg-muted flex items-start gap-1.5 select-text">
              <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{turn.error}</span>
            </p>
          ) : turn.result ? (
            <div className="space-y-2">
              <SqlBlock sql={turn.result.generated_sql} />
              <div className="flex flex-wrap items-center justify-between gap-1">
                {turn.result.tables_used?.length > 0 ? (
                  <span className="text-[11px] text-fg-subtle font-mono truncate" title="Tablas usadas">
                    {turn.result.tables_used.join(", ")}
                  </span>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-0.5">{sqlActions(turn.result.generated_sql, "SQL")}</div>
              </div>
              {turn.result.explanation && (
                <details className="group">
                  <summary className="cursor-pointer text-[11px] text-fg-muted hover:text-fg select-none list-none flex items-center gap-1">
                    <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                    Cómo funciona
                  </summary>
                  <div className="pt-1.5 pl-4">
                    <MarkdownRenderer content={turn.result.explanation} />
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-fg-muted">
              <Spinner className="w-3.5 h-3.5" />
              <span>Analizando el esquema y escribiendo el SQL…</span>
            </div>
          )}
        </div>
      ))}
      <div ref={threadEndRef} />
    </div>
  );

  const renderHub = () => (
    <div className="space-y-5">
      {errorMessage && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-line p-3">
          <div className="flex items-start gap-2 min-w-0">
            <Bug className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-fg">La última ejecución falló</p>
              <p className="text-[11px] font-mono text-fg-muted line-clamp-2 mt-0.5">{errorMessage}</p>
            </div>
          </div>
          <button onClick={() => runAction("fix")} className={`${secondaryBtn} shrink-0`}>
            Corregir con IA
          </button>
        </div>
      )}

      {/* Natural language: the main entry point */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-fg">¿Qué datos necesitas?</h3>
          {promptHistory.length > 0 && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              title="Peticiones recientes (↑ en el cuadro vacío recupera la última)"
              className={`${ghostBtn} ${showHistory ? "text-fg bg-hover" : ""}`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Recientes</span>
            </button>
          )}
        </div>

        {turns.length > 0 && renderThread()}
        {renderComposer()}

        {showHistory && promptHistory.length > 0 ? (
          <div className="space-y-0.5">
            {promptHistory.map((p) => (
              <button key={p} onClick={() => setPrompt(p)} className={`${menuItem} rounded-md`} title={p}>
                <History className={menuIcon} />
                <span className="truncate">{p}</span>
              </button>
            ))}
            <button
              onClick={() => {
                setPromptHistory([]);
                savePromptHistory([]);
                setShowHistory(false);
              }}
              className={`${ghostBtn} mt-1`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Borrar recientes</span>
            </button>
          </div>
        ) : (
          turns.length === 0 &&
          !prompt && (
            <div className="space-y-0.5">
              {PROMPT_STARTERS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPrompt(p);
                    composerRef.current?.focus();
                  }}
                  className={`${menuItem} rounded-md text-fg-muted hover:text-fg`}
                >
                  <Sparkles className={menuIcon} />
                  <span className="truncate">{p}</span>
                </button>
              ))}
            </div>
          )
        )}
      </section>

      {/* Tools over the current editor query */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Con la consulta del editor</span>
          {!hasSql && <span className="text-[11px] text-fg-subtle">El editor está vacío</span>}
        </div>
        <div className="grid grid-cols-1 @md:grid-cols-2 gap-x-2">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={() => openTool(tool.id)}
                disabled={!tool.enabled}
                className="group w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left hover:bg-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${tool.iconClass ?? "text-fg-muted"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-fg">{tool.label}</span>
                  <span className="block text-[11px] text-fg-subtle truncate">{tool.hint}</span>
                </span>
                {tool.done ? (
                  <Check className="w-3.5 h-3.5 text-success shrink-0" aria-label="Resultado disponible" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-fg-subtle opacity-0 group-hover:opacity-100 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );

  const renderCreateView = () => (
    <div className="space-y-4">
      {createViewSuccess ? (
        <div className="space-y-3">
          <p className="text-xs text-fg flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            <span>
              Vista <strong className="font-mono">{createViewSuccess.viewName}</strong> creada en{" "}
              <strong className="font-mono">{createViewSuccess.db}</strong>.
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                onApplySql(`SELECT * FROM \`${createViewSuccess.viewName}\` LIMIT 100;`);
                onClose();
              }}
              className={primaryBtn}
            >
              Consultar la vista
            </button>
            <button onClick={() => handleCopy(createViewSuccess.ddl, "DDL")} className={ghostBtn}>
              <Copy className="w-3.5 h-3.5" />
              <span>Copiar DDL</span>
            </button>
            <button onClick={() => setCreateViewSuccess(null)} className={ghostBtn}>
              Crear otra vista
            </button>
          </div>
        </div>
      ) : (
        <>
          {createViewError && (
            <p className="text-xs text-fg flex items-start gap-2 select-text">
              <AlertTriangle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
              <span className="flex-1 font-mono">{createViewError}</span>
            </p>
          )}

          <div className="grid grid-cols-1 @md:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>Nombre de la vista</label>
              <input
                type="text"
                value={viewName}
                onChange={(e) => setViewName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                placeholder="v_mi_vista"
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className={fieldLabel}>Base de datos destino</label>
              <select value={viewTargetDb} onChange={(e) => setViewTargetDb(e.target.value)} className={`${inputClass} font-mono`}>
                {databases.map((db) => (
                  <option key={db.name} value={db.name}>
                    {db.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-fg cursor-pointer select-none">
            <input
              type="checkbox"
              checked={viewOrReplace}
              onChange={(e) => setViewOrReplace(e.target.checked)}
              className="rounded border-line bg-canvas cursor-pointer"
            />
            <span>
              Reemplazar si ya existe (<code className="font-mono">CREATE OR REPLACE</code>)
            </span>
          </label>

          <ResultSection
            icon={Eye}
            title="Sentencia a ejecutar"
            actions={
              <button onClick={() => handleCopy(generatedViewDdl, "DDL")} title="Copiar DDL" className={iconBtn}>
                <Copy className="w-3.5 h-3.5" />
              </button>
            }
          >
            <SqlBlock sql={generatedViewDdl} />
          </ResultSection>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => {
                onApplySql(generatedViewDdl);
                onClose();
              }}
              className={secondaryBtn}
            >
              Insertar en el editor
            </button>
            <button
              onClick={handleCreateViewInDb}
              disabled={isCreatingView || !viewName.trim() || !cleanViewSql}
              className={primaryBtn}
            >
              {isCreatingView ? <Spinner className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>Crear vista</span>
            </button>
          </div>
        </>
      )}
    </div>
  );

  const markdownResult = (
    icon: React.ComponentType<{ className?: string }>,
    title: string,
    markdown: string,
  ) => (
    <ResultSection
      icon={icon}
      title={title}
      actions={
        <button onClick={() => handleCopy(markdown, title)} title="Copiar Markdown" className={iconBtn}>
          <Copy className="w-3.5 h-3.5" />
        </button>
      }
    >
      <MarkdownRenderer content={markdown} />
    </ResultSection>
  );

  const renderToolResult = () => {
    switch (activeAction) {
      case "create_view":
        return renderCreateView();
      case "explain":
        return explanation && markdownResult(Bot, "Explicación", explanation.full_markdown);
      case "optimize":
        return (
          optimization && (
            <div className="space-y-5">
              <ResultSection icon={Zap} iconClass="text-warning" title="Consulta optimizada" actions={sqlActions(optimization.suggested_sql, "SQL optimizado")}>
                <SqlBlock sql={optimization.suggested_sql} />
              </ResultSection>
              {markdownResult(FileText, "Análisis de rendimiento", optimization.full_markdown)}
            </div>
          )
        );
      case "fix":
        return (
          errorFix && (
            <div className="space-y-5">
              <p className="text-[11px] font-mono text-fg-muted flex items-start gap-2 select-text">
                <Bug className="w-3.5 h-3.5 text-danger shrink-0" />
                <span>{errorFix.error_message}</span>
              </p>
              {errorFix.corrected_sql && (
                <ResultSection
                  icon={CheckCircle2}
                  iconClass="text-success"
                  title="Consulta corregida"
                  actions={sqlActions(errorFix.corrected_sql, "SQL corregido", "Aplicar")}
                >
                  <SqlBlock sql={errorFix.corrected_sql} />
                </ResultSection>
              )}
              {markdownResult(FileText, "Explicación del problema", errorFix.full_markdown)}
            </div>
          )
        );
      case "tests":
        return testCases && markdownResult(TestTube2, "Casos de prueba", testCases.test_cases_markdown);
      case "docs":
        return documentation && markdownResult(FileText, "Documentación", documentation.markdown_doc);
      default:
        return null;
    }
  };

  const activeToolLabel = tools.find((t) => t.id === activeAction)?.label;

  return (
    <div
      className={docked ? "h-full w-full" : modalBackdrop}
      onKeyDown={(e) => {
        // Keep editor shortcuts (Ctrl+Enter, Ctrl+S…) from firing while typing here.
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className={
          docked
            ? "@container h-full flex flex-col overflow-hidden bg-surface text-fg"
            : "@container bg-surface border border-line rounded-xl shadow-modal w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden text-fg"
        }
      >
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-line flex items-center justify-between gap-2 select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {activeAction !== "menu" ? (
              backButton
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-accent shrink-0" />
                <h2 className="text-sm font-medium text-fg">Asistente IA</h2>
              </>
            )}
            {activeToolLabel && <span className="text-xs text-fg truncate">{activeToolLabel}</span>}
          </div>
          <div className="flex items-center gap-0.5">
            <span className="text-[11px] text-fg-subtle mr-1 hidden @sm:flex items-center gap-1" title="Proveedor de IA y base de datos activa">
              {config.privacy_mode && <ShieldCheck className="w-3 h-3 text-success" aria-label="Modo Privado" />}
              {config.provider}
              <span>·</span>
              <Database className="w-3 h-3" />
              <span className="font-mono truncate max-w-[120px]">{database || "sin BD"}</span>
            </span>
            {activeAction !== "menu" && activeAction !== "create_view" && (
              <button
                onClick={() => runAction(activeAction)}
                disabled={isLoading}
                title="Volver a ejecutar"
                className={iconBtn}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            )}
            <button onClick={openAiSettings} title="Ajustes de IA (modelo, proveedor, privacidad)" className={iconBtn}>
              <Sliders className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} title="Cerrar (Esc)" className={iconBtn}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 text-xs select-text">
          {error && (
            <div className="mb-4 rounded-lg border border-line p-3 space-y-2">
              <p className="text-xs text-fg flex items-start gap-2 whitespace-pre-wrap">
                <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
                <span className="flex-1">{error}</span>
              </p>
              <div className="flex items-center justify-end gap-1 select-none">
                <button onClick={() => handleCopy(error, "Error")} className={ghostBtn}>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar</span>
                </button>
                {error.includes("Ajustes") && (
                  <button onClick={openAiSettings} className={secondaryBtn}>
                    Abrir ajustes de IA
                  </button>
                )}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-fg-muted select-none">
              <Spinner className="w-5 h-5" />
              <p className="text-xs">Consultando al modelo y analizando el esquema…</p>
            </div>
          ) : activeAction === "menu" || activeAction === "generate" ? (
            renderHub()
          ) : (
            renderToolResult()
          )}
        </div>

        {copyFeedback && (
          <div className="px-4 py-1.5 border-t border-line text-[11px] text-fg-muted flex items-center gap-1.5 select-none shrink-0">
            <Check className="w-3 h-3 text-success" />
            <span>{copyFeedback}</span>
          </div>
        )}
      </div>
    </div>
  );
};
