import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Zap,
} from "lucide-react";
import type { ColumnMetadata, CreateIndexRequest, IndexMetadata } from "../types/database";
import { dbService } from "../services/tauriDb";
import { ConfirmModal } from "./ConfirmModal";
import { primaryBtn, secondaryBtn } from "./ui/styles";

interface IndexManagerTabProps {
  database: string;
  table: string;
  columns: ColumnMetadata[];
}

// ─── Add Index Modal ──────────────────────────────────────────────────────────

interface AddIndexModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  table: string;
  columns: ColumnMetadata[];
  onIndexAdded: () => void;
}

const INDEX_TYPES = [
  { value: "INDEX", label: "INDEX (normal)", description: "Índice estándar para optimizar búsquedas y JOINs" },
  { value: "UNIQUE", label: "UNIQUE", description: "Garantiza que no haya valores duplicados" },
  { value: "FULLTEXT", label: "FULLTEXT", description: "Búsqueda de texto completo en columnas CHAR/VARCHAR/TEXT" },
  { value: "SPATIAL", label: "SPATIAL", description: "Índice geoespacial para columnas de geometría" },
];

const AddIndexModal: React.FC<AddIndexModalProps> = ({
  isOpen,
  onClose,
  database,
  table,
  columns,
  onIndexAdded,
}) => {
  const [indexName, setIndexName] = useState("");
  const [indexType, setIndexType] = useState("INDEX");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setIndexName("");
    setIndexType("INDEX");
    setSelectedColumns([]);
    setComment("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const toggleColumn = (colName: string) => {
    setSelectedColumns((prev) =>
      prev.includes(colName) ? prev.filter((c) => c !== colName) : [...prev, colName],
    );
  };

  const moveColumn = (colName: string, direction: "up" | "down") => {
    setSelectedColumns((prev) => {
      const idx = prev.indexOf(colName);
      if (idx === -1) return prev;
      const next = [...prev];
      const swap = direction === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  const handleSave = async () => {
    setError(null);
    if (!indexName.trim()) {
      setError("El nombre del índice es obligatorio.");
      return;
    }
    if (selectedColumns.length === 0) {
      setError("Selecciona al menos una columna.");
      return;
    }
    setIsSaving(true);
    try {
      const req: CreateIndexRequest = {
        database,
        table,
        index_name: indexName.trim(),
        index_type: indexType,
        columns: selectedColumns,
        comment: comment.trim() || undefined,
      };
      await dbService.createIndex(req);
      onIndexAdded();
      handleClose();
    } catch (err: unknown) {
      setError(typeof err === "string" ? err : (err as Error)?.message || "Error al crear el índice.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
      <div className="w-[560px] max-h-[85vh] flex flex-col bg-surface border border-line rounded-xl shadow-modal overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-raised border border-line flex items-center justify-center">
              <Zap className="w-4 h-4 text-fg-muted" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-fg">Agregar Índice</h2>
              <p className="text-xs text-fg-subtle font-mono">{database}.{table}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-fg-subtle hover:text-fg transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Index name */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1.5">
              Nombre del Índice <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              placeholder="idx_columna_tabla"
              className="w-full px-3 py-2 rounded-md bg-raised border border-line text-fg font-mono text-sm placeholder-neutral-600 focus:outline-none focus:border-line focus:ring-1 focus: transition-colors"
            />
          </div>

          {/* Index type */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1.5">Tipo de Índice</label>
            <div className="grid grid-cols-2 gap-2">
              {INDEX_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setIndexType(t.value)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    indexType === t.value
                      ? "border-line bg-raised text-fg"
                      : "border-line bg-surface text-fg-muted hover:border-line hover:text-fg"
                  }`}
                >
                  <div className="text-xs font-bold font-mono mb-0.5">{t.label}</div>
                  <div className="text-[10px] text-fg-subtle leading-tight">{t.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Column selector */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1.5">
              Columnas <span className="text-danger">*</span>
              <span className="ml-2 text-fg-subtle font-normal">
                (marca y reordena según necesites)
              </span>
            </label>
            <div className="rounded-lg border border-line bg-surface overflow-hidden max-h-44 overflow-y-auto">
              {columns.map((col) => {
                const isSelected = selectedColumns.includes(col.name);
                const pos = selectedColumns.indexOf(col.name);
                return (
                  <div
                    key={col.name}
                    className={`flex items-center px-3 py-2 border-b border-line last:border-b-0 transition-colors ${
                      isSelected ? "bg-raised" : "hover:bg-hover"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleColumn(col.name)}
                      className="mr-3 cursor-pointer"
                    />
                    <span className="flex-1 font-mono text-xs text-fg">{col.name}</span>
                    <span className="text-[10px] font-mono text-accent-text mr-3">{col.column_type}</span>
                    {isSelected && (
                      <div className="flex items-center space-x-1">
                        <span className="text-[10px] text-fg-muted font-mono w-4 text-center">
                          #{pos + 1}
                        </span>
                        <button
                          onClick={() => moveColumn(col.name, "up")}
                          disabled={pos === 0}
                          className="p-0.5 text-fg-subtle hover:text-fg disabled:opacity-30 transition-colors"
                          title="Subir"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => moveColumn(col.name, "down")}
                          disabled={pos === selectedColumns.length - 1}
                          className="p-0.5 text-fg-subtle hover:text-fg disabled:opacity-30 transition-colors"
                          title="Bajar"
                        >
                          ▼
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {selectedColumns.length > 0 && (
              <p className="mt-1.5 text-[10px] text-fg-muted font-mono">
                Orden: ({selectedColumns.join(", ")})
              </p>
            )}
          </div>

          {/* Comment */}
          <div>
            <label className="block text-xs font-semibold text-fg mb-1.5">
              Comentario <span className="text-fg-subtle font-normal">(opcional)</span>
            </label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Descripción del índice..."
              className="w-full px-3 py-2 rounded-md bg-raised border border-line text-fg text-sm placeholder-neutral-600 focus:outline-none focus:border-line focus:ring-1 focus: transition-colors"
            />
          </div>

          {/* SQL preview */}
          {selectedColumns.length > 0 && indexName.trim() && (
            <div className="rounded-lg bg-canvas border border-line p-3">
              <p className="text-[10px] text-fg-subtle mb-1.5 font-medium">
                SQL generado
              </p>
              <p className="text-xs font-mono text-success break-all">
                ALTER TABLE `{database}`.`{table}` ADD{" "}
                {indexType === "INDEX" ? "" : indexType + " "}INDEX `{indexName.trim()}` (
                {selectedColumns.map((c) => `\`${c}\``).join(", ")})
                {comment.trim() ? ` COMMENT '${comment.trim()}'` : ""};
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start space-x-2 px-3 py-2.5 rounded-lg bg-red-950/40 border border-red-800/50 text-danger text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-line flex items-center justify-end space-x-3">
          <button
            onClick={handleClose}
            className={secondaryBtn}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={primaryBtn}
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span>{isSaving ? "Creando..." : "Crear Índice"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main IndexManagerTab ─────────────────────────────────────────────────────

export const IndexManagerTab: React.FC<IndexManagerTabProps> = ({
  database,
  table,
  columns,
}) => {
  const [indexes, setIndexes] = useState<IndexMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [actionStatus, setActionStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [indexToDrop, setIndexToDrop] = useState<IndexMetadata | null>(null);

  const fetchIndexes = async () => {
    setIsLoading(true);
    try {
      const data = await dbService.listIndexes(database, table);
      setIndexes(data);
      // Auto-expand PRIMARY
      setExpandedKeys(new Set(data.filter((i) => i.is_primary).map((i) => i.key_name)));
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al cargar índices.";
      showStatus(false, msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchIndexes();
  }, [database, table]);

  const showStatus = (success: boolean, message: string) => {
    setActionStatus({ success, message });
    setTimeout(() => setActionStatus(null), 5000);
  };

  const toggleExpand = (keyName: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      next.has(keyName) ? next.delete(keyName) : next.add(keyName);
      return next;
    });
  };

  const handleDrop = (idx: IndexMetadata) => {
    setIndexToDrop(idx);
  };

  const executeDropIndex = async () => {
    if (!indexToDrop) return;
    const idx = indexToDrop;
    setIndexToDrop(null);
    try {
      await dbService.dropIndex(database, table, idx.key_name);
      showStatus(true, `Índice '${idx.key_name}' eliminado.`);
      fetchIndexes();
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al eliminar el índice.";
      showStatus(false, msg);
    }
  };

  const indexTypeBadge = (idx: IndexMetadata) => {
    if (idx.is_primary)
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-warning border border-amber-500/30">
          PRIMARY KEY
        </span>
      );
    if (idx.is_unique)
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-raised text-fg-muted border border-line">
          UNIQUE
        </span>
      );
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-raised text-fg-muted border border-line">
        INDEX
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {actionStatus && (
            <div
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border ${
                actionStatus.success
                  ? "bg-emerald-950/40 border-emerald-800/60 text-success"
                  : "bg-red-950/40 border-red-800/60 text-danger"
              }`}
            >
              {actionStatus.success ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" />
              )}
              <span className="truncate max-w-xs">{actionStatus.message}</span>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsAddOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1 bg-raised hover:bg-hover text-fg border border-line rounded text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Agregar Índice</span>
          </button>
          <button
            onClick={fetchIndexes}
            title="Refrescar índices"
            className="p-1 rounded bg-raised hover:bg-hover border border-line text-fg-muted hover:text-fg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-2 text-fg-muted">
          <Loader2 className="w-6 h-6 animate-spin text-fg-muted" />
          <span className="text-xs">Cargando índices...</span>
        </div>
      ) : indexes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3 text-fg-subtle">
          <ShieldCheck className="w-10 h-10 opacity-30" />
          <p className="text-sm">No hay índices definidos en esta tabla.</p>
          <button
            onClick={() => setIsAddOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-raised hover:bg-hover text-fg border border-line rounded text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Crear primer índice</span>
          </button>
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-lg overflow-hidden shadow-pop">
          {indexes.map((idx, i) => {
            const isExpanded = expandedKeys.has(idx.key_name);
            return (
              <div key={idx.key_name} className={i > 0 ? "border-t border-line" : ""}>
                {/* Index header row */}
                <div
                  className="flex items-center px-4 py-3 hover:bg-hover cursor-pointer transition-colors group"
                  onClick={() => toggleExpand(idx.key_name)}
                >
                  <button className="mr-2 text-fg-subtle group-hover:text-fg transition-colors">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <span className="flex-1 font-mono text-sm font-semibold text-fg">
                    {idx.key_name}
                  </span>

                  <div className="flex items-center space-x-2 mr-4">
                    {indexTypeBadge(idx)}
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-fg-muted bg-raised border border-line">
                      {idx.index_type}
                    </span>
                    <span className="text-xs text-fg-subtle font-mono">
                      {idx.columns.length === 1
                        ? "1 columna"
                        : `${idx.columns.length} columnas`}
                    </span>
                  </div>

                  {/* Drop button — hidden for PRIMARY unless you really want */}
                  {!idx.is_primary && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDrop(idx);
                      }}
                      title="Eliminar índice (DROP INDEX)"
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-fg-subtle hover:text-danger hover:bg-red-950/40 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {idx.is_primary && (
                    <div className="w-6" /> /* spacer */
                  )}
                </div>

                {/* Expanded: column detail */}
                {isExpanded && (
                  <div className="bg-surface border-t border-line px-4 py-3">
                    {idx.comment && (
                      <p className="text-xs text-fg-muted italic mb-3">{idx.comment}</p>
                    )}
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="text-[11px] font-mono text-fg-subtle border-b border-line">
                          <th className="pb-1.5 pr-4 w-8">#</th>
                          <th className="pb-1.5 pr-4">Columna</th>
                          <th className="pb-1.5 pr-4">Cotejamiento</th>
                          <th className="pb-1.5">Prefijo (Sub_part)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {idx.columns.map((col) => (
                          <tr key={col.seq_in_index} className="text-[11px]">
                            <td className="py-1.5 pr-4 text-fg-subtle font-mono">
                              {col.seq_in_index}
                            </td>
                            <td className="py-1.5 pr-4 font-mono font-semibold text-fg">
                              {col.column_name}
                            </td>
                            <td className="py-1.5 pr-4 font-mono text-fg-muted">
                              {col.collation ?? "—"}
                            </td>
                            <td className="py-1.5 font-mono text-fg-muted">
                              {col.sub_part != null ? col.sub_part : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Drop link also visible when expanded */}
                    {!idx.is_primary && (
                      <div className="mt-3 pt-3 border-t border-line flex justify-end">
                        <button
                          onClick={() => handleDrop(idx)}
                          className="flex items-center space-x-1 text-xs text-fg-subtle hover:text-danger transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Eliminar índice</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AddIndexModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        database={database}
        table={table}
        columns={columns}
        onIndexAdded={() => {
          fetchIndexes();
        }}
      />

      <ConfirmModal
        isOpen={!!indexToDrop}
        title="Eliminar Índice"
        message={`¿Estás seguro de eliminar ${
          indexToDrop?.is_primary
            ? "la llave primaria (PRIMARY KEY)"
            : `el índice '${indexToDrop?.key_name}'`
        } de la tabla '${table}'?`}
        details="Esta acción modificará la estructura de la tabla y no se puede deshacer."
        confirmText="Eliminar Índice"
        variant="danger"
        onConfirm={executeDropIndex}
        onClose={() => setIndexToDrop(null)}
      />
    </div>
  );
};
