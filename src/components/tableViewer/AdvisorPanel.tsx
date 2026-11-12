import React from "react";
import { InspectorLoading } from "./InspectorLoading";
import { AlertCircle, Check, CheckCircle2, Copy, FileCode2, Link as LinkIcon, Play, Zap } from "lucide-react";
import { primaryBtn } from "../ui/styles";
import type { DbEngine, IndexAdvisorReport } from "../../types/database";
import { useUIStore } from "../../stores/uiStore";
import { reportError } from "../../utils/errors";
import { uid } from "../../utils/uid";

/** Script opened in a query tab; USE only exists in MySQL/MariaDB. */
export function proposalScript(database: string, tableName: string, sql: string, engine: DbEngine): string {
  const header = `-- Propuesta generada por el Asesor de Índices para '${database}.${tableName}'\n`;
  const use = engine === "sqlite" ? "" : `USE \`${database.replace(/`/g, "``")}\`;\n`;
  return `${header}${use}${sql}\n`;
}

interface AdvisorPanelProps {
  database: string;
  tableName: string;
  engine: DbEngine;
  isLoading: boolean;
  report: IndexAdvisorReport | null;
  /** Indexes of the table, when already loaded. */
  indexCount?: number;
  onShowScript: () => void;
}

/** Index advice for one table: summary, recommendations and their SQL. */
export function AdvisorPanel({ database, tableName, engine, isLoading, report, indexCount, onShowScript }: AdvisorPanelProps) {
  const [copiedAdvisorSql, setCopiedAdvisorSql] = React.useState<string | null>(null);
  return (
    isLoading ? (
      <InspectorLoading label={`Analizando índices y restricciones de '${tableName}'...`} />
    ) : report ? (
      <div className="space-y-6">
        {/* Header summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-surface border border-line flex items-center justify-between">
            <div>
              <span className="text-xs text-fg-muted font-medium">Índices Analizados</span>
              <h3 className="text-lg font-semibold text-fg font-mono mt-1">
                {indexCount ?? "—"}
              </h3>
            </div>
            <div className="w-9 h-9 rounded-lg bg-raised border border-line flex items-center justify-center text-fg-muted">
              <Zap className="w-4 h-4" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-line flex items-center justify-between">
            <div>
              <span className="text-xs text-fg-muted font-medium">Índices Redundantes</span>
              <h3 className={`text-lg font-semibold font-mono mt-1 ${
                (report.redundant_indexes_count ?? 0) > 0 ? "text-warning" : "text-success"
              }`}>
                {report.redundant_indexes_count ?? 0}
              </h3>
            </div>
            <div className="w-9 h-9 rounded-lg border border-line flex items-center justify-center text-warning">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-line flex items-center justify-between">
            <div>
              <span className="text-xs text-fg-muted font-medium">FKs sin Indexar</span>
              <h3 className={`text-lg font-semibold font-mono mt-1 ${
                (report.missing_indexes_count ?? 0) > 0 ? "text-accent-text" : "text-success"
              }`}>
                {report.missing_indexes_count ?? 0}
              </h3>
            </div>
            <div className="w-9 h-9 rounded-lg bg-accent-soft border border-accent/30 flex items-center justify-center text-accent-text">
              <LinkIcon className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Recommendations List */}
        {(!report.recommendations || report.recommendations.length === 0) ? (
          <div className="p-8 text-center bg-surface border border-line rounded-xl space-y-2">
            <CheckCircle2 className="w-8 h-8 text-success mx-auto" />
            <h4 className="text-sm font-semibold text-success">
              ¡Esquema de Índices Optimizado!
            </h4>
            <p className="text-xs text-fg-muted max-w-md mx-auto">
              No se detectaron índices redundantes ni claves foráneas sin indexar en la tabla <code className="text-accent-text font-mono">{tableName}</code>.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-fg font-mono">
                Recomendaciones ({report.recommendations.length})
              </h4>
              <button onClick={() => onShowScript()} className={primaryBtn}>
                <FileCode2 className="w-3.5 h-3.5" />
                <span>Script SQL con todas</span>
              </button>
            </div>

          {report.recommendations.map((rec, idx) => (
            <div
              key={idx}
              className="p-4 rounded-xl bg-surface border border-line space-y-3 shadow-md"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono ${
                      rec.is_redundant
                        ? "text-warning border border-line"
                        : "bg-raised text-fg border border-line"
                    }`}
                  >
                    {rec.is_redundant ? "Índice Redundante" : "Falta Índice en FK"}
                  </span>
                  <span className="text-sm font-bold text-fg font-mono">
                    {rec.recommendation}
                  </span>
                </div>
              </div>

              <p className="text-xs text-fg leading-relaxed">
                {rec.reason}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-fg-muted font-mono">
                <div className="p-2 rounded bg-surface border border-line">
                  <strong className="text-success">Beneficio estimado:</strong> {rec.estimated_benefit}
                </div>
                <div className="p-2 rounded bg-surface border border-line">
                  <strong className="text-fg">Costo potencial:</strong> {rec.potential_cost}
                </div>
              </div>

              {/* Proposed SQL */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-fg-subtle font-mono">
                  Propuesta SQL:
                </span>
                <div className="p-3 bg-canvas border border-line rounded-lg flex items-center justify-between gap-3 font-mono text-xs text-accent-text">
                  <span className="truncate">{rec.sql_proposal}</span>
                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(rec.sql_proposal).then(
                          () => {
                            setCopiedAdvisorSql(rec.sql_proposal);
                            setTimeout(() => setCopiedAdvisorSql(null), 2000);
                          },
                          (err) => reportError("No se pudo copiar el SQL", err),
                        );
                      }}
                      className="flex items-center space-x-1 px-2.5 py-1 bg-raised hover:bg-hover border border-line rounded text-fg hover:text-fg transition-colors text-[11px]"
                    >
                      {copiedAdvisorSql === rec.sql_proposal ? (
                        <>
                          <Check className="w-3 h-3 text-success" />
                          <span className="text-success">¡Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        useUIStore.getState().openTab({
                          id: `query-${uid()}`,
                          title: `Optimizar ${tableName}`,
                          type: "query",
                          database,
                          queryContent: proposalScript(database, tableName, rec.sql_proposal, engine),
                        });
                      }}
                      className="flex items-center space-x-1 px-2.5 py-1 bg-accent-soft hover:bg-hover border border-accent/40 rounded text-accent-text font-semibold transition-colors text-[11px]"
                    >
                      <Play className="w-3 h-3" />
                      <span>Abrir en Consulta</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : (
    <div className="p-8 text-center text-fg-subtle font-mono text-xs bg-surface border border-line rounded-lg">
      No se pudo obtener el informe de índices.
    </div>
  )
  );
}
