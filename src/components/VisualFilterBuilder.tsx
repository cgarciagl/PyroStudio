import React, { useState, useRef, useEffect } from "react";
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  Check,
  ChevronDown,
  X,
  Code2,
  Filter,
} from "lucide-react";
import type { ColumnMetadata } from "../types/database";

export type FilterOperator =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "contains"
  | "does not contain"
  | "begins with"
  | "does not begin with"
  | "ends with"
  | "does not end with"
  | "is null"
  | "is not null"
  | "is empty"
  | "is not empty"
  | "is between"
  | "is not between"
  | "is in list"
  | "is not in list"
  | "custom";

export interface FilterRule {
  id: string;
  enabled: boolean;
  column: string;
  operator: FilterOperator;
  value: string;
  valueTo?: string;
  connector: "AND" | "OR";
  openParen?: boolean;
  closeParen?: boolean;
}

export interface SortRule {
  id: string;
  column: string;
  direction: "ASC" | "DESC";
}

export const VISUAL_FILTER_OPERATORS: Array<{ id: FilterOperator; label: string; unary?: boolean }> = [
  { id: "=", label: "=" },
  { id: "!=", label: "!=" },
  { id: "<", label: "<" },
  { id: "<=", label: "<=" },
  { id: ">", label: ">" },
  { id: ">=", label: ">=" },
  { id: "contains", label: "contiene" },
  { id: "does not contain", label: "no contiene" },
  { id: "begins with", label: "comienza con" },
  { id: "does not begin with", label: "no comienza con" },
  { id: "ends with", label: "termina con" },
  { id: "does not end with", label: "no termina con" },
  { id: "is null", label: "es nulo (IS NULL)", unary: true },
  { id: "is not null", label: "no es nulo (IS NOT NULL)", unary: true },
  { id: "is empty", label: "está vacío", unary: true },
  { id: "is not empty", label: "no está vacío", unary: true },
  { id: "is between", label: "está entre" },
  { id: "is not between", label: "no está entre" },
  { id: "is in list", label: "está en la lista" },
  { id: "is not in list", label: "no está en la lista" },
  { id: "custom", label: "[Personalizado]" },
];

/**
 * Construye una cláusula WHERE de SQL limpia y segura a partir de reglas activas
 */
export function buildFilterSql(rules: FilterRule[]): string {
  const activeRules = rules.filter((r) => r.enabled && r.column.trim());
  if (activeRules.length === 0) return "";

  const segments: string[] = [];

  activeRules.forEach((rule, idx) => {
    const colName = rule.column.trim();
    const quotedCol = `\`${colName.replace(/`/g, "``")}\``;
    const val = (rule.value ?? "").trim();
    const valTo = (rule.valueTo ?? "").trim();

    const formatLiteral = (v: string) => {
      if (/^-?\d+(\.\d+)?$/.test(v)) return v;
      return `'${v.replace(/'/g, "''")}'`;
    };

    let conditionSql = "";

    switch (rule.operator) {
      case "=":
        if (val.toUpperCase() === "NULL") conditionSql = `${quotedCol} IS NULL`;
        else conditionSql = `${quotedCol} = ${formatLiteral(val)}`;
        break;
      case "!=":
        if (val.toUpperCase() === "NULL") conditionSql = `${quotedCol} IS NOT NULL`;
        else conditionSql = `${quotedCol} != ${formatLiteral(val)}`;
        break;
      case "<":
        conditionSql = `${quotedCol} < ${formatLiteral(val)}`;
        break;
      case "<=":
        conditionSql = `${quotedCol} <= ${formatLiteral(val)}`;
        break;
      case ">":
        conditionSql = `${quotedCol} > ${formatLiteral(val)}`;
        break;
      case ">=":
        conditionSql = `${quotedCol} >= ${formatLiteral(val)}`;
        break;
      case "contains":
        conditionSql = `${quotedCol} LIKE '%${val.replace(/'/g, "''")}%'`;
        break;
      case "does not contain":
        conditionSql = `${quotedCol} NOT LIKE '%${val.replace(/'/g, "''")}%'`;
        break;
      case "begins with":
        conditionSql = `${quotedCol} LIKE '${val.replace(/'/g, "''")}%'`;
        break;
      case "does not begin with":
        conditionSql = `${quotedCol} NOT LIKE '%${val.replace(/'/g, "''")}%'`;
        break;
      case "ends with":
        conditionSql = `${quotedCol} LIKE '%${val.replace(/'/g, "''")}'`;
        break;
      case "does not end with":
        conditionSql = `${quotedCol} NOT LIKE '%${val.replace(/'/g, "''")}'`;
        break;
      case "is null":
        conditionSql = `${quotedCol} IS NULL`;
        break;
      case "is not null":
        conditionSql = `${quotedCol} IS NOT NULL`;
        break;
      case "is empty":
        conditionSql = `(${quotedCol} = '' OR ${quotedCol} IS NULL)`;
        break;
      case "is not empty":
        conditionSql = `(${quotedCol} != '' AND ${quotedCol} IS NOT NULL)`;
        break;
      case "is between":
        conditionSql = `${quotedCol} BETWEEN ${formatLiteral(val)} AND ${formatLiteral(valTo)}`;
        break;
      case "is not between":
        conditionSql = `${quotedCol} NOT BETWEEN ${formatLiteral(val)} AND ${formatLiteral(valTo)}`;
        break;
      case "is in list": {
        const items = val
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => {
            if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t;
            if (/^-?\d+(\.\d+)?$/.test(t)) return t;
            return `'${t.replace(/'/g, "''")}'`;
          });
        conditionSql = items.length > 0 ? `${quotedCol} IN (${items.join(", ")})` : "1=1";
        break;
      }
      case "is not in list": {
        const items = val
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => {
            if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t;
            if (/^-?\d+(\.\d+)?$/.test(t)) return t;
            return `'${t.replace(/'/g, "''")}'`;
          });
        conditionSql = items.length > 0 ? `${quotedCol} NOT IN (${items.join(", ")})` : "1=1";
        break;
      }
      case "custom":
        conditionSql = val ? `${quotedCol} ${val}` : "1=1";
        break;
    }

    let segment = "";
    if (rule.openParen) segment += "(";
    segment += conditionSql;
    if (rule.closeParen) segment += ")";

    if (idx < activeRules.length - 1) {
      segment += ` ${rule.connector}`;
    }

    segments.push(segment);
  });

  return segments.join(" ");
}

/**
 * Construye una cláusula ORDER BY multi-columna a partir de reglas de orden
 */
export function buildSortSql(sortRules: SortRule[]): string {
  const activeSorts = sortRules.filter((s) => s.column.trim());
  if (activeSorts.length === 0) return "";
  return activeSorts
    .map((s) => `\`${s.column.trim().replace(/`/g, "``")}\` ${s.direction}`)
    .join(", ");
}

/**
 * Evalúa una regla de filtro en memoria del lado del cliente
 */
export function evaluateFilterRuleClient(rowValue: any, rule: FilterRule): boolean {
  const val = rule.value?.trim() ?? "";
  const valTo = rule.valueTo?.trim() ?? "";
  const cellStr = rowValue === null || rowValue === undefined ? "" : String(rowValue);
  const cellNum = Number(rowValue);
  const isCellNum = !isNaN(cellNum) && rowValue !== null && rowValue !== "";

  switch (rule.operator) {
    case "=":
      if (val.toUpperCase() === "NULL") return rowValue === null || rowValue === undefined;
      if (isCellNum && !isNaN(Number(val))) return cellNum === Number(val);
      return cellStr.toLowerCase() === val.toLowerCase();
    case "!=":
      if (val.toUpperCase() === "NULL") return rowValue !== null && rowValue !== undefined;
      if (isCellNum && !isNaN(Number(val))) return cellNum !== Number(val);
      return cellStr.toLowerCase() !== val.toLowerCase();
    case "<":
      if (isCellNum && !isNaN(Number(val))) return cellNum < Number(val);
      return cellStr < val;
    case "<=":
      if (isCellNum && !isNaN(Number(val))) return cellNum <= Number(val);
      return cellStr <= val;
    case ">":
      if (isCellNum && !isNaN(Number(val))) return cellNum > Number(val);
      return cellStr > val;
    case ">=":
      if (isCellNum && !isNaN(Number(val))) return cellNum >= Number(val);
      return cellStr >= val;
    case "contains":
      return cellStr.toLowerCase().includes(val.toLowerCase());
    case "does not contain":
      return !cellStr.toLowerCase().includes(val.toLowerCase());
    case "begins with":
      return cellStr.toLowerCase().startsWith(val.toLowerCase());
    case "does not begin with":
      return !cellStr.toLowerCase().startsWith(val.toLowerCase());
    case "ends with":
      return cellStr.toLowerCase().endsWith(val.toLowerCase());
    case "does not end with":
      return !cellStr.toLowerCase().endsWith(val.toLowerCase());
    case "is null":
      return rowValue === null || rowValue === undefined;
    case "is not null":
      return rowValue !== null && rowValue !== undefined;
    case "is empty":
      return rowValue === null || rowValue === undefined || cellStr.trim() === "";
    case "is not empty":
      return rowValue !== null && rowValue !== undefined && cellStr.trim() !== "";
    case "is between": {
      const n1 = Number(val);
      const n2 = Number(valTo);
      if (isCellNum && !isNaN(n1) && !isNaN(n2)) {
        return cellNum >= Math.min(n1, n2) && cellNum <= Math.max(n1, n2);
      }
      return cellStr >= val && cellStr <= valTo;
    }
    case "is not between": {
      const n1 = Number(val);
      const n2 = Number(valTo);
      if (isCellNum && !isNaN(n1) && !isNaN(n2)) {
        return cellNum < Math.min(n1, n2) || cellNum > Math.max(n1, n2);
      }
      return cellStr < val || cellStr > valTo;
    }
    case "is in list": {
      const items = val.split(",").map((s) => s.trim().toLowerCase().replace(/^['"]|['"]$/g, ""));
      return items.includes(cellStr.toLowerCase());
    }
    case "is not in list": {
      const items = val.split(",").map((s) => s.trim().toLowerCase().replace(/^['"]|['"]$/g, ""));
      return !items.includes(cellStr.toLowerCase());
    }
    default:
      return true;
  }
}

interface VisualFilterBuilderProps {
  columns: string[] | ColumnMetadata[];
  rules: FilterRule[];
  onChangeRules: (newRules: FilterRule[]) => void;
  sortRules: SortRule[];
  onChangeSortRules: (newSorts: SortRule[]) => void;
  onApply: (whereSql: string, sortSql: string) => void;
  onReset: () => void;
  onClose: () => void;
  isLight?: boolean;
}

export const VisualFilterBuilder: React.FC<VisualFilterBuilderProps> = ({
  columns,
  rules,
  onChangeRules,
  sortRules,
  onChangeSortRules,
  onApply,
  onReset,
  onClose,
  isLight = false,
}) => {
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(
    rules.length > 0 ? rules[0].id : null,
  );
  const [openOperatorMenuId, setOpenOperatorMenuId] = useState<string | null>(null);
  const [openColumnMenuId, setOpenColumnMenuId] = useState<string | null>(null);
  const [columnSearch, setColumnSearch] = useState("");
  const [openSortColumnMenuId, setOpenSortColumnMenuId] = useState<string | null>(null);

  const operatorMenuRef = useRef<HTMLDivElement | null>(null);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);

  // Normalizar lista de nombres de columna
  const columnNames = Array.isArray(columns)
    ? columns.map((c) => (typeof c === "string" ? c : c.name))
    : [];

  // Cerrar menús al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        operatorMenuRef.current &&
        !operatorMenuRef.current.contains(e.target as Node)
      ) {
        setOpenOperatorMenuId(null);
      }
      if (
        columnMenuRef.current &&
        !columnMenuRef.current.contains(e.target as Node)
      ) {
        setOpenColumnMenuId(null);
        setOpenSortColumnMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Mover regla activa arriba o abajo
  const handleMoveRule = (direction: "up" | "down") => {
    if (!selectedRuleId) return;
    const idx = rules.findIndex((r) => r.id === selectedRuleId);
    if (idx === -1) return;

    const newIndex = direction === "up" ? idx - 1 : idx + 1;
    if (newIndex < 0 || newIndex >= rules.length) return;

    const updated = [...rules];
    const [moved] = updated.splice(idx, 1);
    updated.splice(newIndex, 0, moved);
    onChangeRules(updated);
  };

  // Añadir nueva regla de condición
  const handleAddRule = (afterIndex?: number) => {
    const defaultCol = columnNames.length > 0 ? columnNames[0] : "";
    const newRule: FilterRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      enabled: true,
      column: defaultCol,
      operator: "=",
      value: "",
      connector: "AND",
    };

    if (typeof afterIndex === "number" && afterIndex >= 0) {
      const updated = [...rules];
      updated.splice(afterIndex + 1, 0, newRule);
      onChangeRules(updated);
    } else {
      onChangeRules([...rules, newRule]);
    }
    setSelectedRuleId(newRule.id);
  };

  // Alternar paréntesis de agrupación en regla
  const handleToggleParen = (ruleId: string) => {
    onChangeRules(
      rules.map((r) => {
        if (r.id === ruleId) {
          if (!r.openParen && !r.closeParen) return { ...r, openParen: true };
          if (r.openParen && !r.closeParen) return { ...r, openParen: false, closeParen: true };
          if (!r.openParen && r.closeParen) return { ...r, openParen: true, closeParen: true };
          return { ...r, openParen: false, closeParen: false };
        }
        return r;
      }),
    );
  };

  // Eliminar regla
  const handleDeleteRule = (ruleId: string) => {
    const updated = rules.filter((r) => r.id !== ruleId);
    onChangeRules(updated);
    if (selectedRuleId === ruleId) {
      setSelectedRuleId(updated.length > 0 ? updated[0].id : null);
    }
  };

  // Actualizar campo de regla
  const handleUpdateRule = (ruleId: string, patch: Partial<FilterRule>) => {
    onChangeRules(
      rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)),
    );
  };

  // Gestión de ordenación
  const handleUpdateSortRule = (id: string, patch: Partial<SortRule>) => {
    onChangeSortRules(
      sortRules.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  };

  const handleDeleteSortRule = (id: string) => {
    onChangeSortRules(sortRules.filter((s) => s.id !== id));
  };

  const generatedWhere = buildFilterSql(rules);
  const generatedSort = buildSortSql(sortRules);

  const filteredColumns = columnNames.filter((col) =>
    col.toLowerCase().includes(columnSearch.toLowerCase()),
  );

  return (
    <div
      className={`border-b select-none transition-all duration-150 ${
        isLight
          ? "bg-[#f5f8fc] border-slate-300 text-slate-800"
          : "bg-[#0c0f17] border-[#1e2536] text-neutral-200"
      }`}
    >
      {/* Barra superior del Filtro: Filtro  ↑  ↓ */}
      <div
        className={`px-4 py-2 border-b flex items-center justify-between text-xs font-semibold ${
          isLight ? "bg-[#eaf0f8] border-slate-300" : "bg-[#111520] border-[#1a2130]"
        }`}
      >
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 text-sky-500 font-bold tracking-wide">
            <Filter className="w-3.5 h-3.5" />
            <span className="text-[13px]">Filtro</span>
          </div>

          {/* Flechas de reordenación ↑ ↓ */}
          <div className="flex items-center space-x-0.5 ml-2">
            <button
              type="button"
              onClick={() => handleMoveRule("up")}
              disabled={!selectedRuleId || rules.findIndex((r) => r.id === selectedRuleId) <= 0}
              title="Mover condición seleccionada hacia arriba"
              className={`p-1 rounded transition-colors disabled:opacity-30 ${
                isLight ? "hover:bg-slate-200 text-slate-700" : "hover:bg-[#1f273b] text-neutral-300"
              }`}
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleMoveRule("down")}
              disabled={
                !selectedRuleId ||
                rules.findIndex((r) => r.id === selectedRuleId) === -1 ||
                rules.findIndex((r) => r.id === selectedRuleId) >= rules.length - 1
              }
              title="Mover condición seleccionada hacia abajo"
              className={`p-1 rounded transition-colors disabled:opacity-30 ${
                isLight ? "hover:bg-slate-200 text-slate-700" : "hover:bg-[#1f273b] text-neutral-300"
              }`}
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => handleAddRule()}
            className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium text-sky-500 hover:text-sky-400 hover:bg-sky-500/10 transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>Añadir Regla</span>
          </button>
        </div>

        <div className="flex items-center space-x-2">
          {generatedWhere && (
            <div
              className={`hidden md:flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono border max-w-sm truncate ${
                isLight
                  ? "bg-white border-slate-300 text-slate-600"
                  : "bg-[#0a0d14] border-[#1d2436] text-sky-300"
              }`}
              title={`WHERE ${generatedWhere}`}
            >
              <Code2 className="w-3 h-3 text-sky-400 shrink-0" />
              <span className="truncate">WHERE {generatedWhere}</span>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded transition-colors ${
              isLight ? "hover:bg-slate-300 text-slate-600" : "hover:bg-[#1a2132] text-neutral-400 hover:text-white"
            }`}
            title="Cerrar panel de filtro"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Contenedor de filas de reglas */}
      <div className="p-3 space-y-1.5 max-h-56 overflow-y-auto font-mono text-xs select-text">
        {rules.length === 0 ? (
          <div className="py-4 text-center text-neutral-500 text-xs font-sans space-y-2">
            <p>No hay condiciones de filtro definidas.</p>
            <button
              type="button"
              onClick={() => handleAddRule()}
              className="px-3 py-1 rounded bg-sky-600/20 hover:bg-sky-600/30 text-sky-400 border border-sky-500/40 text-xs font-medium transition-colors"
            >
              + Crear primera condición de filtro
            </button>
          </div>
        ) : (
          rules.map((rule, idx) => {
            const isSelected = selectedRuleId === rule.id;
            const opObj = VISUAL_FILTER_OPERATORS.find((o) => o.id === rule.operator) || VISUAL_FILTER_OPERATORS[0];
            const isUnary = opObj.unary;
            const isBetween = rule.operator === "is between" || rule.operator === "is not between";

            return (
              <div
                key={rule.id}
                onClick={() => setSelectedRuleId(rule.id)}
                className={`flex flex-wrap items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer border ${
                  isSelected
                    ? isLight
                      ? "bg-[#d8e6f8] border-sky-400 shadow-xs"
                      : "bg-[#14233c] border-sky-500/60 shadow-xs"
                    : isLight
                    ? "bg-white/80 hover:bg-slate-100 border-slate-200"
                    : "bg-[#10141f] hover:bg-[#141a29] border-[#1d2436]"
                } ${!rule.enabled ? "opacity-50" : ""}`}
              >
                {/* 1. Casilla de verificación [✓] */}
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleUpdateRule(rule.id, { enabled: e.target.checked });
                  }}
                  className="rounded border-[#2c374e] bg-[#0c0f16] text-sky-500 focus:ring-0 cursor-pointer"
                  title={rule.enabled ? "Desactivar esta regla" : "Activar esta regla"}
                />

                {/* Paréntesis de apertura ( */}
                {rule.openParen && <span className="font-bold text-sky-400 text-sm">(</span>}

                {/* 2. Selector de columna */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenColumnMenuId(openColumnMenuId === rule.id ? null : rule.id);
                      setColumnSearch("");
                    }}
                    className={`font-semibold underline decoration-dotted underline-offset-4 hover:opacity-80 transition-opacity ${
                      rule.enabled ? "text-blue-500 dark:text-sky-400" : "text-neutral-400"
                    }`}
                  >
                    {rule.column || "<columna>"}
                  </button>

                  {/* Menú desplegable de columnas */}
                  {openColumnMenuId === rule.id && (
                    <div
                      ref={columnMenuRef}
                      className={`absolute left-0 top-full mt-1 w-52 max-h-60 overflow-y-auto rounded-lg shadow-2xl border py-1 z-50 text-xs font-mono animate-in fade-in ${
                        isLight ? "bg-white border-slate-300 text-slate-800" : "bg-[#10141f] border-[#252f44] text-neutral-200"
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-1.5 border-b border-[#252f44]">
                        <input
                          type="text"
                          value={columnSearch}
                          onChange={(e) => setColumnSearch(e.target.value)}
                          placeholder="Buscar columna..."
                          className="w-full px-2 py-1 bg-[#090b10] border border-[#232c3f] rounded text-neutral-200 text-[11px] focus:outline-none focus:border-sky-500"
                          autoFocus
                        />
                      </div>
                      <div className="py-1">
                        {filteredColumns.map((colName) => (
                          <button
                            key={colName}
                            type="button"
                            onClick={() => {
                              handleUpdateRule(rule.id, { column: colName });
                              setOpenColumnMenuId(null);
                            }}
                            className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors ${
                              rule.column === colName
                                ? "bg-sky-600/30 text-sky-300 font-bold"
                                : isLight
                                ? "hover:bg-slate-100"
                                : "hover:bg-[#1a2233]"
                            }`}
                          >
                            <span className="truncate">{colName}</span>
                            {rule.column === colName && <Check className="w-3.5 h-3.5 text-sky-400" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Selector de operador */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenOperatorMenuId(openOperatorMenuId === rule.id ? null : rule.id);
                    }}
                    className="px-1.5 py-0.5 rounded text-neutral-300 hover:text-white hover:bg-neutral-800/40 transition-colors flex items-center space-x-1"
                  >
                    <span>{opObj.label}</span>
                    <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                  </button>

                  {/* Menú de operadores */}
                  {openOperatorMenuId === rule.id && (
                    <div
                      ref={operatorMenuRef}
                      className={`absolute left-0 top-full mt-1 w-48 max-h-72 overflow-y-auto rounded-lg shadow-2xl border py-1.5 z-50 text-xs font-sans animate-in fade-in select-none ${
                        isLight ? "bg-white border-slate-300 text-slate-800" : "bg-[#111522] border-[#263148] text-neutral-200"
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {VISUAL_FILTER_OPERATORS.map((op) => {
                        const isCur = rule.operator === op.id;
                        return (
                          <button
                            key={op.id}
                            type="button"
                            onClick={() => {
                              handleUpdateRule(rule.id, { operator: op.id });
                              setOpenOperatorMenuId(null);
                            }}
                            className={`w-full text-left px-3 py-1 flex items-center justify-between transition-colors text-xs ${
                              isCur
                                ? "bg-sky-600/20 text-sky-400 font-semibold"
                                : isLight
                                ? "hover:bg-slate-100"
                                : "hover:bg-[#192236]"
                            }`}
                          >
                            <span>{op.label}</span>
                            {isCur && <Check className="w-3 h-3 text-sky-400" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 4. Entradas de valor / operando */}
                {!isUnary && (
                  isBetween ? (
                    <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={rule.value}
                        onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                        placeholder="<?> desde"
                        className="w-24 px-2 py-0.5 bg-[#090c12] border border-[#232c3f] rounded text-sky-300 text-xs focus:outline-none focus:border-sky-500 font-mono"
                      />
                      <span className="text-neutral-500 text-[11px]">y</span>
                      <input
                        type="text"
                        value={rule.valueTo ?? ""}
                        onChange={(e) => handleUpdateRule(rule.id, { valueTo: e.target.value })}
                        placeholder="<?> hasta"
                        className="w-24 px-2 py-0.5 bg-[#090c12] border border-[#232c3f] rounded text-sky-300 text-xs focus:outline-none focus:border-sky-500 font-mono"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={rule.value}
                        onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                        placeholder="<?>"
                        className={`px-2 py-0.5 bg-[#090c12] border border-[#232c3f] rounded text-sky-300 text-xs focus:outline-none focus:border-sky-500 font-mono ${
                          rule.operator === "is in list" || rule.operator === "is not in list"
                            ? "w-44"
                            : "w-28"
                        }`}
                      />
                    </div>
                  )
                )}

                {/* Paréntesis de cierre ) */}
                {rule.closeParen && <span className="font-bold text-sky-400 text-sm">)</span>}

                {/* 5. Conector: 'y' / 'o' */}
                {idx < rules.length - 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUpdateRule(rule.id, {
                        connector: rule.connector === "AND" ? "OR" : "AND",
                      });
                    }}
                    className="px-1.5 py-0.5 rounded text-sky-500 hover:text-sky-400 font-bold lowercase text-[11px] bg-sky-500/10 hover:bg-sky-500/20 transition-colors"
                    title="Alternar conector: 'y' (AND) / 'o' (OR)"
                  >
                    {rule.connector === "AND" ? "y" : "o"}
                  </button>
                )}

                {/* Botones de acción de fila: [+] [(]+ [X] */}
                <div className="flex items-center space-x-1 ml-auto" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => handleAddRule(idx)}
                    title="Insertar condición debajo"
                    className="p-1 rounded text-neutral-400 hover:text-sky-400 hover:bg-sky-500/10 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleParen(rule.id)}
                    title="Alternar paréntesis de agrupación ( )"
                    className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition-colors ${
                      rule.openParen || rule.closeParen
                        ? "bg-sky-500/20 text-sky-400 border border-sky-500/40"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    ( )
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteRule(rule.id)}
                    title="Eliminar condición"
                    className="p-1 rounded text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Sección de ordenación (Sort By) */}
      <div
        className={`px-4 py-2 border-t flex flex-wrap items-center gap-2 text-xs select-none ${
          isLight ? "bg-[#eaf0f8] border-slate-300" : "bg-[#0f131c] border-[#1a2130]"
        }`}
      >
        <span className="font-bold text-neutral-400 text-[11px] uppercase tracking-wider">
          Ordenar por:
        </span>

        {sortRules.map((sort) => (
          <div
            key={sort.id}
            className={`flex items-center space-x-1.5 px-2 py-0.5 rounded-md border text-xs font-mono ${
              isLight
                ? "bg-white border-slate-300 text-slate-700"
                : "bg-[#141824] border-[#252f44] text-neutral-200"
            }`}
          >
            <span>{sort.column}</span>
            <button
              type="button"
              onClick={() =>
                handleUpdateSortRule(sort.id, {
                  direction: sort.direction === "ASC" ? "DESC" : "ASC",
                })
              }
              className="px-1 rounded bg-[#0b0e16] text-[10px] text-amber-400 font-bold hover:text-amber-300"
              title="Alternar dirección de orden (ASC / DESC)"
            >
              {sort.direction}
            </button>
            <button
              type="button"
              onClick={() => handleDeleteSortRule(sort.id)}
              className="text-neutral-500 hover:text-red-400 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Botón para añadir columna de ordenación */}
        <div className="relative">
          <button
            type="button"
            onClick={() =>
              setOpenSortColumnMenuId(openSortColumnMenuId ? null : "new")
            }
            className="flex items-center space-x-1 px-2 py-0.5 rounded text-sky-500 hover:text-sky-400 hover:bg-sky-500/10 text-xs transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>Clic para añadir columna de orden...</span>
          </button>

          {openSortColumnMenuId && (
            <div
              ref={columnMenuRef}
              className={`absolute left-0 bottom-full mb-1 w-48 max-h-48 overflow-y-auto rounded-lg shadow-2xl border py-1 z-50 text-xs font-mono animate-in fade-in ${
                isLight ? "bg-white border-slate-300 text-slate-800" : "bg-[#10141f] border-[#252f44] text-neutral-200"
              }`}
            >
              {columnNames.map((colName) => (
                <button
                  key={colName}
                  type="button"
                  onClick={() => {
                    onChangeSortRules([
                      ...sortRules,
                      {
                        id: `sort_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        column: colName,
                        direction: "ASC",
                      },
                    ]);
                    setOpenSortColumnMenuId(null);
                  }}
                  className={`w-full text-left px-3 py-1.5 transition-colors ${
                    isLight ? "hover:bg-slate-100" : "hover:bg-[#1a2233]"
                  }`}
                >
                  {colName}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Barra de acciones inferior */}
      <div
        className={`px-4 py-2 border-t flex flex-wrap items-center justify-between gap-2 select-none ${
          isLight ? "bg-[#f0f4fa] border-slate-300" : "bg-[#0a0d14] border-[#181e2b]"
        }`}
      >
        <div className="flex items-center space-x-2">
          {/* Botón Aplicar Filtro y Orden */}
          <button
            type="button"
            onClick={() => onApply(generatedWhere, generatedSort)}
            className="px-4 py-1.5 rounded-md bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-semibold text-xs shadow-sm transition-all active:scale-95 flex items-center space-x-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Aplicar Filtro y Orden</span>
          </button>

          <button
            type="button"
            onClick={onReset}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
              isLight
                ? "bg-white hover:bg-slate-100 text-slate-700 border-slate-300"
                : "bg-[#141824] hover:bg-[#1e2436] text-neutral-300 border-[#232c3f]"
            }`}
          >
            Limpiar Filtro
          </button>
        </div>

        <div className="flex items-center space-x-2">
          {generatedSort && (
            <span className="text-[11px] font-mono text-neutral-400 hidden sm:inline">
              ORDER BY {generatedSort}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1.5 rounded text-xs transition-colors ${
              isLight ? "hover:bg-slate-200 text-slate-600" : "hover:bg-[#1a2030] text-neutral-400 hover:text-white"
            }`}
          >
            Ocultar Panel
          </button>
        </div>
      </div>
    </div>
  );
};
