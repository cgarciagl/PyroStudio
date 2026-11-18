import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Columns,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { useAiStore } from "../stores/aiStore";
import { useUIStore } from "../stores/uiStore";
import { AiNotice } from "./ai/AiNotice";
import { aiService } from "../services/aiService";
import type { SmartSearchResult } from "../types/database";
import { errorText } from "../utils/errors";
import { ObjectIcon } from "./objectIcons";
import { EmptyState, Spinner } from "./ui/Modal";
import { ghostBtn, iconBtn, modalBackdrop, modalPanel, primaryBtn } from "./ui/styles";

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
      useUIStore.getState().showAlert({
        title: "No se pudo completar la búsqueda",
        message: errorText(err),
        variant: "warning",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className={`${modalBackdrop} !items-start pt-20 select-none`}
      onClick={onClose}
    >
      <div
        className={`${modalPanel} max-w-2xl text-fg`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Buscar en el esquema ${database}`}
      >
        {/* Search Input Bar */}
        <div className="px-4 py-3 bg-raised border-b border-line flex items-center gap-3">
          <Search className="w-4 h-4 shrink-0 text-fg-muted" />
          <input
            ref={inputRef}
            type="search"
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={`Buscar en el esquema ${database} (ej. "email", "created_at", "pedidos del cliente")...`}
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none font-sans"
          />
          {isLoading && <Spinner className="w-4 h-4 shrink-0" />}
          <button
            type="button"
            onClick={onClose}
            className={iconBtn}
            aria-label="Cerrar"
            title="Cerrar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2.5 text-xs bg-canvas">
          <AiNotice notice={searchResult?.ai_notice} />

          {searchResult && searchResult.ai_suggestion && (
            <div className="p-3 bg-surface border border-line rounded-lg text-fg flex items-start gap-2">
              <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
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
                  className="p-3 bg-surface hover:border-line-strong border border-line rounded-lg flex items-center justify-between gap-3 transition-colors group"
                >
                  <div className="flex items-center gap-3 truncate min-w-0">
                    <div className="w-8 h-8 rounded-lg border border-line bg-raised flex items-center justify-center shrink-0">
                      {item.item_type === "table" ? (
                        <ObjectIcon kind="tables" className="w-4 h-4" />
                      ) : (
                        <Columns className="w-4 h-4 text-fg-muted" />
                      )}
                    </div>
                    <div className="truncate">
                      <div className="font-semibold text-fg truncate">
                        {item.snippet}
                      </div>
                      {item.table_name && item.item_type === "column" && (
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          En tabla: <strong className="text-fg font-mono">{item.table_name}</strong>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.table_name && (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenTable(item.table_name!);
                          onClose();
                        }}
                        className={ghostBtn}
                      >
                        Ver tabla
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const targetTbl = item.table_name || item.name;
                        const sql = `SELECT * FROM \`${database}\`.\`${targetTbl}\` LIMIT 100;`;
                        onOpenQuery(sql);
                        onClose();
                      }}
                      className={primaryBtn}
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Consultar</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : searchTerm.trim() && !isLoading ? (
            <EmptyState
              icon={<Search className="w-7 h-7" />}
              title={`Sin coincidencias para "${searchTerm}"`}
              description="No se encontraron tablas ni columnas relacionadas en el esquema."
            />
          ) : (
            <EmptyState
              icon={<Search className="w-7 h-7" />}
              title="Búsqueda en el esquema"
              description="Escribe el nombre de una columna, tabla o término funcional para buscar en el esquema."
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-surface border-t border-line flex items-center justify-between text-[11px] text-fg-subtle font-mono">
          <span>Esquema: {database}</span>
          <span>Presiona ESC para cerrar</span>
        </div>
      </div>
    </div>
  );
};

