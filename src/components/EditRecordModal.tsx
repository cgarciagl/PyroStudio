import React, { useState, useEffect } from "react";
import {
  X,
  Edit3,
  Plus,
  Save,
  Loader2,
  AlertCircle,
  Key,
} from "lucide-react";
import { standardizeNumericString } from "../utils/pasteParser";
import { iconBtn, modalHeader, modalTitle, secondaryBtn } from "./ui/styles";

interface EditRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  tableName: string;
  pkColumns?: string[];
  pkColumn?: string;
  columns: string[];
  columnTypes?: string[];
  rowData?: any[];
  rowIndex?: number;
  isNewRecord?: boolean;
  onSave: (updatedValues: any[]) => Promise<void>;
}

export const EditRecordModal: React.FC<EditRecordModalProps> = ({
  isOpen,
  onClose,
  database,
  tableName,
  pkColumns,
  pkColumn,
  columns,
  columnTypes,
  rowData,
  rowIndex = -1,
  isNewRecord = false,
  onSave,
}) => {
  const activePkCols = React.useMemo(() => {
    if (pkColumns && pkColumns.length > 0) return pkColumns;
    if (pkColumn) return [pkColumn];
    return [];
  }, [pkColumns, pkColumn]);

  const [formValues, setFormValues] = useState<Record<string, { value: string; isNull: boolean }>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const initial: Record<string, { value: string; isNull: boolean }> = {};

    columns.forEach((col, idx) => {
      const isPk = activePkCols.includes(col);
      if (isNewRecord || !rowData) {
        // For new records: Primary keys default to NULL for AUTO_INCREMENT
        initial[col] = { value: "", isNull: isPk };
      } else {
        const val = rowData[idx];
        if (val === null || val === undefined) {
          initial[col] = { value: "", isNull: true };
        } else {
          let str = typeof val === "object" ? JSON.stringify(val) : String(val);
          const colType = (columnTypes?.[idx] || "").toUpperCase();
          const isColNumeric =
            colType.includes("INT") ||
            colType.includes("DECIMAL") ||
            colType.includes("FLOAT") ||
            colType.includes("DOUBLE") ||
            colType.includes("NUMERIC") ||
            colType.includes("REAL") ||
            typeof val === "number";
          if (isColNumeric && typeof str === "string") {
            str = standardizeNumericString(str);
          }
          initial[col] = { value: str, isNull: false };
        }
      }
    });
    setFormValues(initial);
    setError(null);
  }, [isOpen, columns, rowData, isNewRecord, activePkCols, columnTypes]);

  if (!isOpen) return null;

  const handleFieldChange = (col: string, val: string, isNumeric?: boolean) => {
    let finalVal = val;
    if (isNumeric) {
      // Automatically convert any comma to dot as the user types
      finalVal = finalVal.replace(/,/g, ".");
    }
    setFormValues((prev) => ({
      ...prev,
      [col]: { value: finalVal, isNull: false },
    }));
  };

  const handleFieldBlur = (col: string, isNumeric?: boolean) => {
    if (!isNumeric) return;
    setFormValues((prev) => {
      const current = prev[col];
      if (!current || current.isNull || !current.value) return prev;
      return {
        ...prev,
        [col]: {
          ...current,
          value: standardizeNumericString(current.value),
        },
      };
    });
  };

  const handleNullToggle = (col: string, isNull: boolean) => {
    setFormValues((prev) => ({
      ...prev,
      [col]: {
        value: isNull ? "" : prev[col]?.value || "",
        isNull,
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    const updatedArray = columns.map((col, idx) => {
      const field = formValues[col];
      if (!field || field.isNull) return null;
      let val = field.value;
      const colType = (columnTypes?.[idx] || "").toUpperCase();
      const isColNumeric =
        colType.includes("INT") ||
        colType.includes("DECIMAL") ||
        colType.includes("FLOAT") ||
        colType.includes("DOUBLE") ||
        colType.includes("NUMERIC") ||
        colType.includes("REAL");
      if (isColNumeric && typeof val === "string") {
        val = standardizeNumericString(val);
      }
      return val;
    });

    try {
      await onSave(updatedArray);
      onClose();
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || (isNewRecord ? "Error al insertar el registro en MariaDB" : "Error al actualizar el registro en MariaDB");
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-2xl bg-surface border border-line rounded-xl shadow-modal overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className={modalHeader}>
          <div className="flex items-center space-x-3">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                isNewRecord
                  ? "border-line text-success"
                  : "bg-accent-soft border-accent/30 text-accent-text"
              }`}
            >
              {isNewRecord ? <Plus className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
            </div>
            <div>
              <h2 className={modalTitle}>
                <span>{isNewRecord ? "Registrar Nuevo Registro" : `Editar Registro (Fila #${rowIndex + 1})`}</span>
              </h2>
              <p className="text-xs text-fg-muted font-mono flex items-center space-x-2">
                <span>Esquema: <strong className="text-accent-text">{database || "—"}</strong></span>
                <span>•</span>
                <span>Tabla: <strong className="text-fg">{tableName || "—"}</strong></span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={iconBtn}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fields List Form */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="p-6 overflow-y-auto space-y-3.5 flex-1 divide-y divide-line">
            {columns.map((col, idx) => {
              const isPk = activePkCols.includes(col);
              const colType = columnTypes?.[idx];
              const field = formValues[col] || { value: "", isNull: false };

              return (
                <div key={col} className="pt-3.5 first:pt-0 grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-4 flex items-center space-x-1.5 truncate">
                    {isPk && (
                      <span title="Llave Primaria">
                        <Key className="w-3.5 h-3.5 text-warning shrink-0" />
                      </span>
                    )}
                    <div className="truncate">
                      <label
                        htmlFor={`field-${col}`}
                        className={`text-xs font-mono truncate font-medium block ${
                          isPk ? "text-warning" : "text-fg"
                        }`}
                        title={col}
                      >
                        {col}
                      </label>
                      {colType && (
                        <span className="text-[11px] text-fg-subtle font-mono block truncate">
                          {colType}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="col-span-6">
                    {(() => {
                      const upperType = (colType || "").toUpperCase();
                      const isColNumeric =
                        upperType.includes("INT") ||
                        upperType.includes("DECIMAL") ||
                        upperType.includes("FLOAT") ||
                        upperType.includes("DOUBLE") ||
                        upperType.includes("NUMERIC") ||
                        upperType.includes("REAL");
                      return (
                        <input
                          id={`field-${col}`}
                          type="text"
                          disabled={field.isNull}
                          value={field.value}
                          onChange={(e) => handleFieldChange(col, e.target.value, isColNumeric)}
                          onBlur={() => handleFieldBlur(col, isColNumeric)}
                          placeholder={
                            field.isNull
                              ? isNewRecord && isPk
                                ? "AUTO_INCREMENT (NULL)"
                                : "NULL"
                              : isColNumeric
                              ? "Ej: 1234.56"
                              : "Valor"
                          }
                          className={`w-full px-3 py-1.5 text-xs rounded border font-mono transition-colors focus:outline-none ${
                            field.isNull
                              ? "bg-canvas border-line text-fg-subtle italic"
                              : "bg-raised border-line text-fg focus:border-accent"
                          }`}
                        />
                      );
                    })()}
                  </div>

                  <div className="col-span-2 flex items-center justify-end">
                    <label className="flex items-center space-x-1.5 text-[11px] font-mono text-fg-muted hover:text-fg cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={field.isNull}
                        onChange={(e) => handleNullToggle(col, e.target.checked)}
                        className="rounded border-line bg-raised text-accent-text focus:ring-0"
                      />
                      <span>NULL</span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Error display */}
          {error && (
            <div className="mx-6 mb-3 p-3 rounded-lg border border-line text-danger text-xs flex items-start space-x-2 shrink-0">
              <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Modal Footer */}
          <div className="px-6 py-3 bg-raised border-t border-line flex items-center justify-end space-x-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className={secondaryBtn}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className={`flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-accent-fg rounded-md shadow-md transition-all disabled:opacity-50 ${
                isNewRecord
                  ? "bg-raised hover:bg-hover"
                  : "bg-accent hover:bg-accent-hover"
              }`}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{isNewRecord ? "Insertando en MariaDB..." : "Guardando en MariaDB..."}</span>
                </>
              ) : (
                <>
                  {isNewRecord ? <Plus className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{isNewRecord ? "Insertar Registro (INSERT)" : "Guardar Registro en BD (UPDATE)"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
