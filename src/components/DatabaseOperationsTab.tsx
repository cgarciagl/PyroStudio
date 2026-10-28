import React, { useState } from "react";
import {
  CheckCircle2,
  Cpu,
  RotateCw,
  Wrench,
  Zap,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { useSchemaStore } from "../stores/schemaStore";
import { usePreferenceStore } from "../stores/preferenceStore";
import type { TableMetadata, TableOperationResult } from "../types/database";
import { ConfirmModal } from "./ConfirmModal";

interface DatabaseOperationsTabProps {
  database: string;
  tables?: TableMetadata[];
  onRefreshDatabase?: () => Promise<void> | void;
}

export const DatabaseOperationsTab: React.FC<DatabaseOperationsTabProps> = ({
  database,
  tables: propsTables,
  onRefreshDatabase: _onRefreshDatabase,
}) => {
  const { tables: storeTables } = useSchemaStore();
  const { safeModeEnabled } = usePreferenceStore();

  const dbTables = propsTables || storeTables[database] || [];
  const [selectedTable, setSelectedTable] = useState<string>(
    dbTables.length > 0 ? dbTables[0].name : "",
  );
  const [isAllTables, setIsAllTables] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<TableOperationResult[]>([]);
  const [flushMessage, setFlushMessage] = useState<string | null>(null);
  const [pendingOptimizeOp, setPendingOptimizeOp] = useState<boolean>(false);

  const runOperation = async (op: "ANALYZE" | "OPTIMIZE" | "CHECK" | "REPAIR" | "CHECKSUM") => {
    setIsRunning(true);
    setFlushMessage(null);
    const targetTables = isAllTables ? dbTables.map((t) => t.name) : [selectedTable];
    const newResults: TableOperationResult[] = [];

    for (const tbl of targetTables) {
      try {
        const res = await dbService.executeTableOperation(database, tbl, op);
        newResults.push(res);
      } catch (err: unknown) {
        newResults.push({
          database,
          table: tbl,
          operation: op,
          msg_type: "error",
          msg_text: typeof err === "string" ? err : (err as Error)?.message || "Error desconocido",
          duration_ms: 0,
        });
      }
    }
    setResults((prev) => [...newResults, ...prev]);
    setIsRunning(false);
  };

  const handleExecuteOperation = async (
    op: "ANALYZE" | "OPTIMIZE" | "CHECK" | "REPAIR" | "CHECKSUM",
  ) => {
    if (!isAllTables && !selectedTable) return;

    if (op === "OPTIMIZE" && safeModeEnabled) {
      setPendingOptimizeOp(true);
      return;
    }

    await runOperation(op);
  };

  const handleFlush = async (flushType: "TABLES" | "PRIVILEGES" | "STATUS") => {
    setIsRunning(true);
    try {
      const msg = await dbService.executeMaintenanceFlush(flushType);
      setFlushMessage(msg);
      setTimeout(() => setFlushMessage(null), 5000);
    } catch (err: unknown) {
      setFlushMessage(
        `Error: ${typeof err === "string" ? err : (err as Error)?.message || "Fallo en flush"}`,
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 bg-canvas overflow-y-auto space-y-6 select-none min-h-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-amber-950/40 border border-amber-500/30 flex items-center justify-center text-warning">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-fg font-mono">{database}</h2>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-950/50 text-warning border border-amber-800/40">
                Mantenimiento de BD
              </span>
            </div>
            <p className="text-xs text-fg-muted">
              Operaciones de desfragmentación, actualización de estadísticas de índices y verificación de integridad
            </p>
          </div>
        </div>
      </div>

      {flushMessage && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-success text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
          <span>{flushMessage}</span>
        </div>
      )}

      {/* Target Table Selector & Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Table Selector */}
        <div className="p-4 rounded-xl bg-raised border border-line space-y-3 sm:col-span-1">
          <span className="text-[11px] font-medium text-fg-muted block">
            Tabla Objetivo
          </span>

          <div className="space-y-2">
            <div className="flex items-center space-x-2 text-xs text-fg">
              <input
                type="checkbox"
                id="allTablesCheck"
                checked={isAllTables}
                onChange={(e) => setIsAllTables(e.target.checked)}
                className="rounded bg-elevated border-line text-accent-text focus:ring-0"
              />
              <label htmlFor="allTablesCheck" className="cursor-pointer font-medium">
                Aplicar a todas las tablas ({dbTables.length})
              </label>
            </div>

            {!isAllTables && (
              <select
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
                className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-xs font-mono text-fg focus:outline-hidden focus:border-accent"
              >
                {dbTables.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Operations Action Panel */}
        <div className="p-4 rounded-xl bg-raised border border-line space-y-3 sm:col-span-2 flex flex-col justify-between">
          <span className="text-[11px] font-medium text-fg-muted block">
            Acciones de Mantenimiento
          </span>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              onClick={() => handleExecuteOperation("ANALYZE")}
              disabled={isRunning || (!isAllTables && !selectedTable)}
              title="Actualiza la cardinalidad y estadísticas de índices para el optimizador"
              className="px-3 py-2 text-xs font-semibold text-accent-fg bg-accent hover:bg-accent-hover disabled:opacity-50 rounded-lg transition-colors flex flex-col items-center justify-center space-y-1"
            >
              <Zap className="w-4 h-4" />
              <span>ANALYZE TABLE</span>
            </button>

            <button
              onClick={() => handleExecuteOperation("OPTIMIZE")}
              disabled={isRunning || (!isAllTables && !selectedTable)}
              title="Desfragmenta datos e índices y recupera espacio libre en disco"
              className="px-3 py-2 text-xs font-semibold text-accent-fg bg-accent hover:bg-accent-hover disabled:opacity-50 rounded-lg transition-colors flex flex-col items-center justify-center space-y-1"
            >
              <Cpu className="w-4 h-4" />
              <span>OPTIMIZE TABLE</span>
            </button>

            <button
              onClick={() => handleExecuteOperation("CHECK")}
              disabled={isRunning || (!isAllTables && !selectedTable)}
              title="Verifica la integridad de la estructura de la tabla"
              className="px-3 py-2 text-xs font-semibold text-accent-fg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg transition-colors flex flex-col items-center justify-center space-y-1"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>CHECK TABLE</span>
            </button>

            <button
              onClick={() => handleExecuteOperation("CHECKSUM")}
              disabled={isRunning || (!isAllTables && !selectedTable)}
              title="Calcula el checksum CRC de la tabla"
              className="px-3 py-2 text-xs font-semibold text-fg bg-raised hover:bg-hover border border-line rounded-lg transition-colors flex flex-col items-center justify-center space-y-1"
            >
              <RotateCw className="w-4 h-4" />
              <span>CHECKSUM</span>
            </button>
          </div>

          {/* Quick Flush Controls */}
          <div className="flex items-center space-x-2 pt-2 border-t border-line text-xs">
            <span className="text-fg-subtle font-semibold text-[10px] uppercase">Flush:</span>
            <button
              onClick={() => handleFlush("TABLES")}
              disabled={isRunning}
              className="px-2.5 py-1 rounded bg-raised hover:bg-hover text-fg text-[11px] border border-line"
            >
              FLUSH TABLES
            </button>
            <button
              onClick={() => handleFlush("PRIVILEGES")}
              disabled={isRunning}
              className="px-2.5 py-1 rounded bg-raised hover:bg-hover text-fg text-[11px] border border-line"
            >
              FLUSH PRIVILEGES
            </button>
            <button
              onClick={() => handleFlush("STATUS")}
              disabled={isRunning}
              className="px-2.5 py-1 rounded bg-raised hover:bg-hover text-fg text-[11px] border border-line"
            >
              FLUSH STATUS
            </button>
          </div>
        </div>
      </div>

      {/* Operation Output Results Log */}
      <div className="rounded-xl bg-surface border border-line overflow-hidden shadow-pop">
        <div className="px-5 py-3.5 bg-raised border-b border-line flex items-center justify-between text-xs font-bold text-fg">
          <div className="flex items-center space-x-2">
            <Wrench className="w-4 h-4 text-fg-muted" />
            <span>Registro de Ejecución de Operaciones</span>
          </div>
          <span className="text-[11px] text-fg-subtle font-mono">
            {results.length} resultado(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead>
              <tr className="bg-raised text-fg-muted font-semibold border-b border-line text-[11px]">
                <th className="py-2.5 px-4">Tabla</th>
                <th className="py-2.5 px-4">Operación</th>
                <th className="py-2.5 px-4">Tipo</th>
                <th className="py-2.5 px-4">Mensaje del Servidor</th>
                <th className="py-2.5 px-4 text-right">Duración</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-fg">
              {results.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-fg-subtle font-sans">
                    Ninguna operación ejecutada en esta sesión.
                  </td>
                </tr>
              ) : (
                results.map((res, idx) => {
                  const isOk = res.msg_text.toLowerCase().includes("ok") || res.msg_type === "status";
                  return (
                    <tr key={idx} className="hover:bg-hover transition-colors">
                      <td className="py-2.5 px-4 font-bold text-fg">{res.table}</td>
                      <td className="py-2.5 px-4 text-accent-text font-semibold">{res.operation}</td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${
                            isOk
                              ? "bg-emerald-950/50 border-emerald-800 text-success"
                              : "bg-rose-950/50 border-rose-800 text-danger"
                          }`}
                        >
                          {res.msg_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-fg">{res.msg_text}</td>
                      <td className="py-2.5 px-4 text-right text-fg-muted">
                        {res.duration_ms} ms
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        isOpen={pendingOptimizeOp}
        title="Modo Seguro: Optimizar Tablas"
        message={`¿Estás seguro de que deseas ejecutar OPTIMIZE TABLE en ${
          isAllTables ? `TODAS las tablas de '${database}'` : `'${selectedTable}'`
        }?`}
        details="Esta operación puede bloquear temporalmente la tabla y consumir I/O significativo durante la compactación y desfragmentación de espacio."
        confirmText="Optimizar"
        variant="warning"
        onConfirm={() => {
          setPendingOptimizeOp(false);
          runOperation("OPTIMIZE");
        }}
        onClose={() => setPendingOptimizeOp(false)}
      />
    </div>
  );
};
