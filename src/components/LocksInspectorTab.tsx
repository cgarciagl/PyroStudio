import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GitFork,
  Info,
  List,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
  XCircle,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { useConnectionStore } from "../stores/connectionStore";
import { useUIStore } from "../stores/uiStore";
import type {
  ActiveTransactionEntry,
  KillThreadMode,
  LocksAndTransactionsReport,
  LockTreeNode,
} from "../types/database";
import { errorText } from "../utils/errors";
import { DatabaseScopeBar } from "./ui/DatabaseScopeBar";
import { EmptyState, Spinner } from "./ui/Modal";
import {
  cardClass,
  dangerGhostBtn,
  ghostBtn,
  inputClass,
  primaryBtn,
  sectionLabel,
  selectClass,
  tabClass,
} from "./ui/styles";

interface LocksInspectorTabProps {
  database: string;
}

type ViewMode = "tree" | "table";
type SortField = "duration" | "state" | "isolation" | "rows_locked";
type SortDirection = "asc" | "desc";

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

export function sortTransactions(
  entries: ActiveTransactionEntry[],
  field: SortField,
  direction: SortDirection,
): ActiveTransactionEntry[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "duration":
        cmp = a.duration_seconds - b.duration_seconds;
        break;
      case "state":
        cmp = (a.trx_state || a.process_state || "").localeCompare(
          b.trx_state || b.process_state || "",
        );
        break;
      case "isolation":
        cmp = (a.isolation_level || "").localeCompare(b.isolation_level || "");
        break;
      case "rows_locked":
        cmp = a.rows_locked - b.rows_locked;
        break;
    }
    if (cmp !== 0) return cmp * factor;
    return a.thread_id - b.thread_id;
  });
}

export const LocksInspectorTab: React.FC<LocksInspectorTabProps> = ({ database }) => {
  const environment = useConnectionStore((s) => s.connectionStatus.config?.environment);
  const isProdOrStaging = environment === "production" || environment === "staging";

  const [report, setReport] = useState<LocksAndTransactionsReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [autoRefreshSec, setAutoRefreshSec] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("duration");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [collapsedNodes, setCollapsedNodes] = useState<Record<number, boolean>>({});
  const [killingKey, setKillingKey] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const loadLocks = useCallback(async (background = false) => {
    if (background && isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (background) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);
    try {
      const data = await dbService.getActiveLocksAndTransactions();
      setReport(data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadLocks(false);
  }, [loadLocks]);

  useEffect(() => {
    if (autoRefreshSec <= 0) return;
    const timer = window.setInterval(() => {
      loadLocks(true);
    }, autoRefreshSec * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshSec, loadLocks]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const toggleCollapse = (threadId: number) => {
    setCollapsedNodes((prev) => ({ ...prev, [threadId]: !prev[threadId] }));
  };

  const requestKillThread = (
    threadId: number,
    mode: KillThreadMode,
    user: string,
    sqlText: string,
  ) => {
    const sqlPreview = mode === "query" ? `KILL QUERY ${threadId}` : `KILL ${threadId}`;
    const actionLabel = mode === "query" ? "Terminar consulta" : "Cerrar conexión";
    const envNotice = isProdOrStaging
      ? `\n\nEntorno ${environment?.toUpperCase()}: esta acción afectará al servidor en vivo.`
      : "";
    const snippet = sqlText.trim() ? `SQL: ${sqlText.trim().slice(0, 180)}` : "";

    useUIStore.getState().showConfirm({
      title: `${actionLabel} (hilo #${threadId})`,
      message: `¿Confirmas ejecutar ${sqlPreview} sobre la sesión de ${user || "usuario"}?${
        mode === "connection"
          ? " Se cerrará la conexión y se revertirá cualquier transacción sin confirmar."
          : " Se cancelará únicamente la sentencia en ejecución."
      }${envNotice}`,
      details: snippet || undefined,
      confirmText: actionLabel,
      variant: "danger",
      icon: "alert",
      onConfirm: async () => {
        const key = `${mode}-${threadId}`;
        setKillingKey(key);
        try {
          await dbService.killServerThread(threadId, mode);
          await loadLocks(true);
        } catch (err) {
          useUIStore.getState().showAlert({
            title: "Error al terminar hilo",
            message: errorText(err),
            variant: "danger",
            icon: "alert",
          });
        } finally {
          setKillingKey(null);
        }
      },
    });
  };

  const filteredTransactions = useMemo(() => {
    if (!report) return [];
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? report.transactions.filter(
          (tx) =>
            String(tx.thread_id).includes(q) ||
            tx.user.toLowerCase().includes(q) ||
            tx.host.toLowerCase().includes(q) ||
            (tx.db || "").toLowerCase().includes(q) ||
            (tx.trx_state || "").toLowerCase().includes(q) ||
            (tx.process_state || "").toLowerCase().includes(q) ||
            (tx.locked_table || "").toLowerCase().includes(q) ||
            tx.sql_text.toLowerCase().includes(q),
        )
      : report.transactions;
    return sortTransactions(list, sortField, sortDirection);
  }, [report, searchQuery, sortField, sortDirection]);

  if (isLoading && !report) {
    return (
      <div className="pyro-view pyro-locks flex-1 flex flex-col bg-canvas min-h-0" data-locks-view>
        <div className="px-6 pt-5 pb-3 border-b border-line bg-surface">
          <DatabaseScopeBar database={database} tool="Inspector de bloqueos" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <Spinner />
          <span className="text-xs text-fg-muted">
            Inspeccionando bloqueos y transacciones activas...
          </span>
        </div>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="pyro-view pyro-locks flex-1 flex flex-col bg-canvas min-h-0" data-locks-view>
        <div className="px-6 pt-5 pb-3 border-b border-line bg-surface">
          <DatabaseScopeBar database={database} tool="Inspector de bloqueos" />
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <EmptyState
            icon={<AlertTriangle className="w-8 h-8 text-danger" />}
            title="No se pudo inspeccionar la concurrencia"
            description={error}
            action={
              <button onClick={() => loadLocks(false)} className={primaryBtn}>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reintentar</span>
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const renderTreeNode = (node: LockTreeNode, depth = 0): React.ReactNode => {
    const isSelf = report?.current_connection_id === node.thread_id;
    const hasChildren = node.children.length > 0;
    const isCollapsed = Boolean(collapsedNodes[node.thread_id]);
    const isWaiting = Boolean(node.blocking_thread_id);
    const killQueryBusy = killingKey === `query-${node.thread_id}`;
    const killConnBusy = killingKey === `connection-${node.thread_id}`;

    return (
      <div key={`${depth}-${node.thread_id}`} className="space-y-2">
        <div
          className={`${cardClass} p-3 transition-colors ${
            node.is_root_blocker ? "border-warning/50" : isWaiting ? "border-danger/40" : ""
          }`}
          style={{ marginLeft: `${Math.min(depth, 6) * 24}px` }}
          data-lock-node={node.thread_id}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleCollapse(node.thread_id)}
                  className="mt-0.5 p-0.5 rounded text-fg-muted hover:text-fg hover:bg-hover"
                  aria-label={isCollapsed ? "Expandir dependientes" : "Colapsar dependientes"}
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-4.5 shrink-0" />
              )}

              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                      node.is_root_blocker
                        ? "bg-warning"
                        : isWaiting
                          ? "bg-danger"
                          : "bg-fg-subtle"
                    }`}
                  />
                  <span className="font-mono font-semibold text-fg tabular-nums">
                    Hilo #{node.thread_id}
                  </span>
                  <span className="text-fg-muted font-medium">
                    {node.is_root_blocker
                      ? "Bloqueador raíz"
                      : isWaiting
                        ? `Esperando a #${node.blocking_thread_id}`
                        : "Transacción"}
                  </span>
                  {isWaiting && (node.other_blocking_thread_ids?.length ?? 0) > 0 && (
                    <span className="text-fg-subtle text-[11px]">
                      (también a {node.other_blocking_thread_ids!.map((id) => `#${id}`).join(", ")})
                    </span>
                  )}
                  {node.trx_state && (
                    <span
                      className={`text-[11px] font-medium ${
                        node.trx_state === "LOCK WAIT" ? "text-danger" : "text-fg-muted"
                      }`}
                    >
                      · {node.trx_state}
                    </span>
                  )}
                  <span className="text-[11px] font-mono text-fg-muted tabular-nums">
                    · {formatDuration(node.duration_seconds)}
                  </span>
                  {node.has_cycle && (
                    <span className="text-[11px] font-medium text-danger inline-flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" />
                      Ciclo / Deadlock detectado
                    </span>
                  )}
                  {isSelf && (
                    <span className="text-[11px] text-accent-text font-medium">
                      (Tu conexión actual)
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
                  <span>
                    Usuario: <strong className="text-fg font-medium">{node.user}</strong>
                    {node.host ? `@${node.host}` : ""}
                  </span>
                  {node.db && (
                    <span>
                      BD: <strong className="text-fg font-medium">{node.db}</strong>
                    </span>
                  )}
                  {node.isolation_level && <span>Aislamiento: {node.isolation_level}</span>}
                  {node.rows_locked > 0 && (
                    <span className="tabular-nums">Filas bloqueadas: {node.rows_locked}</span>
                  )}
                  {node.locked_table && (
                    <span>
                      Tabla: <code className="font-mono text-fg">{node.locked_table}</code>
                      {node.locked_index ? ` (${node.locked_index})` : ""}
                    </span>
                  )}
                  {node.lock_mode && (
                    <span>
                      Modo: <code className="font-mono text-fg">{node.lock_mode}</code>
                      {node.lock_type ? ` / ${node.lock_type}` : ""}
                    </span>
                  )}
                </div>

                {node.sql_text ? (
                  <pre className="text-[11px] font-mono text-fg bg-canvas border border-line rounded px-2.5 py-1.5 overflow-x-auto whitespace-pre-wrap break-all">
                    {node.sql_text}
                  </pre>
                ) : (
                  <p className="text-[11px] text-fg-subtle italic">
                    Sin sentencia SQL activa en curso (transacción abierta en espera de commit/rollback).
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={isSelf || killQueryBusy || killConnBusy}
                onClick={() =>
                  requestKillThread(node.thread_id, "query", node.user, node.sql_text)
                }
                title={
                  isSelf
                    ? "No puedes terminar tu propia conexión actual"
                    : `Terminar consulta (KILL QUERY ${node.thread_id})`
                }
                className={`${dangerGhostBtn} inline-flex items-center gap-1 text-[11px] px-2 py-1 disabled:opacity-40 disabled:pointer-events-none`}
              >
                <Square className="w-3 h-3" />
                <span>Terminar Consulta</span>
              </button>
              <button
                type="button"
                disabled={isSelf || killQueryBusy || killConnBusy}
                onClick={() =>
                  requestKillThread(node.thread_id, "connection", node.user, node.sql_text)
                }
                title={
                  isSelf
                    ? "No puedes cerrar tu propia conexión actual"
                    : `Cerrar conexión (KILL ${node.thread_id})`
                }
                className={`${dangerGhostBtn} inline-flex items-center gap-1 text-[11px] px-2 py-1 disabled:opacity-40 disabled:pointer-events-none`}
              >
                <XCircle className="w-3 h-3" />
                <span>Cerrar Conexión</span>
              </button>
            </div>
          </div>
        </div>

        {hasChildren && !isCollapsed && (
          <div className="space-y-2">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === "asc" ? (
      <ArrowUp className="w-3 h-3 inline ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 inline ml-1" />
    );
  };

  return (
    <div
      className="pyro-view pyro-locks flex-1 flex flex-col bg-canvas min-h-0 overflow-hidden"
      data-locks-view
    >
      {/* Top Toolbar */}
      <div
        className="px-6 pt-5 pb-3 border-b border-line bg-surface shrink-0 space-y-3"
        data-view-toolbar
      >
        <DatabaseScopeBar database={database} tool="Inspector de bloqueos">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Intervalo de actualización automática"
              value={autoRefreshSec}
              onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
              className={`${selectClass} w-auto`}
            >
              <option value={0}>Auto: Pausado</option>
              <option value={3}>Auto: 3s</option>
              <option value={5}>Auto: 5s</option>
              <option value={10}>Auto: 10s</option>
            </select>
            <button
              type="button"
              onClick={() => loadLocks(true)}
              disabled={isRefreshing}
              className={primaryBtn}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              <span>Actualizar</span>
            </button>
          </div>
        </DatabaseScopeBar>

        {/* Sub-navigation Tabs */}
        {!report?.sqlite_info && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1 border-b border-transparent">
              <button
                type="button"
                onClick={() => setViewMode("tree")}
                className={tabClass(viewMode === "tree")}
              >
                <GitFork className="w-3.5 h-3.5 inline mr-1.5" />
                Árbol de contención ({report?.lock_tree.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={tabClass(viewMode === "table")}
              >
                <List className="w-3.5 h-3.5 inline mr-1.5" />
                Transacciones activas ({report?.transactions.length ?? 0})
              </button>
            </div>

            {report && (
              <span className="text-[11px] text-fg-subtle hidden md:inline">
                {report.engine_label} · {report.detection_source}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5 min-h-0">
        {/* Warnings */}
        {report && report.warnings.length > 0 && (
          <div className={`${cardClass} border-warning/40 px-4 py-3 space-y-1`}>
            {report.warnings.map((w, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs text-fg-muted">
                <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* SQLite Mode */}
        {report?.sqlite_info ? (
          <div className="space-y-4 max-w-3xl">
            <div className={`${cardClass} p-4 space-y-3`}>
              <div className="flex items-center justify-between">
                <span className={sectionLabel}>Estado de concurrencia SQLite</span>
                <span
                  className={`text-xs font-medium ${
                    report.sqlite_info.write_lock_active ? "text-danger" : "text-success"
                  }`}
                >
                  {report.sqlite_info.write_lock_active
                    ? "Bloqueo de escritura activo"
                    : "Sin contención de escritura"}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div>
                  <div className="text-[11px] text-fg-muted">Journal mode</div>
                  <div className="text-xs font-mono font-semibold text-fg uppercase">
                    {report.sqlite_info.journal_mode}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-fg-muted">Busy timeout</div>
                  <div className="text-xs font-mono font-semibold text-fg tabular-nums">
                    {report.sqlite_info.busy_timeout_ms} ms
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-fg-muted">Locking mode</div>
                  <div className="text-xs font-mono font-semibold text-fg uppercase">
                    {report.sqlite_info.locking_mode}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-fg-muted">WAL autocheckpoint</div>
                  <div className="text-xs font-mono font-semibold text-fg tabular-nums">
                    {report.sqlite_info.wal_autocheckpoint ?? "—"}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2 pt-2 border-t border-line text-xs text-fg-muted">
                <Info className="w-4 h-4 text-info shrink-0 mt-0.5" />
                <span>{report.sqlite_info.note}</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Compact Metrics Strip */}
            {report && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-locks-summary>
                <div className={`${cardClass} px-4 py-3`}>
                  <div className="text-[11px] text-fg-muted">Transacciones activas</div>
                  <div className="text-lg font-semibold font-mono text-fg tabular-nums mt-0.5">
                    {report.total_active_transactions}
                  </div>
                </div>
                <div className={`${cardClass} px-4 py-3`}>
                  <div className="text-[11px] text-fg-muted">Hilos en espera (LOCK WAIT)</div>
                  <div
                    className={`text-lg font-semibold font-mono tabular-nums mt-0.5 ${
                      report.total_blocked_threads > 0 ? "text-danger" : "text-fg"
                    }`}
                  >
                    {report.total_blocked_threads}
                  </div>
                </div>
                <div className={`${cardClass} px-4 py-3`}>
                  <div className="text-[11px] text-fg-muted">Bloqueadores raíz</div>
                  <div
                    className={`text-lg font-semibold font-mono tabular-nums mt-0.5 ${
                      report.root_blockers_count > 0 ? "text-warning" : "text-fg"
                    }`}
                  >
                    {report.root_blockers_count}
                  </div>
                </div>
              </div>
            )}

            {/* Tree View */}
            {viewMode === "tree" && report && (
              <div className="space-y-3" data-locks-tree>
                {report.lock_tree.length === 0 ? (
                  <EmptyState
                    icon={<Lock className="w-8 h-8 text-success" />}
                    title="Sin bloqueos activos"
                    description={
                      report.total_active_transactions > 0
                        ? `Hay ${report.total_active_transactions} transacción(es) en curso, pero ninguna está bloqueando a otra.`
                        : "No hay contención ni esperas de bloqueo InnoDB en este momento."
                    }
                    action={
                      report.total_active_transactions > 0 ? (
                        <button onClick={() => setViewMode("table")} className={ghostBtn}>
                          Ver transacciones activas
                        </button>
                      ) : undefined
                    }
                  />
                ) : (
                  report.lock_tree.map((root) => renderTreeNode(root, 0))
                )}
              </div>
            )}

            {/* Active Transactions Table */}
            {viewMode === "table" && report && (
              <div className="space-y-3" data-locks-table>
                <div className="flex items-center justify-between gap-3">
                  <div className="relative max-w-sm w-full">
                    <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filtrar por hilo, usuario, tabla o SQL..."
                      className={`${inputClass} pl-8`}
                    />
                  </div>
                  <span className="text-[11px] text-fg-muted tabular-nums">
                    {filteredTransactions.length} de {report.transactions.length}
                  </span>
                </div>

                {filteredTransactions.length === 0 ? (
                  <EmptyState
                    icon={<List className="w-8 h-8 text-fg-subtle" />}
                    title="No hay transacciones activas"
                    description="Ninguna transacción coincide con el filtro actual o no hay transacciones abiertas."
                  />
                ) : (
                  <div className={`${cardClass} overflow-x-auto`}>
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-line bg-raised text-[11px] text-fg-muted">
                          <th className="py-2 px-3 font-medium">Hilo / Usuario</th>
                          <th
                            className="py-2 px-3 font-medium cursor-pointer hover:text-fg"
                            onClick={() => handleSort("state")}
                          >
                            Estado {renderSortIcon("state")}
                          </th>
                          <th
                            className="py-2 px-3 font-medium cursor-pointer hover:text-fg"
                            onClick={() => handleSort("duration")}
                          >
                            Duración {renderSortIcon("duration")}
                          </th>
                          <th
                            className="py-2 px-3 font-medium cursor-pointer hover:text-fg"
                            onClick={() => handleSort("isolation")}
                          >
                            Aislamiento {renderSortIcon("isolation")}
                          </th>
                          <th
                            className="py-2 px-3 font-medium cursor-pointer hover:text-fg text-right"
                            onClick={() => handleSort("rows_locked")}
                          >
                            Filas bloq. {renderSortIcon("rows_locked")}
                          </th>
                          <th className="py-2 px-3 font-medium">SQL / Recurso</th>
                          <th className="py-2 px-3 font-medium text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {filteredTransactions.map((tx) => {
                          const isSelf = report.current_connection_id === tx.thread_id;
                          const stateText = tx.trx_state || tx.process_state || tx.command;
                          const isWaiting = tx.trx_state === "LOCK WAIT" || Boolean(tx.blocking_thread_id);
                          return (
                            <tr key={tx.thread_id} className="hover:bg-hover/60 align-top">
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <div className="font-mono font-semibold text-fg tabular-nums">
                                  #{tx.thread_id}
                                  {tx.is_root_blocker && (
                                    <span className="ml-1.5 text-[11px] text-warning font-sans font-medium">
                                      Raíz ({tx.waiting_count})
                                    </span>
                                  )}
                                  {isSelf && (
                                    <span className="ml-1.5 text-[11px] text-accent-text font-sans font-medium">
                                      (Actual)
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-fg-muted">
                                  {tx.user}
                                  {tx.db ? ` · ${tx.db}` : ""}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span
                                  className={`font-medium ${
                                    isWaiting
                                      ? "text-danger"
                                      : tx.is_root_blocker
                                        ? "text-warning"
                                        : "text-fg"
                                  }`}
                                >
                                  {stateText}
                                </span>
                                {tx.blocking_thread_id && (
                                  <div className="text-[11px] text-fg-muted font-mono">
                                    Bloqueado por #{tx.blocking_thread_id}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">
                                {formatDuration(tx.duration_seconds)}
                              </td>
                              <td className="py-2.5 px-3 text-[11px] text-fg-muted whitespace-nowrap">
                                {tx.isolation_level || "—"}
                              </td>
                              <td className="py-2.5 px-3 font-mono tabular-nums text-right whitespace-nowrap">
                                {tx.rows_locked}
                              </td>
                              <td className="py-2.5 px-3 max-w-md">
                                {tx.locked_table && (
                                  <div className="text-[11px] text-fg-muted mb-0.5">
                                    <code className="font-mono text-fg">{tx.locked_table}</code>
                                    {tx.lock_mode ? ` (${tx.lock_mode})` : ""}
                                  </div>
                                )}
                                <div className="font-mono text-[11px] text-fg break-all line-clamp-2">
                                  {tx.sql_text || "—"}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={isSelf}
                                    onClick={() =>
                                      requestKillThread(tx.thread_id, "query", tx.user, tx.sql_text)
                                    }
                                    title={
                                      isSelf
                                        ? "Tu conexión actual"
                                        : `Terminar consulta (KILL QUERY ${tx.thread_id})`
                                    }
                                    className={`${dangerGhostBtn} disabled:opacity-40 disabled:pointer-events-none`}
                                  >
                                    <Square className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isSelf}
                                    onClick={() =>
                                      requestKillThread(
                                        tx.thread_id,
                                        "connection",
                                        tx.user,
                                        tx.sql_text,
                                      )
                                    }
                                    title={
                                      isSelf
                                        ? "Tu conexión actual"
                                        : `Cerrar conexión (KILL ${tx.thread_id})`
                                    }
                                    className={`${dangerGhostBtn} disabled:opacity-40 disabled:pointer-events-none`}
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
