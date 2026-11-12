import { Zap } from "lucide-react";
import type { TriggerMetadata } from "../../types/database";
import { InspectorLoading } from "./InspectorLoading";

interface TriggersPanelProps {
  tableName: string;
  isLoading: boolean;
  triggers: TriggerMetadata[];
  /** Absent when the engine/session cannot create triggers. */
  onCreateTrigger?: () => void;
}

/** Triggers attached to a table. */
export function TriggersPanel({ tableName, isLoading, triggers, onCreateTrigger }: TriggersPanelProps) {
  return (
  isLoading ? (
    <InspectorLoading label="Cargando triggers..." />
  ) : (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted font-mono">
          Disparadores asociados a <strong className="text-fg">{tableName}</strong>
        </span>
        {onCreateTrigger && (
          <button
            onClick={() => onCreateTrigger()}
            className="px-3 py-1.5 hover:bg-hover text-warning border border-line rounded text-xs font-semibold flex items-center space-x-1.5 transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Nuevo Trigger</span>
          </button>
        )}
      </div>

      {triggers.length === 0 ? (
        <div className="p-8 text-center text-fg-subtle font-mono text-xs bg-surface border border-line rounded-lg space-y-3">
          <p>Esta tabla no tiene disparadores (Triggers) asociados.</p>
          {onCreateTrigger && (
            <button
              onClick={() => onCreateTrigger()}
              className="px-3 py-1.5 hover:bg-hover text-warning border border-line rounded text-xs font-semibold inline-flex items-center space-x-1.5 transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Crear Primer Trigger para {tableName}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {triggers.map((trg) => (
            <div
              key={trg.name}
              className="bg-surface border border-line rounded-lg p-4 space-y-3 shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 font-mono">
                  <Zap className="w-4 h-4 text-fg-muted" />
                  <span className="font-bold text-fg text-sm">{trg.name}</span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold text-warning border border-line">
                    {trg.timing} {trg.event}
                  </span>
                </div>
                {trg.created && (
                  <span className="text-fg-subtle text-[11px] font-mono">
                    Creado: {trg.created}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
  );
}
