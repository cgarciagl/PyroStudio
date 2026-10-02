import React, { useState, useEffect } from "react";
import {
  X,
  Edit3,
  Save,
  Loader2,
  AlertCircle,
  Key,
} from "lucide-react";

interface EditRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  tableName: string;
  pkColumn: string;
  columns: string[];
  rowData: any[];
  rowIndex: number;
  onSave: (updatedValues: any[]) => Promise<void>;
}

export const EditRecordModal: React.FC<EditRecordModalProps> = ({
  isOpen,
  onClose,
  database,
  tableName,
  pkColumn,
  columns,
  rowData,
  rowIndex,
  onSave,
}) => {
  const [formValues, setFormValues] = useState<Record<string, { value: string; isNull: boolean }>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !rowData) return;
    const initial: Record<string, { value: string; isNull: boolean }> = {};
    columns.forEach((col, idx) => {
      const val = rowData[idx];
      if (val === null || val === undefined) {
        initial[col] = { value: "", isNull: true };
      } else {
        const str = typeof val === "object" ? JSON.stringify(val) : String(val);
        initial[col] = { value: str, isNull: false };
      }
    });
    setFormValues(initial);
    setError(null);
  }, [isOpen, columns, rowData]);

  if (!isOpen) return null;

  const handleFieldChange = (col: string, val: string) => {
    setFormValues((prev) => ({
      ...prev,
      [col]: { value: val, isNull: false },
    }));
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

    const updatedArray = columns.map((col) => {
      const field = formValues[col];
      if (!field || field.isNull) return null;
      return field.value;
    });

    try {
      await onSave(updatedArray);
      onClose();
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al actualizar el registro en MariaDB";
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#11131a] border border-[#262c3e] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-3.5 bg-[#141822] border-b border-[#212638] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-orange-600/20 border border-orange-500/30 flex items-center justify-center">
              <Edit3 className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center space-x-2">
                <span>Editar Registro (Fila #{rowIndex + 1})</span>
              </h2>
              <p className="text-xs text-neutral-400 font-mono flex items-center space-x-2">
                <span>Esquema: <strong className="text-orange-400">{database || "—"}</strong></span>
                <span>•</span>
                <span>Tabla: <strong className="text-white">{tableName || "—"}</strong></span>
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

        {/* Fields List Form */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="p-6 overflow-y-auto space-y-3.5 flex-1 divide-y divide-[#181d29]">
            {columns.map((col) => {
              const isPk = col === pkColumn;
              const field = formValues[col] || { value: "", isNull: false };

              return (
                <div key={col} className="pt-3.5 first:pt-0 grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-4 flex items-center space-x-1.5 truncate">
                    {isPk && (
                      <span title="Llave Primaria">
                        <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      </span>
                    )}
                    <label
                      htmlFor={`field-${col}`}
                      className={`text-xs font-mono truncate font-medium ${
                        isPk ? "text-amber-300" : "text-neutral-200"
                      }`}
                      title={col}
                    >
                      {col}
                    </label>
                  </div>

                  <div className="col-span-6">
                    <input
                      id={`field-${col}`}
                      type="text"
                      disabled={field.isNull}
                      value={field.value}
                      onChange={(e) => handleFieldChange(col, e.target.value)}
                      placeholder={field.isNull ? "NULL" : "Valor"}
                      className={`w-full px-3 py-1.5 text-xs rounded border font-mono transition-colors focus:outline-none ${
                        field.isNull
                          ? "bg-[#0a0b0e] border-[#1a1f2c] text-neutral-600 italic"
                          : "bg-[#141824] border-[#252c3e] text-white focus:border-orange-500"
                      }`}
                    />
                  </div>

                  <div className="col-span-2 flex items-center justify-end">
                    <label className="flex items-center space-x-1.5 text-[11px] font-mono text-neutral-400 hover:text-white cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={field.isNull}
                        onChange={(e) => handleNullToggle(col, e.target.checked)}
                        className="rounded border-[#262c3e] bg-[#161a26] text-orange-600 focus:ring-0"
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
            <div className="mx-6 mb-3 p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-start space-x-2 shrink-0">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Modal Footer */}
          <div className="px-6 py-3 bg-[#141822] border-t border-[#1f2434] flex items-center justify-end space-x-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 rounded-md shadow-md shadow-orange-950/40 transition-all disabled:opacity-50 active:scale-95"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Guardando en MariaDB...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar Registro en BD (UPDATE)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
