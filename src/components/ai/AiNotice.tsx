import React from "react";
import { AlertTriangle } from "lucide-react";
import { useUIStore } from "../../stores/uiStore";

/**
 * Explains why the AI part of a result is missing (invalid AI settings,
 * Privacy Mode, provider error…), so a silent rule-based fallback never
 * looks like an AI answer.
 */
export const AiNotice: React.FC<{ notice?: string | null; className?: string }> = ({ notice, className = "" }) => {
  if (!notice) return null;
  return (
    <div
      role="status"
      data-ai-notice
      className={`flex items-start gap-2 px-3 py-2 rounded-lg border border-line bg-surface text-xs ${className}`}
    >
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" />
      <p className="flex-1 min-w-0 text-fg-muted break-words">{notice}</p>
      <button
        type="button"
        onClick={() => useUIStore.getState().openSettingsModal("ai")}
        className="shrink-0 text-[11px] text-fg-subtle hover:text-fg transition-colors"
      >
        Ajustes de IA
      </button>
    </div>
  );
};
