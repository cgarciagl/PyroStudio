import React, { useState, useEffect, useRef } from "react";
import { Edit3, X, Ban, Check } from "lucide-react";
import { primaryBtn } from "./ui/styles";

interface FillSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  cellCount: number;
  onApply: (value: any) => void;
}

export const FillSelectionModal: React.FC<FillSelectionModalProps> = ({
  isOpen,
  onClose,
  cellCount,
  onApply,
}) => {
  const [value, setValue] = useState("");
  const [isNull, setIsNull] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue("");
      setIsNull(false);
      setTimeout(() => inputRef.current?.focus(), 50);
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

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isNull) {
      onApply(null);
    } else {
      onApply(value);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150 select-none"
      onClick={onClose}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className={`w-full max-w-md rounded-xl border flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 bg-surface border-line shadow-modal text-fg`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`px-5 py-3.5 border-b flex items-center justify-between bg-raised border-line`}
        >
          <div className="flex items-center space-x-2.5">
            <div className="text-fg-muted">
              <Edit3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className={`font-semibold text-sm text-fg`}>
                Asignar Valor a la Selección
              </h3>
              <p className={`text-[11px] font-mono text-fg-muted`}>
                Se aplicará a {cellCount} celda(s) seleccionada(s)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors text-fg-muted hover:text-fg hover:bg-hover`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={`text-xs font-medium text-fg`}>
                Nuevo valor para las celdas:
              </label>
              <button
                type="button"
                onClick={() => setIsNull((prev) => !prev)}
                className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-mono border transition-all ${
                  isNull
                  ? "bg-amber-500/20 border-amber-500/40 text-warning font-bold"
                  : "bg-raised border-line text-fg-muted hover:text-fg"
                }`}
              >
                <Ban className="w-3 h-3 text-warning" />
                <span>{isNull ? "NULL Activo ✓" : "Establecer como NULL"}</span>
              </button>
            </div>

            {isNull ? (
              <div
                className={`w-full px-3 py-2.5 rounded-lg border text-xs font-mono font-bold flex items-center justify-between bg-amber-500/10 border-amber-500/25 text-warning`}
              >
                <span>NULL (Valor nulo de base de datos)</span>
                <span className="text-[10px] opacity-70">Desmarca el botón arriba para ingresar texto</span>
              </div>
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Escribe el valor a replicar..."
                className={`w-full px-3 py-2 rounded-lg border text-xs font-mono transition-colors focus:outline-hidden bg-canvas border-line text-fg focus:border-accent`}
              />
            )}
            <p className={`text-[11px] text-fg-subtle`}>
              {isNull
                ? "Todas las celdas del rango pasarán al estado NULL en cambios en cola."
                : 'Para asignar una cadena vacía deja el campo en blanco. Para NULL pulsa "Establecer como NULL".'}
            </p>
          </div>

          {/* Footer Actions */}
          <div
            className={`pt-3 border-t flex items-center justify-end space-x-2.5 border-line`}
          >
            <button
              type="button"
              onClick={onClose}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-raised hover:bg-hover border-line-strong text-fg`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={primaryBtn}
            >
              <Check className="w-3.5 h-3.5" />
              <span>Aplicar a {cellCount} celda(s)</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

