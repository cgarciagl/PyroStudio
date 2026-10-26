import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Code2,
  Copy,
  Check,
  Save,
  Braces,
} from "lucide-react";
import { useIsLightTheme } from "../stores/preferenceStore";

interface CellInspectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  database?: string;
  table: string;
  columnName: string;
  columnType?: string;
  initialValue: any;
  onSaveToStaged: (newValue: any) => void;
  isReadonly?: boolean;
}

export const CellInspectorDrawer: React.FC<CellInspectorDrawerProps> = ({
  isOpen,
  onClose,
  table,
  columnName,
  columnType = "TEXT",
  initialValue,
  onSaveToStaged,
  isReadonly = false,
}) => {
  const isLight = useIsLightTheme();
  const [textValue, setTextValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeMode, setActiveMode] = useState<"text" | "json">("text");

  // Sync state on open or cell change
  useEffect(() => {
    if (initialValue === null || initialValue === undefined) {
      setTextValue("");
    } else if (typeof initialValue === "object") {
      setTextValue(JSON.stringify(initialValue, null, 2));
    } else {
      setTextValue(String(initialValue));
    }
  }, [initialValue, isOpen]);

  // Determine if valid JSON
  const parsedJson = useMemo(() => {
    const trimmed = textValue.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }, [textValue]);

  // Auto-switch to JSON view if detected
  useEffect(() => {
    if (parsedJson !== null) {
      setActiveMode("json");
    } else {
      setActiveMode("text");
    }
  }, [parsedJson]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn("Could not copy:", err);
    }
  };

  const handleFormatJson = () => {
    if (parsedJson !== null) {
      setTextValue(JSON.stringify(parsedJson, null, 2));
    }
  };

  const handleSave = () => {
    if (isReadonly) return;
    let finalVal: any = textValue;
    if (textValue.trim().toUpperCase() === "NULL") {
      finalVal = null;
    } else if (parsedJson !== null && activeMode === "json") {
      finalVal = textValue;
    }
    onSaveToStaged(finalVal);
    onClose();
  };

  const byteLength = new TextEncoder().encode(textValue).length;

  return (
    <div
      className="fixed inset-y-0 right-0 z-40 w-96 md:w-[460px] border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 backdrop-blur-md select-none bg-opacity-95"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className={`flex flex-col h-full ${
          isLight ? "bg-white border-slate-200" : "bg-surface border-line"
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${
            isLight ? "bg-slate-50 border-slate-200" : "bg-raised border-line"
          }`}
        >
          <div className="flex items-center space-x-2 truncate">
            <div className="p-1 rounded bg-orange-500/15 text-orange-400 border border-orange-500/20">
              <Code2 className="w-4 h-4" />
            </div>
            <div className="truncate">
              <h3
                className={`font-semibold text-xs truncate ${
                  isLight ? "text-slate-900" : "text-neutral-100"
                }`}
                title={`${columnName} (${columnType})`}
              >
                {columnName}
              </h3>
              <p className={`text-[10px] font-mono ${isLight ? "text-slate-500" : "text-neutral-400"}`}>
                {table} • {columnType}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isLight
                ? "text-slate-400 hover:text-slate-700 hover:bg-slate-200"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* View Mode Tabs & Stats Bar */}
        <div
          className={`flex items-center justify-between px-3 py-1.5 border-b shrink-0 text-xs ${
            isLight ? "bg-slate-100/60 border-slate-200" : "bg-surface border-line"
          }`}
        >
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={() => setActiveMode("text")}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                activeMode === "text"
                  ? isLight
                    ? "bg-white text-orange-600 shadow-xs"
                    : "bg-elevated text-orange-400"
                  : isLight
                  ? "text-slate-500 hover:text-slate-900"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Texto
            </button>
            <button
              type="button"
              onClick={() => setActiveMode("json")}
              disabled={parsedJson === null}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors disabled:opacity-40 ${
                activeMode === "json"
                  ? isLight
                    ? "bg-white text-orange-600 shadow-xs"
                    : "bg-elevated text-orange-400"
                  : isLight
                  ? "text-slate-500 hover:text-slate-900"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              JSON {parsedJson !== null ? "✓" : ""}
            </button>
            {!isReadonly && (
              <button
                type="button"
                onClick={() => {
                  setTextValue("NULL");
                  setActiveMode("text");
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                  textValue.trim().toUpperCase() === "NULL"
                    ? isLight
                      ? "bg-amber-100 text-amber-800 border border-amber-300 font-bold"
                      : "bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold"
                    : isLight
                    ? "text-slate-500 hover:text-amber-800 hover:bg-amber-50"
                    : "text-neutral-400 hover:text-amber-400 hover:bg-amber-500/10"
                }`}
                title="Establecer contenido de la celda como NULL"
              >
                ⊘ NULL
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2 font-mono text-[10px] text-neutral-400">
            <span>{textValue.length} chars</span>
            <span>•</span>
            <span>{byteLength} B</span>
          </div>
        </div>

        {/* Editor / Viewer Body */}
        <div className="flex-1 p-3 overflow-hidden flex flex-col">
          {activeMode === "json" && parsedJson !== null ? (
            <div className="flex-1 flex flex-col space-y-2 overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                  <Braces className="w-3.5 h-3.5" /> JSON Válido Detectado
                </span>
                <button
                  type="button"
                  onClick={handleFormatJson}
                  className="text-[11px] font-medium text-orange-400 hover:underline"
                >
                  Pretty-print
                </button>
              </div>
              <textarea
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                readOnly={isReadonly}
                className={`flex-1 w-full p-3 font-mono text-xs rounded-xl border resize-none focus:outline-hidden leading-relaxed overflow-auto ${
                  isLight
                    ? "bg-slate-50 border-slate-300 text-slate-800 focus:border-orange-500"
                    : "bg-canvas border-line text-amber-300/90 focus:border-orange-500"
                }`}
                placeholder="Escribe JSON..."
                spellCheck={false}
              />
            </div>
          ) : (
            <textarea
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              readOnly={isReadonly}
              className={`flex-1 w-full p-3 font-mono text-xs rounded-xl border resize-none focus:outline-hidden leading-relaxed overflow-auto ${
                isLight
                  ? "bg-slate-50 border-slate-300 text-slate-800 focus:border-orange-500"
                  : "bg-canvas border-line text-neutral-200 focus:border-orange-500"
              }`}
              placeholder="Escribe el texto de la celda o 'NULL'..."
              spellCheck={false}
            />
          )}
        </div>

        {/* Footer Actions */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-t shrink-0 ${
            isLight ? "bg-slate-50 border-slate-200" : "bg-raised border-line"
          }`}
        >
          <button
            type="button"
            onClick={handleCopy}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              isLight
                ? "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
                : "bg-raised border-line-strong text-neutral-300 hover:bg-hover"
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "Copiado" : "Copiar"}</span>
          </button>

          {!isReadonly && (
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-accent-fg shadow-md transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Guardar en Cambios en Cola</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
