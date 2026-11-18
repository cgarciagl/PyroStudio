import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  History,
  Search,
  Trash2,
  Copy,
  Check,
  Play,
  ArrowUpRight,
  Clock,
  Database,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Star,
} from "lucide-react";
import type { QueryHistoryItem } from "../types/database";
import { queryHistoryStorage } from "../services/queryHistoryStorage";
import { useUIStore } from "../stores/uiStore";
import { useSchemaStore } from "../stores/schemaStore";
import { EmptyState } from "./ui/Modal";
import {
  dangerGhostBtn,
  ghostBtn,
  iconBtn,
  inputClass,
  modalBackdrop,
  modalHeader,
  modalTitle,
  primaryBtn,
} from "./ui/styles";
import { uid } from "../utils/uid";

interface QueryHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuery?: (sql: string, runImmediately?: boolean) => void;
  currentDatabase?: string;
  /** Acoplado al panel derecho del editor en lugar de abrirse como modal. */
  docked?: boolean;
}

export const QueryHistoryModal: React.FC<QueryHistoryModalProps> = ({
  isOpen,
  onClose,
  onSelectQuery,
  currentDatabase,
  docked = false,
}) => {
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSuccess, setFilterSuccess] = useState<"all" | "success" | "error">("all");
  const [onlyCurrentDb, setOnlyCurrentDb] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setHistory(queryHistoryStorage.getHistory());
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || docked) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, docked, onClose]);

  const filteredHistory = useMemo(() => {
    let list = history;

    if (onlyCurrentDb && currentDatabase) {
      list = list.filter((item) => item.database === currentDatabase);
    }

    if (filterSuccess === "success") {
      list = list.filter((item) => item.success);
    } else if (filterSuccess === "error") {
      list = list.filter((item) => !item.success);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (item) =>
          item.sql.toLowerCase().includes(term) ||
          item.database.toLowerCase().includes(term) ||
          item.connectionName.toLowerCase().includes(term) ||
          (item.errorMessage && item.errorMessage.toLowerCase().includes(term)),
      );
    }

    return list;
  }, [history, searchTerm, filterSuccess, onlyCurrentDb, currentDatabase]);

  if (!isOpen) return null;

  const handleCopy = (id: string, sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = (id: string) => {
    const updated = queryHistoryStorage.deleteEntry(id);
    setHistory(updated);
  };

  const handleClearAll = () => {
    useUIStore.getState().showConfirm({
      title: "Vaciar historial de consultas",
      message: "¿Estás seguro de que deseas vaciar todo el historial de consultas?",
      details: "Se eliminarán todos los registros guardados localmente. Esta acción no se puede deshacer.",
      confirmText: "Vaciar historial",
      variant: "danger",
      icon: "trash",
      onConfirm: () => {
        queryHistoryStorage.clearHistory();
        setHistory([]);
      },
    });
  };

  const openInNewTab = (item: QueryHistoryItem) => {
    const schema = useSchemaStore.getState();
    const targetDb =
      item.database || currentDatabase || schema.selectedDatabase || schema.databases[0]?.name || "test";
    const ui = useUIStore.getState();
    const queryCount = ui.tabs.filter((t) => t.type === "query").length + 1;
    if (item.database) {
      schema.setSelectedDatabase(item.database);
    }
    ui.openTab({
      id: `query-hist-${uid()}`,
      title: `Consulta ${queryCount}`,
      type: "query",
      database: targetDb,
      queryContent: item.sql,
    });
    onClose();
  };

  const saveToFavorites = (item: QueryHistoryItem) => {
    if (docked) onClose();
    useUIStore.getState().openFavoritesModal(item.sql);
  };

  const formatTimestamp = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleString("es-ES", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const filtering = Boolean(searchTerm.trim() || filterSuccess !== "all" || (onlyCurrentDb && currentDatabase));

  return (
    <div className={docked ? "h-full w-full" : modalBackdrop} onClick={docked ? undefined : onClose}>
      <div
        className={
          docked
            ? "@container h-full bg-surface flex flex-col overflow-hidden text-xs"
            : "@container bg-surface border border-line w-full max-w-4xl h-[85vh] rounded-xl shadow-modal flex flex-col overflow-hidden text-xs zoom-in-95"
        }
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault();
            onClose();
          }
        }}
        role={docked ? "complementary" : "dialog"}
        aria-label="Historial de consultas SQL"
      >
        {/* Header: icon box + title + count, matching Modal.tsx & FavoritesModal */}
        <div className={modalHeader}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg border border-line bg-raised flex items-center justify-center shrink-0">
              <History className="w-4 h-4 text-fg-muted" />
            </div>
            <div className="min-w-0">
              <h2 className={modalTitle}>Historial de consultas</h2>
              <p className="text-[11px] text-fg-muted tabular-nums truncate">
                {filtering
                  ? `${filteredHistory.length} de ${history.length}`
                  : `${history.length} ${history.length === 1 ? "ejecución" : "ejecuciones"}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {history.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className={`${ghostBtn} hover:text-danger`}
                title="Vaciar todo el historial"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vaciar</span>
              </button>
            )}
            <button type="button" onClick={onClose} className={iconBtn} aria-label="Cerrar" title="Cerrar (Esc)">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar: Search & Filters */}
        <div className="px-3 py-2 bg-surface border-b border-line flex flex-wrap items-center justify-between gap-2 select-none shrink-0">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
            <input
              ref={searchRef}
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar en SQL, base de datos o error..."
              aria-label="Buscar en el historial"
              className={`${inputClass} pl-8`}
            />
          </div>

          <div className="flex items-center flex-wrap gap-2 text-[11px]">
            <div className="flex items-center gap-0.5 bg-canvas border border-line rounded-md p-0.5">
              {(
                [
                  ["all", "Todas"],
                  ["success", "Exitosas"],
                  ["error", "Errores"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilterSuccess(value)}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    filterSuccess === value
                      ? "bg-surface text-fg font-medium"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {currentDatabase && (
              <label className="flex items-center gap-1.5 text-fg-muted cursor-pointer px-1.5 py-1 rounded hover:bg-hover">
                <input
                  type="checkbox"
                  checked={onlyCurrentDb}
                  onChange={(e) => setOnlyCurrentDb(e.target.checked)}
                  className="rounded border-line-strong text-accent-text"
                />
                <span>Solo `{currentDatabase}`</span>
              </label>
            )}
          </div>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-canvas">
          {filteredHistory.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState
                icon={<History className="w-8 h-8" />}
                title="No hay consultas en el historial"
                description={
                  filtering
                    ? "Prueba ajustando la búsqueda o los filtros activos."
                    : "Las consultas que ejecutes en el editor aparecerán aquí."
                }
              />
            </div>
          ) : (
            filteredHistory.map((item) => (
              <div
                key={item.id}
                className="bg-surface border border-line hover:border-line-strong rounded-lg p-3 transition-colors flex flex-col gap-2 group"
              >
                {/* Item header */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-fg-muted">
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
                    {item.success ? (
                      <span className="inline-flex items-center gap-1 text-fg font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                        <span>Éxito</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-fg font-medium">
                        <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" />
                        <span>Error</span>
                      </span>
                    )}

                    <span className="text-fg-subtle">·</span>

                    <span className="inline-flex items-center gap-1 font-mono tabular-nums text-fg-muted">
                      <Clock className="w-3 h-3 text-fg-subtle" />
                      <span>{item.durationMs} ms</span>
                    </span>

                    {item.database && (
                      <>
                        <span className="text-fg-subtle">·</span>
                        <span className="inline-flex items-center gap-1 font-mono text-fg-muted">
                          <Database className="w-3 h-3 text-fg-subtle" />
                          <span>{item.database}</span>
                        </span>
                      </>
                    )}

                    <span className="text-fg-subtle">·</span>
                    <span className="text-fg-subtle">{formatTimestamp(item.timestamp)}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopy(item.id, item.sql)}
                      title="Copiar SQL al portapapeles"
                      aria-label="Copiar SQL"
                      className={iconBtn}
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => saveToFavorites(item)}
                      title="Guardar en consultas guardadas"
                      aria-label="Guardar consulta"
                      className={iconBtn}
                    >
                      <Star className="w-3.5 h-3.5" />
                    </button>

                    {onSelectQuery ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openInNewTab(item)}
                          title="Abrir en nueva pestaña"
                          aria-label="Abrir en nueva pestaña"
                          className={iconBtn}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectQuery(item.sql, false);
                            onClose();
                          }}
                          title="Cargar consulta en el editor activo"
                          className={ghostBtn}
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span>Cargar</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectQuery(item.sql, true);
                            onClose();
                          }}
                          title="Ejecutar consulta en el editor activo"
                          className={primaryBtn}
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Ejecutar</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openInNewTab(item)}
                        title="Abrir en nueva pestaña de consulta"
                        className={primaryBtn}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Abrir en pestaña</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      title="Eliminar del historial"
                      aria-label="Eliminar del historial"
                      className={dangerGhostBtn}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* SQL statement preview */}
                <pre className="p-2.5 bg-canvas border border-line rounded-md font-mono text-[11px] text-fg whitespace-pre-wrap max-h-28 overflow-y-auto select-all">
                  {item.sql}
                </pre>

                {/* Error message preview if any */}
                {item.errorMessage && (
                  <div className="text-[11px] font-mono text-danger bg-canvas border border-line px-2.5 py-1.5 rounded-md">
                    {item.errorMessage}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
