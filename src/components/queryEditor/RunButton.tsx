import { useTranslation } from "react-i18next";
import { Play, ChevronDown, Clock, Square } from "lucide-react";
import { menuItem, menuPanel, menuSeparator, primaryBtn, secondaryBtn } from "../ui/styles";
import { useEffect, useRef, useState } from "react";
import type { ExecutionTargetMode } from "../../services/sqlStatementExtractor";
import { QUERY_TIMEOUT_OPTIONS } from "../../stores/preferenceStore";

/** 300 → "5m", 45 → "45s", 0 → `unlimited`. */
const formatTimeout = (sec: number, unlimited: string) =>
  sec === 0 ? unlimited : sec >= 60 && sec % 60 === 0 ? `${sec / 60}m` : `${sec}s`;

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
  const { t } = useTranslation("queryEditor");
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

  const targetLabel =
    target.mode === "selection"
      ? t("runButton.targetSelection")
      : target.mode === "statement"
      ? t("runButton.targetStatement", { index: (target.statementIndex ?? 0) + 1 })
      : t("runButton.targetAll");

  return (
    <>
    {isExecuting ? (
      <button
        onClick={onCancel}
        title={t("runButton.cancelTooltip")}
        className={secondaryBtn}
      >
        <Square className="w-3.5 h-3.5 fill-current" />
        <span>{t("runButton.cancel")}</span>
      </button>
    ) : (
      <div className="relative inline-flex items-stretch" ref={menuRef}>
        <button
          onClick={onRun}
          title={t("runButton.runTooltip", {
            target: targetLabel,
            preview: target.preview ? `\n${target.preview}` : "",
          })}
          className={`${primaryBtn} rounded-r-none`}
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{t("runButton.run")}</span>
          <span className="text-[11px] opacity-75 font-normal">
            {executionMode === "auto"
              ? target.mode === "selection"
                ? t("runButton.mode.selectionShort")
                : t("runButton.mode.statementShort")
              : executionMode === "all"
              ? t("runButton.mode.allShort")
              : executionMode === "statement"
              ? t("runButton.mode.statementShort")
              : t("runButton.mode.selectionShort")}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          title={t("runButton.modeAndTimeoutTooltip")}
          className="px-1.5 rounded-r-md bg-accent hover:bg-accent-hover text-accent-fg border-l border-black/20 flex items-center"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>

        {menuOpen && (
          <div className={`${menuPanel} left-0 right-auto w-60`}>
            <div className="px-3 pt-1 pb-0.5 text-[11px] text-fg-muted">{t("runButton.menuRunHeading")}</div>
            {(
              [
                { mode: "all", label: t("runButton.mode.all"), hint: t("runButton.mode.allHint") },
                { mode: "auto", label: t("runButton.mode.auto"), hint: t("runButton.mode.autoHint") },
                { mode: "statement", label: t("runButton.mode.statement"), hint: t("runButton.mode.statementHint") },
                { mode: "selection", label: t("runButton.mode.selection"), hint: t("runButton.mode.selectionHint") },
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
            <div className="px-3 pt-1 pb-0.5 text-[11px] text-fg-muted">{t("runButton.menuTimeoutHeading")}</div>
            <div className="px-3 py-1 flex flex-wrap gap-1">
              {QUERY_TIMEOUT_OPTIONS.map((val) => (
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
                  {formatTimeout(val, "∞")}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )}

    {timeoutSec !== 0 && (
      <span className="flex items-center gap-1 text-[11px] text-fg-muted font-mono ml-1" title={t("runButton.timeoutTooltip")}>
        <Clock className="w-3 h-3" />
        {formatTimeout(timeoutSec, t("runButton.unlimited"))}
      </span>
    )}
    </>
  );
}
