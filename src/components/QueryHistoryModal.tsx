import React, { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import type { QueryHistoryItem } from "../types/database";
import { queryHistoryStorage } from "../services/queryHistoryStorage";
import { ConfirmModal } from "./ConfirmModal";
import { iconBtn, modalBackdrop, modalHeader } from "./ui/styles";

interface QueryHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuery: (sql: string, runImmediately?: boolean) => void;
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
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setHistory(queryHistoryStorage.getHistory());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

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
    setShowClearConfirm(true);
  };

  const executeClearAll = () => {
    queryHistoryStorage.clearHistory();
    setHistory([]);
    setShowClearConfirm(false);
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

  return (
    <div className={docked ? "h-full w-full" : modalBackdrop} onClick={docked ? undefined : onClose}>
      <div
        className={
          docked
            ? "@container h-full bg-surface flex flex-col overflow-hidden text-xs"
            : "@container bg-surface border border-line w-full max-w-4xl h-[85vh] rounded-xl shadow-modal flex flex-col overflow-hidden text-xs zoom-in-95"
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={modalHeader}>
          <div className="flex items-center space-x-2.5 text-fg">
            <History className="w-4 h-4 text-fg-muted" />
            <span className="font-semibold text-sm">Historial de Consultas SQL</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-elevated text-fg-muted font-mono">
              {filteredHistory.length} de {history.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {history.length > 0 && (
              <button
                onClick={handleClearAll}
                className="flex items-center space-x-1 px-2.5 py-1 text-danger hover:text-danger hover:bg-hover rounded border border-transparent transition-colors"
                title="Vaciar todo el historial"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vaciar</span>
              </button>
            )}
            <button
              onClick={onClose}
              className={iconBtn}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar: Search & Filters */}
        <div className="px-5 py-2.5 bg-raised border-b border-line flex flex-wrap items-center justify-between gap-3 select-none">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-fg-subtle" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar en SQL o base de datos..."
              className="w-full bg-canvas border border-line focus:border-accent rounded pl-8 pr-3 py-1.5 text-xs text-fg focus:outline-none"
            />
          </div>

          <div className="flex items-center space-x-3 text-[11px]">
            {/* Filter by status */}
            <div className="flex items-center space-x-1 bg-canvas border border-line rounded p-0.5">
              <button
                onClick={() => setFilterSuccess("all")}
                className={`px-2 py-0.5 rounded transition-colors ${
                  filterSuccess === "all" ? "bg-surface text-fg font-medium" : "text-fg-muted hover:text-fg"
                }`}
              >
                Todas
              </button>
              <button
                onClick={() => setFilterSuccess("success")}
                className={`px-2 py-0.5 rounded transition-colors ${
                  filterSuccess === "success" ? "bg-surface text-fg font-medium" : "text-fg-muted hover:text-fg"
                }`}
              >
                Exitosas
              </button>
              <button
                onClick={() => setFilterSuccess("error")}
                className={`px-2 py-0.5 rounded transition-colors ${
                  filterSuccess === "error" ? "bg-surface text-fg font-medium" : "text-fg-muted hover:text-fg"
                }`}
              >
                Errores
              </button>
            </div>

            {/* Current DB filter checkbox */}
            {currentDatabase && (
              <label className="flex items-center space-x-1.5 text-fg-muted cursor-pointer">
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
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-canvas">
          {filteredHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-fg-subtle space-y-2">
              <History className="w-8 h-8 opacity-30 text-fg-muted" />
              <span>No se encontraron consultas en el historial.</span>
            </div>
          ) : (
            filteredHistory.map((item) => (
              <div
                key={item.id}
                className="bg-raised border border-line hover:border-line-strong rounded-lg p-3 transition-colors flex flex-col space-y-2 group"
              >
                {/* Item header */}
                <div className="flex items-center justify-between text-[11px] text-fg-muted">
                  <div className="flex items-center space-x-2">
                    {item.success ? (
                      <span className="flex items-center space-x-1 text-success font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Éxito</span>
                      </span>
                    ) : (
                      <span className="flex items-center space-x-1 text-danger font-medium">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Error</span>
                      </span>
                    )}

                    <span className="text-fg-subtle">•</span>

                    <span className="flex items-center space-x-1 font-mono text-fg">
                      <Clock className="w-3 h-3 text-fg-subtle" />
                      <span>{item.durationMs} ms</span>
                    </span>

                    {item.database && (
                      <>
                        <span className="text-fg-subtle">•</span>
                        <span className="flex items-center space-x-1 font-mono text-accent-text bg-accent-soft border border-accent/30 px-1.5 py-0.2 rounded">
                          <Database className="w-2.5 h-2.5" />
                          <span>{item.database}</span>
                        </span>
                      </>
                    )}

                    <span className="text-fg-subtle">•</span>
                    <span className="text-fg-subtle">{formatTimestamp(item.timestamp)}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-1.5 opacity-90 group-hover:opacity-100">
                    <button
                      onClick={() => handleCopy(item.id, item.sql)}
                      title="Copiar SQL al portapapeles"
                      className="p-1 rounded hover:bg-hover text-fg-muted hover:text-fg transition-colors"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      onClick={() => {
                        onSelectQuery(item.sql, false);
                        onClose();
                      }}
                      title="Cargar consulta en el editor"
                      className="flex items-center space-x-1 px-2 py-0.5 rounded bg-elevated hover:bg-hover text-fg border border-line-strong text-[11px] font-medium transition-colors"
                    >
                      <ArrowUpRight className="w-3 h-3 text-fg-muted" />
                      <span>Cargar</span>
                    </button>

                    <button
                      onClick={() => {
                        onSelectQuery(item.sql, true);
                        onClose();
                      }}
                      title="Ejecutar consulta directamente"
                      className="flex items-center space-x-1 px-2 py-0.5 rounded bg-accent/30 hover:bg-hover text-accent-text border border-accent/40 text-[11px] font-semibold transition-colors"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Ejecutar</span>
                    </button>

                    <button
                      onClick={() => handleDelete(item.id)}
                      title="Eliminar del historial"
                      className="p-1 rounded hover:bg-hover text-fg-subtle hover:text-danger transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* SQL statement preview */}
                <pre className="p-2.5 bg-canvas border border-line rounded font-mono text-[11px] text-fg whitespace-pre-wrap max-h-28 overflow-y-auto select-all">
                  {item.sql}
                </pre>

                {/* Error message preview if any */}
                {item.errorMessage && (
                  <div className="text-[11px] font-mono text-danger border border-line px-2.5 py-1 rounded">
                    {item.errorMessage}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={showClearConfirm}
        title="Vaciar Historial de Consultas"
        message="¿Estás seguro de que deseas vaciar todo el historial de consultas?"
        details="Se eliminarán todos los registros guardados localmente. Esta acción no se puede deshacer."
        confirmText="Vaciar Historial"
        variant="danger"
        onConfirm={executeClearAll}
        onClose={() => setShowClearConfirm(false)}
      />
    </div>
  );
};
