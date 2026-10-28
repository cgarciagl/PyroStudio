import React, { useMemo, useState } from "react";
import { Code2, Pencil, Search, X } from "lucide-react";
import { ghostBtn, iconBtn, inputClass, modalHeader, modalTitle } from "./ui/styles";

interface RecordDetailPanelProps {
  columns: string[];
  columnTypes?: string[];
  /** Raw row values, indexed like `columns`. */
  row: unknown[] | null;
  rowNumber: number | null;
  onClose: () => void;
  /** Opens the full record editor; omitted when editing is not allowed. */
  onEdit?: () => void;
  /** Opens the cell inspector on the given raw column index. */
  onInspect: (rawColIndex: number) => void;
}

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** Read-only form view of the selected row, shown beside the grid on wide screens. */
export const RecordDetailPanel: React.FC<RecordDetailPanelProps> = ({
  columns,
  columnTypes,
  row,
  rowNumber,
  onClose,
  onEdit,
  onInspect,
}) => {
  const [filter, setFilter] = useState("");

  const fields = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return columns
      .map((name, index) => ({ name, index, type: columnTypes?.[index] }))
      .filter((f) => !term || f.name.toLowerCase().includes(term));
  }, [columns, columnTypes, filter]);

  return (
    <div className="h-full flex flex-col bg-surface text-xs select-text">
      <div className={modalHeader}>
        <div className="min-w-0">
          <h2 className={modalTitle}>Detalle del registro</h2>
          <p className="text-[11px] text-fg-muted">
            {rowNumber === null ? "Seleccione una fila" : `Fila ${rowNumber + 1} · ${columns.length} columnas`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {onEdit && row && (
            <button onClick={onEdit} className={ghostBtn} title="Editar registro completo">
              <Pencil className="w-3.5 h-3.5" />
              Editar
            </button>
          )}
          <button onClick={onClose} className={iconBtn} title="Cerrar panel">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-4 py-2 border-b border-line shrink-0 relative">
        <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-6 top-1/2 -translate-y-1/2" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar columnas..."
          className={`${inputClass} pl-7`}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>

      {!row ? (
        <div className="flex-1 flex items-center justify-center p-6 text-fg-muted">
          Seleccione una celda para ver su registro.
        </div>
      ) : (
        <dl className="flex-1 overflow-y-auto divide-y divide-line">
          {fields.map((f) => {
            const value = row[f.index];
            const isNull = value === null || value === undefined;
            return (
              <div key={f.name} className="group px-4 py-2 hover:bg-hover">
                <dt className="flex items-center justify-between gap-2">
                  <span className="font-medium text-fg-muted truncate" title={f.name}>
                    {f.name}
                    {f.type && <span className="ml-1.5 font-mono text-[11px] text-fg-subtle">{f.type}</span>}
                  </span>
                  <button
                    onClick={() => onInspect(f.index)}
                    className={`${iconBtn} opacity-0 group-hover:opacity-100`}
                    title="Abrir en el inspector"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                  </button>
                </dt>
                <dd
                  className={`mt-0.5 font-mono break-all whitespace-pre-wrap line-clamp-6 ${
                    isNull ? "italic text-fg-subtle" : "text-fg"
                  }`}
                >
                  {formatValue(value)}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
};
