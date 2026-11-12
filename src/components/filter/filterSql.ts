/**
 * Rules of the visual filter: operators, the WHERE / ORDER BY they produce, the same
 * rules evaluated in memory (client-side filtering) and validation before applying.
 * Pure functions, no React.
 */

/** Plain numbers go unquoted; "007" stays text so a VARCHAR code keeps its zeros. */
export function sqlLiteral(v: string): string {
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v)) return v;
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * LIKE with the user's text taken literally: % and _ in the value are not wildcards.
 * ESCAPE '!' is only added when needed (same SQL as before for ordinary values) and
 * works in MySQL/MariaDB and SQLite alike.
 */
export function like(col: string, keyword: "LIKE" | "NOT LIKE", prefix: string, value: string, suffix: string): string {
  const needsEscape = /[%_!]/.test(value);
  const body = (needsEscape ? value.replace(/[!%_]/g, "!$&") : value).replace(/'/g, "''");
  return `${col} ${keyword} '${prefix}${body}${suffix}'${needsEscape ? " ESCAPE '!'" : ""}`;
}

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
  { id: "!=", label: "≠" },
  { id: "<", label: "<" },
  { id: "<=", label: "≤" },
  { id: ">", label: ">" },
  { id: ">=", label: "≥" },
  { id: "contains", label: "contiene" },
  { id: "does not contain", label: "no contiene" },
  { id: "begins with", label: "comienza con" },
  { id: "does not begin with", label: "no comienza con" },
  { id: "ends with", label: "termina con" },
  { id: "does not end with", label: "no termina con" },
  { id: "is null", label: "es nulo", unary: true },
  { id: "is not null", label: "no es nulo", unary: true },
  { id: "is empty", label: "está vacío", unary: true },
  { id: "is not empty", label: "no está vacío", unary: true },
  { id: "is between", label: "está entre" },
  { id: "is not between", label: "no está entre" },
  { id: "is in list", label: "está en la lista" },
  { id: "is not in list", label: "no está en la lista" },
  { id: "custom", label: "condición SQL" },
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

    const formatLiteral = sqlLiteral;

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
        conditionSql = like(quotedCol, "LIKE", "%", val, "%");
        break;
      case "does not contain":
        conditionSql = like(quotedCol, "NOT LIKE", "%", val, "%");
        break;
      case "begins with":
        conditionSql = like(quotedCol, "LIKE", "", val, "%");
        break;
      case "does not begin with":
        conditionSql = like(quotedCol, "NOT LIKE", "", val, "%");
        break;
      case "ends with":
        conditionSql = like(quotedCol, "LIKE", "%", val, "");
        break;
      case "does not end with":
        conditionSql = like(quotedCol, "NOT LIKE", "%", val, "");
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
            return sqlLiteral(t);
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
            return sqlLiteral(t);
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
export function evaluateFilterRuleClient(rowValue: unknown, rule: FilterRule): boolean {
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

export type OperatorGroup = "Comparación" | "Texto" | "Vacío o nulo" | "Rango y lista" | "Avanzado";

/** Operator menu sections (the flat list of 21 operators was hard to scan). */
export const OPERATOR_GROUPS: Record<FilterOperator, OperatorGroup> = {
  "=": "Comparación",
  "!=": "Comparación",
  "<": "Comparación",
  "<=": "Comparación",
  ">": "Comparación",
  ">=": "Comparación",
  contains: "Texto",
  "does not contain": "Texto",
  "begins with": "Texto",
  "does not begin with": "Texto",
  "ends with": "Texto",
  "does not end with": "Texto",
  "is null": "Vacío o nulo",
  "is not null": "Vacío o nulo",
  "is empty": "Vacío o nulo",
  "is not empty": "Vacío o nulo",
  "is between": "Rango y lista",
  "is not between": "Rango y lista",
  "is in list": "Rango y lista",
  "is not in list": "Rango y lista",
  custom: "Avanzado",
};

export interface FilterIssues {
  /** Rule id → what is missing in it. */
  byRule: Record<string, string>;
  /** Problem of the whole expression (unbalanced parentheses). */
  global?: string;
}

/**
 * What would make the filter wrong or surprising, before it is sent: missing values
 * (e.g. BETWEEN '' AND '') and unbalanced parentheses (invalid SQL).
 */
export function validateFilter(rules: FilterRule[]): FilterIssues {
  const byRule: Record<string, string> = {};
  let depth = 0;
  let global: string | undefined;
  for (const r of rules.filter((x) => x.enabled && x.column.trim())) {
    const op = VISUAL_FILTER_OPERATORS.find((o) => o.id === r.operator);
    const v = (r.value ?? "").trim();
    if (r.operator === "is between" || r.operator === "is not between") {
      if (!v || !(r.valueTo ?? "").trim()) byRule[r.id] = "Indique los dos extremos del rango.";
    } else if (r.operator === "is in list" || r.operator === "is not in list") {
      if (!v.split(",").some((t) => t.trim())) byRule[r.id] = "Escriba al menos un valor, separados por comas.";
    } else if (r.operator === "custom") {
      if (!v) byRule[r.id] = "Escriba la condición SQL, por ejemplo: > NOW() - INTERVAL 7 DAY.";
    } else if (!op?.unary && !v && r.operator !== "=" && r.operator !== "!=") {
      byRule[r.id] = "Falta el valor.";
    }
    if (r.openParen) depth++;
    if (r.closeParen) depth--;
    if (depth < 0 && !global) global = "Hay un paréntesis de cierre sin su apertura.";
  }
  if (depth > 0 && !global) global = "Falta cerrar un paréntesis.";
  return { byRule, global };
}

/** Human summary of a rule for the list and the screen reader. */
export function operatorLabel(op: FilterOperator): string {
  return VISUAL_FILTER_OPERATORS.find((o) => o.id === op)?.label ?? op;
}
