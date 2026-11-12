import { Play, ChevronDown, Clock, Square } from "lucide-react";
import { menuItem, menuPanel, menuSeparator, primaryBtn, secondaryBtn } from "../ui/styles";
import { useEffect, useRef, useState } from "react";
import type { ExecutionTargetMode } from "../../services/sqlStatementExtractor";

export interface RunTarget {
  mode: string;
  statementIndex?: number;
  preview?: string;
}

interface RunButtonProps {
  isExecuting: boolean;
  /** What a click would run now (selection / statement / script). */
  target: RunTarget;
  executionMode: ExecutionTargetMode;
  timeoutSec: number;
  onRun: () => void;
  onCancel: () => void;
  onModeChange: (mode: ExecutionTargetMode) => void;
  onTimeoutChange: (seconds: number) => void;
}

/** Run / Cancel with the execution-mode and time-limit menu. */
export function RunButton({
  isExecuting,
  target,
  executionMode,
  timeoutSec,
  onRun,
  onCancel,
  onModeChange,
  onTimeoutChange,
}: RunButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);
  return (
    <>
    {isExecuting ? (
      <button
        onClick={onCancel}
        title="Cancelar ejecución (Esc)"
        className={secondaryBtn}
      >
        <Square className="w-3.5 h-3.5 fill-current" />
        <span>Cancelar</span>
      </button>
    ) : (
      <div className="relative inline-flex items-stretch" ref={menuRef}>
        <button
          onClick={onRun}
          title={`Ejecutar: ${target.mode === "selection" ? "selección" : target.mode === "statement" ? `sentencia #${(target.statementIndex ?? 0) + 1}` : "todo el script"} (Ctrl+Enter)\n${target.preview || ""}`}
          className={`${primaryBtn} rounded-r-none`}
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Ejecutar</span>
          <span className="text-[11px] opacity-75 font-normal">
            {executionMode === "auto"
              ? target.mode === "selection"
                ? "selección"
                : "sentencia"
              : executionMode === "all"
              ? "todo"
              : executionMode === "statement"
              ? "sentencia"
              : "selección"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          title="Modo de ejecución y tiempo límite"
          className="px-1.5 rounded-r-md bg-accent hover:bg-accent-hover text-accent-fg border-l border-black/20 flex items-center"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>

        {menuOpen && (
          <div className={`${menuPanel} left-0 right-auto w-60`}>
            <div className="px-3 pt-1 pb-0.5 text-[11px] text-fg-muted">Ejecutar</div>
            {(
              [
                { mode: "all", label: "Todo el script", hint: "Predeterminado" },
                { mode: "auto", label: "Auto (cursor o selección)", hint: "Ctrl+Shift+Enter" },
                { mode: "statement", label: "Sentencia actual", hint: "Cursor" },
                { mode: "selection", label: "Solo selección", hint: "Resaltado" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.mode}
                onClick={() => {
                  onModeChange(opt.mode);
                  setMenuOpen(false);
                }}
                className={`${menuItem} justify-between ${executionMode === opt.mode ? "text-accent font-medium" : ""}`}
              >
                <span>{opt.label}</span>
                <span className="text-[11px] text-fg-muted">{opt.hint}</span>
              </button>
            ))}
            <div className={menuSeparator} />
            <div className="px-3 pt-1 pb-0.5 text-[11px] text-fg-muted">Tiempo límite</div>
            <div className="px-3 py-1 flex flex-wrap gap-1">
              {[5, 10, 30, 60, 120, 0].map((val) => (
                <button
                  key={val}
                  onClick={() => {
                    onTimeoutChange(val);
                    setMenuOpen(false);
                  }}
                  className={`px-2 py-0.5 rounded font-mono text-[11px] ${
                    timeoutSec === val ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-hover hover:text-fg"
                  }`}
                >
                  {val === 0 ? "∞" : `${val}s`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )}

    {timeoutSec !== 30 && (
      <span className="flex items-center gap-1 text-[11px] text-fg-muted font-mono ml-1" title="Tiempo límite de la consulta">
        <Clock className="w-3 h-3" />
        {timeoutSec === 0 ? "sin límite" : `${timeoutSec}s`}
      </span>
    )}
    </>
  );
}
