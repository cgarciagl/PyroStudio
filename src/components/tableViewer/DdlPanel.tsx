import React from "react";
import { CheckCircle2, Copy } from "lucide-react";
import { reportError } from "../../utils/errors";
import { InspectorLoading } from "./InspectorLoading";

interface DdlPanelProps {
  isLoading: boolean;
  ddl?: string | null;
}

/** CREATE statement of the table, with copy. */
export function DdlPanel({ isLoading, ddl }: DdlPanelProps) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    if (!ddl) return;
    navigator.clipboard.writeText(ddl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      },
      (err) => reportError("No se pudo copiar el DDL", err),
    );
  };
  return (
  isLoading ? (
    <InspectorLoading label="Generando DDL (SHOW CREATE TABLE)..." />
  ) : ddl ? (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted font-mono">
          Definición SQL generada por el motor:
        </span>
        <button
          onClick={copy}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-raised hover:bg-hover text-fg border border-line rounded text-xs font-semibold transition-colors"
        >
          {copied ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              <span className="text-success">¡DDL Copiado!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copiar DDL</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 bg-canvas border border-line rounded-lg text-success font-mono text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner">
        {ddl}
      </pre>
    </div>
  ) : (
    <div className="p-8 text-center text-fg-subtle font-mono text-xs">
      No se pudo obtener el DDL de la tabla.
    </div>
  )
  );
}
