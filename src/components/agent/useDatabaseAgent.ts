import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentActivityStep, AgentRunResult, ProposedAction } from "../../types/database";
import { useAiStore } from "../../stores/aiStore";
import { useUIStore } from "../../stores/uiStore";
import { useSchemaStore } from "../../stores/schemaStore";
import { aiService } from "../../services/aiService";
import { aiReadiness } from "../../services/aiReadiness";
import { uid } from "../../utils/uid";
import { errorText, reportError } from "../../utils/errors";
import { isOverloadedError, promptWithFocus, transcriptMarkdown } from "./agentText";

export interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  text: string;
  timestamp: string;
  activitySteps?: AgentActivityStep[];
  proposedActions?: ProposedAction[];
  durationMs?: number;
  isError?: boolean;
  isOverloaded?: boolean;
  failedPrompt?: string;
  isStreaming?: boolean;
  pinnedTables?: string[];
}

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Progress shown while the backend inspects the schema (the call returns all at once). */
function scheduleProgress(
  pinnedTables: string[],
  push: (step: AgentActivityStep) => void,
): number[] {
  const focus = pinnedTables.length
    ? ` (enfoque en ${pinnedTables.slice(0, 3).join(", ")}${pinnedTables.length > 3 ? "…" : ""})`
    : "";
  const steps: [number, AgentActivityStep][] = [
    [1400, { step_number: 2, title: `Inspeccionando metadatos del esquema${focus}`, status: "running", tool_name: "list_tables / get_table_columns" }],
    [3200, { step_number: 3, title: "Evaluando planes EXPLAIN y estructura de índices", status: "running", tool_name: "explain_query" }],
    [5200, { step_number: 4, title: "Sintetizando diagnóstico y recomendaciones", status: "running" }],
  ];
  return steps.map(([ms, step]) => window.setTimeout(() => push(step), ms));
}

/**
 * Conversation with the database agent: sending, simulated progress, streaming of the
 * answer, stop / skip, retry and session management. Views only render this state.
 */
export function useDatabaseAgent(database: string) {
  const { config, addAuditLog, recordMetric, openAiSettings } = useAiStore();
  const { tables } = useSchemaStore();
  const availableTables = useMemo(() => tables[database] || [], [tables, database]);
  const readiness = aiReadiness(config);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState("");
  const [pinnedTables, setPinnedTables] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentSteps, setCurrentSteps] = useState<AgentActivityStep[]>([]);

  const abortedRef = useRef(false);
  const streamIntervalRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const fullAnswerRef = useRef<string | null>(null);

  const clearTimers = () => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
  };

  // Closing the tab stops the progress and the streaming (they kept updating state).
  useEffect(() => {
    return () => {
      abortedRef.current = true;
      clearTimers();
    };
  }, []);

  const togglePin = (table: string) =>
    setPinnedTables((prev) => (prev.includes(table) ? prev.filter((t) => t !== table) : [...prev, table]));
  const clearPinned = () => setPinnedTables([]);
  const pinAll = () => setPinnedTables(availableTables.map((t) => t.name));

  const mentionTable = (table: string) =>
    setInputQuery((prev) => {
      const insertion = `\`${table}\``;
      return prev.trim() ? `${prev} ${insertion}` : `Analiza el rendimiento y estructura de ${insertion}`;
    });

  const insertExplain = () =>
    setInputQuery((prev) =>
      prev.trim() ? `${prev}\n\nEXPLAIN SELECT * FROM ...` : "Explica el siguiente plan de ejecución:\nEXPLAIN SELECT * FROM ",
    );

  /** Settings problem: explain it and offer the settings (also guarded in the view). */
  const blockedByConfig = () => {
    if (readiness.ready) return false;
    useUIStore.getState().showAlert({
      title: readiness.title,
      message: readiness.message,
      variant: "warning",
      icon: "alert",
      confirmText: "Abrir ajustes de IA",
      onConfirm: () => openAiSettings(),
    });
    return true;
  };

  const send = async (promptToSend?: string) => {
    const text = (promptToSend || inputQuery).trim();
    if (!text || isRunning || blockedByConfig()) return;

    setMessages((prev) => [
      ...prev,
      { id: `user_${uid()}`, sender: "user", text, pinnedTables: pinnedTables.length ? [...pinnedTables] : undefined, timestamp: now() },
    ]);
    setInputQuery("");
    setIsRunning(true);
    abortedRef.current = false;
    setCurrentSteps([{ step_number: 1, title: "Analizando la solicitud y planificando la inspección", status: "running" }]);
    clearTimers();
    timeoutsRef.current = scheduleProgress(pinnedTables, (step) => {
      if (abortedRef.current) return;
      setCurrentSteps((prev) => [...prev.map((s) => ({ ...s, status: "completed" as const })), step]);
    });

    try {
      const result: AgentRunResult = await aiService.runDatabaseAgentAi(
        database,
        promptWithFocus(text, database, pinnedTables),
        config,
        8,
      );
      clearTimers();
      if (abortedRef.current) {
        setIsRunning(false);
        return;
      }
      addAuditLog(result.audit_entry);
      recordMetric(result.audit_entry.total_tokens, result.duration_ms);

      const id = `agent_${uid()}`;
      const full = result.final_answer;
      fullAnswerRef.current = full;
      setMessages((prev) => [
        ...prev,
        {
          id,
          sender: "agent",
          text: "",
          timestamp: now(),
          activitySteps: result.activity_steps,
          proposedActions: result.proposed_actions,
          durationMs: result.duration_ms,
          isStreaming: true,
        },
      ]);
      setCurrentSteps([]);

      // Progressive reveal of the answer.
      let cursor = 0;
      const step = Math.max(10, Math.floor(full.length / 45));
      streamIntervalRef.current = window.setInterval(() => {
        if (abortedRef.current) {
          clearTimers();
          setIsRunning(false);
          return;
        }
        cursor = Math.min(cursor + step, full.length);
        const done = cursor >= full.length;
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: full.slice(0, cursor), isStreaming: !done } : m)));
        if (done) {
          clearTimers();
          fullAnswerRef.current = null;
          setIsRunning(false);
        }
      }, 22);
    } catch (err: unknown) {
      clearTimers();
      if (abortedRef.current) return;
      const message = errorText(err, "Error al ejecutar el agente de base de datos.");
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${uid()}`,
          sender: "agent",
          text: message,
          timestamp: now(),
          isError: true,
          isOverloaded: isOverloadedError(message),
          failedPrompt: text,
        },
      ]);
      setCurrentSteps([]);
      setIsRunning(false);
    }
  };

  const stop = () => {
    abortedRef.current = true;
    clearTimers();
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
    fullAnswerRef.current = null;
    setIsRunning(false);
    setCurrentSteps((prev) => prev.map((s) => ({ ...s, status: s.status === "running" ? "error" : s.status })));
  };

  /** Show the whole answer now instead of animating it. */
  const skipStreaming = () => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    const full = fullAnswerRef.current;
    if (full) {
      setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, text: full, isStreaming: false } : m)));
      fullAnswerRef.current = null;
    }
    setIsRunning(false);
  };

  const newSession = () => {
    useUIStore.getState().showConfirm({
      title: "Nueva sesión del agente",
      message: "Se borrará la conversación actual. Las tablas en las que se enfoca se conservan.",
      variant: "danger",
      confirmText: "Borrar conversación",
      cancelText: "Cancelar",
      onConfirm: () => {
        stop();
        setMessages([]);
        setCurrentSteps([]);
      },
    });
  };

  const copyText = (text: string) =>
    navigator.clipboard.writeText(text).catch((err) => {
      reportError("No se pudo copiar al portapapeles", err);
      throw err;
    });

  const exportConversation = () => copyText(transcriptMarkdown(messages));

  return {
    config,
    readiness,
    openAiSettings,
    availableTables,
    messages,
    inputQuery,
    setInputQuery,
    pinnedTables,
    togglePin,
    clearPinned,
    pinAll,
    mentionTable,
    insertExplain,
    isRunning,
    currentSteps,
    send,
    stop,
    skipStreaming,
    newSession,
    copyText,
    exportConversation,
  };
}

export type DatabaseAgent = ReturnType<typeof useDatabaseAgent>;
