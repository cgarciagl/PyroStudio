import React from "react";
import {
  CheckCircle2,
  AlertCircle,
  History as HistoryIcon,
  Trash2,
  RefreshCw,
} from "lucide-react";
import {
  secondaryBtn,
  dangerGhostBtn,
} from "../ui/styles";
import { EmptyState, Spinner } from "../ui/Modal";


import { formatBytes } from "./formatBytes";
import type { BackupRestoreState } from "./useBackupRestore";

export const HistoryTab: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const {
    handleClearHistory,
    historyRecords,
    isLoadingHistory,
    loadHistory,
  } = state;

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-fg">
              Historial de Ejecuciones ({historyRecords.length})
            </h3>
            <p className="text-[11px] text-fg-muted">
              Registro de auditoría de todas las copias de seguridad ejecutadas manual o automáticamente.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadHistory}
              disabled={isLoadingHistory}
              className={secondaryBtn}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoadingHistory ? "animate-spin" : ""}`} />
              Actualizar
            </button>
            <button
              type="button"
              onClick={handleClearHistory}
              disabled={historyRecords.length === 0 || isLoadingHistory}
              className={dangerGhostBtn}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Limpiar historial
            </button>
          </div>
        </div>

        {isLoadingHistory ? (
          <div className="py-12 flex justify-center">
            <Spinner className="w-6 h-6" />
          </div>
        ) : historyRecords.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="w-8 h-8" />}
            title="Sin registros de ejecución"
            description="Las ejecuciones automáticas programadas y manuales aparecerán aquí con sus métricas completas de tiempo, filas y bytes transferidos."
          />
        ) : (
          <div className="border border-line rounded-lg overflow-hidden bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="bg-raised border-b border-line text-[11px] text-fg-muted font-medium">
                <tr>
                  <th className="py-2.5 px-3">Estado</th>
                  <th className="py-2.5 px-3">Fecha y Hora</th>
                  <th className="py-2.5 px-3">Perfil / Origen</th>
                  <th className="py-2.5 px-3">Base de Datos</th>
                  <th className="py-2.5 px-3">Formato</th>
                  <th className="py-2.5 px-3 text-right">Filas / Tablas</th>
                  <th className="py-2.5 px-3 text-right">Tamaño</th>
                  <th className="py-2.5 px-3 text-right">Duración</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono text-[11px]">
                {historyRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-hover transition-colors">
                    <td className="py-2 px-3">
                      {record.status === "success" ? (
                        <CheckCircle2 className="w-4 h-4 text-success" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-danger" />
                      )}
                    </td>
                    <td className="py-2 px-3 text-fg whitespace-nowrap">
                      {new Date(record.started_at).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 font-sans">
                      <span className="font-semibold text-fg text-xs block">
                        {record.profile_name || "(Manual)"}
                      </span>
                      <span className="text-[10px] text-fg-muted">
                        {record.profile_id ? "Programado" : "Manual"}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-fg font-medium">
                      {record.database}
                    </td>
                    <td className="py-2 px-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-canvas border border-line text-fg-muted">
                        {record.backup_format.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-fg">
                      {record.total_rows.toLocaleString()} f ({record.total_tables} t)
                    </td>
                    <td className="py-2 px-3 text-right text-fg font-medium">
                      {formatBytes(record.total_bytes)}
                    </td>
                    <td className="py-2 px-3 text-right text-fg-muted">
                      {record.duration_ms} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
