import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, Play, RefreshCw } from "lucide-react";
import { useIsLightTheme } from "../../stores/preferenceStore";
import { ghostBtn, primaryBtn, sectionLabel } from "../ui/styles";
import { QueryPlanViewer } from "../QueryPlanViewer";
import type { ExplainAnalysis } from "./useExplainAnalysis";

/**
 * Write or paste a query, run EXPLAIN, read the diagnosis and the plan. The editor and
 * the plan are the content; the summary is one line, not a row of cards.
 */
export function ExplainAnalyzer({ query, setQuery, analysis, fromCache, isLoading, error, analyze }: ExplainAnalysis) {
  const isLight = useIsLightTheme();
  const canRun = !isLoading && !!query.trim();

  return (
    <section data-slow-query-explain className="space-y-4 min-w-0">
      <div data-slow-query-editor className="rounded-lg border border-line bg-surface overflow-hidden">
        <div className="px-3 py-2 border-b border-line flex items-center gap-2">
          <span className={sectionLabel}>Consulta a analizar</span>
          <span className="ml-auto flex items-center gap-1.5">
            {analysis && fromCache && (
              <span className="text-[11px] text-fg-muted" title="El plan se reutilizó de la caché (60 s)">
                Plan en caché
              </span>
            )}
            {analysis && (
              <button
                type="button"
                onClick={() => analyze(undefined, true)}
                disabled={!canRun}
                title="Volver a pedir el plan al motor, sin caché"
                className={ghostBtn}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} /> Volver a analizar
              </button>
            )}
            <button type="button" onClick={() => analyze()} disabled={!canRun} title="Analizar (Ctrl+Enter)" className={primaryBtn}>
              {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              Analizar
            </button>
          </span>
        </div>
        <div
          className="bg-canvas"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canRun) {
              e.preventDefault();
              analyze();
            }
          }}
        >
          <CodeMirror
            value={query}
            minHeight="96px"
            maxHeight="240px"
            theme={isLight ? "light" : "dark"}
            extensions={[sqlLang()]}
            onChange={setQuery}
            className="text-xs font-mono"
            aria-label="Consulta SQL a analizar"
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="px-3 py-2.5 rounded-lg border border-line flex items-start gap-2 text-xs">
          <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium text-fg">No se pudo obtener el plan</p>
            <p className="text-fg-muted break-words select-text">{error}</p>
          </div>
        </div>
      )}

      {!analysis && !error && !isLoading && (
        <p className="text-xs text-fg-muted">
          Escriba o pegue una consulta y pulse <span className="text-fg">Analizar</span> (Ctrl+Enter). También puede
          elegir una de la pestaña <span className="text-fg">Actividad del servidor</span>.
        </p>
      )}

      {analysis && (
        <div data-slow-query-results className="space-y-4 min-w-0">
          {/* Summary: one line of facts, color only where it means something. */}
          <dl className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-fg-muted">Filas estimadas</dt>
              <dd className="font-mono tabular-nums text-fg">~{analysis.estimated_total_rows.toLocaleString()}</dd>
            </div>
            <div className="flex items-baseline gap-1.5 min-w-0">
              <dt className="text-fg-muted">Join</dt>
              <dd className="font-mono text-fg truncate">{analysis.join_strategy || "Acceso a una sola tabla"}</dd>
            </div>
            <div className="flex items-baseline gap-1.5 min-w-0">
              <dt className="text-fg-muted">Índices</dt>
              <dd className="font-mono text-fg truncate" title={analysis.indexes_involved.join(", ")}>
                {analysis.indexes_involved.length ? analysis.indexes_involved.join(", ") : "ninguno"}
              </dd>
            </div>
          </dl>

          {/* Diagnosis first: what is wrong and what to do about it. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
            <div className="space-y-1.5">
              <h3 className={sectionLabel}>
                Cuellos de botella <span className="tabular-nums">({analysis.bottlenecks.length})</span>
              </h3>
              {analysis.bottlenecks.length === 0 ? (
                <p className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" /> Sin problemas de rendimiento detectados.
                </p>
              ) : (
                <ul className="space-y-1 text-xs text-fg">
                  {analysis.bottlenecks.map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-1.5">
              <h3 className={sectionLabel}>Recomendaciones</h3>
              {analysis.potential_optimizations.length === 0 ? (
                <p className="text-xs text-fg-muted">Nada que sugerir para este plan.</p>
              ) : (
                <ul className="space-y-1 text-xs text-fg list-disc pl-4 marker:text-fg-subtle">
                  {analysis.potential_optimizations.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* The diagnosis is shown above: the viewer gets only the plan (it was duplicated). */}
          <div className="border border-line rounded-lg overflow-hidden bg-surface min-h-[400px] flex flex-col">
            <QueryPlanViewer
              planRows={analysis.execution_plan}
              jsonPlan={analysis.json_plan}
              treePlan={analysis.tree_plan}
              visualNodes={analysis.visual_nodes}
              querySql={query}
              initialTab="tree"
            />
          </div>
        </div>
      )}
    </section>
  );
}
