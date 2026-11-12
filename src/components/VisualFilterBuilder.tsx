import React, { useMemo, useRef, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Check, Copy, Plus, X } from "lucide-react";
import type { ColumnMetadata } from "../types/database";
import { uid } from "../utils/uid";
import { reportError } from "../utils/errors";
import { ghostBtn, iconBtn, primaryBtn, sectionLabel } from "./ui/styles";
import { buildFilterSql, buildSortSql, validateFilter, type FilterRule, type SortRule } from "./filter/filterSql";
import { FilterRuleRow } from "./filter/FilterRuleRow";
import { PickerMenu } from "./filter/PickerMenu";

// The grid and its tests import the rules from here.
export {
  VISUAL_FILTER_OPERATORS,
  buildFilterSql,
  buildSortSql,
  evaluateFilterRuleClient,
  type FilterOperator,
  type FilterRule,
  type SortRule,
} from "./filter/filterSql";

interface VisualFilterBuilderProps {
  columns: string[] | ColumnMetadata[];
  rules: FilterRule[];
  onChangeRules: (newRules: FilterRule[]) => void;
  sortRules: SortRule[];
  onChangeSortRules: (newSorts: SortRule[]) => void;
  onApply: (whereSql: string, sortSql: string) => void;
  onReset: () => void;
  onClose: () => void;
}

/**
 * Filter and sort panel of the data grid (table and query results). Reads like the SQL it
 * builds: "Donde columna operador valor, y …", then "Ordenar por", and shows that SQL
 * before applying. Problems (missing values, unbalanced groups) are flagged inline.
 */
export const VisualFilterBuilder: React.FC<VisualFilterBuilderProps> = ({
  columns,
  rules,
  onChangeRules,
  sortRules,
  onChangeSortRules,
  onApply,
  onReset,
  onClose,
}) => {
  const columnNames = useMemo(() => columns.map((c) => (typeof c === "string" ? c : c.name)), [columns]);
  const [sortPickerOpen, setSortPickerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const addSortRef = useRef<HTMLButtonElement>(null);

  const where = buildFilterSql(rules);
  const orderBy = buildSortSql(sortRules);
  const issues = validateFilter(rules);
  const blocking = issues.global ?? (Object.keys(issues.byRule).length ? "Complete las condiciones marcadas." : undefined);
  const activeCount = rules.filter((r) => r.enabled && r.column.trim()).length;

  const update = (id: string, patch: Partial<FilterRule>) => onChangeRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRule = (afterIndex?: number) => {
    const rule: FilterRule = { id: `rule_${uid()}`, enabled: true, column: columnNames[0] ?? "", operator: "=", value: "", connector: "AND" };
    const next = [...rules];
    next.splice(afterIndex === undefined ? next.length : afterIndex + 1, 0, rule);
    onChangeRules(next);
  };

  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= rules.length) return;
    const next = [...rules];
    [next[index], next[to]] = [next[to], next[index]];
    onChangeRules(next);
  };

  const apply = () => {
    if (!blocking) onApply(where, orderBy);
  };

  const copySql = () => {
    const sql = [where && `WHERE ${where}`, orderBy && `ORDER BY ${orderBy}`].filter(Boolean).join("\n");
    navigator.clipboard.writeText(sql).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      (err) => reportError("No se pudo copiar el SQL", err),
    );
  };

  const unusedSortColumns = columnNames.filter((c) => !sortRules.some((s) => s.column === c));

  return (
    <section
      data-filter-builder
      aria-label="Filtro y orden"
      className="border-b border-line bg-surface text-fg text-xs"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          apply();
        } else if (e.key === "Escape" && !e.defaultPrevented) {
          onClose();
        }
      }}
    >
      <div className="px-3 py-1.5 border-b border-line flex items-center gap-2">
        <h2 className="text-xs font-semibold text-fg">Filtro y orden</h2>
        <span className="text-[11px] text-fg-muted tabular-nums">
          {activeCount === 0 ? "sin condiciones" : `${activeCount} ${activeCount === 1 ? "condición" : "condiciones"}`}
          {sortRules.length > 0 && ` · ${sortRules.length} ${sortRules.length === 1 ? "orden" : "órdenes"}`}
        </span>
        <button type="button" onClick={onClose} aria-label="Cerrar el filtro" title="Cerrar (Esc)" className={`${iconBtn} ml-auto`}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-1.5 max-h-60 overflow-y-auto">
        {rules.length === 0 ? (
          <div className="py-1.5">
            <button type="button" onClick={() => addRule()} className={ghostBtn}>
              <Plus className="w-3.5 h-3.5" /> Agregar condición
            </button>
          </div>
        ) : (
          <>
            {rules.map((rule, i) => (
              <FilterRuleRow
                key={rule.id}
                rule={rule}
                index={i}
                count={rules.length}
                joinWithPrevious={i > 0 ? rules[i - 1].connector : undefined}
                columns={columnNames}
                issue={issues.byRule[rule.id]}
                onChange={(patch) => update(rule.id, patch)}
                onToggleJoin={() => update(rules[i - 1].id, { connector: rules[i - 1].connector === "AND" ? "OR" : "AND" })}
                onInsertBelow={() => addRule(i)}
                onMove={(dir) => move(i, dir)}
                onDelete={() => onChangeRules(rules.filter((r) => r.id !== rule.id))}
                onSubmit={apply}
              />
            ))}
            <button type="button" onClick={() => addRule()} className={`${ghostBtn} mt-0.5`}>
              <Plus className="w-3.5 h-3.5" /> Condición
            </button>
          </>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-line flex flex-wrap items-center gap-1.5">
        <span className={`${sectionLabel} mr-1`}>Ordenar por</span>
        {sortRules.map((s, i) => (
          <span key={s.id} className="inline-flex items-center h-7 rounded-md border border-line bg-canvas">
            <span className="pl-2 pr-1 font-mono text-fg">
              {sortRules.length > 1 && <span className="text-fg-subtle mr-1 tabular-nums">{i + 1}.</span>}
              {s.column}
            </span>
            <button
              type="button"
              onClick={() => onChangeSortRules(sortRules.map((x) => (x.id === s.id ? { ...x, direction: x.direction === "ASC" ? "DESC" : "ASC" } : x)))}
              title="Cambiar el sentido"
              aria-label={`${s.column}: ${s.direction === "ASC" ? "ascendente" : "descendente"}. Cambiar`}
              className="h-full inline-flex items-center gap-1 px-1.5 text-[11px] text-fg-muted hover:text-fg hover:bg-hover"
            >
              {s.direction === "ASC" ? <ArrowUpNarrowWide className="w-3 h-3" /> : <ArrowDownWideNarrow className="w-3 h-3" />}
              {s.direction === "ASC" ? "asc" : "desc"}
            </button>
            <button
              type="button"
              onClick={() => onChangeSortRules(sortRules.filter((x) => x.id !== s.id))}
              aria-label={`Quitar el orden por ${s.column}`}
              className="h-full px-1.5 rounded-r-md text-fg-subtle hover:text-fg hover:bg-hover"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {unusedSortColumns.length > 0 && (
          <button ref={addSortRef} type="button" onClick={() => setSortPickerOpen((v) => !v)} className={ghostBtn}>
            <Plus className="w-3.5 h-3.5" /> {sortRules.length ? "Otra columna" : "Columna"}
          </button>
        )}
        {sortRules.length === 0 && <span className="text-[11px] text-fg-subtle">orden natural de la tabla</span>}
        {sortPickerOpen && addSortRef.current && (
          <PickerMenu
            anchor={addSortRef.current}
            items={unusedSortColumns.map((c) => ({ id: c, label: c }))}
            searchable
            mono
            placeholder="Buscar columna"
            onPick={(c) => {
              onChangeSortRules([...sortRules, { id: `sort_${uid()}`, column: c, direction: "ASC" }]);
              setSortPickerOpen(false);
            }}
            onClose={() => setSortPickerOpen(false)}
          />
        )}
      </div>

      {/* What will run, then the actions. */}
      <div className="px-3 py-2 border-t border-line flex flex-wrap items-center gap-2 bg-canvas">
        <div className="min-w-0 flex-1 flex items-center gap-1">
          {where || orderBy ? (
            <>
              <span className="min-w-0 line-clamp-2 break-all font-mono text-[11px] text-fg-muted select-text" title={`${where ? `WHERE ${where}` : ""}${where && orderBy ? "\n" : ""}${orderBy ? `ORDER BY ${orderBy}` : ""}`}>
                {where && <><span className="text-fg-subtle">WHERE</span> {where}</>}
                {where && orderBy && " "}
                {orderBy && <><span className="text-fg-subtle">ORDER BY</span> {orderBy}</>}
              </span>
              <button type="button" onClick={copySql} aria-label="Copiar el SQL" title="Copiar el SQL" className={`${iconBtn} shrink-0`}>
                {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
              </button>
            </>
          ) : (
            <span className="text-[11px] text-fg-subtle">Sin filtro ni orden: se muestran todas las filas.</span>
          )}
        </div>
        {blocking && (
          <span role="status" className="text-[11px] text-warning">
            {blocking}
          </span>
        )}
        <button type="button" onClick={onReset} className={ghostBtn} disabled={rules.length === 0 && sortRules.length === 0}>
          Limpiar
        </button>
        <button type="button" onClick={apply} disabled={!!blocking} title="Aplicar (Ctrl+Enter)" className={primaryBtn}>
          Aplicar
        </button>
      </div>
    </section>
  );
};
