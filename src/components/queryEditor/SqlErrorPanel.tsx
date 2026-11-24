import { useTranslation } from "react-i18next";
import { Loader2, AlertCircle, Check, Copy, Bug, Lightbulb, ArrowLeftRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { SqlDiagnosticResult } from "../../types/database";
import { reportError } from "../../utils/errors";

interface SqlErrorPanelProps {
  diagnostic: SqlDiagnosticResult;
  /** Offer a retry over a direct connection (tunnel timeouts). */
  canRetryDirect: boolean;
  isRetryingDirect: boolean;
  onRetryDirect: () => void;
  /** Offer a retry without the client time limit (direct connection timeouts). */
  canRetryUnlimited?: boolean;
  onRetryUnlimited?: () => void;
  onFixWithAi: () => void;
}

/** Diagnosed SQL error with code, category, suggestion and recovery actions. */
export function SqlErrorPanel({
  diagnostic,
  canRetryDirect,
  isRetryingDirect,
  onRetryDirect,
  canRetryUnlimited = false,
  onRetryUnlimited,
  onFixWithAi,
}: SqlErrorPanelProps) {
  const { t } = useTranslation("queryEditor");
  const [isCopiedError, setIsCopiedError] = useState(false);
  return (
    <div className="p-4 m-4 rounded-lg border border-line text-danger text-xs font-mono space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start space-x-2.5">
          <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-danger flex flex-wrap items-center gap-2">
              <span>{t("sqlError.title")}</span>
              {diagnostic.error_code && (
                <span className="px-1.5 py-0.5 rounded text-danger border border-line text-[11px]">
                  {t("sqlError.code", { code: diagnostic.error_code })}
                </span>
              )}
              {diagnostic.sqlstate && (
                <span className="px-1.5 py-0.5 rounded text-danger border border-line text-[11px]">
                  SQLSTATE: {diagnostic.sqlstate}
                </span>
              )}
              <span className="px-1.5 py-0.5 rounded text-warning border border-line text-[11px]">
                {diagnostic.category}
              </span>
            </div>
            <div className="mt-1.5 whitespace-pre-wrap text-danger select-text">
              {diagnostic.original_error}
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          {canRetryDirect && (
            <button
              onClick={onRetryDirect}
              disabled={isRetryingDirect}
              title={t("sqlError.retryDirectTooltip")}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-accent text-accent-fg hover:opacity-90 rounded text-xs font-semibold shadow-sm transition-all disabled:opacity-60"
            >
              {isRetryingDirect ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowLeftRight className="w-3.5 h-3.5" />
              )}
              <span>{t("sqlError.retryDirect")}</span>
            </button>
          )}
          {canRetryUnlimited && onRetryUnlimited && (
            <button
              onClick={onRetryUnlimited}
              title={t("sqlError.retryUnlimitedTooltip")}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-accent text-accent-fg hover:opacity-90 rounded text-xs font-semibold transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t("sqlError.retryUnlimited")}</span>
            </button>
          )}
          <button
            onClick={() => {
              if (!diagnostic.original_error) return;
              navigator.clipboard.writeText(diagnostic.original_error).then(
                () => {
                  setIsCopiedError(true);
                  setTimeout(() => setIsCopiedError(false), 2000);
                },
                (err) => reportError(t("sqlError.copyErrorTitle"), err),
              );
            }}
            title={t("sqlError.copyTooltip")}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-elevated hover:bg-hover text-fg hover:text-fg border border-line-strong rounded text-xs font-medium transition-colors"
          >
            {isCopiedError ? (
              <>
                <Check className="w-3.5 h-3.5 text-success" />
                <span className="text-success">{t("sqlError.copied")}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-fg-muted" />
                <span>{t("sqlError.copyError")}</span>
              </>
            )}
          </button>

          <button
            onClick={onFixWithAi}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-raised hover:bg-hover text-fg rounded text-xs font-semibold shadow-sm transition-all"
          >
            <Bug className="w-3.5 h-3.5" />
            <span>{t("sqlError.fixWithAi")}</span>
          </button>
        </div>
      </div>

      {diagnostic.suggested_action && (
        <div className="p-2.5 bg-surface border border-line rounded flex items-start space-x-2 text-warning">
          <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-fg-muted" />
          <div>
            <span className="font-semibold text-warning">{t("sqlError.suggestedAction")}</span>
            <span>{diagnostic.suggested_action}</span>
          </div>
        </div>
      )}
    </div>
  );
}
