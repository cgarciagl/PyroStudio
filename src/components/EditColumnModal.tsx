import React, { useState } from "react";
import {
  Edit3,
  Loader2,
  AlertCircle,
  Code2,
} from "lucide-react";
import type { ColumnMetadata } from "../types/database";
import { useDdlBuilder, type ChangeColumnSpec } from "../services/ddl";
import { useCapabilitiesStore } from "../stores/capabilitiesStore";
import { PreviewStagedSqlModal } from "./PreviewStagedSqlModal";
import { primaryBtn, secondaryBtn } from "./ui/styles";
import { Modal } from "./ui/Modal";

interface EditColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  table: string;
  column: ColumnMetadata;
  onColumnUpdated: () => void;
}

const CHARACTER_SETS = [
  { name: "", label: "Por defecto de la tabla" },
  { name: "utf8mb4", label: "utf8mb4 (Unicode 4 bytes / Emojis - Recomendado)" },
  { name: "utf8mb3", label: "utf8mb3 / utf8 (Unicode 3 bytes)" },
  { name: "latin1", label: "latin1 (ISO-8859-1 Occidental)" },
  { name: "ascii", label: "ascii (US-ASCII 7-bit)" },
  { name: "binary", label: "binary (Bytes binarios)" },
];

const COMMON_COLLATIONS = [
  { name: "", label: "Por defecto del Character Set" },
  { name: "utf8mb4_unicode_ci", label: "utf8mb4_unicode_ci (Recomendado / UCA 4.0)" },
  { name: "utf8mb4_general_ci", label: "utf8mb4_general_ci (Rápido)" },
  { name: "utf8mb4_spanish_ci", label: "utf8mb4_spanish_ci (Español tradicional)" },
  { name: "utf8mb4_spanish2_ci", label: "utf8mb4_spanish2_ci (Español moderno)" },
  { name: "utf8mb4_bin", label: "utf8mb4_bin (Sensible a mayúsculas/binario)" },
  { name: "utf8mb4_0900_ai_ci", label: "utf8mb4_0900_ai_ci (MySQL 8+)" },
  { name: "utf8_general_ci", label: "utf8_general_ci" },
  { name: "utf8_unicode_ci", label: "utf8_unicode_ci" },
  { name: "utf8_spanish_ci", label: "utf8_spanish_ci" },
  { name: "utf8_bin", label: "utf8_bin" },
  { name: "latin1_swedish_ci", label: "latin1_swedish_ci (MySQL default)" },
  { name: "latin1_general_ci", label: "latin1_general_ci" },
  { name: "latin1_spanish_ci", label: "latin1_spanish_ci" },
  { name: "latin1_bin", label: "latin1_bin" },
  { name: "ascii_general_ci", label: "ascii_general_ci" },
  { name: "ascii_bin", label: "ascii_bin" },
  { name: "binary", label: "binary" },
];

export const EditColumnModal: React.FC<EditColumnModalProps> = ({
  isOpen,
  onClose,
  database,
  table,
  column,
  onColumnUpdated,
}) => {
  const initialType = (column.data_type || "VARCHAR").toUpperCase();
  const rawType = column.column_type || "";
  const matchLen = rawType.match(/\((.*?)\)/);
  const initialLength = matchLen ? matchLen[1] : "";

  const ddl = useDdlBuilder();
  const supportsFeature = useCapabilitiesStore((state) => state.supportsFeature);
  /** Planned statements awaiting confirmation (engines that rebuild tables). */
  const [pendingPlan, setPendingPlan] = useState<string[] | null>(null);
  const [columnName, setColumnName] = useState(column.name);
  const [dataType, setDataType] = useState(initialType);
  const [length, setLength] = useState(initialLength);
  const [characterSet, setCharacterSet] = useState(column.character_set || "");
  const [collation, setCollation] = useState(column.collation || "");
  const [isNullable, setIsNullable] = useState(column.is_nullable);
  const [defaultValue, setDefaultValue] = useState(column.column_default || "");
  const [isAutoIncrement, setIsAutoIncrement] = useState(
    column.extra?.toLowerCase().includes("auto_increment") || false,
  );
  const [comment, setComment] = useState(column.comment || "");

  const [isExecuting, setIsExecuting] = useState(false);
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

  const isTextType = [
    "VARCHAR",
    "CHAR",
    "TEXT",
    "MEDIUMTEXT",
    "LONGTEXT",
    "TINYTEXT",
    "ENUM",
    "SET",
  ].includes(dataType.toUpperCase());

  const changeSpec = (): ChangeColumnSpec => ({
    database,
    table,
    column: column.name,
    definition: {
      name: columnName,
      dataType,
      length,
      nullable: isNullable,
      defaultValue,
      autoIncrement: isAutoIncrement,
      charset: characterSet,
      collation,
      comment,
    },
  });


  const applyChange = async (statements: string[]) => {
    setIsExecuting(true);
    setError(null);
    try {
      await ddl.applyColumnChange(changeSpec(), statements);
      setPendingPlan(null);
      onColumnUpdated();
      onClose();
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al modificar la columna";
      setPendingPlan(null);
      setError(msg);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!columnName.trim()) {
      setError("El nombre de la columna no puede estar vacío.");
      return;
    }
    setError(null);
    try {
      const statements = await ddl.planColumnChange(changeSpec());
      if (statements.length === 0) {
        onClose();
      } else if (ddl.previewsColumnChanges) {
        setPendingPlan(statements);
      } else {
        await applyChange(statements);
      }
    } catch (err: unknown) {
      setError(typeof err === "string" ? err : (err as Error)?.message || "Error al planificar el cambio");
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={<>Modificar Columna `{column.name}`</>}
      subtitle={<>{database}.{table}</>}
      icon={<Edit3 className="w-4 h-4" />}
      size="md"
      bodyClassName="flex flex-col overflow-hidden"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Column Name & Data Type */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-fg">
                Nombre de la Columna
              </label>
              <input
                type="text"
                required
                value={columnName}
                onChange={(e) => setColumnName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-mono transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg">
                Tipo de Dato
              </label>
              <select
                value={dataType}
                onChange={(e) => {
                  const t = e.target.value;
                  setDataType(t);
                  if (t === "VARCHAR" && !length) setLength("255");
                }}
                className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg focus:outline-none focus:border-accent font-mono transition-colors"
              >
                {ddl.dataTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Length & Default Value */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg">
                Longitud / Precisión
              </label>
              <input
                type="text"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder="ej. 255 o 10,2"
                className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-mono transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg">
                Valor por Defecto
              </label>
              <input
                type="text"
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="NULL o valor"
                className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-mono transition-colors"
              />
            </div>
          </div>

          {/* Charset & Collation (Active for text/string types) */}
          {supportsFeature("collations") && (
          <div className={`grid grid-cols-2 gap-3 p-3 rounded-lg border transition-opacity ${isTextType ? "bg-surface border-line opacity-100" : "bg-canvas border-line opacity-50 pointer-events-none"}`}>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg flex items-center justify-between">
                <span>Juego de Caracteres (Charset)</span>
                {!isTextType && <span className="text-[11px] text-fg-subtle">(Sólo texto)</span>}
              </label>
              <select
                disabled={!isTextType}
                value={characterSet}
                onChange={(e) => {
                  const val = e.target.value;
                  setCharacterSet(val);
                  if (val === "utf8mb4" && !collation) setCollation("utf8mb4_unicode_ci");
                  else if (val === "utf8mb3" && !collation) setCollation("utf8_general_ci");
                  else if (val === "latin1" && !collation) setCollation("latin1_swedish_ci");
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-canvas border border-line rounded-md text-fg focus:outline-none focus:border-accent font-mono text-[11px] transition-colors"
              >
                {CHARACTER_SETS.map((cs) => (
                  <option key={cs.name} value={cs.name}>
                    {cs.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg">
                Cotejamiento (Collation)
              </label>
              <select
                disabled={!isTextType}
                value={collation}
                onChange={(e) => setCollation(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-canvas border border-line rounded-md text-fg focus:outline-none focus:border-accent font-mono text-[11px] transition-colors"
              >
                {COMMON_COLLATIONS.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          )}

          {/* Flags */}
          <div className="p-3 bg-canvas border border-line rounded-lg flex items-center space-x-6 text-xs">
            <label className="flex items-center space-x-2 cursor-pointer text-fg hover:text-fg">
              <input
                type="checkbox"
                checked={isNullable}
                onChange={(e) => setIsNullable(e.target.checked)}
                className="rounded border-line-strong text-accent-text focus:ring-0 bg-raised"
              />
              <span>Permite NULL</span>
            </label>

            {ddl.changesAutoIncrement && (
            <label className="flex items-center space-x-2 cursor-pointer text-fg hover:text-fg">
              <input
                type="checkbox"
                checked={isAutoIncrement}
                onChange={(e) => {
                  setIsAutoIncrement(e.target.checked);
                  if (e.target.checked) setIsNullable(false);
                }}
                className="rounded border-line-strong text-accent-text focus:ring-0 bg-raised"
              />
              <span>Autoincremental</span>
            </label>
            )}
          </div>

          {/* Comment */}
          {supportsFeature("comments") && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-fg">
              Comentario de la Columna
            </label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Descripción"
              className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          )}

          {/* Live SQL Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center space-x-1.5 text-xs text-fg-muted font-mono">
              <Code2 className="w-3.5 h-3.5 text-fg-muted" />
              <span>Sentencia SQL Generada:</span>
            </div>
            <pre className="p-3 bg-canvas border border-line rounded text-accent-text font-mono text-[11px] whitespace-pre-wrap select-all">
              {ddl.describeColumnChange(changeSpec())}
            </pre>
          </div>

          {/* Error alert */}
          {error && (
            <div className="p-3 rounded-lg border border-line text-danger text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Modal Footer */}
          <div className="pt-3 flex items-center justify-end space-x-2 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className={secondaryBtn}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isExecuting || !columnName.trim()}
              className={primaryBtn}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Guardando Cambios...</span>
                </>
              ) : (
                <>
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Aplicar Cambios (ALTER TABLE)</span>
                </>
              )}
            </button>
          </div>
        </form>
        <PreviewStagedSqlModal
          isOpen={pendingPlan !== null}
          onClose={() => setPendingPlan(null)}
          onApply={() => pendingPlan && applyChange(pendingPlan)}
          sqlStatements={pendingPlan ?? []}
          database={database}
          table={table}
          isApplying={isExecuting}
        />
    </Modal>
  );
};
