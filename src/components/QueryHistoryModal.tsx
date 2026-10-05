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

interface QueryHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuery: (sql: string, runImmediately?: boolean) => void;
  currentDatabase?: string;
}

export const QueryHistoryModal: React.FC<QueryHistoryModalProps> = ({
  isOpen,
  onClose,
  onSelectQuery,
  currentDatabase,
}) => {
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSuccess, setFilterSuccess] = useState<"all" | "success" | "error">("all");
  const [onlyCurrentDb, setOnlyCurrentDb] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setHistory(queryHistoryStorage.getHistory());
    }
  }, [isOpen]);

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
    if (window.confirm("¿Seguro que deseas vaciar todo el historial de consultas?")) {
      queryHistoryStorage.clearHistory();
      setHistory([]);
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#0f121a] border border-[#202738] w-full max-w-4xl h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#121622] border-b border-[#1f2638] flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-neutral-200">
            <History className="w-4 h-4 text-orange-400" />
            <span className="font-semibold text-sm">Historial de Consultas SQL</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1b2233] text-neutral-400 font-mono">
              {filteredHistory.length} de {history.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {history.length > 0 && (
              <button
                onClick={handleClearAll}
                className="flex items-center space-x-1 px-2.5 py-1 text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded border border-transparent hover:border-red-900/40 transition-colors"
                title="Vaciar todo el historial"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vaciar</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar: Search & Filters */}
        <div className="px-5 py-2.5 bg-[#141824] border-b border-[#1b202e] flex flex-wrap items-center justify-between gap-3 select-none">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-neutral-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar en SQL o base de datos..."
              className="w-full bg-[#0a0c10] border border-[#222a3d] focus:border-orange-500 rounded pl-8 pr-3 py-1.5 text-xs text-neutral-200 focus:outline-none"
            />
          </div>

          <div className="flex items-center space-x-3 text-[11px]">
            {/* Filter by status */}
            <div className="flex items-center space-x-1 bg-[#0a0c10] border border-[#222a3d] rounded p-0.5">
              <button
                onClick={() => setFilterSuccess("all")}
                className={`px-2 py-0.5 rounded transition-colors ${
                  filterSuccess === "all" ? "bg-orange-600 text-white font-medium" : "text-neutral-400 hover:text-white"
                }`}
              >
                Todas
              </button>
              <button
                onClick={() => setFilterSuccess("success")}
                className={`px-2 py-0.5 rounded transition-colors ${
                  filterSuccess === "success" ? "bg-emerald-700 text-white font-medium" : "text-neutral-400 hover:text-white"
                }`}
              >
                Exitosas
              </button>
              <button
                onClick={() => setFilterSuccess("error")}
                className={`px-2 py-0.5 rounded transition-colors ${
                  filterSuccess === "error" ? "bg-red-700 text-white font-medium" : "text-neutral-400 hover:text-white"
                }`}
              >
                Errores
              </button>
            </div>

            {/* Current DB filter checkbox */}
            {currentDatabase && (
              <label className="flex items-center space-x-1.5 text-neutral-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyCurrentDb}
                  onChange={(e) => setOnlyCurrentDb(e.target.checked)}
                  className="rounded border-neutral-700 text-orange-600"
                />
                <span>Solo `{currentDatabase}`</span>
              </label>
            )}
          </div>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-[#0a0b0e]">
          {filteredHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-2">
              <History className="w-8 h-8 opacity-30 text-orange-400" />
              <span>No se encontraron consultas en el historial.</span>
            </div>
          ) : (
            filteredHistory.map((item) => (
              <div
                key={item.id}
                className="bg-[#10141f] border border-[#1b2234] hover:border-[#2d3852] rounded-lg p-3 transition-colors flex flex-col space-y-2 group"
              >
                {/* Item header */}
                <div className="flex items-center justify-between text-[11px] text-neutral-400">
                  <div className="flex items-center space-x-2">
                    {item.success ? (
                      <span className="flex items-center space-x-1 text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Éxito</span>
                      </span>
                    ) : (
                      <span className="flex items-center space-x-1 text-red-400 font-medium">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Error</span>
                      </span>
                    )}

                    <span className="text-neutral-600">•</span>

                    <span className="flex items-center space-x-1 font-mono text-neutral-300">
                      <Clock className="w-3 h-3 text-neutral-500" />
                      <span>{item.durationMs} ms</span>
                    </span>

                    {item.database && (
                      <>
                        <span className="text-neutral-600">•</span>
                        <span className="flex items-center space-x-1 font-mono text-orange-400 bg-orange-950/20 border border-orange-800/30 px-1.5 py-0.2 rounded">
                          <Database className="w-2.5 h-2.5" />
                          <span>{item.database}</span>
                        </span>
                      </>
                    )}

                    <span className="text-neutral-600">•</span>
                    <span className="text-neutral-500">{formatTimestamp(item.timestamp)}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-1.5 opacity-90 group-hover:opacity-100">
                    <button
                      onClick={() => handleCopy(item.id, item.sql)}
                      title="Copiar SQL al portapapeles"
                      className="p-1 rounded hover:bg-[#1a202d] text-neutral-400 hover:text-white transition-colors"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
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
                      className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#1a2133] hover:bg-[#25304a] text-neutral-200 border border-[#2b3754] text-[11px] font-medium transition-colors"
                    >
                      <ArrowUpRight className="w-3 h-3 text-orange-400" />
                      <span>Cargar</span>
                    </button>

                    <button
                      onClick={() => {
                        onSelectQuery(item.sql, true);
                        onClose();
                      }}
                      title="Ejecutar consulta directamente"
                      className="flex items-center space-x-1 px-2 py-0.5 rounded bg-orange-600/30 hover:bg-orange-600/50 text-orange-300 border border-orange-500/40 text-[11px] font-semibold transition-colors"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Ejecutar</span>
                    </button>

                    <button
                      onClick={() => handleDelete(item.id)}
                      title="Eliminar del historial"
                      className="p-1 rounded hover:bg-red-950/40 text-neutral-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* SQL statement preview */}
                <pre className="p-2.5 bg-[#08090d] border border-[#191f2e] rounded font-mono text-[11px] text-neutral-200 whitespace-pre-wrap max-h-28 overflow-y-auto select-all">
                  {item.sql}
                </pre>

                {/* Error message preview if any */}
                {item.errorMessage && (
                  <div className="text-[11px] font-mono text-red-400 bg-red-950/20 border border-red-900/40 px-2.5 py-1 rounded">
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
