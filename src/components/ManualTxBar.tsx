import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, GitCommitHorizontal, Undo2, X } from "lucide-react";
import type { ManualTxStatus } from "../types/database";
import { ghostBtn, primaryBtn, secondaryBtn } from "./ui/styles";
import { usePreferenceStore } from "../stores/preferenceStore";

/** Default age after which an open transaction holds locks long enough to warn about. */
export const LONG_TRANSACTION_MS = 5 * 60 * 1000;

export function isLongRunning(status: ManualTxStatus, now: number, limitMs = LONG_TRANSACTION_MS): boolean {
  return status.pending_statements > 0 && now - status.started_at_ms >= limitMs;
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
  const { t } = useTranslation("queryEditor");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const pending = status.pending_statements;
  const limitMinutes = usePreferenceStore((s) => s.longTransactionMinutes);
  const long = isLongRunning(status, now, limitMinutes * 60 * 1000);

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-line bg-surface text-xs"
    >
      <div className="flex items-center gap-2 min-w-0 text-fg-muted">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pending > 0 ? "bg-warning" : "bg-fg-subtle"}`} />
        <span className="text-fg">{t("manualTx.title")}</span>
        <span>
          · {pending === 0 ? t("manualTx.noPending") : t("manualTx.pendingCount", { count: pending })}
        </span>
        {pending > 0 && <span className="font-mono">· {formatElapsed(now - status.started_at_ms)}</span>}
        {long && (
          <span className="flex items-center gap-1 text-warning" title={t("manualTx.longTooltip")}>
            <AlertTriangle className="w-3.5 h-3.5" />
            {t("manualTx.longWarning")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button type="button" onClick={onExit} disabled={busy} className={ghostBtn} title={t("manualTx.exitTooltip")}>
          <X className="w-3.5 h-3.5" />
          <span>{t("manualTx.exit")}</span>
        </button>
        <button type="button" onClick={onRollback} disabled={busy || pending === 0} className={secondaryBtn}>
          <Undo2 className="w-3.5 h-3.5" />
          <span>{t("manualTx.rollback")}</span>
        </button>
        <button type="button" onClick={onCommit} disabled={busy || pending === 0} className={primaryBtn}>
          <GitCommitHorizontal className="w-3.5 h-3.5" />
          <span>{t("manualTx.commit")}</span>
        </button>
      </div>
    </div>
  );
};
