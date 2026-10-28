import React, { useState } from "react";
import {
  X,
  Database,
  Loader2,
  AlertCircle,
  Plus,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { primaryBtn, secondaryBtn } from "./ui/styles";

interface CreateDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDatabaseCreated: (dbName: string) => void;
}

const COMMON_CHARSETS_COLLATIONS: { charset: string; collation: string; label: string }[] = [
  { charset: "utf8mb4", collation: "utf8mb4_unicode_ci", label: "utf8mb4_unicode_ci (Recomendado - Multilingüe/Emojis)" },
  { charset: "utf8mb4", collation: "utf8mb4_general_ci", label: "utf8mb4_general_ci (Rápido)" },
  { charset: "utf8mb4", collation: "utf8mb4_spanish_ci", label: "utf8mb4_spanish_ci (Español moderno)" },
  { charset: "utf8mb4", collation: "utf8mb4_spanish2_ci", label: "utf8mb4_spanish2_ci (Español tradicional)" },
  { charset: "utf8mb4", collation: "utf8mb4_bin", label: "utf8mb4_bin (Binario sensible a mayúsculas/minúsculas)" },
  { charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci", label: "utf8mb4_0900_ai_ci (MySQL 8.0+ por defecto)" },
  { charset: "utf8", collation: "utf8_general_ci", label: "utf8_general_ci (Legado 3 bytes)" },
  { charset: "latin1", collation: "latin1_swedish_ci", label: "latin1_swedish_ci (Europa Occidental clásico)" },
];

export const CreateDatabaseModal: React.FC<CreateDatabaseModalProps> = ({
  isOpen,
  onClose,
  onDatabaseCreated,
}) => {
  const [dbName, setDbName] = useState("");
  const [selectedCollationIdx, setSelectedCollationIdx] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = dbName.trim();

    if (!cleanName) {
      setError("Por favor ingresa un nombre para la base de datos.");
      return;
    }

    // Identificador válido en MySQL/MariaDB (letras, números, guiones bajos o medios)
    if (!/^[a-zA-Z0-9_\-]+$/.test(cleanName)) {
      setError("El nombre de la base de datos contiene caracteres no válidos.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const { charset, collation } = COMMON_CHARSETS_COLLATIONS[selectedCollationIdx];
    const sql = `CREATE DATABASE \`${cleanName}\` CHARACTER SET ${charset} COLLATE ${collation};`;

    try {
      await dbService.executeConfirmedQuery(sql);
      onDatabaseCreated(cleanName);
      setDbName("");
      onClose();
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al crear la base de datos";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-line rounded-xl shadow-modal w-full max-w-md overflow-hidden text-fg zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-raised border-b border-line flex items-center justify-between select-none">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-accent-soft border border-accent/30 text-accent-text">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-fg tracking-tight">
                Crear Nueva Base de Datos
              </h2>
              <p className="text-[11px] text-fg-muted">
                Define el nombre del esquema, juego de caracteres e intercalación.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-hover text-fg-muted hover:text-fg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleCreate} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-danger text-xs flex items-start space-x-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div className="font-mono">{error}</div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-fg">
              Nombre de la Base de Datos <span className="text-accent-text">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={dbName}
              onChange={(e) => setDbName(e.target.value)}
              placeholder="p. ej. tienda_online, app_db, facturacion"
              className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-xs font-mono text-fg placeholder-neutral-500 focus:outline-hidden focus:border-accent transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-fg">
              Juego de Caracteres & Intercalación (Collation)
            </label>
            <select
              value={selectedCollationIdx}
              onChange={(e) => setSelectedCollationIdx(Number(e.target.value))}
              className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-xs font-mono text-fg focus:outline-hidden focus:border-accent transition-colors"
            >
              {COMMON_CHARSETS_COLLATIONS.map((item, idx) => (
                <option key={item.collation} value={idx}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-fg-subtle block">
              Charset:{" "}
              <span className="text-fg-muted font-mono">
                {COMMON_CHARSETS_COLLATIONS[selectedCollationIdx].charset}
              </span>{" "}
              | Collate:{" "}
              <span className="text-fg-muted font-mono">
                {COMMON_CHARSETS_COLLATIONS[selectedCollationIdx].collation}
              </span>
            </span>
          </div>

          <div className="pt-2 flex items-center justify-end space-x-2 select-none">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className={secondaryBtn}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !dbName.trim()}
              className={primaryBtn}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Creando...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Crear Base de Datos</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

