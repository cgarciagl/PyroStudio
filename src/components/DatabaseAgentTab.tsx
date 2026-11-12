import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { secondaryBtn } from "./ui/styles";
import { useDatabaseAgent } from "./agent/useDatabaseAgent";
import { AgentHeader } from "./agent/AgentHeader";
import { AgentMessage } from "./agent/AgentMessage";
import { AgentActivity } from "./agent/AgentActivity";
import { AgentComposer } from "./agent/AgentComposer";
import { EmptyConversation } from "./agent/EmptyConversation";

interface DatabaseAgentTabProps {
  database: string;
  onOpenQuery?: (sql: string) => void;
}

/**
 * Database agent: a conversation that inspects the schema to answer. Layout: header,
 * readiness notice (only when the AI cannot answer), conversation, composer.
 */
export const DatabaseAgentTab: React.FC<DatabaseAgentTabProps> = ({ database, onOpenQuery }) => {
  const agent = useDatabaseAgent(database);
  const { config, readiness, messages, isRunning, currentSteps } = agent;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, currentSteps]);

  const hasConversation = messages.length > 0;

  return (
    <div className="pyro-view pyro-agent-workspace flex-1 flex flex-col h-full min-w-0 bg-canvas overflow-hidden text-fg" data-agent-view>
      <AgentHeader
        database={database}
        tableCount={agent.availableTables.length}
        provider={config.provider}
        model={config.model}
        readiness={readiness}
        hasConversation={hasConversation}
        onExport={agent.exportConversation}
        onNewSession={agent.newSession}
        onOpenSettings={agent.openAiSettings}
      />

      {/* Said before typing, not after sending. */}
      {!readiness.ready && (
        <div role="alert" data-agent-readiness className="px-4 py-2.5 border-b border-line bg-surface flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-fg">{readiness.title}</p>
            <p className="text-[11px] text-fg-muted">{readiness.message}</p>
          </div>
          <button type="button" onClick={agent.openAiSettings} className={secondaryBtn}>
            Abrir ajustes de IA
          </button>
        </div>
      )}

      {hasConversation || isRunning ? (
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6 chat-selectable" data-agent-conversation>
          {messages.map((msg) => (
            <AgentMessage
              key={msg.id}
              msg={msg}
              isRunning={isRunning}
              copy={agent.copyText}
              onOpenQuery={onOpenQuery}
              onRetry={(q) => agent.send(q)}
              onEditPrompt={agent.setInputQuery}
              onSkipStreaming={agent.skipStreaming}
              onOpenSettings={agent.openAiSettings}
            />
          ))}
          {isRunning && currentSteps.length > 0 && <AgentActivity steps={currentSteps} onStop={agent.stop} />}
          <div ref={bottomRef} />
        </div>
      ) : (
        <EmptyConversation database={database} disabled={!readiness.ready} onAsk={(q) => agent.send(q)} />
      )}

      <AgentComposer
        database={database}
        ready={readiness.ready}
        hasConversation={hasConversation}
        inputQuery={agent.inputQuery}
        setInputQuery={agent.setInputQuery}
        pinnedTables={agent.pinnedTables}
        togglePin={agent.togglePin}
        clearPinned={agent.clearPinned}
        pinAll={agent.pinAll}
        mentionTable={agent.mentionTable}
        insertExplain={agent.insertExplain}
        isRunning={isRunning}
        send={agent.send}
        stop={agent.stop}
        availableTables={agent.availableTables}
      />
    </div>
  );
};
