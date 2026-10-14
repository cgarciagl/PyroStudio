import React, { useState, useEffect, useRef } from "react";
import { Edit3, X, Ban, Check } from "lucide-react";
import { useIsLightTheme } from "../stores/preferenceStore";

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
  const isLight = useIsLightTheme();
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
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150 select-none"
      onClick={onClose}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className={`w-full max-w-md rounded-xl border flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 ${
          isLight
            ? "bg-white border-slate-200 shadow-2xl text-slate-800"
            : "bg-[#11141c] border-[#222a3d] shadow-2xl shadow-black/80 text-neutral-100"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`px-5 py-3.5 border-b flex items-center justify-between ${
            isLight ? "bg-slate-50 border-slate-200" : "bg-[#141824] border-[#1f2536]"
          }`}
        >
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-orange-500/15 text-orange-500 border border-orange-500/20">
              <Edit3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className={`font-semibold text-sm ${isLight ? "text-slate-900" : "text-neutral-100"}`}>
                Asignar Valor a la Selección
              </h3>
              <p className={`text-[11px] font-mono ${isLight ? "text-slate-500" : "text-neutral-400"}`}>
                Se aplicará a {cellCount} celda(s) seleccionada(s)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isLight
                ? "text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800/60"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={`text-xs font-medium ${isLight ? "text-slate-700" : "text-neutral-300"}`}>
                Nuevo valor para las celdas:
              </label>
              <button
                type="button"
                onClick={() => setIsNull((prev) => !prev)}
                className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-mono border transition-all ${
                  isNull
                    ? isLight
                      ? "bg-amber-100 border-amber-300 text-amber-900 font-bold"
                      : "bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold"
                    : isLight
                    ? "bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200"
                    : "bg-[#171b26] border-[#252c3e] text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <Ban className="w-3 h-3 text-amber-500" />
                <span>{isNull ? "NULL Activo ✓" : "Establecer como NULL"}</span>
              </button>
            </div>

            {isNull ? (
              <div
                className={`w-full px-3 py-2.5 rounded-lg border text-xs font-mono font-bold flex items-center justify-between ${
                  isLight
                    ? "bg-amber-50/70 border-amber-200 text-amber-900"
                    : "bg-amber-500/10 border-amber-500/25 text-amber-300"
                }`}
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
                className={`w-full px-3 py-2 rounded-lg border text-xs font-mono transition-colors focus:outline-hidden ${
                  isLight
                    ? "bg-white border-slate-300 text-slate-900 focus:border-orange-500"
                    : "bg-[#0b0d13] border-[#222a3d] text-neutral-200 focus:border-orange-500"
                }`}
              />
            )}
            <p className={`text-[11px] ${isLight ? "text-slate-500" : "text-neutral-500"}`}>
              {isNull
                ? "Todas las celdas del rango pasarán al estado NULL en cambios en cola."
                : 'Para asignar una cadena vacía deja el campo en blanco. Para NULL pulsa "Establecer como NULL".'}
            </p>
          </div>

          {/* Footer Actions */}
          <div
            className={`pt-3 border-t flex items-center justify-end space-x-2.5 ${
              isLight ? "border-slate-100" : "border-[#1e2434]"
            }`}
          >
            <button
              type="button"
              onClick={onClose}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                isLight
                  ? "bg-white hover:bg-slate-100 text-slate-700 border-slate-300 shadow-xs"
                  : "bg-[#181c26] hover:bg-[#202636] border-[#2b3345] text-neutral-300"
              }`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white shadow-md active:scale-95 transition-all"
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

