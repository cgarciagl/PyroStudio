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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 backdrop-blur-xs p-4 pt-20 animate-in fade-in duration-150 select-none">
      <div className="bg-[#10131c] border border-[#232a3c] rounded-xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden text-neutral-200">
        {/* Search Input Bar */}
        <div className="p-4 bg-[#141824] border-b border-[#202738] flex items-center space-x-3">
          <Search className="w-5 h-5 text-orange-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={`Buscar en el esquema ${database} (ej. "email", "created_at", "pedidos del cliente")...`}
            className="flex-1 bg-transparent text-sm text-white placeholder-neutral-500 focus:outline-none font-sans"
          />
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-orange-400 shrink-0" />}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-3 text-xs">
          {searchResult && searchResult.ai_suggestion && (
            <div className="p-3 bg-purple-950/30 border border-purple-800/40 rounded-lg text-purple-200 flex items-start space-x-2">
              <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-purple-300">Sugerencia de IA: </span>
                <span>{searchResult.ai_suggestion}</span>
              </div>
            </div>
          )}

          {searchResult && searchResult.results.length > 0 ? (
            <div className="space-y-2">
              {searchResult.results.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-[#141824] hover:bg-[#1a202e] border border-[#202738] hover:border-[#2a354c] rounded-lg flex items-center justify-between transition-colors group"
                >
                  <div className="flex items-center space-x-3 truncate mr-3">
                    <div className="p-2 rounded bg-[#0d1017] text-orange-400 shrink-0">
                      {item.item_type === "table" ? (
                        <Table className="w-4 h-4" />
                      ) : (
                        <Columns className="w-4 h-4 text-blue-400" />
                      )}
                    </div>
                    <div className="truncate">
                      <div className="font-semibold text-white truncate flex items-center space-x-2">
                        <span>{item.snippet}</span>
                      </div>
                      {item.table_name && item.item_type === "column" && (
                        <div className="text-[11px] text-neutral-400 mt-0.5">
                          En tabla: <strong className="text-neutral-300">{item.table_name}</strong>
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
                        className="px-2.5 py-1 bg-[#1e2536] hover:bg-[#283248] text-neutral-300 hover:text-white rounded border border-[#2f3b54] text-[11px] font-medium transition-colors"
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
                      className="px-2.5 py-1 bg-orange-600/30 hover:bg-orange-600/50 text-orange-300 border border-orange-500/40 rounded text-[11px] font-medium transition-colors flex items-center space-x-1"
                    >
                      <Terminal className="w-3 h-3" />
                      <span>Consultar</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : searchTerm.trim() && !isLoading ? (
            <div className="py-12 text-center text-neutral-500">
              No se encontraron tablas ni columnas que coincidan con "{searchTerm}".
            </div>
          ) : (
            <div className="py-10 text-center text-neutral-500">
              Escribe el nombre de una columna, tabla o término funcional para buscar en el esquema.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-[#141824] border-t border-[#202738] flex items-center justify-between text-[11px] text-neutral-500 font-mono">
          <span>Esquema: {database}</span>
          <span>Presiona ESC para cerrar</span>
        </div>
      </div>
    </div>
  );
};
