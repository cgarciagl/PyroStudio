import { useEffect, useMemo, useState } from "react";
import { Activity, Check, Copy, Loader2, RefreshCw, Search, Unplug, XOctagon } from "lucide-react";
import type { ServerSlowQueriesReport } from "../../types/database";
import { dbService } from "../../services/tauriDb";
import { useUIStore } from "../../stores/uiStore";
import { ConfirmModal } from "../ConfirmModal";
import { EmptyState } from "../ui/Modal";
import { dangerGhostBtn, ghostBtn, iconBtn, inputClass, tabClass } from "../ui/styles";
import { errorText, reportError } from "../../utils/errors";
import { formatSeconds, matchesFilter } from "./format";

type SubTab = "digest" | "slow_log" | "processlist";

interface ServerActivityProps {
  database: string;
  /** Analyze a statement in the EXPLAIN view. */
  onExplain: (sql: string) => void;
}

interface PendingKill {
  id: number;
  type: "QUERY" | "CONNECTION";
  info: string;
  user: string;
}

const SETUP_SQL =
  "SET GLOBAL slow_query_log = 'ON';\nSET GLOBAL log_output = 'TABLE';\nSET GLOBAL long_query_time = 1.0; -- consultas de más de 1 s";

function RowActions({ sql, onExplain, children }: { sql: string; onExplain: (s: string) => void; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-end gap-0.5">
      <button type="button" onClick={() => onExplain(sql)} title="Analizar el plan con EXPLAIN" className={`${ghostBtn} px-2 py-0.5 text-[11px]`}>
        <Activity className="w-3 h-3" /> EXPLAIN
      </button>
      <button
        type="button"
        aria-label="Copiar SQL"
        title="Copiar SQL"
        onClick={() =>
          navigator.clipboard.writeText(sql).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            },
            (err) => reportError("No se pudo copiar el SQL", err),
          )
        }
        className={iconBtn}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {children}
    </div>
  );
}

const th = "py-2 px-3 font-medium text-[11px] text-fg-muted whitespace-nowrap";
const td = "py-2 px-3 align-top";
/** Numbers never wrap (narrow windows scroll the table instead). */
const num = "text-right font-mono tabular-nums whitespace-nowrap";

/**
 * What the server says about slow statements: slow log configuration, Performance
 * Schema digest, mysql.slow_log and the statements running now (with KILL).
 */
export function ServerActivity({ database, onExplain }: ServerActivityProps) {
  const [report, setReport] = useState<ServerSlowQueriesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<SubTab>("digest");
  const [filter, setFilter] = useState("");
  const [pendingKill, setPendingKill] = useState<PendingKill | null>(null);

  const load = async (pickTab = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await dbService.getServerSlowQueries(database);
      setReport(res);
      setUpdatedAt(new Date());
      // First load: open the list that actually has rows.
      if (pickTab) {
        if (res.slow_log_entries.length > 0) setTab("slow_log");
        else if (res.performance_digest_entries.length > 0) setTab("digest");
        else if (res.running_queries.length > 0) setTab("processlist");
      }
    } catch (err: unknown) {
      setError(errorText(err, "Error al consultar el registro de consultas lentas del servidor"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database]);

  const confirmKill = async () => {
    if (!pendingKill) return;
    try {
      const msg = await dbService.executeKillProcess(pendingKill.id, pendingKill.type);
      useUIStore.getState().showAlert({ title: "Operación ejecutada en el servidor", message: msg, variant: "info", icon: "info" });
      setPendingKill(null);
      await load();
    } catch (err: unknown) {
      reportError("No se pudo terminar el proceso", err);
    }
  };

  const threshold = report?.long_query_time ?? Infinity;
  /** Data-encoding color: only times over the server's own threshold stand out. */
  const slow = (sec: number) => (sec >= threshold ? "text-warning" : "text-fg");

  const digest = useMemo(
    () => report?.performance_digest_entries.filter((e) => matchesFilter(filter, e.digest_text, e.schema_name)) ?? [],
    [report, filter],
  );
  const slowLog = useMemo(
    () => report?.slow_log_entries.filter((e) => matchesFilter(filter, e.sql_text, e.user_host)) ?? [],
    [report, filter],
  );
  const running = useMemo(
    () => report?.running_queries.filter((p) => matchesFilter(filter, p.info, p.user, p.db)) ?? [],
    [report, filter],
  );

  const needsSetup = report && (!report.is_slow_log_enabled || !report.log_output.includes("TABLE"));
  const counts: Record<SubTab, number> = {
    digest: report?.performance_digest_entries.length ?? 0,
    slow_log: report?.slow_log_entries.length ?? 0,
    processlist: report?.running_queries.length ?? 0,
  };
  const emptyRow = (cols: number, text: string) => (
    <tr>
      <td colSpan={cols} className="py-8 px-4 text-center text-xs text-fg-muted">
        {filter.trim() ? "Ninguna fila coincide con el filtro." : text}
      </td>
    </tr>
  );

  return (
    <section data-slow-query-server className="space-y-3 min-w-0">
      {report && (
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${report.is_slow_log_enabled ? "bg-success" : "bg-warning"}`} />
            <dt className="text-fg-muted">Registro de lentas</dt>
            <dd className="text-fg">
              {report.is_slow_log_enabled ? "activo" : "inactivo"} <span className="text-fg-subtle">· {report.log_output}</span>
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-fg-muted">Umbral</dt>
            <dd className="font-mono tabular-nums text-fg">{report.long_query_time} s</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-fg-muted">Lentas desde el arranque</dt>
            <dd className="font-mono tabular-nums text-fg">{report.total_server_slow_queries_count.toLocaleString()}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-fg-muted">Consultas sin índice</dt>
            <dd className="text-fg">{report.log_queries_not_using_indexes ? "se registran" : "no se registran"}</dd>
          </div>
        </dl>
      )}

      {needsSetup && (
        <details className="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
          <summary className="cursor-pointer text-fg">
            El registro de consultas lentas no guarda cada consulta en una tabla. Mientras tanto se usan Performance
            Schema y los procesos activos. <span className="text-accent-text">Cómo activarlo</span>
          </summary>
          <div className="mt-2 space-y-2 text-fg-muted">
            <p>
              Con privilegios de administrador, guarde cada consulta lenta en <code className="font-mono text-fg">mysql.slow_log</code>:
            </p>
            <pre className="m-0 p-2.5 rounded-md bg-canvas border border-line font-mono text-[11px] text-fg whitespace-pre-wrap select-text">{SETUP_SQL}</pre>
          </div>
        </details>
      )}

      {error && (
        <p role="alert" className="text-xs text-fg">
          <span className="text-danger font-medium">No se pudo leer la actividad del servidor.</span>{" "}
          <span className="text-fg-muted">{error}</span>
        </p>
      )}

      <div data-slow-query-controls className="flex flex-wrap items-end justify-between gap-2 border-b border-line">
        <div role="tablist" className="flex items-center gap-1 -mb-px overflow-x-auto">
          {(
            [
              ["digest", "Resumen por patrón"],
              ["slow_log", "mysql.slow_log"],
              ["processlist", "En ejecución"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={tabClass(tab === id)}>
              {label} <span className="tabular-nums text-fg-subtle">{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 pb-1.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrar por SQL, usuario o BD"
              aria-label="Filtrar"
              className={`${inputClass} pl-8 w-56`}
            />
          </div>
          {updatedAt && (
            <span className="text-[11px] text-fg-subtle tabular-nums hidden md:inline" title="Última lectura del servidor">
              {updatedAt.toLocaleTimeString()}
            </span>
          )}
          <button type="button" onClick={() => load()} disabled={loading} aria-label="Actualizar" title="Volver a leer del servidor" className={iconBtn}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading && !report ? (
        <EmptyState icon={<Loader2 className="w-5 h-5 animate-spin" />} title="Leyendo la actividad del servidor…" />
      ) : (
        <div data-slow-query-table className="overflow-x-auto">
          {tab === "digest" && (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Patrón de consulta</th>
                  <th className={`${th} text-right`}>Ejecuciones</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Promedio</th>
                  <th className={`${th} text-right`}>Máximo</th>
                  <th className={`${th} text-right`}>Filas examinadas</th>
                  <th className={`${th} text-right`}>Sin índice</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {digest.length === 0
                  ? emptyRow(8, "Performance Schema no registra eventos o está desactivado en el servidor.")
                  : digest.map((e, i) => (
                      <tr key={i} className="hover:bg-hover">
                        <td className={`${td} max-w-md`}>
                          <div className="font-mono text-fg truncate" title={e.digest_text}>
                            {e.digest_text}
                          </div>
                          {e.schema_name && <div className="text-[11px] text-fg-subtle">{e.schema_name}</div>}
                        </td>
                        <td className={`${td} ${num}`}>{e.exec_count.toLocaleString()}</td>
                        <td className={`${td} ${num}`}>{formatSeconds(e.sum_timer_wait_sec)}</td>
                        <td className={`${td} ${num} ${slow(e.avg_timer_wait_sec)}`}>{formatSeconds(e.avg_timer_wait_sec)}</td>
                        <td className={`${td} ${num} ${slow(e.max_timer_wait_sec)}`}>{formatSeconds(e.max_timer_wait_sec)}</td>
                        <td className={`${td} ${num} text-fg-muted`}>{e.sum_rows_examined.toLocaleString()}</td>
                        <td className={`${td} ${num} ${e.sum_no_index_used > 0 ? "text-warning" : "text-fg-subtle"}`}>
                          {e.sum_no_index_used.toLocaleString()}
                        </td>
                        <td className={td}>
                          <RowActions sql={e.digest_text} onExplain={onExplain} />
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          )}

          {tab === "slow_log" && (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Inicio</th>
                  <th className={th}>Usuario</th>
                  <th className={`${th} text-right`}>Duración</th>
                  <th className={`${th} text-right`}>Bloqueo</th>
                  <th className={`${th} text-right`}>Filas examinadas</th>
                  <th className={th}>Consulta</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {slowLog.length === 0
                  ? emptyRow(7, "mysql.slow_log está vacía. Requiere log_output = 'TABLE'.")
                  : slowLog.map((e, i) => (
                      <tr key={i} className="hover:bg-hover">
                        <td className={`${td} whitespace-nowrap text-fg-muted tabular-nums`}>{e.start_time}</td>
                        <td className={`${td} max-w-[12rem] truncate text-fg-muted`} title={e.user_host}>
                          {e.user_host}
                        </td>
                        <td className={`${td} ${num} ${slow(e.query_time_seconds)}`}>{formatSeconds(e.query_time_seconds)}</td>
                        <td className={`${td} ${num} text-fg-muted`}>{formatSeconds(e.lock_time_seconds)}</td>
                        <td className={`${td} ${num} text-fg-muted`}>{e.rows_examined.toLocaleString()}</td>
                        <td className={`${td} max-w-sm`}>
                          <div className="font-mono text-fg truncate" title={e.sql_text}>
                            {e.sql_text}
                          </div>
                        </td>
                        <td className={td}>
                          <RowActions sql={e.sql_text} onExplain={onExplain} />
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          )}

          {tab === "processlist" && (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Proceso</th>
                  <th className={th}>Usuario</th>
                  <th className={th}>Base de datos</th>
                  <th className={`${th} text-right`}>En curso</th>
                  <th className={th}>Estado</th>
                  <th className={th}>Consulta</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {running.length === 0
                  ? emptyRow(7, "No hay consultas lentas ejecutándose en este momento.")
                  : running.map((p) => (
                      <tr key={p.id} className="hover:bg-hover">
                        <td className={`${td} font-mono tabular-nums text-fg-muted`}>{p.id}</td>
                        <td className={`${td} text-fg-muted whitespace-nowrap`}>
                          {p.user}@{p.host}
                        </td>
                        <td className={`${td} font-mono text-fg-muted`}>{p.db || "—"}</td>
                        <td className={`${td} ${num} ${slow(p.time_seconds)}`}>{formatSeconds(p.time_seconds)}</td>
                        <td className={`${td} text-fg-muted`}>{p.state || "Ejecutando"}</td>
                        <td className={`${td} max-w-sm`}>
                          <div className="font-mono text-fg truncate" title={p.info}>
                            {p.info}
                          </div>
                        </td>
                        <td className={td}>
                          <RowActions sql={p.info} onExplain={onExplain}>
                            <button
                              type="button"
                              aria-label={`Interrumpir la consulta del proceso ${p.id}`}
                              title="Interrumpir la consulta (KILL QUERY): la sesión sigue abierta"
                              onClick={() => setPendingKill({ id: Number(p.id), type: "QUERY", info: p.info, user: `${p.user}@${p.host}` })}
                              className={dangerGhostBtn}
                            >
                              <XOctagon className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Terminar la sesión ${p.id}`}
                              title="Terminar la sesión (KILL CONNECTION): revierte sus transacciones"
                              onClick={() => setPendingKill({ id: Number(p.id), type: "CONNECTION", info: p.info, user: `${p.user}@${p.host}` })}
                              className={dangerGhostBtn}
                            >
                              <Unplug className="w-3.5 h-3.5" />
                            </button>
                          </RowActions>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {pendingKill && (
        <ConfirmModal
          isOpen
          title={pendingKill.type === "QUERY" ? `Interrumpir la consulta del proceso ${pendingKill.id}` : `Terminar la sesión ${pendingKill.id}`}
          message={
            pendingKill.type === "QUERY"
              ? `Se detendrá la consulta de ${pendingKill.user}; su conexión seguirá abierta.`
              : `Se desconectará a ${pendingKill.user} y se revertirán sus transacciones abiertas.`
          }
          details={`${pendingKill.info ? `SQL: ${pendingKill.info}\n\n` : ""}Requiere el privilegio PROCESS o SUPER.`}
          confirmText={pendingKill.type === "QUERY" ? "Interrumpir consulta" : "Terminar sesión"}
          variant="danger"
          onConfirm={confirmKill}
          onClose={() => setPendingKill(null)}
        />
      )}
    </section>
  );
}
