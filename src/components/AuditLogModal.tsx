import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, RefreshCw, ScrollText } from "lucide-react";
import type { AuditEntry } from "../types/database";
import { dbService } from "../services/tauriDb";
import { Modal, Spinner, EmptyState } from "./ui/Modal";
import { ghostBtn, inputClass } from "./ui/styles";

interface AuditLogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Writes executed through PyroStudio, newest first (backend `audit` module). */
export const AuditLogModal: React.FC<AuditLogModalProps> = ({ isOpen, onClose }) => {
  const [filter, setFilter] = useState("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (text: string) => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await dbService.readAuditLog(500, text || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => void load(filter.trim()), 250);
    return () => clearTimeout(timer);
  }, [isOpen, filter, load]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Log de auditoría"
      subtitle="Escrituras ejecutadas desde PyroStudio (se conservan 90 días)"
      icon={<ScrollText className="w-4 h-4" />}
      size="xl"
      className="h-[80vh]"
      bodyClassName="flex flex-col min-h-0 p-0"
    >
      <div className="flex items-center gap-2 px-4 py-2 border-b border-line">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por SQL, conexión o base…"
          className={inputClass}
          autoFocus
        />
        <button type="button" onClick={() => void load(filter.trim())} className={ghostBtn} title="Recargar">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && entries.length === 0 ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : error ? (
          <EmptyState title="No se pudo leer el log" description={error} />
        ) : entries.length === 0 ? (
          <EmptyState
            title="Sin registros"
            description="Aquí aparecerán los INSERT, UPDATE, DELETE y cambios de esquema que ejecutes."
          />
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((entry, index) => (
              <li key={`${entry.timestamp}-${index}`} className="px-4 py-2 space-y-1">
                <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                  {entry.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" />
                  )}
                  <span className="font-mono">{formatTimestamp(entry.timestamp)}</span>
                  <span>· {entry.connection}</span>
                  {entry.database && <span>· {entry.database}</span>}
                  {entry.affected_rows != null && <span>· {entry.affected_rows} fila(s)</span>}
                  <span>· {entry.duration_ms} ms</span>
                </div>
                <pre className="text-xs font-mono text-fg whitespace-pre-wrap break-all">{entry.sql}</pre>
                {entry.error && <div className="text-[11px] text-danger">{entry.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
};
