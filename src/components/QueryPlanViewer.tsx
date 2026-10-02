import React from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Layers,
  Sparkles,
  Zap,
} from "lucide-react";
import type { ExplainRow } from "../types/database";

interface QueryPlanViewerProps {
  planRows: ExplainRow[];
  rawResult?: {
    columns: string[];
    rows: any[][];
    execution_time_ms: number;
  };
}

export const QueryPlanViewer: React.FC<QueryPlanViewerProps> = ({
  planRows,
  rawResult,
}) => {
  // If planRows is empty but rawResult is provided, normalize columns
  const rows: ExplainRow[] = React.useMemo(() => {
    if (planRows && planRows.length > 0) return planRows;
    if (!rawResult || !rawResult.columns) return [];

    const cols = rawResult.columns.map((c) => c.toLowerCase());
    const idIdx = cols.indexOf("id");
    const selectTypeIdx = cols.indexOf("select_type");
    const tableIdx = cols.indexOf("table");
    const typeIdx = cols.indexOf("type");
    const possibleKeysIdx = cols.indexOf("possible_keys");
    const keyIdx = cols.indexOf("key");
    const keyLenIdx = cols.indexOf("key_len");
    const refIdx = cols.indexOf("ref");
    const rowsIdx = cols.indexOf("rows");
    const filteredIdx = cols.indexOf("filtered");
    const extraIdx = cols.indexOf("extra");

    return rawResult.rows.map((r) => ({
      id: idIdx !== -1 ? r[idIdx] : 1,
      select_type: selectTypeIdx !== -1 ? String(r[selectTypeIdx] || "") : "SIMPLE",
      table: tableIdx !== -1 ? String(r[tableIdx] || "") : "—",
      type: typeIdx !== -1 ? String(r[typeIdx] || "ALL").toUpperCase() : "ALL",
      possible_keys: possibleKeysIdx !== -1 && r[possibleKeysIdx] ? String(r[possibleKeysIdx]) : undefined,
      key: keyIdx !== -1 && r[keyIdx] ? String(r[keyIdx]) : undefined,
      key_len: keyLenIdx !== -1 && r[keyLenIdx] ? String(r[keyLenIdx]) : undefined,
      ref: refIdx !== -1 && r[refIdx] ? String(r[refIdx]) : undefined,
      rows: rowsIdx !== -1 ? Number(r[rowsIdx]) || 0 : 0,
      filtered: filteredIdx !== -1 && r[filteredIdx] !== null ? Number(r[filteredIdx]) : undefined,
      extra: extraIdx !== -1 && r[extraIdx] ? String(r[extraIdx]) : undefined,
    }));
  }, [planRows, rawResult]);

  const totalEstimatedRows = rows.reduce((acc, r) => acc + (r.rows || 0), 0);
  const hasFullTableScan = rows.some((r) => r.type === "ALL");
  const usesIndexes = rows.some((r) => r.key && r.key !== "NULL");
  const hasFilesort = rows.some((r) => r.extra && r.extra.includes("Using filesort"));
  const hasTemporary = rows.some((r) => r.extra && r.extra.includes("Using temporary"));

  const getScanBadge = (type: string) => {
    switch (type) {
      case "SYSTEM":
      case "CONST":
        return {
          bg: "bg-purple-950/40 border-purple-800/60 text-purple-300",
          label: "CONST (Máxima Velocidad)",
          icon: Zap,
        };
      case "EQ_REF":
        return {
          bg: "bg-emerald-950/40 border-emerald-800/60 text-emerald-300",
          label: "EQ_REF (Índice Único)",
          icon: CheckCircle2,
        };
      case "REF":
        return {
          bg: "bg-emerald-950/30 border-emerald-700/50 text-emerald-400",
          label: "REF (Búsqueda por Índice)",
          icon: CheckCircle2,
        };
      case "RANGE":
        return {
          bg: "bg-sky-950/40 border-sky-800/60 text-sky-300",
          label: "RANGE (Rango de Índice)",
          icon: Activity,
        };
      case "INDEX":
        return {
          bg: "bg-amber-950/40 border-amber-800/60 text-amber-300",
          label: "INDEX (Escaneo de Todo el Índice)",
          icon: AlertTriangle,
        };
      case "ALL":
      default:
        return {
          bg: "bg-rose-950/40 border-rose-800/60 text-rose-300",
          label: "ALL (Full Table Scan - Lento)",
          icon: AlertTriangle,
        };
    }
  };

  return (
    <div className="flex-1 flex flex-col p-5 bg-[#0a0c10] overflow-y-auto space-y-4 select-none">
      {/* Metrics Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-[#11141c] border border-[#1e2333] flex items-center space-x-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
              hasFullTableScan
                ? "bg-rose-950/40 border-rose-800/50 text-rose-400"
                : "bg-emerald-950/40 border-emerald-800/50 text-emerald-400"
            }`}
          >
            {hasFullTableScan ? (
              <AlertTriangle className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
          </div>
          <div className="truncate">
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
              Tipo de Acceso
            </span>
            <span className="text-xs font-bold text-white font-mono">
              {hasFullTableScan ? "Full Table Scan (ALL)" : "Índice Optimizado"}
            </span>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-[#11141c] border border-[#1e2333] flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-orange-600/10 border border-orange-500/20 flex items-center justify-center text-orange-400 shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div className="truncate">
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
              Filas Examinadas
            </span>
            <span className="text-xs font-bold text-white font-mono">
              ~{totalEstimatedRows.toLocaleString()} filas
            </span>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-[#11141c] border border-[#1e2333] flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-sky-600/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
            <Database className="w-4 h-4" />
          </div>
          <div className="truncate">
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
              Tablas en Plan
            </span>
            <span className="text-xs font-bold text-white font-mono">
              {rows.length} paso(s) de ejecución
            </span>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-[#11141c] border border-[#1e2333] flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          <div className="truncate">
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-semibold">
              Uso de Índices
            </span>
            <span className="text-xs font-bold text-white font-mono">
              {usesIndexes ? "Activo (Llave asignada)" : "Sin índice utilizado"}
            </span>
          </div>
        </div>
      </div>

      {/* Optimization Tips & Warnings Box */}
      <div className="p-3.5 rounded-lg bg-[#121520] border border-[#23293c] space-y-2">
        <div className="flex items-center space-x-2 text-xs font-semibold text-orange-400">
          <Sparkles className="w-4 h-4" />
          <span>Diagnóstico de Rendimiento del Optimizador MariaDB</span>
        </div>

        <div className="space-y-1.5 text-xs">
          {hasFullTableScan && (
            <div className="flex items-start space-x-2 text-rose-300">
              <span className="font-bold">•</span>
              <span>
                <strong className="text-rose-200">Alerta de Rendimiento:</strong> Se detectó un escaneo total de tabla (<code className="px-1 py-0.5 rounded bg-rose-950/60 font-mono text-[11px]">ALL</code>). Si la tabla crece, causará bloqueos y latencia alta. Se recomienda crear índices sobre las columnas del <code className="font-mono">WHERE</code> o <code className="font-mono">JOIN</code>.
              </span>
            </div>
          )}

          {hasFilesort && (
            <div className="flex items-start space-x-2 text-amber-300">
              <span className="font-bold">•</span>
              <span>
                <strong className="text-amber-200">Using filesort:</strong> MariaDB está ordenando los registros en un búfer temporal de memoria o disco. Considera crear un índice compuesto que incluya las columnas de <code className="font-mono">ORDER BY</code>.
              </span>
            </div>
          )}

          {hasTemporary && (
            <div className="flex items-start space-x-2 text-amber-300">
              <span className="font-bold">•</span>
              <span>
                <strong className="text-amber-200">Using temporary:</strong> La consulta crea una tabla temporal en memoria/disco para resolver la consulta (común en <code className="font-mono">GROUP BY</code> o <code className="font-mono">DISTINCT</code>).
              </span>
            </div>
          )}

          {!hasFullTableScan && !hasFilesort && !hasTemporary && (
            <div className="flex items-start space-x-2 text-emerald-300">
              <span className="font-bold">•</span>
              <span>
                <strong className="text-emerald-200">Excelente:</strong> La consulta utiliza índices eficientes y no genera operaciones pesadas de ordenamiento o tablas temporales no indexadas.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* EXPLAIN Data Table */}
      <div className="bg-[#11141c] border border-[#1f2535] rounded-lg overflow-hidden shadow-xl">
        <div className="px-4 py-2.5 bg-[#141822] border-b border-[#212739] flex items-center justify-between text-xs font-semibold text-neutral-300">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-orange-400" />
            <span>Detalle de Pasos del Plan (EXPLAIN)</span>
          </div>
          {rawResult && (
            <span className="text-[11px] font-mono text-neutral-500">
              Tiempo de análisis: {rawResult.execution_time_ms} ms
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#161a26] text-neutral-400 font-semibold border-b border-[#212739] font-mono text-[11px]">
                <th className="py-2.5 px-3 w-10 text-center">ID</th>
                <th className="py-2.5 px-3">Select Type</th>
                <th className="py-2.5 px-3">Tabla</th>
                <th className="py-2.5 px-3">Tipo Acceso</th>
                <th className="py-2.5 px-3">Posibles Llaves</th>
                <th className="py-2.5 px-3">Llave Utilizada</th>
                <th className="py-2.5 px-3">Long. Llave</th>
                <th className="py-2.5 px-3">Ref</th>
                <th className="py-2.5 px-3 text-right">Filas Estim.</th>
                <th className="py-2.5 px-3 text-right">Filtrado %</th>
                <th className="py-2.5 px-3">Extra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c2232] font-mono text-xs">
              {rows.map((row, idx) => {
                const badge = getScanBadge(row.type);
                const BadgeIcon = badge.icon;

                return (
                  <tr
                    key={idx}
                    className="hover:bg-[#151926] transition-colors"
                  >
                    <td className="py-2.5 px-3 text-center text-neutral-400">
                      {row.id}
                    </td>
                    <td className="py-2.5 px-3 text-neutral-300">
                      {row.select_type}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-white">
                      {row.table}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold border ${badge.bg}`}
                      >
                        <BadgeIcon className="w-3 h-3 shrink-0" />
                        <span>{row.type}</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-neutral-400 text-[11px]">
                      {row.possible_keys || <span className="text-neutral-600">NULL</span>}
                    </td>
                    <td className="py-2.5 px-3 text-orange-300 font-semibold text-[11px]">
                      {row.key || <span className="text-neutral-600 font-normal">NULL</span>}
                    </td>
                    <td className="py-2.5 px-3 text-neutral-400 text-[11px]">
                      {row.key_len || "—"}
                    </td>
                    <td className="py-2.5 px-3 text-neutral-400 text-[11px]">
                      {row.ref || "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-white">
                      {row.rows.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right text-neutral-300">
                      {row.filtered !== undefined ? `${row.filtered}%` : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-neutral-400">
                      {row.extra || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
