import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Bot,
  Send,
  Loader2,
  Terminal,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Square,
  Activity,
  RefreshCw,
  Clock,
  CornerDownLeft,
  RotateCcw,
  Sparkles,
  Code,
  Table as TableIcon,
  ChevronDown,
  Trash2,
  Check,
  FileText,
  Pin,
  PinOff,
  X,
  Search,
  FastForward,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { marked } from "marked";
import { useAiStore } from "../stores/aiStore";
import { useUIStore } from "../stores/uiStore";
import { useSchemaStore } from "../stores/schemaStore";
import { aiService } from "../services/aiService";
import type {
  AgentActivityStep,
  ProposedAction,
  AgentRunResult,
} from "../types/database";

interface DatabaseAgentTabProps {
  database: string;
  onOpenQuery?: (sql: string) => void;
}

interface ChatMessage {
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

interface MessageContentChunk {
  type: "markdown" | "code";
  language: string;
  content: string;
}

/**
 * Splits text into markdown prose and code blocks (SQL, JSON, bash, etc.) to render them
 * with full syntax highlighting, copy actions, and proper markdown formatting.
 * Gracefully handles streaming / unclosed code fences at the end of the text.
 */
function parseMessageChunks(text: string): MessageContentChunk[] {
  const chunks: MessageContentChunk[] = [];
  // Matches ```[language]...``` or unclosed ```[language]... at the end of the string
  const regex = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index === text.length) break;

    if (match.index > lastIndex) {
      const prose = text.slice(lastIndex, match.index);
      if (prose.trim()) {
        chunks.push({ type: "markdown", language: "", content: prose });
      }
    }

    const lang = (match[1] || "").trim().toLowerCase();
    const code = match[2];

    if (code.length > 0 || lang.length > 0) {
      chunks.push({
        type: "code",
        language: lang,
        content: code,
      });
    }

    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) {
      regex.lastIndex++;
    }
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining.trim()) {
      chunks.push({ type: "markdown", language: "", content: remaining });
    }
  }

  if (chunks.length === 0 && text.trim()) {
    chunks.push({ type: "markdown", language: "", content: text });
  }

  return chunks;
}

export const DatabaseAgentTab: React.FC<DatabaseAgentTabProps> = ({
  database,
  onOpenQuery,
}) => {
  const { config, addAuditLog, recordMetric, openAiSettings } = useAiStore();
  const { tables } = useSchemaStore();

  const [inputQuery, setInputQuery] = useState("");
  const [pinnedTables, setPinnedTables] = useState<string[]>([]);
  const [showPinPopover, setShowPinPopover] = useState(false);
  const [pinSearchFilter, setPinSearchFilter] = useState("");

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome_agent_msg",
      sender: "agent",
      text: `Hola, soy el **Agente de Base de Datos de PyroStudio**. Puedo inspeccionar esquemas, ejecutar planes de ejecución \`EXPLAIN\`, auditar índices y diagnosticar cuellos de botella en **\`${database}\`** de forma autónoma y segura.\n\n*Puedes hacerme preguntas en lenguaje natural, pedirme optimizaciones o **pegar directamente tus consultas SQL multilínea** en el editor inferior. También puedes usar **Schema Pinning** en la barra superior para restringir mi enfoque a tablas clave.*`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const [isRunning, setIsRunning] = useState(false);
  const [currentSteps, setCurrentSteps] = useState<AgentActivityStep[]>([]);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [tablePickerFilter, setTablePickerFilter] = useState("");

  const abortControllerRef = useRef<boolean>(false);
  const streamIntervalRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const activeFullAnswerRef = useRef<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const tablePickerRef = useRef<HTMLDivElement>(null);
  const pinPopoverRef = useRef<HTMLDivElement>(null);

  const availableTables = useMemo(() => {
    return tables[database] || [];
  }, [tables, database]);

  const filteredTablesToPin = useMemo(() => {
    if (!pinSearchFilter.trim()) return availableTables;
    const q = pinSearchFilter.toLowerCase();
    return availableTables.filter((t) => t.name.toLowerCase().includes(q));
  }, [availableTables, pinSearchFilter]);

  const filteredAvailableTables = useMemo(() => {
    if (!tablePickerFilter.trim()) return availableTables;
    const q = tablePickerFilter.toLowerCase();
    return availableTables.filter((t) => t.name.toLowerCase().includes(q));
  }, [availableTables, tablePickerFilter]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentSteps]);

  // Click outside listener for table picker and pin popover
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tablePickerRef.current && !tablePickerRef.current.contains(e.target as Node)) {
        setShowTablePicker(false);
      }
      if (pinPopoverRef.current && !pinPopoverRef.current.contains(e.target as Node)) {
        setShowPinPopover(false);
      }
    };
    if (showTablePicker || showPinPopover) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showTablePicker, showPinPopover]);

  const handleTogglePin = (tableName: string) => {
    setPinnedTables((prev) =>
      prev.includes(tableName) ? prev.filter((t) => t !== tableName) : [...prev, tableName],
    );
  };

  const handleClearPinned = () => {
    setPinnedTables([]);
  };

  const handlePinAll = () => {
    setPinnedTables(availableTables.map((t) => t.name));
  };

  const clearPendingTimeouts = () => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];
  };

  const handleSkipStreaming = () => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    if (activeFullAnswerRef.current) {
      const full = activeFullAnswerRef.current;
      setMessages((prev) =>
        prev.map((m) => (m.isStreaming ? { ...m, text: full, isStreaming: false } : m)),
      );
      activeFullAnswerRef.current = null;
    }
    setIsRunning(false);
  };

  const handleSendPrompt = async (promptToSend?: string) => {
    const text = (promptToSend || inputQuery).trim();
    if (!text || isRunning) return;

    if (!config.enabled) {
      useUIStore.getState().showAlert({
        title: "Integración de IA Deshabilitada",
        message: "La integración de IA está deshabilitada. Por favor actívala en los Ajustes de IA.",
        variant: "warning",
        icon: "alert",
        confirmText: "Abrir Ajustes",
        onConfirm: () => openAiSettings(),
      });
      return;
    }

    if (config.privacy_mode && config.provider !== "ollama" && config.provider !== "mock") {
      useUIStore.getState().showAlert({
        title: "Modo Privado Activo",
        message: "Para usar el Agente con proveedores en la nube debes desactivar el Modo Privado o configurar Ollama (Local) en los Ajustes de IA.",
        variant: "warning",
        icon: "alert",
        confirmText: "Abrir Ajustes",
        onConfirm: () => openAiSettings(),
      });
      return;
    }

    // Prepare prompt text with Schema Pinning context if active
    let promptForAgent = text;
    if (pinnedTables.length > 0) {
      promptForAgent = `${text}\n\n[CONTEXTO PRIORITARIO - SCHEMA PINNING ACTIVADO]:\nEl usuario ha fijado y priorizado específicamente las siguientes tablas de '${database}': ${pinnedTables.map((t) => `\`${t}\``).join(", ")}.\nEnfoca tu análisis, explicaciones y consultas de inspección preferentemente en estas tablas.`;
    }

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: "user",
      text,
      pinnedTables: pinnedTables.length > 0 ? [...pinnedTables] : undefined,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery("");
    setIsRunning(true);
    abortControllerRef.current = false;

    // Progressive step simulation during backend inspection
    setCurrentSteps([
      {
        step_number: 1,
        title: "Analizando solicitud y planificando herramientas de inspección...",
        status: "running",
      },
    ]);

    clearPendingTimeouts();
    timeoutsRef.current.push(
      window.setTimeout(() => {
        if (!abortControllerRef.current) {
          setCurrentSteps((prev) => [
            ...prev.map((s) => ({ ...s, status: "completed" as const })),
            {
              step_number: 2,
              title: `Inspeccionando metadatos del esquema${pinnedTables.length > 0 ? ` (enfoque en ${pinnedTables.slice(0, 3).join(", ")}${pinnedTables.length > 3 ? "..." : ""})` : ""}...`,
              status: "running",
              tool_name: "list_tables / get_table_columns",
            },
          ]);
        }
      }, 1400),
      window.setTimeout(() => {
        if (!abortControllerRef.current) {
          setCurrentSteps((prev) => [
            ...prev.map((s) => ({ ...s, status: "completed" as const })),
            {
              step_number: 3,
              title: "Evaluando planes de ejecución EXPLAIN y estructura de índices...",
              status: "running",
              tool_name: "explain_query",
            },
          ]);
        }
      }, 3200),
      window.setTimeout(() => {
        if (!abortControllerRef.current) {
          setCurrentSteps((prev) => [
            ...prev.map((s) => ({ ...s, status: "completed" as const })),
            {
              step_number: 4,
              title: "Sintetizando diagnóstico y elaborando recomendaciones técnicas...",
              status: "running",
            },
          ]);
        }
      }, 5200),
    );

    try {
      const result: AgentRunResult = await aiService.runDatabaseAgentAi(
        database,
        promptForAgent,
        config,
        8,
      );

      clearPendingTimeouts();

      if (abortControllerRef.current) {
        setIsRunning(false);
        return;
      }

      // Record audit entry & metrics
      addAuditLog(result.audit_entry);
      recordMetric(result.audit_entry.total_tokens, result.duration_ms);

      const agentMsgId = `agent_${Date.now()}`;
      const fullAnswer = result.final_answer;
      activeFullAnswerRef.current = fullAnswer;

      // Create streaming placeholder message
      const initialAgentMsg: ChatMessage = {
        id: agentMsgId,
        sender: "agent",
        text: "",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        activitySteps: result.activity_steps,
        proposedActions: result.proposed_actions,
        durationMs: result.duration_ms,
        isStreaming: true,
      };

      setMessages((prev) => [...prev, initialAgentMsg]);
      setCurrentSteps([]);

      // Start Progressive Streaming Effect
      let cursor = 0;
      const stepIncrement = Math.max(10, Math.floor(fullAnswer.length / 45));

      streamIntervalRef.current = window.setInterval(() => {
        if (abortControllerRef.current) {
          if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
          setIsRunning(false);
          return;
        }

        cursor = Math.min(cursor + stepIncrement, fullAnswer.length);
        const streamedSlice = fullAnswer.slice(0, cursor);
        const isFinished = cursor >= fullAnswer.length;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId
              ? { ...m, text: streamedSlice, isStreaming: !isFinished }
              : m,
          ),
        );

        if (isFinished) {
          if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
          streamIntervalRef.current = null;
          activeFullAnswerRef.current = null;
          setIsRunning(false);
        }
      }, 22);
    } catch (err: unknown) {
      clearPendingTimeouts();
      if (abortControllerRef.current) return;

      const rawErrorMsg =
        typeof err === "string" ? err : (err as Error)?.message || "Error al ejecutar el agente de base de datos.";

      const isOverloaded =
        /ocupado|overloaded|exhausted|quota|429|503|529|saturado|busy|demanda|resource_exhausted/i.test(
          rawErrorMsg,
        );

      const errorChatMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: "agent",
        text: rawErrorMsg,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isError: true,
        isOverloaded,
        failedPrompt: text,
      };

      setMessages((prev) => [...prev, errorChatMsg]);
      setCurrentSteps([]);
      setIsRunning(false);
    }
  };

  const handleStopAgent = () => {
    abortControllerRef.current = true;
    clearPendingTimeouts();
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    // Finalize any streaming message
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
    );
    activeFullAnswerRef.current = null;
    setIsRunning(false);
    setCurrentSteps((prev) =>
      prev.map((s) => ({ ...s, status: s.status === "running" ? "error" : s.status })),
    );
  };

  const handleCopySql = (sqlText: string, label: string) => {
    navigator.clipboard.writeText(sqlText);
    setCopyFeedback(`¡${label} copiado!`);
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  const handleCopyMessage = (fullText: string) => {
    navigator.clipboard.writeText(fullText);
    setCopyFeedback("¡Mensaje copiado al portapapeles!");
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  const handleClearChat = () => {
    useUIStore.getState().showConfirm({
      title: "Nueva Sesión del Agente",
      message: "¿Deseas limpiar la conversación actual y reiniciar el historial del Agente para este esquema?",
      variant: "danger",
      confirmText: "Limpiar Chat",
      cancelText: "Cancelar",
      onConfirm: () => {
        handleStopAgent();
        setMessages([
          {
            id: `welcome_agent_msg_${Date.now()}`,
            sender: "agent",
            text: `Sesión reiniciada. Estoy listo para diagnosticar el esquema **\`${database}\`**${pinnedTables.length > 0 ? ` enfocado en las ${pinnedTables.length} tablas fijadas` : ""}. ¿En qué puedo ayudarte hoy?`,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
        setCurrentSteps([]);
      },
    });
  };

  const handleExportChat = () => {
    const formattedTranscript = messages
      .map((m) => {
        const header = `### ${m.sender === "user" ? "👤 Usuario" : "🤖 Agente de Base de Datos"} (${m.timestamp})`;
        return `${header}\n\n${m.text}\n`;
      })
      .join("\n---\n\n");

    navigator.clipboard.writeText(formattedTranscript);
    setCopyFeedback("¡Conversación copiada en formato Markdown!");
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  const handleInsertTable = (tableName: string) => {
    setInputQuery((prev) => {
      const insertion = `\`${tableName}\``;
      if (!prev.trim()) return `Analiza el rendimiento y estructura de ${insertion}`;
      return `${prev} ${insertion}`;
    });
    setShowTablePicker(false);
  };

  const handleKeyDownInEditor = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSendPrompt();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0d13] overflow-hidden text-neutral-200">
      {/* Agent Header Bar */}
      <div className="px-5 py-2.5 bg-[#10131b] border-b border-[#1b202e] flex flex-wrap items-center justify-between gap-3 text-xs select-none shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-purple-600/30 to-indigo-600/30 border border-purple-500/40 text-purple-300 shadow-sm">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-sm text-white tracking-tight">Database Intelligence Agent</span>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/50 flex items-center space-x-1">
                <ShieldCheck className="w-3 h-3" />
                <span>Read-Only Seguro</span>
              </span>
              {availableTables.length > 0 && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#161b26] text-neutral-400 border border-[#262f44]">
                  {availableTables.length} tablas
                </span>
              )}
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">
              Esquema activo: <strong className="text-neutral-200 font-mono">{database}</strong> · Proveedor:{" "}
              <span className="text-purple-300 font-semibold">{config.provider.toUpperCase()}</span> ({config.model})
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {config.privacy_mode && (
            <span className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-950/40 text-emerald-300 border border-emerald-800/40 rounded text-[11px] font-mono">
              <ShieldCheck className="w-3 h-3" />
              <span>Modo Privado ON</span>
            </span>
          )}

          <button
            onClick={handleExportChat}
            title="Copiar toda la conversación a Markdown"
            className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-[#171b26] hover:bg-[#202737] text-neutral-300 hover:text-white border border-[#262f44] rounded-md font-medium text-xs transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Exportar Chat</span>
          </button>

          <button
            onClick={handleClearChat}
            title="Reiniciar y limpiar conversación"
            className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-[#171b26] hover:bg-[#202737] text-neutral-300 hover:text-red-300 border border-[#262f44] rounded-md font-medium text-xs transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nueva Sesión</span>
          </button>

          <button
            onClick={openAiSettings}
            className="px-3 py-1.5 bg-[#171b26] hover:bg-[#202737] text-purple-300 hover:text-purple-200 border border-purple-900/40 hover:border-purple-700/60 rounded-md font-medium text-xs transition-colors"
          >
            Ajustes de IA
          </button>
        </div>
      </div>

      {/* Schema Pinning Bar */}
      <div className="px-5 py-2 bg-[#0c0f16] border-b border-[#1a2130] flex flex-wrap items-center justify-between gap-2.5 text-xs select-none shrink-0">
        <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
          <div className="flex items-center space-x-1.5 text-amber-400 font-semibold text-[11px]">
            <Pin className="w-3.5 h-3.5" />
            <span>Schema Pinning:</span>
          </div>

          {pinnedTables.length === 0 ? (
            <span className="text-[11px] text-neutral-400">
              Todo el esquema ({availableTables.length} tablas) en alcance. Puedes fijar tablas para enfocar el análisis.
            </span>
          ) : (
            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
              {pinnedTables.map((tName) => (
                <span
                  key={tName}
                  className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-purple-950/70 border border-purple-600/60 text-purple-200 text-[11px] font-mono shadow-xs"
                >
                  <span>📌 {tName}</span>
                  <button
                    onClick={() => handleTogglePin(tName)}
                    title={`Desfijar ${tName}`}
                    className="hover:text-red-300 p-0.5 transition-colors ml-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* Pin Table Selector Popover */}
          <div className="relative" ref={pinPopoverRef}>
            <button
              onClick={() => setShowPinPopover((prev) => !prev)}
              className="flex items-center space-x-1 px-2.5 py-1 bg-[#141824] hover:bg-[#1d2334] text-neutral-300 hover:text-white border border-[#252f44] rounded text-[11px] font-medium transition-colors"
            >
              <Pin className="w-3 h-3 text-amber-400" />
              <span>{pinnedTables.length > 0 ? "Modificar Tablas Fijadas" : "+ Fijar Tablas"}</span>
              <ChevronDown className="w-2.5 h-2.5 ml-0.5" />
            </button>

            {showPinPopover && (
              <div className="absolute right-0 top-full mt-1.5 w-72 max-h-80 bg-[#11141c] border border-[#232b3d] shadow-2xl rounded-xl overflow-hidden z-50 flex flex-col animate-in fade-in zoom-in-95 duration-100">
                <div className="p-2 border-b border-[#1c2232] bg-[#0d0f15]">
                  <div className="flex items-center space-x-1.5 px-2 py-1 bg-[#141824] border border-[#222a3d] rounded-md text-xs">
                    <Search className="w-3 h-3 text-neutral-400" />
                    <input
                      type="text"
                      value={pinSearchFilter}
                      onChange={(e) => setPinSearchFilter(e.target.value)}
                      placeholder="Filtrar tablas..."
                      className="bg-transparent border-none outline-none text-neutral-200 text-xs w-full font-mono placeholder-neutral-500"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between px-3 py-1.5 bg-[#0e121a] border-b border-[#1a2130] text-[10px] text-neutral-400 font-mono">
                  <span>{filteredTablesToPin.length} tablas encontradas</span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handlePinAll}
                      className="hover:text-purple-300 transition-colors"
                    >
                      Fijar todas
                    </button>
                    <span>·</span>
                    <button
                      onClick={handleClearPinned}
                      className="hover:text-red-300 transition-colors"
                    >
                      Limpiar
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 max-h-52">
                  {filteredTablesToPin.map((t) => {
                    const isPinned = pinnedTables.includes(t.name);
                    return (
                      <button
                        key={t.name}
                        onClick={() => handleTogglePin(t.name)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-mono transition-colors text-left ${
                          isPinned
                            ? "bg-purple-900/30 text-purple-200 font-semibold"
                            : "hover:bg-[#19202f] text-neutral-300"
                        }`}
                      >
                        <span className="truncate">{t.name}</span>
                        {isPinned ? (
                          <Check className="w-3.5 h-3.5 text-purple-400 shrink-0 ml-2" />
                        ) : (
                          <span className="text-[10px] text-neutral-500 font-sans">{t.table_type}</span>
                        )}
                      </button>
                    );
                  })}
                  {filteredTablesToPin.length === 0 && (
                    <div className="p-3 text-center text-neutral-500 text-xs font-sans">
                      No se encontraron tablas.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {pinnedTables.length > 0 && (
            <button
              onClick={handleClearPinned}
              title="Quitar fijado y abarcar todo el esquema"
              className="flex items-center space-x-1 px-2 py-1 bg-[#141824] hover:bg-red-950/40 text-neutral-400 hover:text-red-300 border border-[#252f44] rounded text-[11px] transition-colors"
            >
              <PinOff className="w-3 h-3" />
              <span>Limpiar ({pinnedTables.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Chat Messages Timeline */}
      <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 text-xs chat-selectable select-text">
        {messages.map((msg) => {
          const isUser = msg.sender === "user";
          return (
            <div
              key={msg.id}
              className={`group flex flex-col ${isUser ? "items-end" : "items-start"} space-y-2`}
            >
              <div className="flex items-center space-x-2 text-[11px] text-neutral-400">
                <span className="font-semibold text-neutral-300">{isUser ? "Tú" : "Database Agent"}</span>
                <span>·</span>
                <span>{msg.timestamp}</span>
                {msg.durationMs !== undefined && (
                  <>
                    <span>·</span>
                    <span className="text-purple-400 font-mono">{msg.durationMs} ms</span>
                  </>
                )}
                {isUser && msg.pinnedTables && msg.pinnedTables.length > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-amber-400 font-mono flex items-center space-x-1">
                      <Pin className="w-3 h-3" />
                      <span>{msg.pinnedTables.length} tablas fijadas</span>
                    </span>
                  </>
                )}
                <button
                  onClick={() => handleCopyMessage(msg.text)}
                  title="Copiar texto completo de este mensaje"
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 px-1.5 rounded bg-[#161a25] hover:bg-[#202737] text-neutral-400 hover:text-white flex items-center space-x-1 border border-[#232a3d] select-none"
                >
                  <Copy className="w-3 h-3" />
                  <span className="text-[10px]">Copiar</span>
                </button>
              </div>

              {/* Special Error Card if message is an execution failure */}
              {msg.isError ? (
                <div
                  className={`max-w-3xl w-full rounded-xl p-4.5 border space-y-3.5 shadow-xl chat-selectable select-text ${
                    msg.isOverloaded
                      ? "bg-amber-950/20 border-amber-600/50 text-amber-200"
                      : "bg-red-950/25 border-red-600/50 text-red-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {msg.isOverloaded ? (
                        <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                      )}
                      <span className="font-bold text-sm tracking-tight text-white">
                        {msg.isOverloaded
                          ? "Modelo de IA Ocupado por Alta Demanda"
                          : "Error en la Ejecución del Agente"}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold border ${
                        msg.isOverloaded
                          ? "bg-amber-900/40 text-amber-300 border-amber-700/60"
                          : "bg-red-900/40 text-red-300 border-red-700/60"
                      }`}
                    >
                      {msg.isOverloaded ? "Servidor Saturado (429/503)" : "Fallo de API"}
                    </span>
                  </div>

                  <p className="text-xs text-neutral-300 leading-relaxed font-sans select-text">
                    {msg.isOverloaded
                      ? "El servidor del proveedor de IA está temporalmente sobrecargado o se alcanzó el límite momentáneo de concurrencia. Esto es habitual en horas de alta demanda en servicios externos como Google AI Studio o OpenAI."
                      : msg.text}
                  </p>

                  {msg.isOverloaded && (
                    <div className="text-[11px] font-mono p-2.5 rounded bg-[#07090e] border border-amber-900/40 text-amber-300/80 overflow-x-auto select-text">
                      Detalle devuelto por la API: {msg.text}
                    </div>
                  )}

                  {/* Actions for recovering from error */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-neutral-800/80 select-none">
                    {msg.failedPrompt && (
                      <button
                        onClick={() => handleSendPrompt(msg.failedPrompt)}
                        disabled={isRunning}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-lg text-xs font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Volver a enviar prompt ahora</span>
                      </button>
                    )}

                    {msg.failedPrompt && (
                      <button
                        onClick={() => {
                          setInputQuery(msg.failedPrompt || "");
                        }}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#171c28] hover:bg-[#232b3d] text-neutral-200 border border-[#2b354c] rounded-lg text-xs font-medium transition-colors"
                      >
                        <CornerDownLeft className="w-3.5 h-3.5 text-neutral-400" />
                        <span>Restaurar en el editor para modificar</span>
                      </button>
                    )}

                    <button
                      onClick={openAiSettings}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#141722] hover:bg-[#1e2334] text-neutral-400 hover:text-neutral-200 border border-[#232a3d] rounded-lg text-xs transition-colors ml-auto"
                    >
                      <span>Ajustes de IA / Cambiar Modelo</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Regular Chat Message Box */
                <div
                  className={`max-w-3xl rounded-xl p-4 leading-relaxed font-sans relative chat-selectable select-text ${
                    isUser
                      ? "bg-purple-900/30 border border-purple-700/50 text-purple-100 shadow-md"
                      : "bg-[#121622] border border-[#20283b] text-neutral-200 shadow-lg"
                  }`}
                >
                  {/* Skip Streaming Button if message is currently typing */}
                  {!isUser && msg.isStreaming && (
                    <div className="absolute top-3 right-3 flex items-center space-x-1.5 select-none">
                      <button
                        onClick={handleSkipStreaming}
                        className="flex items-center space-x-1 px-2 py-0.5 rounded bg-purple-950/60 hover:bg-purple-900/80 text-purple-300 border border-purple-700/50 text-[10px] font-mono transition-colors shadow-xs"
                        title="Completar texto de inmediato sin animación"
                      >
                        <FastForward className="w-3 h-3" />
                        <span>Saltar streaming</span>
                      </button>
                    </div>
                  )}

                  {/* Agent Activity Trace */}
                  {!isUser && msg.activitySteps && msg.activitySteps.length > 0 && (
                    <div className="mb-4 bg-[#0d1017] border border-[#1b2232] rounded-lg overflow-hidden select-text">
                      <div className="px-3 py-2 bg-[#121622] border-b border-[#1b2232] flex items-center justify-between text-[11px] font-semibold text-neutral-300">
                        <div className="flex items-center space-x-1.5">
                          <Activity className="w-3.5 h-3.5 text-purple-400" />
                          <span>Actividad e Inspección Realizada ({msg.activitySteps.length} pasos)</span>
                        </div>
                      </div>
                      <div className="p-2 space-y-1.5 font-mono text-[11px]">
                        {msg.activitySteps.map((step, sIdx) => (
                          <div key={sIdx} className="flex items-start space-x-2 text-neutral-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                              <span className="text-neutral-200 font-semibold">{step.title}</span>
                              {step.tool_name && (
                                <span className="ml-2 px-1.5 py-0.2 rounded bg-[#182030] text-purple-300 text-[10px] border border-purple-900/40">
                                  {step.tool_name}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Main Message Content (Markdown + SQL Code Blocks) */}
                  <div className="space-y-3 chat-selectable select-text">
                    {parseMessageChunks(msg.text).map((chunk, cIdx) => {
                      if (chunk.type === "code") {
                        const isSql =
                          chunk.language === "sql" ||
                          (!chunk.language &&
                            /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|SHOW|DESCRIBE|EXPLAIN|WITH)\b/i.test(
                              chunk.content,
                            ));

                        if (isSql) {
                          return (
                            <div
                              key={cIdx}
                              className="rounded-lg border border-[#242c3e] bg-[#07090e] overflow-hidden shadow-inner my-2 select-text"
                            >
                              <div className="flex items-center justify-between px-3 py-1.5 bg-[#0e121a] border-b border-[#1f2637] text-[11px] select-none">
                                <div className="flex items-center space-x-1.5 font-mono text-purple-300 font-semibold">
                                  <Code className="w-3.5 h-3.5 text-purple-400" />
                                  <span>SQL</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <button
                                    onClick={() => handleCopySql(chunk.content, "SQL")}
                                    className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#161b26] hover:bg-[#222a3a] text-neutral-300 hover:text-white transition-colors text-[11px]"
                                    title="Copiar consulta SQL"
                                  >
                                    <Copy className="w-3 h-3" />
                                    <span>Copiar</span>
                                  </button>
                                  {onOpenQuery && (
                                    <button
                                      onClick={() => onOpenQuery(chunk.content)}
                                      className="flex items-center space-x-1 px-2.5 py-1 rounded bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white transition-all text-[11px] font-semibold shadow-xs"
                                      title="Abrir consulta en el Editor SQL de PyroStudio"
                                    >
                                      <Terminal className="w-3 h-3" />
                                      <span>Abrir en Editor</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="p-1 font-mono text-xs select-text">
                                <CodeMirror
                                  value={chunk.content}
                                  editable={false}
                                  theme="dark"
                                  extensions={[sql()]}
                                  basicSetup={{
                                    lineNumbers: false,
                                    foldGutter: false,
                                    highlightActiveLine: false,
                                  }}
                                  className="text-xs font-mono select-text"
                                />
                              </div>
                            </div>
                          );
                        }

                        // Generic code block (e.g. JSON, Bash, Python, etc.)
                        return (
                          <div
                            key={cIdx}
                            className="rounded-lg border border-[#242c3e] bg-[#080a10] overflow-hidden shadow-inner my-2 select-text"
                          >
                            <div className="flex items-center justify-between px-3 py-1.5 bg-[#0e121a] border-b border-[#1f2637] text-[11px] select-none">
                              <div className="flex items-center space-x-1.5 font-mono text-neutral-300 font-semibold uppercase">
                                <Code className="w-3.5 h-3.5 text-purple-400" />
                                <span>{chunk.language || "Código"}</span>
                              </div>
                              <button
                                onClick={() => handleCopySql(chunk.content, chunk.language || "Código")}
                                className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#161b26] hover:bg-[#222a3a] text-neutral-300 hover:text-white transition-colors text-[11px]"
                                title="Copiar código"
                              >
                                <Copy className="w-3 h-3" />
                                <span>Copiar</span>
                              </button>
                            </div>
                            <pre className="p-3 text-xs font-mono text-purple-200/90 overflow-x-auto leading-relaxed select-text m-0">
                              <code>{chunk.content}</code>
                            </pre>
                          </div>
                        );
                      }

                      // Markdown chunk
                      const htmlContent = marked.parse(chunk.content, {
                        async: false,
                        breaks: true,
                        gfm: true,
                      }) as string;

                      return (
                        <div
                          key={cIdx}
                          className="agent-markdown chat-selectable select-text"
                          dangerouslySetInnerHTML={{ __html: htmlContent }}
                        />
                      );
                    })}

                    {/* Glowing Cursor while streaming */}
                    {msg.isStreaming && (
                      <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse align-middle ml-1" />
                    )}
                  </div>

                  {/* Proposed Action Cards */}
                  {!isUser && msg.proposedActions && msg.proposedActions.length > 0 && !msg.isStreaming && (
                    <div className="mt-4 space-y-3 pt-3 border-t border-[#1e273a]">
                      <div className="font-bold text-amber-300 flex items-center space-x-1.5 text-xs">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        <span>Acciones Propuestas para Revisión Humana (Human-in-the-loop)</span>
                      </div>

                      {msg.proposedActions.map((action, aIdx) => (
                        <div
                          key={aIdx}
                          className="bg-[#0b0e14] border border-amber-800/40 rounded-lg p-3.5 space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-semibold text-white">{action.title}</div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono font-bold ${
                                action.risk_level === "critical"
                                  ? "bg-red-950/60 text-red-300 border border-red-800/60"
                                  : action.risk_level === "high"
                                  ? "bg-orange-950/60 text-orange-300 border border-orange-800/60"
                                  : "bg-emerald-950/60 text-emerald-300 border border-emerald-800/60"
                              }`}
                            >
                              Riesgo: {action.risk_level}
                            </span>
                          </div>

                          <p className="text-[11px] text-neutral-300">{action.description}</p>

                          <div className="rounded border border-[#1b2232] bg-[#06070a] p-1 font-mono text-[11px]">
                            <CodeMirror
                              value={action.sql}
                              editable={false}
                              theme="dark"
                              extensions={[sql()]}
                              basicSetup={{
                                lineNumbers: false,
                                foldGutter: false,
                                highlightActiveLine: false,
                              }}
                              className="text-xs font-mono select-text"
                            />
                          </div>

                          <div className="flex items-center justify-end space-x-2 pt-1">
                            <button
                              onClick={() => handleCopySql(action.sql, "SQL de la acción")}
                              className="flex items-center space-x-1 px-2.5 py-1 bg-[#171c28] hover:bg-[#222a3c] text-neutral-300 border border-[#2b354c] rounded text-[11px] transition-colors"
                            >
                              <Copy className="w-3 h-3" />
                              <span>Copiar SQL</span>
                            </button>
                            {onOpenQuery && (
                              <button
                                onClick={() => onOpenQuery(action.sql)}
                                className="flex items-center space-x-1 px-3 py-1 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded font-semibold text-[11px] shadow-sm transition-all"
                              >
                                <Terminal className="w-3 h-3" />
                                <span>Abrir en Editor de Consultas</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Live Running Activity Indicator */}
        {isRunning && (
          <div className="max-w-2xl bg-[#121622] border border-purple-500/40 rounded-xl p-4 shadow-xl animate-in fade-in space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-purple-300 font-bold">
                <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                <span>El Agente está investigando la base de datos...</span>
              </div>
              <button
                onClick={handleStopAgent}
                className="flex items-center space-x-1 px-2.5 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/40 rounded text-[11px] font-semibold transition-colors"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Detener Agente</span>
              </button>
            </div>

            <div className="space-y-1.5 font-mono text-[11px]">
              {currentSteps.map((step, idx) => (
                <div key={idx} className="flex items-start space-x-2 text-neutral-300">
                  {step.status === "running" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  )}
                  <span>{step.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {copyFeedback && (
          <div className="fixed bottom-24 right-8 p-3 rounded-lg bg-emerald-950/90 border border-emerald-700 text-emerald-200 text-xs font-mono shadow-2xl animate-in fade-in flex items-center space-x-2 z-50">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{copyFeedback}</span>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Suggested Quick Prompts */}
      <div className="px-5 py-2 bg-[#0e1118] border-t border-[#1b202e] flex flex-wrap items-center gap-2 text-[11px] select-none shrink-0">
        <span className="text-neutral-500 font-medium">Diagnósticos rápidos:</span>
        {[
          "¿Hay índices redundantes o duplicados?",
          "¿Qué tablas no tienen Primary Key definida?",
          "¿Cuáles son las 5 tablas con mayor volumen de filas?",
          "¿Por qué esta consulta no usa índices eficientes?",
          "Auditar salud general y cuellos de botella de este esquema",
        ].map((prompt, pIdx) => (
          <button
            key={pIdx}
            onClick={() => handleSendPrompt(prompt)}
            disabled={isRunning}
            className="px-2.5 py-1 rounded-full bg-[#161a26] hover:bg-[#202738] text-neutral-300 hover:text-white border border-[#252e42] transition-colors disabled:opacity-50 truncate max-w-xs"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Enhanced Multiline Input Prompt Box with SQL CodeMirror */}
      <div className="p-3.5 sm:p-4 bg-[#10131b] border-t border-[#1b202e] shrink-0 relative z-30" onKeyDown={handleKeyDownInEditor}>
        <div className="rounded-xl border border-[#232b3d] bg-[#090b10] shadow-xl focus-within:border-purple-500/80 transition-colors relative">
          {/* Editor Header Toolbar */}
          <div className="px-3 py-1.5 bg-[#0e121a] border-b border-[#1d2433] rounded-t-xl flex items-center justify-between text-[11px] text-neutral-400 select-none">
            <div className="flex items-center space-x-3">
              <span className="flex items-center space-x-1.5 font-semibold text-neutral-300">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>Prompt / Consulta SQL</span>
              </span>

              {/* Table Mention Dropdown */}
              {availableTables.length > 0 && (
                <div className="relative" ref={tablePickerRef}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowTablePicker((prev) => !prev);
                      setTablePickerFilter("");
                    }}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#161b26] hover:bg-[#222a3a] text-neutral-300 hover:text-white border border-[#263147] text-[10px] transition-colors"
                  >
                    <TableIcon className="w-3 h-3 text-purple-400" />
                    <span>+ Mencionar Tabla</span>
                    <ChevronDown className="w-2.5 h-2.5 ml-0.5" />
                  </button>

                  {showTablePicker && (
                    <div className="absolute left-0 bottom-full mb-2 w-72 max-h-72 bg-[#11141c] border border-[#283247] shadow-2xl rounded-xl overflow-hidden z-50 flex flex-col animate-in fade-in zoom-in-95 duration-100">
                      <div className="p-2 border-b border-[#1c2232] bg-[#0d0f15]">
                        <div className="flex items-center space-x-1.5 px-2 py-1 bg-[#141824] border border-[#222a3d] rounded-md text-xs">
                          <Search className="w-3 h-3 text-neutral-400" />
                          <input
                            type="text"
                            value={tablePickerFilter}
                            onChange={(e) => setTablePickerFilter(e.target.value)}
                            placeholder="Buscar tabla para mencionar..."
                            className="bg-transparent border-none outline-none text-neutral-200 text-xs w-full font-mono placeholder-neutral-500"
                            autoFocus
                          />
                        </div>
                      </div>

                      <div className="px-2.5 py-1 text-[10px] font-mono text-neutral-500 uppercase bg-[#0e121a] border-b border-[#1d2331]">
                        Tablas de {database} ({filteredAvailableTables.length})
                      </div>

                      <div className="overflow-y-auto max-h-48 p-1">
                        {filteredAvailableTables.map((t) => (
                          <button
                            key={t.name}
                            type="button"
                            onClick={() => handleInsertTable(t.name)}
                            className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-[#1d2332] text-neutral-200 hover:text-white flex items-center justify-between font-mono text-xs transition-colors"
                          >
                            <span className="truncate">{t.name}</span>
                            <span className="text-[10px] text-neutral-500 font-sans">{t.table_type}</span>
                          </button>
                        ))}
                        {filteredAvailableTables.length === 0 && (
                          <div className="p-3 text-center text-neutral-500 text-xs font-sans">
                            No se encontraron tablas.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Quick Snippet Buttons */}
              <button
                type="button"
                onClick={() => {
                  setInputQuery((prev) =>
                    prev.trim()
                      ? `${prev}\n\nEXPLAIN SELECT * FROM ...`
                      : "Explica el siguiente plan de ejecución:\nEXPLAIN SELECT * FROM ",
                  );
                }}
                className="hidden sm:inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-[#141822] hover:bg-[#1d2332] text-neutral-400 hover:text-neutral-200 border border-[#202738] text-[10px] transition-colors"
              >
                <span>+ EXPLAIN</span>
              </button>
            </div>

            <div className="flex items-center space-x-3">
              {inputQuery.trim() && (
                <>
                  <span className="text-[10px] font-mono text-neutral-500">
                    {inputQuery.split("\n").length} {inputQuery.split("\n").length === 1 ? "línea" : "líneas"} · {inputQuery.length} car.
                  </span>
                  <button
                    type="button"
                    onClick={() => setInputQuery("")}
                    title="Limpiar editor"
                    className="p-1 hover:text-red-400 text-neutral-500 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Multiline CodeMirror Editor for Prompts and SQL */}
          <div className="px-2 py-1 bg-[#090b10] min-h-[68px] max-h-[190px] overflow-y-auto">
            <CodeMirror
              value={inputQuery}
              onChange={(val) => setInputQuery(val)}
              extensions={[sql()]}
              theme="dark"
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: false,
              }}
              placeholder={`Pregunta al Agente sobre ${database} o pega sentencias SQL multilínea...\nEj: "¿Por qué esta consulta está lenta y cómo optimizarla?"\nSELECT o.id, c.name FROM orders o JOIN customers c ON ...\n\nPresiona Ctrl + Enter para enviar.`}
              className="text-xs font-mono text-neutral-200 select-text"
            />
          </div>

          {/* Editor Footer / Submit Bar */}
          <div className="px-3 py-2 bg-[#0d1017] border-t border-[#1a2130] rounded-b-xl flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2 text-[10px] text-neutral-500 font-mono">
              <span className="flex items-center space-x-1">
                <kbd className="px-1.5 py-0.5 rounded bg-[#161a26] border border-[#252f44] text-neutral-300">
                  Ctrl + Enter
                </kbd>
                <span>para enviar</span>
              </span>
              <span>·</span>
              <span className="flex items-center space-x-1">
                <kbd className="px-1.5 py-0.5 rounded bg-[#161a26] border border-[#252f44] text-neutral-300">
                  Shift + Enter
                </kbd>
                <span>nueva línea</span>
              </span>
            </div>

            <div className="flex items-center space-x-2">
              {isRunning ? (
                <button
                  type="button"
                  onClick={handleStopAgent}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold text-xs transition-colors flex items-center space-x-1.5 shadow-md shadow-red-950/40"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Detener Agente</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSendPrompt()}
                  disabled={!inputQuery.trim()}
                  className="px-4.5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg font-semibold text-xs transition-all active:scale-95 disabled:opacity-40 shadow-md shadow-purple-950/40 flex items-center space-x-1.5 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Preguntar</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
