import React, { useState } from "react";
import {
  X,
  Edit3,
  Loader2,
  AlertCircle,
  Code2,
} from "lucide-react";
import type { ColumnMetadata } from "../types/database";
import { dbService } from "../services/tauriDb";

interface EditColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  table: string;
  column: ColumnMetadata;
  onColumnUpdated: () => void;
}

const COMMON_DATA_TYPES = [
  "VARCHAR",
  "INT",
  "BIGINT",
  "TEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "TINYINT",
  "BOOLEAN",
  "DECIMAL",
  "FLOAT",
  "DOUBLE",
  "DATETIME",
  "TIMESTAMP",
  "DATE",
  "TIME",
  "JSON",
  "BLOB",
  "ENUM",
];

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

  const buildSql = () => {
    const cleanDb = database.replace(/`/g, "``");
    const cleanTbl = table.replace(/`/g, "``");
    const cleanOld = column.name.replace(/`/g, "``");
    const cleanNew = (columnName.trim() || column.name).replace(/`/g, "``");

    let typeDef = dataType;
    if (
      length.trim() &&
      !["TEXT", "MEDIUMTEXT", "LONGTEXT", "DATETIME", "TIMESTAMP", "DATE", "JSON", "BLOB", "BOOLEAN"].includes(dataType)
    ) {
      typeDef = `${dataType}(${length.trim()})`;
    }

    const charsetClause = isTextType && characterSet.trim() ? `CHARACTER SET ${characterSet.trim()}` : "";
    const collationClause = isTextType && collation.trim() ? `COLLATE ${collation.trim()}` : "";
    const nullClause = isNullable ? "NULL" : "NOT NULL";
    let defaultClause = "";
    if (defaultValue.trim()) {
      if (defaultValue.toUpperCase() === "NULL") {
        defaultClause = "DEFAULT NULL";
      } else if (
        defaultValue.toUpperCase() === "CURRENT_TIMESTAMP" ||
        defaultValue.toUpperCase() === "NOW()" ||
        defaultValue.toUpperCase() === "CURRENT_TIMESTAMP()"
      ) {
        defaultClause = "DEFAULT CURRENT_TIMESTAMP";
      } else {
        defaultClause = `DEFAULT '${defaultValue.replace(/'/g, "\\'")}'`;
      }
    }

    const extraClause = isAutoIncrement ? "AUTO_INCREMENT" : "";
    const commentClause = comment.trim() ? `COMMENT '${comment.replace(/'/g, "\\'")}'` : "";

    const parts = [
      `ALTER TABLE \`${cleanDb}\`.\`${cleanTbl}\``,
      `CHANGE COLUMN \`${cleanOld}\` \`${cleanNew}\` ${typeDef}`,
      charsetClause,
      collationClause,
      nullClause,
      defaultClause,
      extraClause,
      commentClause,
    ].filter(Boolean);

    return parts.join(" ") + ";";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!columnName.trim()) {
      setError("El nombre de la columna no puede estar vacío.");
      return;
    }

    setIsExecuting(true);
    setError(null);

    const sqlStatement = buildSql();

    try {
      await dbService.executeQuery(sqlStatement, database);
      onColumnUpdated();
      onClose();
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al modificar la columna";
      setError(msg);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#11131a] border border-[#262c3e] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-3.5 bg-[#141822] border-b border-[#212638] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-orange-600/20 border border-orange-500/30 flex items-center justify-center">
              <Edit3 className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Modificar Columna `{column.name}`
              </h2>
              <p className="text-xs text-neutral-400 font-mono">
                {database}.{table}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white p-1 rounded hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Column Name & Data Type */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-neutral-300">
                Nombre de la Columna
              </label>
              <input
                type="text"
                required
                value={columnName}
                onChange={(e) => setColumnName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#0b0c10] border border-[#242938] rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 font-mono transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-300">
                Tipo de Dato
              </label>
              <select
                value={dataType}
                onChange={(e) => {
                  const t = e.target.value;
                  setDataType(t);
                  if (t === "VARCHAR" && !length) setLength("255");
                }}
                className="w-full px-3 py-2 text-xs bg-[#0b0c10] border border-[#242938] rounded-md text-white focus:outline-none focus:border-orange-500 font-mono transition-colors"
              >
                {COMMON_DATA_TYPES.map((t) => (
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
              <label className="text-xs font-medium text-neutral-300">
                Longitud / Precisión
              </label>
              <input
                type="text"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder="ej. 255 o 10,2"
                className="w-full px-3 py-2 text-xs bg-[#0b0c10] border border-[#242938] rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 font-mono transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-300">
                Valor por Defecto
              </label>
              <input
                type="text"
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="NULL o valor"
                className="w-full px-3 py-2 text-xs bg-[#0b0c10] border border-[#242938] rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 font-mono transition-colors"
              />
            </div>
          </div>

          {/* Charset & Collation (Active for text/string types) */}
          <div className={`grid grid-cols-2 gap-3 p-3 rounded-lg border transition-opacity ${isTextType ? "bg-[#0e111a] border-[#22293d] opacity-100" : "bg-[#0b0c10] border-[#181d2a] opacity-50 pointer-events-none"}`}>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-300 flex items-center justify-between">
                <span>Juego de Caracteres (Charset)</span>
                {!isTextType && <span className="text-[10px] text-neutral-500">(Sólo texto)</span>}
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
                className="w-full px-2.5 py-1.5 text-xs bg-[#0b0c10] border border-[#242938] rounded-md text-white focus:outline-none focus:border-orange-500 font-mono text-[11px] transition-colors"
              >
                {CHARACTER_SETS.map((cs) => (
                  <option key={cs.name} value={cs.name}>
                    {cs.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-300">
                Cotejamiento (Collation)
              </label>
              <select
                disabled={!isTextType}
                value={collation}
                onChange={(e) => setCollation(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-[#0b0c10] border border-[#242938] rounded-md text-white focus:outline-none focus:border-orange-500 font-mono text-[11px] transition-colors"
              >
                {COMMON_COLLATIONS.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Flags */}
          <div className="p-3 bg-[#0d0f14] border border-[#1e2333] rounded-lg flex items-center space-x-6 text-xs">
            <label className="flex items-center space-x-2 cursor-pointer text-neutral-300 hover:text-white">
              <input
                type="checkbox"
                checked={isNullable}
                onChange={(e) => setIsNullable(e.target.checked)}
                className="rounded border-[#2c3348] text-orange-600 focus:ring-0 bg-[#161a26]"
              />
              <span>Permite NULL</span>
            </label>

            <label className="flex items-center space-x-2 cursor-pointer text-neutral-300 hover:text-white">
              <input
                type="checkbox"
                checked={isAutoIncrement}
                onChange={(e) => {
                  setIsAutoIncrement(e.target.checked);
                  if (e.target.checked) setIsNullable(false);
                }}
                className="rounded border-[#2c3348] text-orange-600 focus:ring-0 bg-[#161a26]"
              />
              <span>Auto Increment</span>
            </label>
          </div>

          {/* Comment */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300">
              Comentario de la Columna
            </label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Descripción"
              className="w-full px-3 py-2 text-xs bg-[#0b0c10] border border-[#242938] rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          {/* Live SQL Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center space-x-1.5 text-xs text-neutral-400 font-mono">
              <Code2 className="w-3.5 h-3.5 text-orange-400" />
              <span>Sentencia SQL Generada:</span>
            </div>
            <pre className="p-3 bg-[#08090d] border border-[#1c2232] rounded text-orange-300 font-mono text-[11px] whitespace-pre-wrap select-all">
              {buildSql()}
            </pre>
          </div>

          {/* Error alert */}
          {error && (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Modal Footer */}
          <div className="pt-3 flex items-center justify-end space-x-2 border-t border-[#1f2434]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isExecuting || !columnName.trim()}
              className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 rounded-md shadow-md shadow-orange-950/40 transition-all disabled:opacity-50"
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
      </div>
    </div>
  );
};
