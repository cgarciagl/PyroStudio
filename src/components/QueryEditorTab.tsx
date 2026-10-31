import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { formatExportProgress } from "../utils/exportProgress";
import { FirstTimeHint } from "./ui/FirstTimeHint";
import CodeMirror, { type EditorView } from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { useSqlDialect } from "../services/sqlDialect";
import { completeFromList, snippet, snippetCompletion } from "@codemirror/autocomplete";
import { INSERT_SNIPPET_EVENT, useSnippets, type SqlSnippet } from "../services/snippetsStorage";
import { useSchemaStore } from "../stores/schemaStore";
import { analyzeCrossDatabase } from "../utils/crossDatabase";
import { resolveExecutionTarget, type ExecutionTargetMode } from "../services/sqlStatementExtractor";
import { DataGridCanvas } from "./DataGridCanvas";
import {
  Play,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Database,
  Loader2,
  Activity,
  FileSpreadsheet,
  Key,
  Shield,
  ShieldAlert,
  History,
  Star,
  Square,
  Sparkles,
  Bug,
  Lightbulb,
  Copy,
  Check,
  Clock,
  ChevronDown,
  Eye,
  Pencil,
  Lock,
  Save,
  PanelBottom,
  PanelRight,
  GitCommitHorizontal,
} from "lucide-react";
import { ManualTxBar } from "./ManualTxBar";
import { useManualTxStore } from "../stores/manualTxStore";
import { ghostBtn, menuItem, menuPanel, menuSeparator, primaryBtn, secondaryBtn, tabClass } from "./ui/styles";
import { FavoriteConflictError, favoritesStorage } from "../services/favoritesStorage";
import { activeSavedConnectionId } from "../types/database";

const ResultChart = React.lazy(() => import("./charts/ResultChart"));

import { dbService } from "../services/tauriDb";
import { queryHistoryStorage } from "../services/queryHistoryStorage";
import { diagnoseSqlError } from "../services/sqlDiagnostics";
import { usePreferenceStore } from "../stores/preferenceStore";
import { useCapabilitiesStore } from "../stores/capabilitiesStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useUIStore } from "../stores/uiStore";
import { useStagedChangesStore } from "../stores/stagedChangesStore";
import type {
  QueryExecutionResult,
  ExportProgressEvent,
  SqlSafetyAnalysis,
  SlowQueryAnalysis,
  ManualTxStatus,
} from "../types/database";
import { QueryPlanViewer } from "./QueryPlanViewer";
import { SafeExecutionModal } from "./SafeExecutionModal";
import { QueryHistoryModal } from "./QueryHistoryModal";
import { FavoritesModal } from "./FavoritesModal";
import { SqlCopilotDrawer, type CopilotActionType } from "./SqlCopilotDrawer";
import { RightDock, WIDE_LAYOUT_QUERY, useDockWidth, useIsWideLayout } from "./ui/RightDock";
import { SqlFormatButton } from "./SqlFormatButton";
import { formatSql } from "../services/sqlFormat";
import { SqlVariablesModal, extractSqlVariables } from "./SqlVariablesModal";

type ExecutionState = "idle" | "executing" | "success" | "error" | "cancelled";

interface QueryEditorTabProps {
  /** Tab id, used to link the tab to the saved query after Ctrl+S. */
  tabId?: string;
  /** When set, Ctrl+S updates this saved query directly. */
  savedQueryId?: string;
  /** Default folder for a new saved query (tab created inside a query folder). */
  pendingFolder?: string;
  database: string;
  initialQuery?: string;
  onQueryChange?: (newQuery: string) => void;
  /** Cursor offset to restore when the editor is created. */
  initialCursor?: number;
  /** Reports cursor moves (debounced), so the session can restore them. */
  onCursorChange?: (pos: number) => void;
}


type ResultsLayout = "bottom" | "right";
const RESULTS_LAYOUT_KEY = "pyro_query_results_layout";
const RESULTS_LAYOUT_EVENT = "pyro:query-results-layout";
const readResultsLayout = (): ResultsLayout => {
  try {
    const saved = localStorage.getItem(RESULTS_LAYOUT_KEY);
    if (saved === "right" || saved === "bottom") return saved;
    // Sin preferencia guardada: en monitores panorámicos los resultados van a la derecha.
    return window.matchMedia?.(WIDE_LAYOUT_QUERY).matches && window.innerWidth / window.innerHeight >= 1.6
      ? "right"
      : "bottom";
  } catch {
    return "bottom";
  }
};

export const QueryEditorTab: React.FC<QueryEditorTabProps> = ({
  tabId,
  savedQueryId,
  pendingFolder,
  database,
  initialQuery: initialQueryProp,
  onQueryChange,
  initialCursor,
  onCursorChange,
}) => {
  const dialect = useSqlDialect();
  const initialQuery = initialQueryProp ?? dialect.starterQuery;
  const [query, setQuery] = useState(initialQuery);
  // Last saved SQL of the linked saved query: drives the "unsaved changes" state.
  // The stored query is the baseline (survives tab remounts); compare ignoring outer whitespace.
  const [savedSql, setSavedSql] = useState<string | null>(() =>
    savedQueryId
      ? favoritesStorage.getFavorites().find((f) => f.id === savedQueryId)?.sql ?? initialQuery
      : null,
  );
  useEffect(() => {
    if (savedQueryId) {
      setSavedSql(favoritesStorage.getFavorites().find((f) => f.id === savedQueryId)?.sql ?? query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedQueryId]);
  const isDirty = savedQueryId ? savedSql !== null && query.trim() !== savedSql.trim() : query.trim().length > 0;
  const [executionState, setExecutionState] = useState<ExecutionState>("idle");
  // Manual-commit mode: the tab runs on a reserved connection with autocommit = 0.
  const [txStatus, setTxStatus] = useState<ManualTxStatus | null>(null);
  const [txBusy, setTxBusy] = useState(false);
  const txActiveRef = useRef(false);
  txActiveRef.current = txStatus !== null;

  useEffect(() => {
    if (!tabId) return;
    if (txStatus) useManualTxStore.getState().setPending(tabId, txStatus.pending_statements);
    else useManualTxStore.getState().clear(tabId);
  }, [tabId, txStatus]);

  // Closing the tab (or reconnecting) rolls back whatever is still pending.
  useEffect(() => {
    return () => {
      if (tabId && txActiveRef.current) {
        void dbService.manualTxEnd(tabId).catch(() => {});
        useManualTxStore.getState().clear(tabId);
      }
    };
  }, [tabId]);

  const runTxAction = async (action: () => Promise<ManualTxStatus | null>) => {
    setTxBusy(true);
    try {
      setTxStatus(await action());
    } catch (err) {
      useUIStore.getState().showAlert({
        title: "Transacción manual",
        message: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setTxBusy(false);
    }
  };

  const enterManualTx = () => {
    if (!tabId) return;
    void runTxAction(() => dbService.manualTxBegin(tabId));
  };

  const exitManualTx = () => {
    if (!tabId) return;
    const leave = () =>
      void runTxAction(async () => {
        await dbService.manualTxEnd(tabId);
        return null;
      });
    const pending = txStatus?.pending_statements ?? 0;
    if (pending === 0) {
      leave();
      return;
    }
    useUIStore.getState().showConfirm({
      title: "Salir de la transacción manual",
      message: `Hay ${pending} sentencia(s) sin COMMIT. Al volver a auto-commit se hará ROLLBACK.`,
      variant: "warning",
      icon: "alert",
      confirmText: "Descartar y salir",
      onConfirm: leave,
    });
  };
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [copilotAction, setCopilotAction] = useState<CopilotActionType>("menu");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<QueryExecutionResult | null>(null);
  const [resultSql, setResultSql] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgressEvent | null>(null);
  const [explainResult, setExplainResult] = useState<QueryExecutionResult | null>(null);
  const [explainAnalysis, setExplainAnalysis] = useState<SlowQueryAnalysis | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<"results" | "chart" | "plan">("results");
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);
  const [isVariablesModalOpen, setIsVariablesModalOpen] = useState(false);
  const [pendingVariableSql, setPendingVariableSql] = useState("");
  const [pendingVariables, setPendingVariables] = useState<string[]>([]);

  const { completionSchemas, routines, loadCompletionSchema } = useSchemaStore();
  const dbCompletionSchema = completionSchemas[database];

  useEffect(() => {
    if (database && (!dbCompletionSchema || Object.keys(dbCompletionSchema).length === 0)) {
      loadCompletionSchema(database);
    }
  }, [database, dbCompletionSchema, loadCompletionSchema]);

  const snippets = useSnippets();

  const sqlExtensions = useMemo(() => {
    const schema = dbCompletionSchema || {};
    const tableItems = Object.keys(schema).map((tbl) => ({
      label: tbl,
      type: "type",
      detail: "Tabla",
      boost: 2,
    }));

    const routineItems = (routines[database] || []).map((r) => ({
      label: r.name,
      type: "function",
      detail: r.routine_type === "FUNCTION" ? "Función" : "Procedimiento",
      boost: 1,
    }));

    const sqlFunctions = [
      { label: "COUNT", type: "function", detail: "COUNT(expr)" },
      { label: "SUM", type: "function", detail: "SUM(expr)" },
      { label: "AVG", type: "function", detail: "AVG(expr)" },
      { label: "MIN", type: "function", detail: "MIN(expr)" },
      { label: "MAX", type: "function", detail: "MAX(expr)" },
      { label: "COALESCE", type: "function", detail: "COALESCE(val, fallback)" },
      { label: "IFNULL", type: "function", detail: "IFNULL(expr1, expr2)" },
      { label: "CONCAT", type: "function", detail: "CONCAT(s1, s2, ...)" },
      { label: "GROUP_CONCAT", type: "function", detail: "GROUP_CONCAT(expr)" },
      { label: "DATE_FORMAT", type: "function", detail: "DATE_FORMAT(date, format)" },
      { label: "DATEDIFF", type: "function", detail: "DATEDIFF(d1, d2)" },
      { label: "NOW", type: "function", detail: "NOW()" },
      { label: "CURDATE", type: "function", detail: "CURDATE()" },
      { label: "UNIX_TIMESTAMP", type: "function", detail: "UNIX_TIMESTAMP()" },
      { label: "JSON_EXTRACT", type: "function", detail: "JSON_EXTRACT(doc, path)" },
      { label: "JSON_UNQUOTE", type: "function", detail: "JSON_UNQUOTE(val)" },
      { label: "LAST_INSERT_ID", type: "function", detail: "LAST_INSERT_ID()" },
      { label: "UUID", type: "function", detail: "UUID()" },
      // MariaDB Vector functions (11.7+ / 11.8+)
      { label: "VEC_FromText", type: "function", detail: "VEC_FromText('[1.0, 2.0, ...]') (MariaDB Vector)" },
      { label: "VEC_ToText", type: "function", detail: "VEC_ToText(vector_column) (MariaDB Vector)" },
      { label: "VEC_DISTANCE", type: "function", detail: "VEC_DISTANCE(vec1, vec2) (MariaDB Vector)" },
      { label: "VEC_DISTANCE_COSINE", type: "function", detail: "VEC_DISTANCE_COSINE(vec1, vec2) (MariaDB Vector)" },
      { label: "VEC_DISTANCE_EUCLIDEAN", type: "function", detail: "VEC_DISTANCE_EUCLIDEAN(vec1, vec2) (MariaDB Vector)" },
      // MariaDB Temporal keywords
      { label: "FOR SYSTEM_TIME ALL", type: "keyword", detail: "Consultar todas las versiones históricas (MariaDB Temporal)" },
      { label: "FOR SYSTEM_TIME AS OF", type: "keyword", detail: "Consultar estado en fecha/hora exacta (MariaDB Temporal)" },
      { label: "FOR SYSTEM_TIME BETWEEN", type: "keyword", detail: "Consultar cambios en intervalo de tiempo (MariaDB Temporal)" },
      // MariaDB Sequences keywords
      { label: "NEXT VALUE FOR", type: "keyword", detail: "NEXT VALUE FOR sequence_name (MariaDB Sequence)" },
      { label: "PREVIOUS VALUE FOR", type: "keyword", detail: "PREVIOUS VALUE FOR sequence_name (MariaDB Sequence)" },
    ];

    // Snippets expand their body; `${campo}` placeholders become tab stops.
    const snippetItems = snippets.map((s) =>
      snippetCompletion(s.body, {
        label: s.prefix,
        detail: s.name,
        info: s.description,
        type: "text",
        boost: 50,
      }),
    );

    const customCompletions = completeFromList([
      ...snippetItems,
      ...tableItems,
      ...routineItems,
      ...sqlFunctions,
    ]);

    return [
      sql({
        dialect: dialect.codeMirror,
        schema,
        defaultSchema: database,
      }),
      dialect.codeMirror.language.data.of({
        autocomplete: customCompletions,
      }),
    ];
  }, [dbCompletionSchema, routines, database, dialect, snippets]);

  // Editor & Execution control refs
  const editorViewRef = useRef<EditorView | null>(null);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Snippets inserted from the command palette go to the active query tab only.
  useEffect(() => {
    const onInsert = (event: Event) => {
      const view = editorViewRef.current;
      if (!view || useUIStore.getState().activeTabId !== tabId) return;
      const { body } = (event as CustomEvent<SqlSnippet>).detail;
      const { from, to } = view.state.selection.main;
      snippet(body)(view, null, from, to);
      view.focus();
    };
    window.addEventListener(INSERT_SNIPPET_EVENT, onInsert);
    return () => window.removeEventListener(INSERT_SNIPPET_EVENT, onInsert);
  }, [tabId]);
  const cancelRequestedRef = useRef(false);
  const activeQueryIdRef = useRef<string | null>(null);
  const executionEpochRef = useRef<number>(0);
  const timerIntervalRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);
  const executionStartRef = useRef<number>(0);

  // Execution mode & Timeout
  const [executionMode, setExecutionMode] = useState<ExecutionTargetMode>("all");
  const [isExecMenuOpen, setIsExecMenuOpen] = useState(false);
  const [timeoutSec, setTimeoutSec] = useState<number>(30); // 0 = unlimited
  const [isCopiedError, setIsCopiedError] = useState(false);
  const execMenuRef = useRef<HTMLDivElement>(null);

  // Safe Mode from store & Connection state
  const { safeModeEnabled, theme, noPrimaryKeyMode } = usePreferenceStore();
  const { connectionStatus } = useConnectionStore();
  const [isSafeModalOpen, setIsSafeModalOpen] = useState(false);
  const [safetyAnalysis, setSafetyAnalysis] = useState<SqlSafetyAnalysis | null>(null);
  // Exact SQL the modal is asking about (may be a selection, not the whole editor)
  const [pendingSafeSql, setPendingSafeSql] = useState<string | null>(null);
  const [estimatedAffectedRows, setEstimatedAffectedRows] = useState<number | null>(null);

  // History & Favorites Modals
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isFavoritesModalOpen, setIsFavoritesModalOpen] = useState(false);

  // The editor has a single right dock: opening one panel closes the others.
  useEffect(() => {
    if (isCopilotOpen) {
      setIsHistoryModalOpen(false);
      setIsFavoritesModalOpen(false);
    }
  }, [isCopilotOpen]);
  useEffect(() => {
    if (isHistoryModalOpen) {
      setIsCopilotOpen(false);
      setIsFavoritesModalOpen(false);
    }
  }, [isHistoryModalOpen]);
  useEffect(() => {
    if (isFavoritesModalOpen) {
      setIsCopilotOpen(false);
      setIsHistoryModalOpen(false);
    }
  }, [isFavoritesModalOpen]);
  const [initialFavToSave, setInitialFavToSave] = useState<string | undefined>(undefined);

  const activeConnectionId = activeSavedConnectionId(connectionStatus.config);

  useEffect(() => {
    if (tabId && savedQueryId) useUIStore.getState().setTabModified(tabId, isDirty);
  }, [tabId, savedQueryId, isDirty]);

  /** Ctrl+S: update the linked saved query, or ask where to save a new one. */
  const saveCurrentQuery = async (mode?: "overwrite" | "copy") => {
    const linked = savedQueryId
      ? favoritesStorage.getFavorites().find((f) => f.id === savedQueryId)
      : undefined;
    if (!linked || favoritesStorage.isPreset(linked.id)) {
      setInitialFavToSave(query);
      setIsFavoritesModalOpen(true);
      return;
    }
    try {
      await favoritesStorage.persistFavorite({ ...linked, sql: query }, mode);
      setSavedSql(query);
      if (tabId) useUIStore.getState().setTabModified(tabId, false);
      setSaveStatus({ success: true, message: `Guardada: ${linked.title}` });
      setTimeout(() => setSaveStatus(null), 2500);
    } catch (e) {
      if (e instanceof FavoriteConflictError) {
        useUIStore.getState().showConfirm({
          title: "La consulta cambió fuera de PyroStudio",
          message: "El archivo .sql se modificó en disco (otro equipo o un editor externo).",
          details: "«Sobrescribir» reemplaza la versión del disco. «Guardar como copia» conserva ambas.",
          variant: "warning",
          icon: "alert",
          confirmText: "Sobrescribir",
          cancelText: "Guardar como copia",
          onConfirm: () => void saveCurrentQuery("overwrite"),
          onCancel: () => void saveCurrentQuery("copy"),
        });
        return;
      }
      setSaveStatus({ success: false, message: e instanceof Error ? e.message : String(e) });
    }
  };

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (execMenuRef.current && !execMenuRef.current.contains(e.target as Node)) {
        setIsExecMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Structured SQL diagnostic parsing on error
  const diagnostic = useMemo(() => (error ? diagnoseSqlError(error) : null), [error]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isDisposed = false;
    const subscribe = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stopListening = await listen<ExportProgressEvent>(
        "excel-export-progress",
        (event) => setExportProgress(event.payload),
      );
      if (isDisposed) stopListening();
      else unlisten = stopListening;
    };
    void subscribe().catch((listenerError) => {
      console.error("No se pudo escuchar el progreso de exportación Excel:", listenerError);
    });
    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

// Helper to robustly extract table and optional database from SQL
function extractTargetTableAndDb(sqlText: string): { db: string | null; table: string | null } {
  if (!sqlText) return { db: null, table: null };
  const clean = sqlText
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/#.*$/gm, " ");

  const match = clean.match(
    /\b(?:FROM|UPDATE|INTO)\s+[`"]?([a-zA-Z0-9_$]+)[`"]?(?:\s*\.\s*[`"]?([a-zA-Z0-9_$]+)[`"]?)?/i,
  );
  if (!match) return { db: null, table: null };
  if (match[2]) {
    return { db: match[1], table: match[2] };
  }
  return { db: null, table: match[1] };
}



  // Resizable SQL Editor height (with localStorage persistence)
  const [editorHeight, setEditorHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("pyro_query_editor_height");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 80 && parsed <= 900) return parsed;
      }
    } catch {}
    return 190;
  });

  const isDraggingSplitterRef = useRef(false);
  const startDragYRef = useRef(0);
  const startHeightRef = useRef(editorHeight);

  // Results panel placement (below or beside the editor), shared by every query tab
  const [resultsLayout, setResultsLayout] = useState<ResultsLayout>(readResultsLayout);
  useEffect(() => {
    const sync = () => setResultsLayout(readResultsLayout());
    window.addEventListener(RESULTS_LAYOUT_EVENT, sync);
    return () => window.removeEventListener(RESULTS_LAYOUT_EVENT, sync);
  }, []);
  const toggleResultsLayout = () => {
    const next: ResultsLayout = resultsLayout === "right" ? "bottom" : "right";
    try {
      localStorage.setItem(RESULTS_LAYOUT_KEY, next);
    } catch {}
    setResultsLayout(next);
    window.dispatchEvent(new Event(RESULTS_LAYOUT_EVENT));
  };
  const isSideBySide = resultsLayout === "right";
  const isWideLayout = useIsWideLayout();
  const [dockWidth, setDockWidth] = useDockWidth("pyro_editor_dock_width", 560);

  // Editor width when results sit on the right (with localStorage persistence)
  const [editorWidth, setEditorWidth] = useState<number>(() => {
    try {
      const parsed = parseInt(localStorage.getItem("pyro_query_editor_width") || "", 10);
      if (!isNaN(parsed) && parsed >= 200) return parsed;
    } catch {}
    return Math.round(window.innerWidth * 0.4);
  });
  const startWidthRef = useRef(editorWidth);

  const handleVerticalSplitterMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      startWidthRef.current = editorWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const newWidth = Math.max(
          200,
          Math.min(window.innerWidth - 300, startWidthRef.current + moveEvent.clientX - startX),
        );
        setEditorWidth(newWidth);
        try {
          localStorage.setItem("pyro_query_editor_width", String(newWidth));
        } catch {}
      };

      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [editorWidth],
  );

  const handleSplitterMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingSplitterRef.current = true;
      startDragYRef.current = e.clientY;
      startHeightRef.current = editorHeight;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingSplitterRef.current) return;
        const deltaY = moveEvent.clientY - startDragYRef.current;
        const newHeight = Math.max(
          80,
          Math.min(window.innerHeight - 200, startHeightRef.current + deltaY),
        );
        setEditorHeight(newHeight);
        try {
          localStorage.setItem("pyro_query_editor_height", String(newHeight));
        } catch {}
      };

      const onMouseUp = () => {
        isDraggingSplitterRef.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [editorHeight],
  );

  // Target table and PK state
  const [targetTableOverride, setTargetTableOverride] = useState<string>("");
  const [targetPkOverride, setTargetPkOverride] = useState<string>("");
  const [tablePkColumns, setTablePkColumns] = useState<string[]>([]);

  // Clear timer interval on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  // Available tables in active database for auto-suggestions
  const { tables: schemaTables } = useSchemaStore();
  const availableTables = useMemo(() => {
    const fromStore = (schemaTables[database] || []).map((t) => t.name);
    if (fromStore.length > 0) return fromStore;
    if (dbCompletionSchema) return Object.keys(dbCompletionSchema);
    return [];
  }, [schemaTables, dbCompletionSchema, database]);

  // Helper to detect table and database from query (prioritize resultSql for current grid data)
  const detectedTarget = useMemo(() => {
    return extractTargetTableAndDb(resultSql || query);
  }, [resultSql, query]);

  const activeTargetTable = targetTableOverride.trim() || detectedTarget.table || "";
  const activeTargetDb = detectedTarget.db || database;

  // Proactively fetch real PK columns of the target table from DB metadata
  useEffect(() => {
    if (!activeTargetTable || !activeTargetDb) {
      setTablePkColumns([]);
      return;
    }
    let isMounted = true;
    dbService
      .getTablePrimaryKey(activeTargetDb, activeTargetTable)
      .then((pk) => {
        if (isMounted && pk?.columns) {
          setTablePkColumns(pk.columns);
        }
      })
      .catch(() => {
        if (isMounted) setTablePkColumns([]);
      });
    return () => {
      isMounted = false;
    };
  }, [activeTargetDb, activeTargetTable]);

  // Primary key columns: override if user specified, otherwise from DB schema
  const activePkColumns = useMemo(() => {
    if (targetPkOverride.trim()) {
      return targetPkOverride
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return tablePkColumns;
  }, [targetPkOverride, tablePkColumns]);

  const hasPrimaryKey = activePkColumns.length > 0;

  // Case-insensitive check to ensure all PK columns are present in query results
  const pkColumnsPresent = useMemo(() => {
    if (!result || !result.columns || !hasPrimaryKey) return false;
    const lowerResultCols = result.columns.map((c) => c.toLowerCase());
    return activePkColumns.every((pk) =>
      lowerResultCols.includes(pk.toLowerCase()),
    );
  }, [result, activePkColumns, hasPrimaryKey]);

  const connectionReadOnly = Boolean(connectionStatus.config?.read_only);
  const canEditResult = Boolean(
    !connectionReadOnly &&
      activeTargetTable &&
      (hasPrimaryKey ? pkColumnsPresent : noPrimaryKeyMode === "use_all_columns"),
  );

  // Resolves the SQL segment to execute based on selection, cursor and preferred mode
  const getTargetSql = useCallback(
    (preferredMode: ExecutionTargetMode = executionMode) => {
      let selectionText: string | undefined;
      let cursorOffset: number | undefined;

      if (editorViewRef.current) {
        const state = editorViewRef.current.state;
        const sel = state.selection.main;
        if (!sel.empty) {
          selectionText = state.sliceDoc(sel.from, sel.to);
        }
        cursorOffset = sel.head;
      }

      return resolveExecutionTarget({
        fullText: query,
        selectionText,
        cursorOffset,
        preferredMode,
      });
    },
    [query, executionMode],
  );

  // Direct internal query executor (called after Safe Mode check passes)
  const executeQueryInternal = useCallback(
    async (sqlToRun: string, confirmationToken?: string) => {
      const currentEpoch = ++executionEpochRef.current;
      const queryId = `query_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      activeQueryIdRef.current = queryId;
      cancelRequestedRef.current = false;
      setExecutionState("executing");
      setError(null);
      setResult(null);
      setResultSql(null);
      executionStartRef.current = Date.now();
      setElapsedMs(0);

      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      timerIntervalRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - executionStartRef.current);
      }, 50);

      // Client-side configurable timeout guard
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      if (timeoutSec > 0) {
        timeoutTimerRef.current = window.setTimeout(async () => {
          if (executionEpochRef.current === currentEpoch) {
            cancelRequestedRef.current = true;
            try {
              await dbService.cancelQuery(queryId);
            } catch {}
            setExecutionState("error");
            setError(
              `Tiempo de espera excedido: La consulta superó el límite configurado de ${timeoutSec}s. Se envió la señal de cancelación al motor.`,
            );
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current);
              timerIntervalRef.current = null;
            }
          }
        }, timeoutSec * 1000);
      }

      try {
        const res =
          tabId && txActiveRef.current
            ? await dbService
                .manualTxExecute(tabId, sqlToRun, database, {
                  safeMode: safeModeEnabled,
                  confirmationToken,
                })
                .then(({ result, status }) => {
                  setTxStatus(status);
                  return result;
                })
            : await dbService.executeQuery(sqlToRun, database, queryId, {
                safeMode: safeModeEnabled,
                confirmationToken,
              });

        // Guard against race conditions from previous slow executions
        if (executionEpochRef.current !== currentEpoch) {
          return;
        }

        if (cancelRequestedRef.current) {
          setExecutionState("cancelled");
          return;
        }

        const duration = Date.now() - executionStartRef.current;
        setElapsedMs(duration);
        setExecutionState("success");
        setResult(res);
        setResultSql(sqlToRun);
        setActiveSubTab("results");

        // Log successful execution in persistent history
        queryHistoryStorage.addEntry({
          connectionName: connectionStatus.config?.savedConnectionName || "Local",
          database,
          sql: sqlToRun,
          durationMs: res.execution_time_ms || duration,
          success: true,
          affectedRows: res.rows.length || (res.affected_rows as number),
          errorMessage: res.warning,
        });
      } catch (err: unknown) {
        // Discard stale responses
        if (executionEpochRef.current !== currentEpoch) {
          return;
        }

        setExportProgress(null);
        if (cancelRequestedRef.current) {
          setExecutionState("cancelled");
          return;
        }

        const duration = Date.now() - executionStartRef.current;
        setElapsedMs(duration);
        setExecutionState("error");
        const msg =
          typeof err === "string"
            ? err
            : (err as Error)?.message || "Error al ejecutar la consulta";
        setError(msg);
        setResult(null);
        setResultSql(null);

        // Log failed execution in persistent history
        queryHistoryStorage.addEntry({
          connectionName: connectionStatus.config?.savedConnectionName || "Local",
          database,
          sql: sqlToRun,
          durationMs: duration,
          success: false,
          errorMessage: msg,
        });
      } finally {
        if (timeoutTimerRef.current) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
        if (executionEpochRef.current === currentEpoch && timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }
    },
    [database, timeoutSec, connectionStatus.config?.savedConnectionName, safeModeEnabled, tabId],
  );

  // Main entry point for query execution (checks Safe Mode first)
  const handleRunQuery = useCallback(
    async (
      forcedModeOrSql?: ExecutionTargetMode | string,
      explicitSql?: string,
      crossDbConfirmed = false,
    ) => {
      let targetSql = explicitSql?.trim();
      let forcedMode: ExecutionTargetMode = executionMode;

      if (forcedModeOrSql) {
        if (
          forcedModeOrSql === "auto" ||
          forcedModeOrSql === "selection" ||
          forcedModeOrSql === "statement" ||
          forcedModeOrSql === "all"
        ) {
          forcedMode = forcedModeOrSql;
        } else {
          targetSql = forcedModeOrSql.trim();
        }
      }

      if (!targetSql) {
        const target = getTargetSql(forcedMode);
        targetSql = target.sql.trim();
      }
      if (!targetSql) return;

      // Single active database: writes aimed at another database are blocked,
      // cross-database reads only need confirmation.
      if (database && !crossDbConfirmed) {
        const knownDbs = useSchemaStore.getState().databases.map((d) => d.name);
        const { foreignDatabases, isWrite } = analyzeCrossDatabase(targetSql, database, knownDbs);
        if (foreignDatabases.length > 0) {
          const others = foreignDatabases.map((d) => `'${d}'`).join(", ");
          if (isWrite) {
            useUIStore.getState().showAlert({
              title: "Consulta bloqueada",
              message: `Esta consulta modifica o cambia a ${others}, pero la base de datos activa es '${database}'.`,
              details: "Para trabajar sobre otra base de datos, actívala desde el panel lateral.",
              variant: "danger",
              icon: "alert",
            });
            return;
          }
          const sqlToConfirm = targetSql;
          useUIStore.getState().showConfirm({
            title: "Consulta a otra base de datos",
            message: `Esta consulta lee de ${others}, pero la base de datos activa es '${database}'. ¿Deseas ejecutarla?`,
            variant: "warning",
            icon: "alert",
            confirmText: "Ejecutar",
            onConfirm: () => handleRunQuery(forcedModeOrSql, sqlToConfirm, true),
          });
          return;
        }
      }

      // Check if there are pending unapplied changes in the current target table
      if (!explicitSql && activeTargetTable) {
        const hasPending = useStagedChangesStore.getState().hasPendingChanges(activeTargetDb, activeTargetTable);
        if (hasPending) {
          useUIStore.getState().showConfirm({
            title: "Cambios Pendientes sin Guardar",
            message: `Hay cambios pendientes en la tabla '${activeTargetTable}'. Si ejecutas una nueva consulta se descartarán los cambios no aplicados. ¿Deseas continuar?`,
            variant: "warning",
            icon: "alert",
            confirmText: "Descartar y Ejecutar",
            cancelText: "Volver",
            onConfirm: () => {
              useStagedChangesStore.getState().clearTableChanges(activeTargetDb, activeTargetTable);
              handleRunQuery(forcedModeOrSql, targetSql, crossDbConfirmed);
            },
          });
          return;
        }
      }

      // Check for named dynamic parameters (:variable)
      const dynamicVars = extractSqlVariables(targetSql);
      if (dynamicVars.length > 0) {
        setPendingVariableSql(targetSql);
        setPendingVariables(dynamicVars);
        setIsVariablesModalOpen(true);
        return;
      }

      const isProduction = connectionStatus.config?.environment === "production";

      // In production, Safe Mode safety checks are always enforced
      if (safeModeEnabled || isProduction) {
        try {
          const analysis = await dbService.checkSqlSafety(targetSql);
          // In production, any destructive or non-safe query requires confirmation
          if (analysis.is_destructive || (isProduction && analysis.danger_level !== "Safe")) {
            setSafetyAnalysis(analysis);
            setPendingSafeSql(targetSql);
            let affected: number | null = null;
            try {
              affected = await dbService.previewAffectedRows(database, targetSql);
            } catch {
              // Non-blocking if estimation query cannot run
            }
            setEstimatedAffectedRows(affected);
            setIsSafeModalOpen(true);
            return;
          }
        } catch (analysisErr) {
          // If safety analysis fails, apply conservative policy: do not run blindly
          setPendingSafeSql(targetSql);
          setSafetyAnalysis({
            is_destructive: true,
            danger_level: "Critical",
            operation: "NO EVALUADA (Error de análisis)",
            message: `No se pudo verificar la seguridad de la consulta debido a un error: ${
              analysisErr instanceof Error ? analysisErr.message : String(analysisErr)
            }. Por precaución, confirme la ejecución explícitamente.`,
            requires_explicit_confirmation: true,
            is_uncertain: true,
          });
          setIsSafeModalOpen(true);
          return;
        }
      }

      await executeQueryInternal(targetSql);
    },
    [getTargetSql, executionMode, safeModeEnabled, executeQueryInternal, connectionStatus.config?.environment, database],
  );

  // Cancel running query and forward signal to backend
  const handleCancelQuery = useCallback(async () => {
    cancelRequestedRef.current = true;
    executionEpochRef.current++;
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setExecutionState("cancelled");

    if (activeQueryIdRef.current) {
      try {
        await dbService.cancelQuery(activeQueryIdRef.current);
      } catch (cancelErr) {
        console.warn("No se pudo enviar KILL QUERY al motor:", cancelErr);
      }
    }
  }, []);

  const handleExplainQuery = useCallback(async () => {
    if (!query.trim()) return;
    setIsExplaining(true);
    setError(null);
    try {
      const isSqlite = useCapabilitiesStore.getState().capabilities?.engine === "sqlite";

      if (isSqlite) {
        setExplainAnalysis(null);
        const explainSql = `EXPLAIN QUERY PLAN ${query.trim().replace(/;+$/, "")};`;
        const res = await dbService.executeQuery(explainSql, database);
        setExplainResult(res);
        setActiveSubTab("plan");
      } else {
        // 1. Fetch deep SlowQueryAnalysis (JSON plan, visual nodes, tree plan, bottlenecks)
        try {
          const analysis = await dbService.analyzeSlowQuery(query, database);
          setExplainAnalysis(analysis);
        } catch (analysisErr) {
          console.warn("analyzeSlowQuery fallback:", analysisErr);
          setExplainAnalysis(null);
        }

        // 2. Fetch raw tabular explain result for execution timing and column metadata
        const explainSql = `EXPLAIN ${query.trim().replace(/;+$/, "")};`;
        const res = await dbService.executeQuery(explainSql, database);
        setExplainResult(res);
        setActiveSubTab("plan");
      }
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al generar el plan de ejecución";
      setError(msg);
    } finally {
      setIsExplaining(false);
    }
  }, [query, database]);

  const handleExportExcel = useCallback(async () => {
    if (!result || !result.columns || result.rows.length === 0 || !resultSql) {
      setSaveStatus({
        success: false,
        message: "No hay filas en los resultados para exportar.",
      });
      setTimeout(() => setSaveStatus(null), 4000);
      return;
    }
    setIsExporting(true);
    setSaveStatus(null);
    setExportProgress({ rows_written: 0, stage: "Preparando exportación" });
    try {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      // Sin extensión: el diálogo añade la del tipo elegido (Excel, CSV o CSV.gz).
      const defaultName = `consulta_${database}_${timestamp}`;
      const chosenPath = await dbService.saveExcelDialog(defaultName);
      if (!chosenPath) {
        setExportProgress(null);
        setIsExporting(false);
        return;
      }

      const summary = await dbService.exportExcelFile({
        database,
        table: "",
        query: resultSql,
        file_path: chosenPath,
        csv_part_rows: usePreferenceStore.getState().csvPartRows || undefined,
      });
      setExportProgress(null);

      setSaveStatus({
        success: true,
        message: `Archivo generado: ${summary.total_rows.toLocaleString()} fila(s) exportada(s) (${summary.execution_time_ms} ms)`,
      });
      setTimeout(() => setSaveStatus(null), 5000);
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al exportar";
      setSaveStatus({
        success: false,
        message: msg,
      });
      setTimeout(() => setSaveStatus(null), 6000);
    } finally {
      setIsExporting(false);
    }
  }, [result, resultSql, database]);

  // Tab modified tracking
  const { activeTabId, setTabModified } = useUIStore();
  useEffect(() => {
    if (activeTabId) {
      setTabModified(activeTabId, query !== initialQuery);
    }
  }, [query, initialQuery, activeTabId, setTabModified]);

  // Formats the selection (or the whole script) in place, as one undoable change.
  const handleFormatQuery = () => {
    const view = editorViewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const from = sel.empty ? 0 : sel.from;
    const to = sel.empty ? view.state.doc.length : sel.to;
    const source = view.state.sliceDoc(from, to);
    if (!source.trim()) return;
    try {
      const formatted = formatSql(
        source,
        usePreferenceStore.getState().sqlFormat,
        dialect.formatterLanguage,
      );
      if (formatted === source) return;
      view.dispatch({
        changes: { from, to, insert: formatted },
        selection: sel.empty ? undefined : { anchor: from, head: from + formatted.length },
      });
      view.focus();
    } catch (e) {
      useUIStore.getState().showAlert({
        title: "No se pudo formatear",
        message: e instanceof Error ? e.message : String(e),
        variant: "warning",
      });
    }
  };

  // Keyboard shortcuts:
  // - Ctrl+Shift+F: Format SQL
  // - Ctrl+Enter / Cmd+Enter: Run
  // - Ctrl+Shift+Enter / Alt+X: Explain
  // - Ctrl+I: Ask the Copilot in natural language
  // - Ctrl+H: Open history
  // - Ctrl+S: Open Favorites to save
  // - Escape: Cancel query execution if running
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Alt + X for EXPLAIN
    if (e.altKey && e.key.toLowerCase() === "x") {
      e.preventDefault();
      handleExplainQuery();
      return;
    }

    // Escape to cancel execution
    if (e.key === "Escape" && executionState === "executing") {
      e.preventDefault();
      handleCancelQuery();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        handleFormatQuery();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          // Ctrl+Shift+Enter: ejecuta solo la sentencia bajo el cursor (o la selección activa)
          handleRunQuery("auto");
        } else {
          // Ctrl+Enter: ejecuta según el modo elegido (por defecto, todo el script)
          handleRunQuery();
        }
      } else if (e.key.toLowerCase() === "i" && !e.shiftKey) {
        e.preventDefault();
        setCopilotAction("menu");
        setIsCopilotOpen(true);
      } else if (e.key.toLowerCase() === "h") {
        e.preventDefault();
        setIsHistoryModalOpen(true);
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          setInitialFavToSave(query);
          setIsFavoritesModalOpen(true);
        } else {
          void saveCurrentQuery();
        }
      }
    }
  };

  const isLight =
    theme === "light" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches);

  return (
    <div
      onKeyDown={handleKeyDown}
      className="flex-1 flex flex-col h-full bg-canvas overflow-hidden relative"
      style={isWideLayout && (isCopilotOpen || isHistoryModalOpen || isFavoritesModalOpen) ? { paddingRight: dockWidth } : undefined}
    >
      {/* Top toolbar: one primary action, everything else ghost */}
      <div className="px-3 py-1.5 bg-surface border-b border-line flex flex-wrap items-center justify-between gap-2 text-xs select-none">
        <div className="flex items-center gap-1 flex-wrap">
          {executionState === "executing" ? (
            <button
              onClick={handleCancelQuery}
              title="Cancelar ejecución (Esc)"
              className={secondaryBtn}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Cancelar</span>
            </button>
          ) : (
            <div className="relative inline-flex items-stretch" ref={execMenuRef}>
              <button
                onClick={() => handleRunQuery()}
                title={`Ejecutar: ${getTargetSql().mode === "selection" ? "selección" : getTargetSql().mode === "statement" ? `sentencia #${(getTargetSql().statementIndex ?? 0) + 1}` : "todo el script"} (Ctrl+Enter)\n${getTargetSql().preview || ""}`}
                className={`${primaryBtn} rounded-r-none`}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Ejecutar</span>
                <span className="text-[11px] opacity-75 font-normal">
                  {executionMode === "auto"
                    ? getTargetSql().mode === "selection"
                      ? "selección"
                      : "sentencia"
                    : executionMode === "all"
                    ? "todo"
                    : executionMode === "statement"
                    ? "sentencia"
                    : "selección"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setIsExecMenuOpen((prev) => !prev)}
                title="Modo de ejecución y tiempo límite"
                className="px-1.5 rounded-r-md bg-accent hover:bg-accent-hover text-accent-fg border-l border-black/20 flex items-center"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {isExecMenuOpen && (
                <div className={`${menuPanel} left-0 right-auto w-60`}>
                  <div className="px-3 pt-1 pb-0.5 text-[11px] text-fg-muted">Ejecutar</div>
                  {(
                    [
                      { mode: "all", label: "Todo el script", hint: "Predeterminado" },
                      { mode: "auto", label: "Auto (cursor o selección)", hint: "Ctrl+Shift+Enter" },
                      { mode: "statement", label: "Sentencia actual", hint: "Cursor" },
                      { mode: "selection", label: "Solo selección", hint: "Resaltado" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.mode}
                      onClick={() => {
                        setExecutionMode(opt.mode);
                        setIsExecMenuOpen(false);
                      }}
                      className={`${menuItem} justify-between ${executionMode === opt.mode ? "text-accent font-medium" : ""}`}
                    >
                      <span>{opt.label}</span>
                      <span className="text-[11px] text-fg-muted">{opt.hint}</span>
                    </button>
                  ))}
                  <div className={menuSeparator} />
                  <div className="px-3 pt-1 pb-0.5 text-[11px] text-fg-muted">Tiempo límite</div>
                  <div className="px-3 py-1 flex flex-wrap gap-1">
                    {[5, 10, 30, 60, 120, 0].map((val) => (
                      <button
                        key={val}
                        onClick={() => {
                          setTimeoutSec(val);
                          setIsExecMenuOpen(false);
                        }}
                        className={`px-2 py-0.5 rounded font-mono text-[11px] ${
                          timeoutSec === val ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-hover hover:text-fg"
                        }`}
                      >
                        {val === 0 ? "∞" : `${val}s`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {timeoutSec !== 30 && (
            <span className="flex items-center gap-1 text-[11px] text-fg-muted font-mono ml-1" title="Tiempo límite de la consulta">
              <Clock className="w-3 h-3" />
              {timeoutSec === 0 ? "sin límite" : `${timeoutSec}s`}
            </span>
          )}

          <div className="w-px h-4 bg-line mx-1" />

          <button
            onClick={() => void saveCurrentQuery()}
            title={
              savedQueryId
                ? "Guardar cambios en la consulta (Ctrl+S) · Guardar como nueva: Ctrl+Mayús+S"
                : "Guardar como consulta (Ctrl+S)"
            }
            className={`${ghostBtn} relative`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>Guardar</span>
            {isDirty && savedQueryId && <span className="w-1.5 h-1.5 rounded-full bg-accent" aria-label="Cambios sin guardar" />}
          </button>
          <button
            onClick={handleExplainQuery}
            disabled={isExplaining || executionState === "executing"}
            title="Plan de ejecución EXPLAIN (Alt+X)"
            className={ghostBtn}
          >
            {isExplaining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
            <span>Plan</span>
          </button>
          <button
            onClick={() => {
              setCopilotAction("menu");
              setIsCopilotOpen(true);
            }}
            disabled={executionState === "executing"}
            title="Asistente IA (Ctrl+I): pide datos en lenguaje natural, o explica, optimiza y corrige la consulta"
            className={`${ghostBtn} ${isCopilotOpen ? "text-fg bg-hover" : ""}`}
          >
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span>Preguntar a la IA</span>
          </button>
          <SqlFormatButton onFormat={handleFormatQuery} disabled={executionState === "executing"} />
          {tabId && !connectionReadOnly && (
            <button
              onClick={txStatus ? exitManualTx : enterManualTx}
              disabled={txBusy || executionState === "executing"}
              title={
                txStatus
                  ? "Volver a auto-commit"
                  : "Desactivar auto-commit: las sentencias quedan en una transacción hasta Commit o Rollback"
              }
              className={`${ghostBtn} ${txStatus ? "text-fg bg-hover" : ""}`}
            >
              <GitCommitHorizontal className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">{txStatus ? "Auto-commit OFF" : "Auto-commit"}</span>
            </button>
          )}
          <button
            onClick={toggleResultsLayout}
            title={isSideBySide ? "Mostrar resultados abajo" : "Mostrar resultados a la derecha"}
            className={ghostBtn}
          >
            {isSideBySide ? <PanelBottom className="w-3.5 h-3.5" /> : <PanelRight className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setIsHistoryModalOpen(true)} title="Historial (Ctrl+H)" className={ghostBtn}>
            <History className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Historial</span>
          </button>
          <button
            onClick={() => {
              setInitialFavToSave(undefined);
              setIsFavoritesModalOpen(true);
            }}
            title="Consultas guardadas (Ctrl+S para guardar)"
            className={ghostBtn}
          >
            <Star className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Guardadas</span>
          </button>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-fg-muted font-mono min-w-0">
          {saveStatus && (
            <span className="flex items-center gap-1.5 min-w-0" title={saveStatus.message}>
              {saveStatus.success ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" />
              )}
              <span className="truncate max-w-xs">{saveStatus.message}</span>
            </span>
          )}
          {isExporting && exportProgress && (
            <span role="status" aria-live="polite" className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              {formatExportProgress(exportProgress)}
            </span>
          )}
          {executionState === "executing" && (
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
              Ejecutando… {elapsedMs} ms
            </span>
          )}
          {executionState === "cancelled" && <span>Cancelada</span>}
          {executionState === "error" && error && (
            <span className="flex items-center gap-1.5 text-danger">
              <AlertCircle className="w-3.5 h-3.5" />
              Error · {elapsedMs} ms
            </span>
          )}
          {executionState === "success" && result && (
            <span className="flex items-center gap-1.5">
              {result.warning ? (
                <AlertCircle className="w-3.5 h-3.5 text-warning" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              )}
              {result.rows.length} fila(s) · {result.execution_time_ms || elapsedMs} ms
            </span>
          )}
          <button
            onClick={() => useUIStore.getState().openSettingsModal("database")}
            title={`Modo seguro ${safeModeEnabled ? "activado" : "DESACTIVADO"} (clic para configurar)`}
            className={`flex items-center gap-1 rounded px-1 hover:bg-hover ${safeModeEnabled ? "" : "text-warning"}`}
          >
            {safeModeEnabled ? <Shield className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
            {!safeModeEnabled && <span>Modo seguro OFF</span>}
          </button>
          <span className="flex items-center gap-1 truncate" title="Base de datos activa">
            <Database className="w-3 h-3 shrink-0" />
            <span className="truncate">{database || "—"}</span>
          </span>
        </div>
      </div>

      {txStatus && tabId && (
        <ManualTxBar
          status={txStatus}
          busy={txBusy || executionState === "executing"}
          onCommit={() => void runTxAction(() => dbService.manualTxCommit(tabId))}
          onRollback={() => void runTxAction(() => dbService.manualTxRollback(tabId))}
          onExit={exitManualTx}
        />
      )}

      <div className={`flex-1 flex min-h-0 overflow-hidden ${isSideBySide ? "flex-row" : "flex-col"}`}>
      {/* SQL Editor Area (CodeMirror 6) with Dynamic Height */}
      <div
        style={isSideBySide ? { width: `${editorWidth}px` } : { height: `${editorHeight}px` }}
        className={`overflow-hidden bg-surface relative shrink-0 ${isSideBySide ? "h-full" : "border-b border-line"}`}
      >
        <FirstTimeHint id="editor" className="absolute top-2 right-3 z-10 max-w-xs">
          Ctrl+Enter ejecuta el script; Ctrl+Shift+Enter, solo la sentencia bajo el cursor. Ctrl+S guarda la consulta y Ctrl+K abre la
          paleta de comandos.
        </FirstTimeHint>
        <CodeMirror
          value={query}
          height={isSideBySide ? "100%" : `${editorHeight}px`}
          theme={isLight ? "light" : "dark"}
          extensions={sqlExtensions}
          basicSetup={{
            autocompletion: true,
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
          }}
          onCreateEditor={(view) => {
            editorViewRef.current = view;
            if (initialCursor !== undefined) {
              const pos = Math.min(initialCursor, view.state.doc.length);
              view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
            }
          }}
          onUpdate={(update) => {
            if (!update.selectionSet || !onCursorChange) return;
            if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
            const pos = update.state.selection.main.head;
            cursorTimerRef.current = setTimeout(() => onCursorChange(pos), 500);
          }}
          onChange={(val) => {
            setQuery(val);
            onQueryChange?.(val);
          }}
          className="text-xs font-mono h-full"
        />
      </div>

      {/* Splitter / Resizer Handle */}
      {isSideBySide ? (
        <div
          onMouseDown={handleVerticalSplitterMouseDown}
          title="Arrastra horizontalmente para redimensionar el editor SQL"
          className="w-1.5 h-full bg-surface hover:bg-hover active:bg-accent/60 border-x border-line cursor-col-resize transition-colors select-none shrink-0 z-10"
        />
      ) : (
        <div
          onMouseDown={handleSplitterMouseDown}
          title="Arrastra verticalmente para redimensionar el editor SQL"
          className="h-1.5 w-full bg-surface hover:bg-hover active:bg-accent/60 border-b border-line cursor-row-resize transition-colors select-none shrink-0 z-10"
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

      {/* Results sub-tabs + edit target binding */}
      {(result || explainResult) && (
        <div className="px-3 bg-surface border-b border-line flex flex-wrap items-center justify-between gap-2 text-xs select-none">
          <div className="flex items-center gap-1">
            {result && (
              <button onClick={() => setActiveSubTab("results")} className={tabClass(activeSubTab === "results")}>
                Resultados ({result.rows.length})
              </button>
            )}
            {result && result.rows.length > 0 && (
              <button onClick={() => setActiveSubTab("chart")} className={tabClass(activeSubTab === "chart")}>
                Gráfica
              </button>
            )}
            {explainResult && (
              <button onClick={() => setActiveSubTab("plan")} className={tabClass(activeSubTab === "plan")}>
                Plan EXPLAIN
              </button>
            )}
          </div>

          {result && activeSubTab === "results" && result.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 py-1 text-[11px] font-mono text-fg-muted">
              <label className="flex items-center gap-1" title="Tabla a la que se envían los cambios de celdas">
                <span>tabla</span>
                <input
                  type="text"
                  list={`tables-list-${database}`}
                  value={targetTableOverride || detectedTarget.table || ""}
                  onChange={(e) => setTargetTableOverride(e.target.value)}
                  placeholder="—"
                  className="bg-transparent text-fg w-28 px-1 py-0.5 rounded border border-transparent hover:border-line focus:border-accent focus:outline-none"
                />
                {availableTables.length > 0 && (
                  <datalist id={`tables-list-${database}`}>
                    {availableTables.map((tbl) => (
                      <option key={tbl} value={tbl} />
                    ))}
                  </datalist>
                )}
              </label>

              {result.columns.length > 0 && (
                <label className="flex items-center gap-1" title="Columna(s) que identifican la fila (WHERE pk = ?)">
                  <Key className="w-3 h-3" />
                  <select
                    value={targetPkOverride || (tablePkColumns.length > 0 ? tablePkColumns.join(",") : "")}
                    onChange={(e) => setTargetPkOverride(e.target.value)}
                    className="bg-transparent text-fg focus:outline-none cursor-pointer max-w-[170px] truncate rounded hover:bg-hover"
                  >
                    {tablePkColumns.length > 0 && (
                      <option value={tablePkColumns.join(",")} className="bg-raised">
                        Auto: {tablePkColumns.join(", ")}
                      </option>
                    )}
                    <option value="" className="bg-raised">
                      (columna clave…)
                    </option>
                    {result.columns.map((c) => (
                      <option key={c} value={c} className="bg-raised">
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <span
                className={`flex items-center gap-1 ${canEditResult ? "" : "text-warning"}`}
                title={
                  canEditResult
                    ? "Doble clic en una celda para editarla."
                    : connectionReadOnly
                    ? "La conexión es de solo lectura."
                    : !activeTargetTable
                    ? "Indique la tabla destino para poder editar."
                    : !hasPrimaryKey
                    ? "Seleccione la columna clave (PK) para poder editar."
                    : "La consulta no incluye las columnas de la clave primaria."
                }
              >
                {canEditResult ? <Pencil className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {canEditResult ? "editable" : "solo lectura"}
              </span>

              <div className="w-px h-4 bg-line" />

              <button
                onClick={() => {
                  setCopilotAction("create_view");
                  setIsCopilotOpen(true);
                }}
                title="Convertir la consulta en una vista (CREATE OR REPLACE VIEW)"
                className={ghostBtn}
              >
                <Eye className="w-3.5 h-3.5" />
                Vista
              </button>
              <button
                onClick={handleExportExcel}
                disabled={isExporting}
                title="Exportar todos los resultados a Excel o CSV"
                className={ghostBtn}
              >
                {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
                Excel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Results / Plan Section */}
      <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
        {error && diagnostic ? (
          <div className="p-4 m-4 rounded-lg border border-line text-danger text-xs font-mono space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-danger flex flex-wrap items-center gap-2">
                    <span>Error en la sentencia SQL</span>
                    {diagnostic.error_code && (
                      <span className="px-1.5 py-0.5 rounded text-danger border border-line text-[11px]">
                        Código: {diagnostic.error_code}
                      </span>
                    )}
                    {diagnostic.sqlstate && (
                      <span className="px-1.5 py-0.5 rounded text-danger border border-line text-[11px]">
                        SQLSTATE: {diagnostic.sqlstate}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded text-warning border border-line text-[11px]">
                      {diagnostic.category}
                    </span>
                  </div>
                  <div className="mt-1.5 whitespace-pre-wrap text-danger select-text">
                    {diagnostic.original_error}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={() => {
                    if (diagnostic.original_error) {
                      navigator.clipboard.writeText(diagnostic.original_error);
                      setIsCopiedError(true);
                      setTimeout(() => setIsCopiedError(false), 2000);
                    }
                  }}
                  title="Copiar mensaje técnico del error al portapapeles"
                  className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-elevated hover:bg-hover text-fg hover:text-fg border border-line-strong rounded text-xs font-medium transition-colors"
                >
                  {isCopiedError ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-success" />
                      <span className="text-success">Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-fg-muted" />
                      <span>Copiar Error</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => {
                    setCopilotAction("fix");
                    setIsCopilotOpen(true);
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-raised hover:bg-hover text-fg rounded text-xs font-semibold shadow-sm transition-all"
                >
                  <Bug className="w-3.5 h-3.5" />
                  <span>Corregir con IA</span>
                </button>
              </div>
            </div>

            {diagnostic.suggested_action && (
              <div className="p-2.5 bg-surface border border-line rounded flex items-start space-x-2 text-warning">
                <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-fg-muted" />
                <div>
                  <span className="font-semibold text-warning">Sugerencia recomendada: </span>
                  <span>{diagnostic.suggested_action}</span>
                </div>
              </div>
            )}
          </div>
        ) : activeSubTab === "chart" && result ? (
          <React.Suspense fallback={<div className="h-40 flex items-center justify-center text-[11px] text-fg-muted">Cargando gráfica…</div>}>
            <ResultChart key={result.columns.join("|")} columns={result.columns} rows={result.rows} />
          </React.Suspense>
        ) : activeSubTab === "plan" && explainResult ? (
          <QueryPlanViewer
            planRows={explainAnalysis?.execution_plan || []}
            rawResult={
              explainResult
                ? {
                    columns: explainResult.columns,
                    rows: explainResult.rows,
                    execution_time_ms: explainResult.execution_time_ms,
                  }
                : undefined
            }
            jsonPlan={explainAnalysis?.json_plan}
            treePlan={explainAnalysis?.tree_plan}
            visualNodes={explainAnalysis?.visual_nodes}
            bottlenecks={explainAnalysis?.bottlenecks}
            potentialOptimizations={explainAnalysis?.potential_optimizations}
            querySql={query}
          />
        ) : result ? (
          result.columns.length > 0 ? (
            <div className="flex-1 w-full h-full flex flex-col overflow-hidden">
              {result.warning && (
                <div className="px-3 py-1.5 border-b border-line flex items-start gap-2 text-xs font-mono text-fg-muted select-text">
                  <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0 text-warning" />
                  <span className="break-all">{result.warning}</span>
                </div>
              )}
              <div className="flex-1 w-full relative overflow-hidden">
                <DataGridCanvas
                  database={activeTargetDb || database}
                  table={activeTargetTable}
                  primaryKeyColumns={activePkColumns}
                  externalData={result}
                  isReadonly={!canEditResult}
                  onRefresh={() => handleRunQuery()}
                />
              </div>
            </div>
          ) : (
            <div className="p-6 flex items-center space-x-3 text-xs text-success font-mono">
              <CheckCircle2 className="w-5 h-5 text-success" />
              <span>{result.message}</span>
            </div>
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-fg-subtle text-xs font-mono space-y-2 select-none">
            <Terminal className="w-8 h-8 opacity-30 text-fg-muted" />
            <span>Presiona 'Ejecutar' (Ctrl+Enter) para correr el script</span>
            <button
              onClick={() => {
                setCopilotAction("menu");
                setIsCopilotOpen(true);
              }}
              className={`${ghostBtn} font-sans`}
            >
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              <span>O describe lo que necesitas y la IA escribe el SQL (Ctrl+I)</span>
            </button>
            <span className="text-[11px] text-fg-subtle">
              Atajos: Ctrl+H (Historial), Ctrl+S (Guardar Favorito)
            </span>
          </div>
        )}
      </div>
      </div>
      </div>

      {/* Safe Execution Warning Modal */}
      {isSafeModalOpen && safetyAnalysis && (
        <SafeExecutionModal
          isOpen={isSafeModalOpen}
          onClose={() => {
            setIsSafeModalOpen(false);
            setSafetyAnalysis(null);
            setPendingSafeSql(null);
          }}
          onConfirm={async () => {
            const confirmedSql = pendingSafeSql ?? query;
            setIsSafeModalOpen(false);
            setSafetyAnalysis(null);
            setPendingSafeSql(null);
            // The backend only runs confirmed statements with a token bound to this exact SQL
            try {
              const token = await dbService.confirmSqlExecution(confirmedSql);
              await executeQueryInternal(confirmedSql, token);
            } catch (err) {
              setExecutionState("error");
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
          analysis={safetyAnalysis}
          sql={pendingSafeSql ?? query}
          estimatedAffectedRows={estimatedAffectedRows}
          database={activeTargetDb}
        />
      )}

      {/* Query History Modal */}
      {isHistoryModalOpen && (() => {
        const panel = (
          <QueryHistoryModal
            isOpen={isHistoryModalOpen}
            onClose={() => setIsHistoryModalOpen(false)}
            currentDatabase={database}
            onSelectQuery={(selectedSql, runImmediately) => {
              setQuery(selectedSql);
              onQueryChange?.(selectedSql);
              if (runImmediately) {
                handleRunQuery(selectedSql);
              }
            }}
            docked={isWideLayout}
          />
        );
        return isWideLayout ? (
          <RightDock width={dockWidth} onResize={setDockWidth}>
            {panel}
          </RightDock>
        ) : (
          panel
        );
      })()}

      {/* Favorites / Snippets Modal */}
      {isFavoritesModalOpen && (() => {
        const panel = (
          <FavoritesModal
            isOpen={isFavoritesModalOpen}
            onClose={() => {
              setIsFavoritesModalOpen(false);
              setInitialFavToSave(undefined);
            }}
            initialQueryToSave={initialFavToSave}
            defaultConnectionId={activeConnectionId}
            defaultDatabase={database || undefined}
            defaultFolder={pendingFolder}
            onSaved={(fav) => {
              if (tabId && initialFavToSave !== undefined) {
                useUIStore.getState().linkTabToSavedQuery(tabId, fav.id, fav.title);
                setSavedSql(fav.sql);
              }
            }}
            onSelectQuery={(selectedSql, runImmediately) => {
              setQuery(selectedSql);
              onQueryChange?.(selectedSql);
              if (runImmediately) {
                handleRunQuery(selectedSql);
              }
            }}
            docked={isWideLayout}
          />
        );
        return isWideLayout ? (
          <RightDock width={dockWidth} onResize={setDockWidth}>
            {panel}
          </RightDock>
        ) : (
          panel
        );
      })()}

      {/* SQL Copilot Drawer */}
      {isCopilotOpen && (() => {
        const copilot = (
          <SqlCopilotDrawer
            isOpen={isCopilotOpen}
            onClose={() => setIsCopilotOpen(false)}
            database={database}
            query={query}
            errorMessage={error || undefined}
            initialAction={copilotAction}
            onApplySql={(newSql) => {
              setQuery(newSql);
              onQueryChange?.(newSql);
            }}
            onRunSql={(newSql) => {
              setQuery(newSql);
              onQueryChange?.(newSql);
              void handleRunQuery(newSql);
            }}
            docked={isWideLayout}
          />
        );
        return isWideLayout ? (
          <RightDock width={dockWidth} onResize={setDockWidth}>
            {copilot}
          </RightDock>
        ) : (
          copilot
        );
      })()}

      {/* Dynamic Parameters Modal */}
      <SqlVariablesModal
        isOpen={isVariablesModalOpen}
        onClose={() => setIsVariablesModalOpen(false)}
        rawSql={pendingVariableSql}
        variableNames={pendingVariables}
        onExecuteWithParams={(finalSql) => {
          handleRunQuery(finalSql);
        }}
      />
    </div>
  );
};
