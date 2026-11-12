import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, CornerDownRight, MoreHorizontal, Trash2 } from "lucide-react";
import { iconBtn, menuIcon, menuItem, menuSeparator } from "../ui/styles";
import { OPERATOR_GROUPS, VISUAL_FILTER_OPERATORS, type FilterOperator, type FilterRule } from "./filterSql";
import { PickerMenu, type PickerItem } from "./PickerMenu";
import { PortalMenu } from "./PortalMenu";

interface FilterRuleRowProps {
  rule: FilterRule;
  index: number;
  count: number;
  /** Connector that joins this rule with the previous one (stored on the previous rule). */
  joinWithPrevious?: "AND" | "OR";
  columns: string[];
  issue?: string;
  onChange: (patch: Partial<FilterRule>) => void;
  onToggleJoin: () => void;
  onInsertBelow: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onSubmit: () => void;
}

const OPERATOR_ITEMS: PickerItem[] = VISUAL_FILTER_OPERATORS.map((o) => ({ id: o.id, label: o.label, group: OPERATOR_GROUPS[o.id] }));

const field =
  "h-7 inline-flex items-center gap-1 px-2 rounded-md border border-line bg-canvas text-xs text-fg hover:border-line-strong focus:outline-none focus-visible:border-accent";

/** One condition: [on] (y|o) ( columna operador valor ) ⋯ — read left to right like SQL. */
export function FilterRuleRow(p: FilterRuleRowProps) {
  const { rule } = p;
  const [picker, setPicker] = useState<"column" | "operator" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const colRef = useRef<HTMLButtonElement>(null);
  const opRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const op = VISUAL_FILTER_OPERATORS.find((o) => o.id === rule.operator) ?? VISUAL_FILTER_OPERATORS[0];
  const isBetween = rule.operator === "is between" || rule.operator === "is not between";
  const isList = rule.operator === "is in list" || rule.operator === "is not in list";
  const valueKeys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      p.onSubmit();
    }
  };
  const valueCls = `h-7 px-2 rounded-md border bg-canvas text-xs font-mono text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent ${
    p.issue ? "border-warning" : "border-line"
  }`;

  return (
    <div data-filter-rule className={`group flex flex-wrap items-center gap-1.5 py-1 ${rule.enabled ? "" : "opacity-50"}`}>
      <input
        type="checkbox"
        checked={rule.enabled}
        onChange={(e) => p.onChange({ enabled: e.target.checked })}
        aria-label={rule.enabled ? "Desactivar esta condición" : "Activar esta condición"}
        title={rule.enabled ? "Desactivar esta condición" : "Activar esta condición"}
        className="accent-[var(--pyro-accent)]"
      />

      {/* Join with the previous condition: first row says "Donde". */}
      {p.index === 0 ? (
        <span className="w-9 text-[11px] text-fg-muted">Donde</span>
      ) : (
        <button
          type="button"
          onClick={p.onToggleJoin}
          title="Cambiar entre «y» (AND) y «o» (OR)"
          aria-label={`Unir con la anterior: ${p.joinWithPrevious === "OR" ? "o" : "y"}. Cambiar`}
          className="w-9 h-7 rounded-md text-[11px] font-medium text-fg-muted hover:text-fg hover:bg-hover"
        >
          {p.joinWithPrevious === "OR" ? "o" : "y"}
        </button>
      )}

      {rule.openParen && <span className="font-mono text-sm text-fg-muted" aria-label="abre grupo">(</span>}

      <button ref={colRef} type="button" onClick={() => setPicker(picker === "column" ? null : "column")} className={`${field} font-mono max-w-[14rem]`} aria-label={`Columna: ${rule.column || "ninguna"}`}>
        <span className="truncate">{rule.column || "columna"}</span>
        <ChevronDown className="w-3 h-3 text-fg-subtle shrink-0" />
      </button>

      <button ref={opRef} type="button" onClick={() => setPicker(picker === "operator" ? null : "operator")} className={field} aria-label={`Operador: ${op.label}`}>
        {op.label}
        <ChevronDown className="w-3 h-3 text-fg-subtle" />
      </button>

      {!op.unary &&
        (isBetween ? (
          <span className="inline-flex items-center gap-1">
            <input value={rule.value} onChange={(e) => p.onChange({ value: e.target.value })} onKeyDown={valueKeys} placeholder="desde" aria-label="Desde" className={`${valueCls} w-24`} />
            <span className="text-[11px] text-fg-muted">y</span>
            <input value={rule.valueTo ?? ""} onChange={(e) => p.onChange({ valueTo: e.target.value })} onKeyDown={valueKeys} placeholder="hasta" aria-label="Hasta" className={`${valueCls} w-24`} />
          </span>
        ) : (
          <input
            value={rule.value}
            onChange={(e) => p.onChange({ value: e.target.value })}
            onKeyDown={valueKeys}
            placeholder={isList ? "a, b, c" : rule.operator === "custom" ? "> NOW() - INTERVAL 7 DAY" : "valor"}
            aria-label="Valor"
            title={rule.operator === "=" || rule.operator === "!=" ? "Escriba NULL para comparar con nulo" : undefined}
            className={`${valueCls} ${isList || rule.operator === "custom" ? "w-56" : "w-36"}`}
          />
        ))}

      {rule.closeParen && <span className="font-mono text-sm text-fg-muted" aria-label="cierra grupo">)</span>}

      {p.issue && <span className="text-[11px] text-warning">{p.issue}</span>}

      <button
        ref={menuRef}
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Acciones de la condición"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`${iconBtn} ml-auto opacity-60 group-hover:opacity-100 focus-visible:opacity-100`}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {menuOpen && menuRef.current && (
        <PortalMenu anchor={menuRef.current} onClose={() => setMenuOpen(false)}>
          {(
            [
              [<CornerDownRight className={menuIcon} />, "Insertar condición debajo", p.onInsertBelow, false],
              [<ArrowUp className={menuIcon} />, "Subir", () => p.onMove(-1), p.index === 0],
              [<ArrowDown className={menuIcon} />, "Bajar", () => p.onMove(1), p.index === p.count - 1],
            ] as const
          ).map(([icon, label, fn, disabled]) => (
            <button key={label} role="menuitem" disabled={disabled} className={`${menuItem} disabled:opacity-40`} onClick={() => { setMenuOpen(false); fn(); }}>
              {icon} {label}
            </button>
          ))}
          <div className={menuSeparator} />
          <button role="menuitemcheckbox" aria-checked={!!rule.openParen} className={menuItem} onClick={() => { setMenuOpen(false); p.onChange({ openParen: !rule.openParen }); }}>
            <span className={`${menuIcon} font-mono text-center`}>(</span> {rule.openParen ? "Quitar el inicio de grupo" : "Iniciar un grupo aquí"}
          </button>
          <button role="menuitemcheckbox" aria-checked={!!rule.closeParen} className={menuItem} onClick={() => { setMenuOpen(false); p.onChange({ closeParen: !rule.closeParen }); }}>
            <span className={`${menuIcon} font-mono text-center`}>)</span> {rule.closeParen ? "Quitar el fin de grupo" : "Terminar el grupo aquí"}
          </button>
          <div className={menuSeparator} />
          <button role="menuitem" className={menuItem.replace("text-fg", "text-danger")} onClick={() => { setMenuOpen(false); p.onDelete(); }}>
            <Trash2 className="w-3.5 h-3.5 shrink-0" /> Eliminar
          </button>
        </PortalMenu>
      )}

      {picker === "column" && colRef.current && (
        <PickerMenu
          anchor={colRef.current}
          items={p.columns.map((c) => ({ id: c, label: c }))}
          selectedId={rule.column}
          searchable
          mono
          placeholder="Buscar columna"
          onPick={(c) => {
            p.onChange({ column: c });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "operator" && opRef.current && (
        <PickerMenu
          anchor={opRef.current}
          items={OPERATOR_ITEMS}
          selectedId={rule.operator}
          onPick={(id) => {
            p.onChange({ operator: id as FilterOperator });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
