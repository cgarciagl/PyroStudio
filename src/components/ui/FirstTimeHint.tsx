import React from "react";
import { Lightbulb, X } from "lucide-react";
import { usePreferenceStore } from "../../stores/preferenceStore";
import { iconBtn } from "./styles";

/** Tips shown once; the id is stored in preferences when dismissed. */
export type FirstTimeHintId = "grid" | "editor" | "safe_mode" | "staged_changes";

/** Whether the hint is still unseen, and the function that dismisses it for good. */
export function useFirstTimeHint(id: FirstTimeHintId): [boolean, () => void] {
  const seen = usePreferenceStore((s) => s.seenHints.includes(id));
  const markHintSeen = usePreferenceStore((s) => s.markHintSeen);
  return [!seen, () => markHintSeen(id)];
}

interface FirstTimeHintProps {
  id: FirstTimeHintId;
  children: React.ReactNode;
  className?: string;
}

/** Small, dismissible first-time tip (no animation, muted colors). */
export const FirstTimeHint: React.FC<FirstTimeHintProps> = ({ id, children, className = "" }) => {
  const [visible, dismiss] = useFirstTimeHint(id);
  if (!visible) return null;
  return (
    <div
      role="note"
      className={`flex items-start gap-2 px-3 py-2 rounded-lg border border-line bg-raised text-[11px] text-fg-muted shadow-pop ${className}`}
    >
      <Lightbulb className="w-3.5 h-3.5 text-accent-text shrink-0 mt-0.5" />
      <div className="flex-1 leading-relaxed">{children}</div>
      <button type="button" onClick={dismiss} className={iconBtn} title="Entendido, no volver a mostrar" aria-label="Cerrar consejo">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
