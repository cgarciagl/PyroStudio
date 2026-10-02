import React, { useState } from "react";
import {
  X,
  Plus,
  Trash2,
  Code2,
  Loader2,
  AlertCircle,
  Table as TableIcon,
  ChevronUp,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import type { ColumnDefinition } from "../types/database";
import { dbService } from "../services/tauriDb";

interface CreateTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  onTableCreated: (dbName: string, tableName: string) => void;
}

const COMMON_DATA_TYPES = [
  "BIGINT",
  "INT",
  "SMALLINT",
  "TINYINT",
  "VARCHAR",
  "CHAR",
  "TEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "DECIMAL",
  "FLOAT",
  "DOUBLE",
  "BOOLEAN",
  "DATETIME",
  "TIMESTAMP",
  "DATE",
  "TIME",
  "JSON",
  "BLOB",
  "ENUM",
];

const ENGINES = ["InnoDB", "Aria", "MyISAM", "MEMORY"];
const COLLATIONS = [
  "utf8mb4_unicode_ci",
  "utf8mb4_general_ci",
  "utf8mb4_spanish_ci",
  "utf8mb4_spanish2_ci",
  "utf8mb4_bin",
  "utf8mb4_0900_ai_ci",
  "utf8_general_ci",
  "utf8_unicode_ci",
  "utf8_spanish_ci",
  "utf8_bin",
  "latin1_swedish_ci",
  "latin1_general_ci",
  "latin1_spanish_ci",
  "latin1_bin",
  "ascii_general_ci",
  "ascii_bin",
  "binary",
];

export const CreateTableModal: React.FC<CreateTableModalProps> = ({
  isOpen,
  onClose,
  database,
  onTableCreated,
}) => {
  const [tableName, setTableName] = useState("");
  const [engine, setEngine] = useState("InnoDB");
  const [collation, setCollation] = useState("utf8mb4_unicode_ci");
  const [comment, setComment] = useState("");

  const [columns, setColumns] = useState<ColumnDefinition[]>([
    {
      id: "col-1",
      name: "id",
      dataType: "BIGINT",
      length: "20",
      isPrimaryKey: true,
      isAutoIncrement: true,
      isNullable: false,
      isUnique: false,
      defaultValue: "",
      comment: "Identificador único",
    },
    {
      id: "col-2",
      name: "nombre",
      dataType: "VARCHAR",
      length: "150",
      isPrimaryKey: false,
      isAutoIncrement: false,
      isNullable: false,
      isUnique: false,
      defaultValue: "",
      comment: "",
    },
    {
      id: "col-3",
      name: "estado",
      dataType: "TINYINT",
      length: "1",
      isPrimaryKey: false,
      isAutoIncrement: false,
      isNullable: false,
      isUnique: false,
      defaultValue: "1",
      comment: "1=Activo, 0=Inactivo",
    },
    {
      id: "col-4",
      name: "creado_en",
      dataType: "TIMESTAMP",
      length: "",
      isPrimaryKey: false,
      isAutoIncrement: false,
      isNullable: false,
      isUnique: false,
      defaultValue: "CURRENT_TIMESTAMP",
      comment: "Fecha de registro",
    },
  ]);

  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddColumn = () => {
    const newCol: ColumnDefinition = {
      id: `col-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      name: `columna_${columns.length + 1}`,
      dataType: "VARCHAR",
      length: "100",
      isPrimaryKey: false,
      isAutoIncrement: false,
      isNullable: true,
      isUnique: false,
      defaultValue: "",
      comment: "",
    };
    setColumns((prev) => [...prev, newCol]);
  };

  const handleRemoveColumn = (id: string) => {
    if (columns.length <= 1) return;
    setColumns((prev) => prev.filter((c) => c.id !== id));
  };

  const handleUpdateColumn = (id: string, updates: Partial<ColumnDefinition>) => {
    setColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    );
  };

  const handleMoveColumn = (index: number, direction: "up" | "down") => {
    const newIdx = direction === "up" ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= columns.length) return;
    const next = [...columns];
    const item = next.splice(index, 1)[0];
    next.splice(newIdx, 0, item);
    setColumns(next);
  };

  // Build the complete CREATE TABLE SQL
  const buildSql = () => {
    const cleanDb = database.replace(/`/g, "``");
    const cleanTbl = (tableName.trim() || "nueva_tabla").replace(/`/g, "``");

    const colClauses: string[] = [];
    const pkCols: string[] = [];
    const uniqueCols: string[] = [];

    for (const col of columns) {
      if (!col.name.trim()) continue;
      const cleanCol = col.name.trim().replace(/`/g, "``");
      let typeDef = col.dataType;

      if (
        col.length &&
        col.length.trim() &&
        !["TEXT", "MEDIUMTEXT", "LONGTEXT", "DATETIME", "TIMESTAMP", "DATE", "JSON", "BLOB", "BOOLEAN"].includes(col.dataType)
      ) {
        typeDef = `${col.dataType}(${col.length.trim()})`;
      }

      const isText = [
        "VARCHAR",
        "CHAR",
        "TEXT",
        "MEDIUMTEXT",
        "LONGTEXT",
        "TINYTEXT",
        "ENUM",
        "SET",
      ].includes(col.dataType.toUpperCase());

      const charsetDef = isText && col.charset && col.charset.trim() ? `CHARACTER SET ${col.charset.trim()}` : "";
      const collationDef = isText && col.collation && col.collation.trim() ? `COLLATE ${col.collation.trim()}` : "";

      const nullDef = col.isNullable ? "NULL" : "NOT NULL";
      let defaultDef = "";
      if (col.defaultValue && col.defaultValue.trim()) {
        const d = col.defaultValue.trim();
        if (d.toUpperCase() === "NULL") {
          defaultDef = "DEFAULT NULL";
        } else if (
          d.toUpperCase() === "CURRENT_TIMESTAMP" ||
          d.toUpperCase() === "NOW()" ||
          d.toUpperCase() === "CURRENT_TIMESTAMP()"
        ) {
          defaultDef = "DEFAULT CURRENT_TIMESTAMP";
        } else {
          defaultDef = `DEFAULT '${d.replace(/'/g, "\\'")}'`;
        }
      }

      const extraDef = col.isAutoIncrement ? "AUTO_INCREMENT" : "";
      const commentDef = col.comment && col.comment.trim() ? `COMMENT '${col.comment.replace(/'/g, "\\'")}'` : "";

      const colLine = [
        `  \`${cleanCol}\``,
        typeDef,
        charsetDef,
        collationDef,
        nullDef,
        defaultDef,
        extraDef,
        commentDef,
      ]
        .filter(Boolean)
        .join(" ");

      colClauses.push(colLine);

      if (col.isPrimaryKey) {
        pkCols.push(`\`${cleanCol}\``);
      }
      if (col.isUnique && !col.isPrimaryKey) {
        uniqueCols.push(`\`${cleanCol}\``);
      }
    }

    if (pkCols.length > 0) {
      colClauses.push(`  PRIMARY KEY (${pkCols.join(", ")})`);
    }
    for (const u of uniqueCols) {
      colClauses.push(`  UNIQUE KEY (${u})`);
    }

    const commentClause = comment.trim() ? ` COMMENT='${comment.replace(/'/g, "\\'")}'` : "";

    return `CREATE TABLE \`${cleanDb}\`.\`${cleanTbl}\` (\n${colClauses.join(",\n")}\n) ENGINE=${engine} DEFAULT CHARSET=utf8mb4 COLLATE=${collation}${commentClause};`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableName.trim()) {
      setError("Por favor ingresa un nombre para la nueva tabla.");
      return;
    }
    if (columns.length === 0 || !columns.some((c) => c.name.trim())) {
      setError("Debes definir al menos una columna.");
      return;
    }

    setIsExecuting(true);
    setError(null);

    const createSql = buildSql();

    try {
      await dbService.executeQuery(createSql, database);
      onTableCreated(database, tableName.trim());
      onClose();
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al crear la tabla en MariaDB";
      setError(msg);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-5xl h-[640px] bg-[#11131a] border border-[#262c3e] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-3.5 bg-[#141822] border-b border-[#212638] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-orange-600/20 border border-orange-500/30 flex items-center justify-center">
              <TableIcon className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Crear Nueva Tabla
              </h2>
              <p className="text-xs text-neutral-400 font-mono">
                Esquema destino: <strong className="text-orange-400">{database}</strong>
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

        {/* Modal Form */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col justify-between overflow-hidden"
        >
          <div className="p-6 overflow-y-auto space-y-4 flex-1">
            {/* Table Settings Row */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-[#0d0f15] p-3.5 rounded-lg border border-[#1e2333]">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-300">
                  Nombre de la Tabla <span className="text-orange-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="ej. clientes o ordenes_pago"
                  className="w-full px-3 py-1.5 text-xs bg-[#121520] border border-[#262e42] rounded text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-300">
                  Motor (Engine)
                </label>
                <select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-[#121520] border border-[#262e42] rounded text-white focus:outline-none focus:border-orange-500 font-mono"
                >
                  {ENGINES.map((eng) => (
                    <option key={eng} value={eng}>
                      {eng}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-300">
                  Collation
                </label>
                <select
                  value={collation}
                  onChange={(e) => setCollation(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-[#121520] border border-[#262e42] rounded text-white focus:outline-none focus:border-orange-500 font-mono text-[11px]"
                >
                  {COLLATIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-300">
                  Comentario (Opcional)
                </label>
                <input
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Descripción de la tabla"
                  className="w-full px-3 py-1.5 text-xs bg-[#121520] border border-[#262e42] rounded text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 text-[11px]"
                />
              </div>
            </div>

            {/* Columns Designer Header & Add Button */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center space-x-2 text-xs font-semibold text-white">
                <Sparkles className="w-4 h-4 text-orange-400" />
                <span>Definición de Columnas ({columns.length})</span>
              </div>

              <button
                type="button"
                onClick={handleAddColumn}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/40 rounded text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Añadir Columna</span>
              </button>
            </div>

            {/* Columns Table Editor */}
            <div className="bg-[#0c0e14] border border-[#1e2333] rounded-lg overflow-hidden shadow-inner max-h-56 overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#141824] text-neutral-400 font-semibold border-b border-[#212739] text-[11px] font-mono sticky top-0 z-10">
                    <th className="py-2 px-2 w-10 text-center">#</th>
                    <th className="py-2 px-3">Nombre Columna</th>
                    <th className="py-2 px-3 w-28">Tipo</th>
                    <th className="py-2 px-2 w-16">Longitud</th>
                    <th className="py-2 px-2 w-28">Collation</th>
                    <th className="py-2 px-2 text-center w-10" title="Llave Primaria">🔑 PK</th>
                    <th className="py-2 px-2 text-center w-10" title="Auto Increment">⚡ AI</th>
                    <th className="py-2 px-2 text-center w-10" title="Permite Null">NULL</th>
                    <th className="py-2 px-2 w-24">Valor Defecto</th>
                    <th className="py-2 px-3">Comentario</th>
                    <th className="py-2 px-2 w-16 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181d2a] font-mono text-xs">
                  {columns.map((col, idx) => {
                    const isText = [
                      "VARCHAR",
                      "CHAR",
                      "TEXT",
                      "MEDIUMTEXT",
                      "LONGTEXT",
                      "ENUM",
                      "SET",
                    ].includes(col.dataType.toUpperCase());

                    return (
                      <tr key={col.id} className="hover:bg-[#121622] transition-colors">
                        <td className="py-1.5 px-2 text-center text-neutral-500 text-[11px]">
                          {idx + 1}
                        </td>

                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            required
                            value={col.name}
                            onChange={(e) =>
                              handleUpdateColumn(col.id, { name: e.target.value })
                            }
                            placeholder="nombre_columna"
                            className="w-full px-2 py-1 bg-[#151926] border border-[#23293c] rounded text-white text-xs font-mono focus:outline-none focus:border-orange-500"
                          />
                        </td>

                        <td className="py-1.5 px-2">
                          <select
                            value={col.dataType}
                            onChange={(e) => {
                              const t = e.target.value;
                              let defaultLen = col.length;
                              if (t === "VARCHAR" && !col.length) defaultLen = "255";
                              else if (t === "INT" && !col.length) defaultLen = "11";
                              else if (t === "BIGINT" && !col.length) defaultLen = "20";
                              else if (t === "TINYINT" && !col.length) defaultLen = "1";
                              else if (t === "DECIMAL" && !col.length) defaultLen = "10,2";

                              handleUpdateColumn(col.id, {
                                dataType: t,
                                length: defaultLen,
                              });
                            }}
                            className="w-full px-1.5 py-1 bg-[#151926] border border-[#23293c] rounded text-white text-xs font-mono focus:outline-none focus:border-orange-500"
                          >
                            {COMMON_DATA_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={col.length}
                            onChange={(e) =>
                              handleUpdateColumn(col.id, { length: e.target.value })
                            }
                            placeholder="255"
                            className="w-full px-2 py-1 bg-[#151926] border border-[#23293c] rounded text-white text-xs font-mono focus:outline-none focus:border-orange-500"
                          />
                        </td>

                        <td className="py-1.5 px-2">
                          {isText ? (
                            <select
                              value={col.collation || ""}
                              onChange={(e) =>
                                handleUpdateColumn(col.id, { collation: e.target.value })
                              }
                              className="w-full px-1 py-1 bg-[#151926] border border-[#23293c] rounded text-neutral-300 text-[10px] font-mono focus:outline-none focus:border-orange-500"
                            >
                              <option value="">(Defecto)</option>
                              {COLLATIONS.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-neutral-600 text-center block text-[11px]">—</span>
                          )}
                        </td>

                        <td className="py-1.5 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={col.isPrimaryKey}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              handleUpdateColumn(col.id, {
                                isPrimaryKey: checked,
                                isNullable: checked ? false : col.isNullable,
                              });
                            }}
                            className="rounded border-[#2c3348] text-amber-500 focus:ring-0 bg-[#151926]"
                          />
                        </td>

                        <td className="py-1.5 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={col.isAutoIncrement}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              handleUpdateColumn(col.id, {
                                isAutoIncrement: checked,
                                isNullable: checked ? false : col.isNullable,
                                dataType: checked && !col.dataType.includes("INT") ? "BIGINT" : col.dataType,
                              });
                            }}
                            className="rounded border-[#2c3348] text-orange-500 focus:ring-0 bg-[#151926]"
                          />
                        </td>

                        <td className="py-1.5 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={col.isNullable}
                            disabled={col.isPrimaryKey || col.isAutoIncrement}
                            onChange={(e) =>
                              handleUpdateColumn(col.id, { isNullable: e.target.checked })
                            }
                            className="rounded border-[#2c3348] text-emerald-500 focus:ring-0 bg-[#151926] disabled:opacity-30"
                          />
                        </td>

                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={col.defaultValue}
                            onChange={(e) =>
                              handleUpdateColumn(col.id, {
                                defaultValue: e.target.value,
                              })
                            }
                            placeholder="NULL"
                            className="w-full px-2 py-1 bg-[#151926] border border-[#23293c] rounded text-neutral-300 text-xs font-mono focus:outline-none focus:border-orange-500"
                          />
                        </td>

                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={col.comment}
                            onChange={(e) =>
                              handleUpdateColumn(col.id, { comment: e.target.value })
                            }
                            placeholder="Comentario"
                            className="w-full px-2 py-1 bg-[#151926] border border-[#23293c] rounded text-neutral-400 text-xs focus:outline-none focus:border-orange-500 font-sans"
                          />
                        </td>

                      <td className="py-1.5 px-2 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveColumn(idx, "up")}
                            className="p-1 text-neutral-500 hover:text-neutral-200 disabled:opacity-20"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === columns.length - 1}
                            onClick={() => handleMoveColumn(idx, "down")}
                            className="p-1 text-neutral-500 hover:text-neutral-200 disabled:opacity-20"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveColumn(col.id)}
                            className="p-1 text-neutral-500 hover:text-red-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>

            {/* SQL Live Preview */}
            <div className="space-y-1">
              <div className="flex items-center space-x-1.5 text-xs text-neutral-400 font-mono">
                <Code2 className="w-3.5 h-3.5 text-orange-400" />
                <span>Vista Previa DDL (CREATE TABLE):</span>
              </div>
              <pre className="p-3 bg-[#08090d] border border-[#1c2232] rounded-md text-orange-300 font-mono text-[11px] whitespace-pre-wrap select-all max-h-28 overflow-y-auto">
                {buildSql()}
              </pre>
            </div>

            {/* Error message */}
            {error && (
              <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-3 bg-[#141822] border-t border-[#1f2434] flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isExecuting || !tableName.trim()}
              className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 rounded-md shadow-md shadow-orange-950/40 transition-all disabled:opacity-50 active:scale-95"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Creando Tabla en MariaDB...</span>
                </>
              ) : (
                <>
                  <TableIcon className="w-3.5 h-3.5" />
                  <span>Crear Tabla (CREATE TABLE)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
