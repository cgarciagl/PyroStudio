import { Bot, CornerDownRight } from "lucide-react";
import { SUGGESTED_PROMPTS } from "./agentText";

/** Before the first question: what the agent can do and a few questions to start with. */
export function EmptyConversation({ database, disabled, onAsk }: { database: string; disabled: boolean; onAsk: (q: string) => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-4">
        <div className="space-y-1">
          <Bot className="w-5 h-5 text-fg-subtle" />
          <h2 className="text-sm font-medium text-fg">Pregúntale al agente sobre {database}</h2>
          <p className="text-xs text-fg-muted leading-relaxed">
            Inspecciona el esquema, revisa planes EXPLAIN y audita índices para responder. Solo lee: cualquier cambio que
            proponga lo revisa usted en el editor.
          </p>
        </div>
        <ul className="space-y-0.5" aria-label="Preguntas sugeridas">
          {SUGGESTED_PROMPTS.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => onAsk(q)}
                disabled={disabled}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-50 disabled:pointer-events-none"
              >
                <CornerDownRight className="w-3 h-3 shrink-0 text-fg-subtle" />
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
