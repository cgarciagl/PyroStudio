import React from "react";
import { FirstTimeHint } from "./ui/FirstTimeHint";
import { Eye, Check, RotateCcw, Loader2, Layers } from "lucide-react";
import { primaryBtn } from "./ui/styles";

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

  if (changeCount === 0) return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 animate-in fade-in slide-in-from-bottom-3 duration-200">
      <FirstTimeHint id="staged_changes" className="mb-2 max-w-md">
        Tus cambios aún no se han guardado en la base. Usa «Vista previa SQL» para revisar las sentencias y «Aplicar»
        para ejecutarlas, o descártalos.
      </FirstTimeHint>
      <div
        className={`flex items-center space-x-3 px-4 py-2.5 rounded-xl border shadow-modal transition-all bg-raised/95 border-amber-500/40 text-fg`}
      >
        {/* Status Badge */}
        <div className="flex items-center space-x-2 pr-3 border-r border-amber-500/20">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
          </span>
          <span className="text-xs font-semibold flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-warning" />
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
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors bg-raised hover:bg-hover border-line-strong text-fg hover:text-fg`}
            title="Previsualizar sentencias SQL que se enviarán"
          >
            <Eye className="w-3.5 h-3.5 text-fg-muted" />
            <span>Ver SQL</span>
          </button>

          {/* Discard */}
          <button
            type="button"
            onClick={onDiscardChanges}
            disabled={isApplying}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-danger`}
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
            className={primaryBtn}
            title="Enviar lote transaccional a la base de datos (Ctrl+S / Cmd+S)"
          >
            {isApplying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5 text-fg" />
            )}
            <span>Aplicar Cambios (Ctrl+S)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
