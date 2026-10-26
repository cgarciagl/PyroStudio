import React from "react";
import { Eye, Check, RotateCcw, Loader2, Layers } from "lucide-react";
import { useIsLightTheme } from "../stores/preferenceStore";

interface StagedChangesActionBarProps {
  changeCount: number;
  onPreviewSql: () => void;
  onApplyChanges: () => void;
  onDiscardChanges: () => void;
  isApplying?: boolean;
}

export const StagedChangesActionBar: React.FC<StagedChangesActionBarProps> = ({
  changeCount,
  onPreviewSql,
  onApplyChanges,
  onDiscardChanges,
  isApplying = false,
}) => {
  const isLight = useIsLightTheme();

  if (changeCount === 0) return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 animate-in fade-in slide-in-from-bottom-3 duration-200">
      <div
        className={`flex items-center space-x-3 px-4 py-2.5 rounded-2xl border shadow-2xl backdrop-blur-md transition-all ${
          isLight
            ? "bg-white/95 border-amber-300 text-slate-800"
            : "bg-raised/95 border-amber-500/40 text-neutral-100"
        }`}
      >
        {/* Status Badge */}
        <div className="flex items-center space-x-2 pr-3 border-r border-amber-500/20">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
          </span>
          <span className="text-xs font-semibold flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-500" />
            <span>
              {changeCount} {changeCount === 1 ? "cambio pendiente" : "cambios pendientes"}
            </span>
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          {/* Preview SQL */}
          <button
            type="button"
            onClick={onPreviewSql}
            disabled={isApplying}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors ${
              isLight
                ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700"
                : "bg-raised hover:bg-hover border-line-strong text-neutral-300 hover:text-white"
            }`}
            title="Previsualizar sentencias SQL que se enviarán (Preview)"
          >
            <Eye className="w-3.5 h-3.5 text-neutral-400" />
            <span>Preview SQL</span>
          </button>

          {/* Discard */}
          <button
            type="button"
            onClick={onDiscardChanges}
            disabled={isApplying}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors ${
              isLight
                ? "bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700"
                : "bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-300"
            }`}
            title="Descartar todos los cambios pendientes sin modificar la base de datos (Esc)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Descartar (Esc)</span>
          </button>

          {/* Apply Changes */}
          <button
            type="button"
            onClick={onApplyChanges}
            disabled={isApplying}
            className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold rounded-xl bg-orange-600 hover:bg-orange-500 text-accent-fg shadow-sm transition-all disabled:opacity-50"
            title="Enviar lote transaccional a la base de datos (Ctrl+S / Cmd+S)"
          >
            {isApplying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5 text-white" />
            )}
            <span>Aplicar Cambios (Ctrl+S)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
