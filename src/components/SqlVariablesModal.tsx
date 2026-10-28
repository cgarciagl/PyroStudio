import React, { useState, useEffect } from "react";
import { X, Play, Variable, AlertCircle } from "lucide-react";
import { formatCellForSql } from "../utils/formatCopy";
import { primaryBtn } from "./ui/styles";

// Session memory for parameter values
const sessionVariablesCache: Record<string, string> = {};

interface SqlVariablesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecuteWithParams: (finalSql: string) => void;
  rawSql: string;
  variableNames: string[];
}

/**
 * Extracts named parameters like :user_id from SQL, ignoring quotes and comments.
 */
export function extractSqlVariables(sql: string): string[] {
  const vars: Set<string> = new Set();
  const len = sql.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < len; i++) {
    const ch = sql[i];
    const nextCh = i + 1 < len ? sql[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n" || ch === "\r") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && nextCh === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingleQuote) {
      if (ch === "\\") i++;
      else if (ch === "'") {
        if (nextCh === "'") i++;
        else inSingleQuote = false;
      }
      continue;
    }
    if (inDoubleQuote) {
      if (ch === "\\") i++;
      else if (ch === '"') {
        if (nextCh === '"') i++;
        else inDoubleQuote = false;
      }
      continue;
    }
    if (inBacktick) {
      if (ch === "\\") i++;
      else if (ch === "`") inBacktick = false;
      continue;
    }

    if (ch === "-" && nextCh === "-") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "#") {
      inLineComment = true;
      continue;
    }
    if (ch === "/" && nextCh === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === "`") {
      inBacktick = true;
      continue;
    }

    // Check for variable placeholder :var_name (avoiding :: type casting)
    if (ch === ":" && nextCh !== ":" && /[a-zA-Z_]/.test(nextCh)) {
      let varName = "";
      let j = i + 1;
      while (j < len && /[a-zA-Z0-9_]/.test(sql[j])) {
        varName += sql[j];
        j++;
      }
      if (varName.length > 0) {
        vars.add(varName);
        i = j - 1;
      }
    }
  }

  return Array.from(vars);
}

/**
 * Safely interpolates named variables into SQL script.
 */
export function interpolateSqlVariables(
  sql: string,
  values: Record<string, string>,
): string {
  let result = "";
  const len = sql.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < len; i++) {
    const ch = sql[i];
    const nextCh = i + 1 < len ? sql[i + 1] : "";

    if (inLineComment) {
      result += ch;
      if (ch === "\n" || ch === "\r") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      result += ch;
      if (ch === "*" && nextCh === "/") {
        result += nextCh;
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingleQuote) {
      result += ch;
      if (ch === "\\") {
        if (i + 1 < len) {
          result += sql[i + 1];
          i++;
        }
      } else if (ch === "'") {
        if (nextCh === "'") {
          result += nextCh;
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }
    if (inDoubleQuote) {
      result += ch;
      if (ch === "\\") {
        if (i + 1 < len) {
          result += sql[i + 1];
          i++;
        }
      } else if (ch === '"') {
        if (nextCh === '"') {
          result += nextCh;
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
      continue;
    }
    if (inBacktick) {
      result += ch;
      if (ch === "\\") {
        if (i + 1 < len) {
          result += sql[i + 1];
          i++;
        }
      } else if (ch === "`") {
        inBacktick = false;
      }
      continue;
    }

    if (ch === "-" && nextCh === "-") {
      result += ch;
      result += nextCh;
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "#") {
      result += ch;
      inLineComment = true;
      continue;
    }
    if (ch === "/" && nextCh === "*") {
      result += ch;
      result += nextCh;
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      result += ch;
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      result += ch;
      inDoubleQuote = true;
      continue;
    }
    if (ch === "`") {
      result += ch;
      inBacktick = true;
      continue;
    }

    if (ch === ":" && nextCh !== ":" && /[a-zA-Z_]/.test(nextCh)) {
      let varName = "";
      let j = i + 1;
      while (j < len && /[a-zA-Z0-9_]/.test(sql[j])) {
        varName += sql[j];
        j++;
      }
      if (varName.length > 0 && varName in values) {
        const rawVal = values[varName];
        result += formatCellForSql(rawVal);
        i = j - 1;
        continue;
      }
    }

    result += ch;
  }

  return result;
}

export const SqlVariablesModal: React.FC<SqlVariablesModalProps> = ({
  isOpen,
  onClose,
  onExecuteWithParams,
  rawSql,
  variableNames,
}) => {
  const [params, setParams] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      const initial: Record<string, string> = {};
      variableNames.forEach((name) => {
        initial[name] = sessionVariablesCache[name] ?? "";
      });
      setParams(initial);
    }
  }, [isOpen, variableNames]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Cache values in session memory
    Object.keys(params).forEach((key) => {
      sessionVariablesCache[key] = params[key];
    });

    const interpolated = interpolateSqlVariables(rawSql, params);
    onClose();
    onExecuteWithParams(interpolated);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-lg rounded-xl border shadow-modal flex flex-col overflow-hidden zoom-in-95 bg-surface border-line`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b border-line bg-raised`}
        >
          <div className="flex items-center space-x-2.5">
            <div className="text-fg-muted">
              <Variable className="w-4 h-4" />
            </div>
            <div>
              <h3 className={`font-semibold text-sm text-fg`}>
                Parámetros Dinámicos de Consulta
              </h3>
              <p className={`text-xs text-fg-muted`}>
                Se han detectado {variableNames.length} variable(s) con nombre (:param)
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
        <form onSubmit={handleSubmit}>
          <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
            <div
              className={`p-3 rounded-lg border text-xs flex items-center space-x-2 bg-raised border-line text-fg`}
            >
              <AlertCircle className="w-4 h-4 text-accent-text shrink-0" />
              <span>
                Ingresa los valores a enlazar. Las comillas y tipos serán escapados automáticamente.
              </span>
            </div>

            <div className="space-y-3">
              {variableNames.map((name) => (
                <div key={name} className="flex flex-col space-y-1">
                  <label
                    htmlFor={`var-${name}`}
                    className="font-mono text-xs font-semibold text-accent-text flex items-center gap-1"
                  >
                    <span>:{name}</span>
                  </label>
                  <input
                    id={`var-${name}`}
                    type="text"
                    value={params[name] ?? ""}
                    onChange={(e) =>
                      setParams((prev) => ({
                        ...prev,
                        [name]: e.target.value,
                      }))
                    }
                    placeholder={`Valor para :${name} (o NULL)`}
                    className={`w-full px-3 py-1.5 font-mono text-xs rounded-lg border focus:outline-hidden transition-colors bg-canvas border-line text-fg focus:border-accent`}
                    autoFocus={variableNames[0] === name}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div
            className={`flex items-center justify-between px-5 py-3.5 border-t border-line bg-raised`}
          >
            <button
              type="button"
              onClick={onClose}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors border-line-strong text-fg hover:bg-hover`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={primaryBtn}
            >
              <Play className="w-3.5 h-3.5" />
              <span>Ejecutar con Parámetros</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
