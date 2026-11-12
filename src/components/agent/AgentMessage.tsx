import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, CornerDownLeft, FastForward, RefreshCw, Target } from "lucide-react";
import type { ProposedAction } from "../../types/database";
import { renderSafeMarkdown } from "../../utils/safeMarkdown";
import { ghostBtn, secondaryBtn } from "../ui/styles";
import { isSqlChunk, parseMessageChunks } from "./agentText";
import { CodeBlock } from "./CodeBlock";
import { CopyButton } from "./CopyButton";
import type { ChatMessage } from "./useDatabaseAgent";

interface AgentMessageProps {
  msg: ChatMessage;
  isRunning: boolean;
  copy: (text: string) => Promise<unknown>;
  onOpenQuery?: (sql: string) => void;
  onRetry: (prompt: string) => void;
  onEditPrompt: (prompt: string) => void;
  onSkipStreaming: () => void;
  onOpenSettings: () => void;
}

const RISK: Record<ProposedAction["risk_level"], { label: string; dot: string }> = {
  low: { label: "Riesgo bajo", dot: "bg-success" },
  medium: { label: "Riesgo medio", dot: "bg-warning" },
  high: { label: "Riesgo alto", dot: "bg-warning" },
  critical: { label: "Riesgo crítico", dot: "bg-danger" },
};

function MessageMeta({ msg, copy }: { msg: ChatMessage; copy: AgentMessageProps["copy"] }) {
  const isUser = msg.sender === "user";
  return (
    <div className={`flex items-center gap-1.5 text-[11px] text-fg-muted ${isUser ? "justify-end" : ""}`}>
      <span className="font-medium text-fg">{isUser ? "Tú" : "Agente"}</span>
      <span aria-hidden>·</span>
      <span className="tabular-nums">{msg.timestamp}</span>
      {msg.durationMs !== undefined && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{(msg.durationMs / 1000).toFixed(1)} s</span>
        </>
      )}
      {msg.pinnedTables?.length ? (
        <>
          <span aria-hidden>·</span>
          <span className="flex items-center gap-1" title={msg.pinnedTables.join(", ")}>
            <Target className="w-3 h-3" /> {msg.pinnedTables.length} {msg.pinnedTables.length === 1 ? "tabla" : "tablas"}
          </span>
        </>
      ) : null}
      {!msg.isStreaming && (
        <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <CopyButton copy={() => copy(msg.text)} title="Copiar el mensaje" />
        </span>
      )}
    </div>
  );
}

/** One turn of the conversation: the user's question, the agent's answer or a failure. */
export function AgentMessage(props: AgentMessageProps) {
  const { msg, isRunning, copy, onOpenQuery, onRetry, onEditPrompt, onSkipStreaming, onOpenSettings } = props;

  if (msg.sender === "user") {
    return (
      <div className="group flex flex-col items-end gap-1">
        <MessageMeta msg={msg} copy={copy} />
        <div className="max-w-[min(48rem,90%)] rounded-lg border border-line bg-raised px-3 py-2 text-xs text-fg whitespace-pre-wrap break-words select-text">
          {msg.text}
        </div>
      </div>
    );
  }

  if (msg.isError) {
    return (
      <div className="group flex flex-col gap-1" role="alert">
        <MessageMeta msg={msg} copy={copy} />
        <div className="max-w-3xl rounded-lg border border-line px-3.5 py-3 space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium text-fg">
            {msg.isOverloaded ? <Clock className="w-4 h-4 text-warning" /> : <AlertTriangle className="w-4 h-4 text-danger" />}
            {msg.isOverloaded ? "El proveedor de IA está saturado" : "El agente no pudo responder"}
          </p>
          <p className="text-xs text-fg-muted leading-relaxed">
            {msg.isOverloaded
              ? "Se alcanzó un límite temporal de demanda o de cuota. Suele resolverse al reintentar en unos segundos o con otro modelo."
              : "El proveedor devolvió un error."}
          </p>
          <pre className="m-0 p-2 rounded bg-canvas border border-line text-[11px] font-mono text-fg-muted whitespace-pre-wrap break-words select-text">
            {msg.text}
          </pre>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {msg.failedPrompt && (
              <>
                <button type="button" onClick={() => onRetry(msg.failedPrompt!)} disabled={isRunning} className={secondaryBtn}>
                  <RefreshCw className="w-3.5 h-3.5" /> Reintentar
                </button>
                <button type="button" onClick={() => onEditPrompt(msg.failedPrompt!)} className={ghostBtn}>
                  <CornerDownLeft className="w-3.5 h-3.5" /> Editar la pregunta
                </button>
              </>
            )}
            <button type="button" onClick={onOpenSettings} className={`${ghostBtn} ml-auto`}>
              Cambiar modelo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-1.5 max-w-3xl">
      <MessageMeta msg={msg} copy={copy} />

      {msg.activitySteps && msg.activitySteps.length > 0 && (
        <details className="text-[11px] text-fg-muted">
          <summary className="cursor-pointer select-none hover:text-fg w-fit">
            Inspección realizada: {msg.activitySteps.length} {msg.activitySteps.length === 1 ? "paso" : "pasos"}
          </summary>
          <ol className="mt-1.5 ml-1 space-y-1 border-l border-line pl-3">
            {msg.activitySteps.map((step, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3 h-3 mt-0.5 text-success shrink-0" />
                <span>
                  <span className="text-fg">{step.title}</span>
                  {step.tool_name && <span className="ml-1.5 font-mono text-fg-subtle">{step.tool_name}</span>}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="space-y-2 text-xs leading-relaxed text-fg select-text">
        {parseMessageChunks(msg.text).map((chunk, i) =>
          chunk.type === "code" ? (
            <CodeBlock
              key={i}
              code={chunk.content}
              language={isSqlChunk(chunk) ? "sql" : chunk.language}
              copy={copy}
              onOpenQuery={onOpenQuery}
            />
          ) : (
            <div key={i} className="agent-markdown" dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(chunk.content) }} />
          ),
        )}
        {msg.isStreaming && (
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block w-1.5 h-3.5 bg-fg-muted" />
            <button type="button" onClick={onSkipStreaming} className={`${ghostBtn} px-1.5 py-0.5 text-[11px]`} title="Mostrar la respuesta completa">
              <FastForward className="w-3 h-3" /> Mostrar todo
            </button>
          </div>
        )}
      </div>

      {msg.proposedActions && msg.proposedActions.length > 0 && !msg.isStreaming && (
        <section className="mt-2 space-y-2" aria-label="Acciones propuestas">
          <p className="text-[11px] font-medium text-fg-muted">
            Acciones propuestas · revíselas antes de ejecutarlas; el agente no modifica la base de datos
          </p>
          {msg.proposedActions.map((action, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-fg">{action.title}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-fg-muted">
                  <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${RISK[action.risk_level]?.dot ?? "bg-fg-subtle"}`} />
                  {RISK[action.risk_level]?.label ?? action.risk_level}
                </span>
              </div>
              {action.description && <p className="text-[11px] text-fg-muted">{action.description}</p>}
              {/* Opening goes through the explicit "review" button below. */}
              <CodeBlock code={action.sql} language="sql" copy={copy} />
              {onOpenQuery && (
                <div className="flex justify-end">
                  <button type="button" onClick={() => onOpenQuery(action.sql)} className={secondaryBtn}>
                    <ArrowUpRight className="w-3.5 h-3.5" /> Revisar en el editor
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
