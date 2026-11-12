import type { TableExtendedStats } from "../../types/database";
import { formatBytes } from "../../utils/formatBytes";
import { InspectorLoading } from "./InspectorLoading";

interface StatisticsPanelProps {
  isLoading: boolean;
  statistics?: TableExtendedStats | null;
}

/** Storage statistics reported by the engine. */
export function StatisticsPanel({ isLoading, statistics }: StatisticsPanelProps) {
  return (
  isLoading ? (
    <InspectorLoading label="Cargando estadísticas del motor..." />
  ) : statistics ? (
    <div className="space-y-6">
      {/* Stat Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-surface border border-line rounded-lg p-4">
          <span className="text-[11px] text-fg-muted font-mono">Filas Totales</span>
          <div className="text-lg font-semibold font-mono text-fg mt-1">
            {statistics.table_rows.toLocaleString()}
          </div>
          <span className="text-[11px] text-fg-subtle">Estimación de almacenamiento</span>
        </div>
        <div className="bg-surface border border-line rounded-lg p-4">
          <span className="text-[11px] text-fg-muted font-mono">Tamaño de Datos</span>
          <div className="text-lg font-semibold font-mono text-success mt-1">
            {formatBytes(statistics.data_length)}
          </div>
          <span className="text-[11px] text-fg-subtle">
            Promedio: {statistics.avg_row_length} B / fila
          </span>
        </div>
        <div className="bg-surface border border-line rounded-lg p-4">
          <span className="text-[11px] text-fg-muted font-mono">Tamaño de Índices</span>
          <div className="text-lg font-semibold font-mono text-fg-muted mt-1">
            {formatBytes(statistics.index_length)}
          </div>
          <span className="text-[11px] text-fg-subtle">Estructuras B-Tree / Claves</span>
        </div>
        <div className="bg-surface border border-line rounded-lg p-4">
          <span className="text-[11px] text-fg-muted font-mono">Espacio Libre (Fragmentación)</span>
          <div className="text-lg font-semibold font-mono text-warning mt-1">
            {formatBytes(statistics.data_free)}
          </div>
          <span className="text-[11px] text-fg-subtle">
            {statistics.data_free > 50 * 1024 * 1024
              ? "Candidata a OPTIMIZE TABLE"
              : "Nivel normal"}
          </span>
        </div>
      </div>

      {/* Extended Details Table */}
      <div className="bg-surface border border-line rounded-lg p-5">
        <h4 className="font-semibold text-fg text-sm mb-4">Detalles del Motor y Configuración</h4>
        <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 font-mono text-xs">
          <div className="flex justify-between py-1 border-b border-line">
            <dt className="text-fg-muted">Motor de Almacenamiento:</dt>
            <dd className="font-semibold text-accent-text">{statistics.engine}</dd>
          </div>
          <div className="flex justify-between py-1 border-b border-line">
            <dt className="text-fg-muted">Formato de Fila (Row Format):</dt>
            <dd className="text-fg">{statistics.row_format || "Default"}</dd>
          </div>
          <div className="flex justify-between py-1 border-b border-line">
            <dt className="text-fg-muted">Cotejamiento (Collation):</dt>
            <dd className="text-fg">{statistics.collation || "—"}</dd>
          </div>
          <div className="flex justify-between py-1 border-b border-line">
            <dt className="text-fg-muted">Siguiente Auto-Increment:</dt>
            <dd className="font-semibold text-warning">
              {statistics.auto_increment?.toLocaleString() || "—"}
            </dd>
          </div>
          <div className="flex justify-between py-1 border-b border-line">
            <dt className="text-fg-muted">Fecha de Creación:</dt>
            <dd className="text-fg">{statistics.create_time || "—"}</dd>
          </div>
          <div className="flex justify-between py-1 border-b border-line">
            <dt className="text-fg-muted">Última Actualización:</dt>
            <dd className="text-fg">{statistics.update_time || "—"}</dd>
          </div>
          {statistics.comment && (
            <div className="col-span-full flex justify-between py-2 border-b border-line">
              <dt className="text-fg-muted">Comentario de la Tabla:</dt>
              <dd className="text-fg">{statistics.comment}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  ) : (
    <div className="p-8 text-center text-fg-subtle font-mono text-xs">
      No se pudieron obtener estadísticas de la tabla.
    </div>
  )
  );
}
