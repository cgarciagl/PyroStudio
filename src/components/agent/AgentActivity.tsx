import { CheckCircle2, Loader2, Square, XCircle } from "lucide-react";
import type { AgentActivityStep } from "../../types/database";
import { ghostBtn } from "../ui/styles";

/** What the agent is doing right now, with a way to stop it. */
export function AgentActivity({ steps, onStop }: { steps: AgentActivityStep[]; onStop: () => void }) {
  return (
    <div role="status" aria-live="polite" className="max-w-3xl space-y-1.5">
      <div className="flex items-center gap-2 text-[11px] text-fg-muted">
        <span className="font-medium text-fg">Agente</span>
        <span aria-hidden>·</span>
        <span>investigando la base de datos</span>
        <button type="button" onClick={onStop} className={`${ghostBtn} px-1.5 py-0.5 text-[11px]`}>
          <Square className="w-2.5 h-2.5 fill-current" /> Detener
        </button>
      </div>
      <ol className="ml-1 space-y-1 border-l border-line pl-3 text-[11px]">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-1.5 text-fg-muted">
            {step.status === "running" ? (
              <Loader2 className="w-3 h-3 mt-0.5 animate-spin shrink-0" />
            ) : step.status === "error" ? (
              <XCircle className="w-3 h-3 mt-0.5 text-danger shrink-0" />
            ) : (
              <CheckCircle2 className="w-3 h-3 mt-0.5 text-success shrink-0" />
            )}
            <span className={step.status === "running" ? "text-fg" : ""}>{step.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
