import React, { useEffect, useState } from "react";
import { AlertTriangle, GitCommitHorizontal, Undo2, X } from "lucide-react";
import type { ManualTxStatus } from "../types/database";
import { ghostBtn, primaryBtn, secondaryBtn } from "./ui/styles";

/** Open transactions older than this hold locks long enough to warn about. */
export const LONG_TRANSACTION_MS = 5 * 60 * 1000;

export function isLongRunning(status: ManualTxStatus, now: number): boolean {
  return status.pending_statements > 0 && now - status.started_at_ms >= LONG_TRANSACTION_MS;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface ManualTxBarProps {
  status: ManualTxStatus;
  busy: boolean;
  onCommit: () => void;
  onRollback: () => void;
  onExit: () => void;
}

/** Bar shown while an editor tab runs with auto-commit off. */
export const ManualTxBar: React.FC<ManualTxBarProps> = ({
  status,
  busy,
  onCommit,
  onRollback,
  onExit,
}) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const pending = status.pending_statements;
  const long = isLongRunning(status, now);

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-line bg-surface text-xs"
    >
      <div className="flex items-center gap-2 min-w-0 text-fg-muted">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pending > 0 ? "bg-warning" : "bg-fg-subtle"}`} />
        <span className="text-fg">Transacción manual</span>
        <span>
          · {pending === 0 ? "sin cambios pendientes" : `${pending} sentencia(s) sin confirmar`}
        </span>
        {pending > 0 && <span className="font-mono">· {formatElapsed(now - status.started_at_ms)}</span>}
        {long && (
          <span className="flex items-center gap-1 text-warning" title="Una transacción abierta mantiene bloqueos en las filas modificadas">
            <AlertTriangle className="w-3.5 h-3.5" />
            Lleva mucho tiempo abierta
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button type="button" onClick={onExit} disabled={busy} className={ghostBtn} title="Volver a auto-commit (hace ROLLBACK de lo pendiente)">
          <X className="w-3.5 h-3.5" />
          <span>Salir</span>
        </button>
        <button type="button" onClick={onRollback} disabled={busy || pending === 0} className={secondaryBtn}>
          <Undo2 className="w-3.5 h-3.5" />
          <span>Rollback</span>
        </button>
        <button type="button" onClick={onCommit} disabled={busy || pending === 0} className={primaryBtn}>
          <GitCommitHorizontal className="w-3.5 h-3.5" />
          <span>Commit</span>
        </button>
      </div>
    </div>
  );
};
