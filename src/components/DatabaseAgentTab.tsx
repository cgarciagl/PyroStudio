import React, { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import { useAiStore } from "../stores/aiStore";
import { useUIStore } from "../stores/uiStore";
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
}

export const DatabaseAgentTab: React.FC<DatabaseAgentTabProps> = ({
  database,
  onOpenQuery,
}) => {
  const { config, addAuditLog, recordMetric, openAiSettings } = useAiStore();

  const [inputQuery, setInputQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome_agent_msg",
      sender: "agent",
      text: `Hola, soy el **Agente de Base de Datos de PyroStudio**. Puedo inspeccionar esquemas, ejecutar planes de ejecución \`EXPLAIN\`, auditar índices y diagnosticar cuellos de botella en **\`${database}\`** de forma autónoma y segura.`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const [isRunning, setIsRunning] = useState(false);
  const [currentSteps, setCurrentSteps] = useState<AgentActivityStep[]>([]);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const abortControllerRef = useRef<boolean>(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentSteps]);

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

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: "user",
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery("");
    setIsRunning(true);
    setCurrentSteps([
      {
        step_number: 1,
        title: "Analizando solicitud y planificando herramientas de inspección...",
        status: "running",
      },
    ]);
    abortControllerRef.current = false;

    try {
      const result: AgentRunResult = await aiService.runDatabaseAgentAi(
        database,
        text,
        config,
        8,
      );

      if (abortControllerRef.current) {
        setIsRunning(false);
        return;
      }

      // Record audit entry & metrics
      addAuditLog(result.audit_entry);
      recordMetric(result.audit_entry.total_tokens, result.duration_ms);

      const agentMsg: ChatMessage = {
        id: `agent_${Date.now()}`,
        sender: "agent",
        text: result.final_answer,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        activitySteps: result.activity_steps,
        proposedActions: result.proposed_actions,
        durationMs: result.duration_ms,
      };

      setMessages((prev) => [...prev, agentMsg]);
      setCurrentSteps([]);
    } catch (err: unknown) {
      if (abortControllerRef.current) return;
      const errorMsg =
        typeof err === "string" ? err : (err as Error)?.message || "Error al ejecutar el agente de base de datos.";
      const errorChatMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: "agent",
        text: `⚠️ **Error al ejecutar el agente:**\n${errorMsg}`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorChatMsg]);
      setCurrentSteps([]);
    } finally {
      setIsRunning(false);
    }
  };

  const handleStopAgent = () => {
    abortControllerRef.current = true;
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

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0d13] overflow-hidden text-neutral-200">
      {/* Agent Header Bar */}
      <div className="px-5 py-3 bg-[#10131b] border-b border-[#1b202e] flex flex-wrap items-center justify-between gap-3 text-xs select-none">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-purple-600/30 to-indigo-600/30 border border-purple-500/40 text-purple-300">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-sm text-white tracking-tight">Database Intelligence Agent</span>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/50 flex items-center space-x-1">
                <ShieldCheck className="w-3 h-3" />
                <span>Read-Only Seguro</span>
              </span>
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
            onClick={openAiSettings}
            className="px-3 py-1.5 bg-[#171b26] hover:bg-[#202737] text-neutral-300 border border-[#262f44] rounded-md font-medium text-xs transition-colors"
          >
            Ajustes de IA
          </button>
        </div>
      </div>

      {/* Chat Messages Timeline */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
        {messages.map((msg) => {
          const isUser = msg.sender === "user";
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-2`}
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
              </div>

              <div
                className={`max-w-3xl rounded-xl p-4 leading-relaxed font-sans ${
                  isUser
                    ? "bg-purple-900/30 border border-purple-700/50 text-purple-100"
                    : "bg-[#121622] border border-[#20283b] text-neutral-200 shadow-lg"
                }`}
              >
                {/* Agent Activity Trace */}
                {!isUser && msg.activitySteps && msg.activitySteps.length > 0 && (
                  <div className="mb-4 bg-[#0d1017] border border-[#1b2232] rounded-lg overflow-hidden">
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

                {/* Main Text Content */}
                <div className="prose prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap">
                  {msg.text}
                </div>

                {/* Proposed Action Cards */}
                {!isUser && msg.proposedActions && msg.proposedActions.length > 0 && (
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

                        <pre className="p-2.5 bg-[#06070a] border border-[#1b2232] rounded text-emerald-300 font-mono text-[11px] overflow-x-auto">
                          {action.sql}
                        </pre>

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
          <div className="fixed bottom-24 right-8 p-3 rounded-lg bg-emerald-950/90 border border-emerald-700 text-emerald-200 text-xs font-mono shadow-2xl animate-in fade-in">
            {copyFeedback}
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Suggested Quick Prompts */}
      <div className="px-6 py-2 bg-[#0e1118] border-t border-[#1b202e] flex flex-wrap items-center gap-2 text-[11px] select-none">
        <span className="text-neutral-500 font-medium">Sugerencias rápidas:</span>
        {[
          "¿Por qué orders está lenta?",
          "¿Qué tablas no tienen primary key?",
          "¿Hay índices redundantes en la base de datos?",
          "¿Cuáles son las 5 tablas con mayor volumen de datos?",
          "Analiza la salud general de este esquema",
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

      {/* Input Prompt Box */}
      <div className="p-4 bg-[#10131b] border-t border-[#1b202e]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendPrompt();
          }}
          className="flex items-center space-x-2"
        >
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            disabled={isRunning}
            placeholder={`Pregunta al Agente sobre el esquema ${database} (ej. "¿Por qué la consulta de ventas no usa índice?", "¿Cómo optimizar...")`}
            className="flex-1 px-4 py-2.5 bg-[#0c0e14] border border-[#22293c] rounded-lg text-neutral-200 text-xs focus:outline-none focus:border-purple-500 placeholder-neutral-500 font-sans"
          />
          {isRunning ? (
            <button
              type="button"
              onClick={handleStopAgent}
              className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold text-xs transition-colors flex items-center space-x-1.5 shadow-md shadow-red-950/40"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>Detener</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputQuery.trim()}
              className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg font-semibold text-xs transition-all active:scale-95 disabled:opacity-40 shadow-md shadow-purple-950/40 flex items-center space-x-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Preguntar</span>
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
