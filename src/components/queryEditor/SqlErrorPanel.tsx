import { Loader2, AlertCircle, Check, Copy, Bug, Lightbulb, ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import type { SqlDiagnosticResult } from "../../types/database";
import { reportError } from "../../utils/errors";

interface SqlErrorPanelProps {
  diagnostic: SqlDiagnosticResult;
  /** Offer a retry over a direct connection (tunnel timeouts). */
  canRetryDirect: boolean;
  isRetryingDirect: boolean;
  onRetryDirect: () => void;
  onFixWithAi: () => void;
}

/** Diagnosed SQL error with code, category, suggestion and recovery actions. */
export function SqlErrorPanel({ diagnostic, canRetryDirect, isRetryingDirect, onRetryDirect, onFixWithAi }: SqlErrorPanelProps) {
  const [isCopiedError, setIsCopiedError] = useState(false);
  return (
    <div className="p-4 m-4 rounded-lg border border-line text-danger text-xs font-mono space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start space-x-2.5">
          <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-danger flex flex-wrap items-center gap-2">
              <span>Error en la sentencia SQL</span>
              {diagnostic.error_code && (
                <span className="px-1.5 py-0.5 rounded text-danger border border-line text-[11px]">
                  Código: {diagnostic.error_code}
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
              title="Cambia esta sesión a conexión directa y vuelve a ejecutar la consulta sin límite de tiempo"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-accent text-accent-fg hover:opacity-90 rounded text-xs font-semibold shadow-sm transition-all disabled:opacity-60"
            >
              {isRetryingDirect ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowLeftRight className="w-3.5 h-3.5" />
              )}
              <span>Reintentar con conexión directa</span>
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
                (err) => reportError("No se pudo copiar el error", err),
              );
            }}
            title="Copiar mensaje técnico del error al portapapeles"
            className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-elevated hover:bg-hover text-fg hover:text-fg border border-line-strong rounded text-xs font-medium transition-colors"
          >
            {isCopiedError ? (
              <>
                <Check className="w-3.5 h-3.5 text-success" />
                <span className="text-success">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-fg-muted" />
                <span>Copiar Error</span>
              </>
            )}
          </button>

          <button
            onClick={onFixWithAi}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-raised hover:bg-hover text-fg rounded text-xs font-semibold shadow-sm transition-all"
          >
            <Bug className="w-3.5 h-3.5" />
            <span>Corregir con IA</span>
          </button>
        </div>
      </div>

      {diagnostic.suggested_action && (
        <div className="p-2.5 bg-surface border border-line rounded flex items-start space-x-2 text-warning">
          <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-fg-muted" />
          <div>
            <span className="font-semibold text-warning">Sugerencia recomendada: </span>
            <span>{diagnostic.suggested_action}</span>
          </div>
        </div>
      )}
    </div>
  );
}
