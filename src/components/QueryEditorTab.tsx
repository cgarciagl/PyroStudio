import React, { useState, useCallback, useMemo, useEffect, useReducer, useRef } from "react";
import { formatExportProgress } from "../utils/exportProgress";
import { FirstTimeHint } from "./ui/FirstTimeHint";
import CodeMirror, { type EditorView } from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { useSqlDialect } from "../services/sqlDialect";
import { snippet, snippetCompletion, type CompletionContext } from "@codemirror/autocomplete";
import { SqlCompletionIndex } from "../services/sqlCompletionIndex";
import { INSERT_SNIPPET_EVENT, useSnippets, type SqlSnippet } from "../services/snippetsStorage";
import { useSchemaStore } from "../stores/schemaStore";
import { analyzeCrossDatabase } from "../utils/crossDatabase";
import {
  extractSqlStatements,
  isDdlQuery,
  resolveExecutionTarget,
  type ExecutionTargetMode,
} from "../services/sqlStatementExtractor";
import { DataGridCanvas } from "./DataGridCanvas";
import {
  CheckCircle2,
  AlertCircle,
  Database,
  Loader2,
  Activity,
  FileSpreadsheet,
  Shield,
  ShieldAlert,
  History,
  Star,
  Sparkles,
  Eye,
  Save,
  PanelBottom,
  PanelRight,
  GitCommitHorizontal,
} from "lucide-react";
import { isClientTimeoutError, isTunnelTimeoutError, liveTunnelConfig, switchLiveTransport } from "./connectionTransport";
import { ManualTxBar } from "./ManualTxBar";
import { ghostBtn, tabClass } from "./ui/styles";
import { activeSavedConnectionId } from "../types/database";

const ResultChart = React.lazy(() => import("./charts/ResultChart"));

import { dbService } from "../services/tauriDb";
import { explainCache } from "../services/explainCache";
import { queryHistoryStorage } from "../services/queryHistoryStorage";
import { diagnoseSqlError } from "../services/sqlDiagnostics";
import { usePreferenceStore } from "../stores/preferenceStore";
import { useCapabilitiesStore } from "../stores/capabilitiesStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useUIStore } from "../stores/uiStore";
import { useEnvVariablesStore } from "../stores/envVariablesStore";
import { applyEnvVariables } from "../utils/envVariables";
import { useStagedChangesStore } from "../stores/stagedChangesStore";
import type {
  QueryExecutionResult,
  ScriptStatementResult,
  SqlSafetyAnalysis,
  SlowQueryAnalysis,
} from "../types/database";
import { QueryPlanViewer } from "./QueryPlanViewer";
import { SafeExecutionModal } from "./SafeExecutionModal";
import { QueryHistoryModal } from "./QueryHistoryModal";
import { FavoritesModal } from "./FavoritesModal";
import { SqlCopilotDrawer, type CopilotActionType } from "./SqlCopilotDrawer";
import { RightDock } from "./ui/RightDock";
import { SqlFormatButton } from "./SqlFormatButton";
import { formatSql } from "../services/sqlFormat";
import { SqlVariablesModal, extractSqlVariables } from "./SqlVariablesModal";
import { uid } from "../utils/uid";
import { errorText } from "../utils/errors";
import { useExportProgress } from "../hooks/useExportProgress";
import { useManualTransaction } from "./queryEditor/useManualTransaction";
import { useEditorLayout } from "./queryEditor/useEditorLayout";
import { extractTargetTableAndDb } from "./queryEditor/sqlTarget";
import { RunButton } from "./queryEditor/RunButton";
import { ExecutionStatus } from "./queryEditor/ExecutionStatus";
import { EditTargetBar } from "./queryEditor/EditTargetBar";
import { ScriptMessagesPanel } from "./queryEditor/ScriptMessagesPanel";
import { SqlErrorPanel } from "./queryEditor/SqlErrorPanel";
import { EmptyResults } from "./queryEditor/EmptyResults";
import { useElapsedTimer } from "./queryEditor/useElapsedTimer";
import { useSavedQueryLink } from "./queryEditor/useSavedQueryLink";
import {
  executionReducer,
  initialExecutionView,
  summarizeScript,
  type ResultsSubTab,
} from "./queryEditor/executionReducer";
import { useEditableTarget } from "./queryEditor/useEditableTarget";


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
  /** Run the initial query once on mount (tab opened with «Ejecutar en nueva pestaña»). */
  autoRun?: boolean;
}



export const QueryEditorTab: React.FC<QueryEditorTabProps> = ({
  tabId,
  savedQueryId,
  pendingFolder,
  database,
  initialQuery: initialQueryProp,
  onQueryChange,
  initialCursor,
  onCursorChange,
  autoRun,
}) => {
  const dialect = useSqlDialect();
  const initialQuery = initialQueryProp ?? dialect.starterQuery;
  const [query, setQuery] = useState(initialQuery);
  const [view, dispatch] = useReducer(executionReducer, initialExecutionView);
  const {
    status: executionState,
    error,
    result,
    resultSql,
    scriptResults,
    activeResultSetIndex,
    activeSubTab,
  } = view;
  const setActiveSubTab = (tab: ResultsSubTab) => dispatch({ type: "setSubTab", tab });
  const { txActiveRef, txStatus, setTxStatus, txBusy, runTxAction, enterManualTx, exitManualTx } = useManualTransaction(tabId);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [copilotAction, setCopilotAction] = useState<CopilotActionType>("menu");
  const { elapsedMs, start: startTimer, stop: stopTimer, finish: finishTimer } = useElapsedTimer();
  const [isExplaining, setIsExplaining] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useExportProgress();
  const [explainResult, setExplainResult] = useState<QueryExecutionResult | null>(null);
  const [explainAnalysis, setExplainAnalysis] = useState<SlowQueryAnalysis | null>(null);
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
    const snippetItems = snippets.map((s) =>
      snippetCompletion(s.body, {
        label: s.prefix,
        detail: s.name,
        info: s.description,
        type: "text",
        boost: 50,
      }),
    );
    const index = new SqlCompletionIndex();
    index.buildIndex(schema, routines[database] || [], snippetItems);

    return [
      sql({
        dialect: dialect.codeMirror,
        schema,
        defaultSchema: database,
      }),
      dialect.codeMirror.language.data.of({
        autocomplete: (context: CompletionContext) => index.getCompletions(context),
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
  /** The client-side time limit fired for the running query (not a user cancel). */
  const timedOutRef = useRef(false);
  const activeQueryIdRef = useRef<string | null>(null);
  const executionEpochRef = useRef<number>(0);
  const timeoutTimerRef = useRef<number | null>(null);

  // Execution mode & Timeout
  const [executionMode, setExecutionMode] = useState<ExecutionTargetMode>("all");
  const [timeoutSec, setTimeoutSec] = useState<number>(30); // 0 = unlimited
  /** Last SQL actually sent to the engine, to retry it after switching transport. */
  const lastExecutedSqlRef = useRef<string | null>(null);
  /** Next execution runs without the client-side timeout (retry over a direct connection). */
  const skipTimeoutOnceRef = useRef(false);

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

  /** Ctrl+S: update the linked saved query, or ask where to save a new one. */
  const { isDirty, saveCurrentQuery, markSaved } = useSavedQueryLink({
    tabId,
    savedQueryId,
    query,
    initialQuery,
    onSaveAsNew: (sql) => {
      setInitialFavToSave(sql);
      setIsFavoritesModalOpen(true);
    },
    onStatus: (status) => {
      setSaveStatus(status);
      if (status.success) setTimeout(() => setSaveStatus(null), 2500);
    },
  });


  const openCopilot = (action: CopilotActionType) => {
    setCopilotAction(action);
    setIsCopilotOpen(true);
  };

  /** Show one result set of a script (from its tab or from the messages list). */
  const showResultSet = (rs: ScriptStatementResult) => {
    dispatch({ type: "showResultSet", resultSet: rs });
  };

  // Structured SQL diagnostic parsing on error
  const diagnostic = useMemo(() => (error ? diagnoseSqlError(error) : null), [error]);

  const {
    editorHeight,
    editorWidth,
    isSideBySide,
    toggleResultsLayout,
    isWideLayout,
    dockWidth,
    setDockWidth,
    handleSplitterMouseDown,
    handleVerticalSplitterMouseDown,
  } = useEditorLayout();



  // Available tables in active database for auto-suggestions
  const { tables: schemaTables } = useSchemaStore();
  const availableTables = useMemo(() => {
    const fromStore = (schemaTables[database] || []).map((t) => t.name);
    if (fromStore.length > 0) return fromStore;
    if (dbCompletionSchema) return Object.keys(dbCompletionSchema);
    return [];
  }, [schemaTables, dbCompletionSchema, database]);


  // Pre-filter statements that return a result set (or columns/rows)
  const resultSets = useMemo(() => {
    if (!scriptResults || scriptResults.length === 0) {
      return result && result.columns.length > 0
        ? [
            {
              ...result,
              statement_index: 0,
              sql: resultSql || query,
              is_result_set: true,
              targetTable: extractTargetTableAndDb(resultSql || query).table,
            },
          ]
        : [];
    }
    return scriptResults
      .filter((s) => s.is_result_set || s.columns.length > 0)
      .map((s) => ({
        ...s,
        targetTable: extractTargetTableAndDb(s.sql).table,
      }));
  }, [scriptResults, result, resultSql, query]);

  const connectionReadOnly = Boolean(connectionStatus.config?.read_only);
  const {
    targetTableOverride,
    setTargetTableOverride,
    targetPkOverride,
    setTargetPkOverride,
    detectedTarget,
    activeTargetTable,
    activeTargetDb,
    activePkColumns,
    hasPrimaryKey,
    tablePkColumns,
    canEditResult,
  } = useEditableTarget({
    // The SQL of the visible result decides the target, not later edits in the editor.
    database,
    sql: resultSql || query,
    result,
    readOnly: connectionReadOnly,
    noPrimaryKeyMode,
  });

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
  /** Select the statement that failed so the user sees where the script stopped. */
  const highlightStatement = (sqlText: string, index: number) => {
    try {
      const segment = extractSqlStatements(sqlText)[index];
      const view = editorViewRef.current;
      if (!segment || !view) return;
      const len = view.state.doc.length;
      view.dispatch({
        selection: { anchor: Math.min(segment.start, len), head: Math.min(segment.end, len) },
        scrollIntoView: true,
      });
    } catch {
      /* the editor changed meanwhile: nothing to highlight */
    }
  };

  const executeQueryInternal = useCallback(
    async (sqlToRun: string, confirmationToken?: string) => {
      const currentEpoch = ++executionEpochRef.current;
      lastExecutedSqlRef.current = sqlToRun;
      const effectiveTimeoutSec = skipTimeoutOnceRef.current ? 0 : timeoutSec;
      skipTimeoutOnceRef.current = false;
      const queryId = `query_${uid()}`;
      activeQueryIdRef.current = queryId;
      cancelRequestedRef.current = false;
      timedOutRef.current = false;
      dispatch({ type: "start" });
      startTimer();

      // Client-side configurable timeout guard
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      if (effectiveTimeoutSec > 0) {
        timeoutTimerRef.current = window.setTimeout(async () => {
          if (executionEpochRef.current === currentEpoch) {
            timedOutRef.current = true;
            try {
              await dbService.cancelQuery(queryId);
            } catch {}
            dispatch({ type: "timedOut", seconds: effectiveTimeoutSec });
            stopTimer();
          }
        }, effectiveTimeoutSec * 1000);
      }

      try {
        const scriptRes =
          tabId && txActiveRef.current
            ? await dbService
                .manualTxExecuteScript(tabId, sqlToRun, database, {
                  stopOnError: true,
                  safeMode: safeModeEnabled,
                  confirmationToken,
                })
                .then(({ result, status }) => {
                  setTxStatus(status);
                  return result;
                })
            : await dbService.executeScript(sqlToRun, database, queryId, {
                stopOnError: true,
                safeMode: safeModeEnabled,
                confirmationToken,
              });

        // Guard against race conditions from previous slow executions
        if (executionEpochRef.current !== currentEpoch) {
          return;
        }

        if (cancelRequestedRef.current) {
          dispatch({ type: "cancelled" });
          return;
        }
        // After a client timeout: keep the timeout message unless the query really
        // finished (the cancel signal arrived too late), in which case show its result.
        if (timedOutRef.current && !scriptRes.success) {
          return;
        }

        const duration = finishTimer();
        dispatch({ type: "scriptDone", script: scriptRes });
        const summary = summarizeScript(scriptRes);
        const historyBase = {
          connectionName: connectionStatus.config?.savedConnectionName || "Local",
          database,
          sql: sqlToRun,
        };

        if (!summary.ok) {
          highlightStatement(sqlToRun, summary.failedIndex);
          queryHistoryStorage.addEntry({ ...historyBase, durationMs: duration, success: false, errorMessage: summary.error });
        } else {
          // DDL changes the schema shown in the sidebar and used for completion.
          if (database && isDdlQuery(sqlToRun)) {
            useSchemaStore.getState().invalidateSchema(database);
            void useSchemaStore.getState().loadSchemaObjects(database, true);
          }
          queryHistoryStorage.addEntry({
            ...historyBase,
            durationMs: scriptRes.total_time_ms || duration,
            success: true,
            affectedRows: summary.affectedRows,
            errorMessage: summary.warning,
          });
        }
      } catch (err: unknown) {
        // Discard stale responses
        if (executionEpochRef.current !== currentEpoch) {
          return;
        }

        setExportProgress(null);
        if (cancelRequestedRef.current) {
          dispatch({ type: "cancelled" });
          return;
        }
        if (timedOutRef.current) {
          return; // the timeout message is already shown
        }

        const duration = finishTimer();
        const msg = errorText(err, "Error al ejecutar la consulta");
        dispatch({ type: "failed", message: msg });

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
        if (executionEpochRef.current === currentEpoch) stopTimer();
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

      // ${variable} from the active environment (7.2), before any safety check.
      const envVars = useEnvVariablesStore.getState().activeVariables();
      if (targetSql && envVars) targetSql = applyEnvVariables(targetSql, envVars).sql;
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

  // Tab opened with «Ejecutar en nueva pestaña»: run once and clear the flag so a
  // restored session does not re-run it.
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (!autoRun || autoRanRef.current) return;
    autoRanRef.current = true;
    if (tabId) {
      useUIStore.setState((s) => ({
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, autoRun: undefined } : t)),
      }));
    }
    void handleRunQuery(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  // A tunnel timeout can be retried over a direct connection (no HTTP/proxy time limit).
  const canRetryDirect =
    Boolean(liveTunnelConfig(connectionStatus.config)?.tunnel?.enabled) &&
    (isTunnelTimeoutError(error) || isClientTimeoutError(error));
  const [isRetryingDirect, setIsRetryingDirect] = useState(false);
  const handleRetryDirect = useCallback(async () => {
    const sql = lastExecutedSqlRef.current;
    if (!sql) return;
    setIsRetryingDirect(true);
    try {
      if (!(await switchLiveTransport())) return;
      skipTimeoutOnceRef.current = true;
      await handleRunQuery(undefined, sql, true);
    } finally {
      setIsRetryingDirect(false);
    }
  }, [handleRunQuery]);

  // Cancel running query and forward signal to backend
  const handleCancelQuery = useCallback(async () => {
    cancelRequestedRef.current = true;
    executionEpochRef.current++;
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    stopTimer();
    dispatch({ type: "cancelled" });

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
    dispatch({ type: "setError", message: null });
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
          const { analysis } = await explainCache.analyzeWithCache(query, database);
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
        errorText(err, "Error al generar el plan de ejecución");
      dispatch({ type: "setError", message: msg });
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
        errorText(err, "Error al exportar");
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
      className="pyro-view pyro-sql-workspace flex-1 flex flex-col h-full bg-canvas overflow-hidden relative"
      style={isWideLayout && (isCopilotOpen || isHistoryModalOpen || isFavoritesModalOpen) ? { paddingRight: dockWidth } : undefined}
    >
      {/* Top toolbar: one primary action, everything else ghost */}
      <div data-view-toolbar data-sql-toolbar className="px-3 py-1.5 bg-surface border-b border-line flex flex-wrap items-center justify-between gap-2 text-xs select-none">
        <div className="flex items-center gap-1 flex-wrap">
          <RunButton
            isExecuting={executionState === "executing"}
            target={getTargetSql()}
            executionMode={executionMode}
            timeoutSec={timeoutSec}
            onRun={() => handleRunQuery()}
            onCancel={handleCancelQuery}
            onModeChange={setExecutionMode}
            onTimeoutChange={setTimeoutSec}
          />

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
          <ExecutionStatus
            executionState={executionState}
            elapsedMs={elapsedMs}
            error={error}
            result={result}
            scriptResults={scriptResults}
          />
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
        data-sql-editor className={`overflow-hidden bg-surface relative shrink-0 ${isSideBySide ? "h-full" : "border-b border-line"}`}
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

      <div data-sql-results className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

      {/* Results sub-tabs + edit target binding */}
      {(result || explainResult || (scriptResults && scriptResults.length > 0)) && (
        <div className="px-3 bg-surface border-b border-line flex flex-wrap items-center justify-between gap-2 text-xs select-none">
          <div className="flex items-center gap-1">
            {resultSets.length > 1 ? (
              resultSets.map((rs, idx) => {
                const isCurrent = activeSubTab === "results" && activeResultSetIndex === rs.statement_index;
                const label = `Resultado ${idx + 1}${rs.targetTable ? `: ${rs.targetTable}` : ""}`;
                return (
                  <button
                    key={rs.statement_index}
                    onClick={() => showResultSet(rs)}
                    className={tabClass(isCurrent)}
                    title={rs.sql}
                  >
                    {label} ({rs.rows.length})
                  </button>
                );
              })
            ) : result ? (
              <button onClick={() => setActiveSubTab("results")} className={tabClass(activeSubTab === "results")}>
                Resultados ({result.rows.length})
              </button>
            ) : null}

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

            {scriptResults && (scriptResults.length > 1 || resultSets.length === 0) && (
              <button
                onClick={() => setActiveSubTab("messages")}
                className={tabClass(activeSubTab === "messages")}
              >
                <span>Mensajes</span>
                {scriptResults.some((s) => s.error) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-danger ml-1 inline-block" />
                )}
              </button>
            )}
          </div>

          {result && activeSubTab === "results" && result.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 py-1 text-[11px] font-mono text-fg-muted">
              <EditTargetBar
                database={database}
                columns={result.columns}
                availableTables={availableTables}
                tableOverride={targetTableOverride}
                detectedTable={detectedTarget.table}
                targetTable={activeTargetTable}
                pkOverride={targetPkOverride}
                tablePkColumns={tablePkColumns}
                hasPrimaryKey={hasPrimaryKey}
                canEdit={canEditResult}
                readOnly={connectionReadOnly}
                onTableChange={setTargetTableOverride}
                onPkChange={setTargetPkOverride}
              />

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
        {activeSubTab === "messages" && scriptResults ? (
          <ScriptMessagesPanel scriptResults={scriptResults} elapsedMs={elapsedMs} onOpenResult={showResultSet} />
        ) : error && diagnostic && (!scriptResults || scriptResults.length <= 1) ? (
          <SqlErrorPanel
            diagnostic={diagnostic}
            canRetryDirect={canRetryDirect}
            isRetryingDirect={isRetryingDirect}
            onRetryDirect={() => void handleRetryDirect()}
            onFixWithAi={() => openCopilot("fix")}
          />
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
                  key={`grid-${activeResultSetIndex}`}
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
          <EmptyResults onAskAi={() => openCopilot("menu")} />
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
              dispatch({ type: "failed", message: errorText(err) });
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
                markSaved(fav.sql);
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
