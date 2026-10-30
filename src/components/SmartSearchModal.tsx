import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Table,
  Columns,
  Sparkles,
  Terminal,
  Loader2,
  X,
} from "lucide-react";
import { useAiStore } from "../stores/aiStore";
import { aiService } from "../services/aiService";
import type { SmartSearchResult } from "../types/database";

interface SmartSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  onOpenTable: (tableName: string) => void;
  onOpenQuery: (sql: string) => void;
}

export const SmartSearchModal: React.FC<SmartSearchModalProps> = ({
  isOpen,
  onClose,
  database,
  onOpenTable,
  onOpenQuery,
}) => {
  const { config } = useAiStore();
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<SmartSearchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSearchTerm("");
      setSearchResult(null);
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

  if (!isOpen) return null;

  const handleSearch = async (term: string) => {
    setSearchTerm(term);
    if (!term.trim()) {
      setSearchResult(null);
      return;
    }

    setIsLoading(true);
    try {
      const res = await aiService.smartSearchSchemaAi(
        database,
        term.trim(),
        config.enabled ? config : undefined,
      );
      setSearchResult(res);
    } catch (err) {
      console.error("Smart search error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/60 animate-in fade-in duration-150 pt-20 select-none"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-line rounded-xl shadow-modal w-full max-w-2xl flex flex-col overflow-hidden text-fg zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="p-4 bg-raised border-b border-line flex items-center space-x-3">
          <Search className="w-5 h-5 shrink-0 text-fg-muted" />
          <input
            ref={inputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={`Buscar en el esquema ${database} (ej. "email", "created_at", "pedidos del cliente")...`}
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none font-sans"
          />
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-fg-muted shrink-0" />}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-hover text-fg-muted hover:text-fg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-3 text-xs">
          {searchResult && searchResult.ai_suggestion && (
            <div className="p-3 bg-raised border border-line rounded-lg text-fg flex items-start space-x-2">
              <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-fg-muted" />
              <div>
                <span className="font-semibold text-fg">Sugerencia de IA: </span>
                <span>{searchResult.ai_suggestion}</span>
              </div>
            </div>
          )}

          {searchResult && searchResult.results.length > 0 ? (
            <div className="space-y-2">
              {searchResult.results.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-raised hover:bg-hover border border-line hover:border-line-strong rounded-lg flex items-center justify-between transition-colors group"
                >
                  <div className="flex items-center space-x-3 truncate mr-3">
                    <div className="p-2 rounded bg-surface text-accent-text shrink-0">
                      {item.item_type === "table" ? (
                        <Table className="w-4 h-4" />
                      ) : (
                        <Columns className="w-4 h-4 text-fg-muted" />
                      )}
                    </div>
                    <div className="truncate">
                      <div className="font-semibold text-fg truncate flex items-center space-x-2">
                        <span>{item.snippet}</span>
                      </div>
                      {item.table_name && item.item_type === "column" && (
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          En tabla: <strong className="text-fg">{item.table_name}</strong>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    {item.table_name && (
                      <button
                        onClick={() => {
                          onOpenTable(item.table_name!);
                          onClose();
                        }}
                        className="px-2.5 py-1 bg-elevated hover:bg-hover text-fg hover:text-fg rounded border border-line-strong text-[11px] font-medium transition-colors"
                      >
                        Ver Tabla
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const targetTbl = item.table_name || item.name;
                        const sql = `SELECT * FROM \`${database}\`.\`${targetTbl}\` LIMIT 100;`;
                        onOpenQuery(sql);
                        onClose();
                      }}
                      className="px-2.5 py-1 bg-accent/30 hover:bg-hover text-accent-text border border-accent/40 rounded text-[11px] font-medium transition-colors flex items-center space-x-1"
                    >
                      <Terminal className="w-3 h-3" />
                      <span>Consultar</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : searchTerm.trim() && !isLoading ? (
            <div className="py-12 text-center text-fg-subtle">
              No se encontraron tablas ni columnas que coincidan con "{searchTerm}".
            </div>
          ) : (
            <div className="py-10 text-center text-fg-subtle">
              Escribe el nombre de una columna, tabla o término funcional para buscar en el esquema.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-raised border-t border-line flex items-center justify-between text-[11px] text-fg-subtle font-mono">
          <span>Esquema: {database}</span>
          <span>Presiona ESC para cerrar</span>
        </div>
      </div>
    </div>
  );
};
