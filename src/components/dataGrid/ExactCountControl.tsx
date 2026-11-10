import React from "react";
import { Loader2 } from "lucide-react";

/** "contar exacto" link, or a spinner while the exact COUNT(*) runs. */
export const ExactCountControl: React.FC<{ isCounting: boolean; onCount: () => void }> = ({
  isCounting,
  onCount,
}) =>
  isCounting ? (
    <span className="flex items-center gap-1 text-fg-subtle text-[11px]">
      <Loader2 className="w-3 h-3 animate-spin" />
      <span>contando…</span>
    </span>
  ) : (
    <button
      type="button"
      onClick={onCount}
      title="Ejecutar SELECT COUNT(*) para obtener el total exacto (puede tardar en tablas grandes)"
      className="text-[11px] text-fg-muted hover:text-fg underline underline-offset-2"
    >
      contar exacto
    </button>
  );
