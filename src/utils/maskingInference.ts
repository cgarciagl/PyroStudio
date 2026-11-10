import type { ColumnMetadata, MaskingProfile, MaskingRule, MaskingStrategy } from "../types/database";

/**
 * Proactive masking suggestions (Roadmap V3 · Fase 3): looks at column names (and
 * types) to propose a rule for personal data such as `email`, `telefono`, `dni`,
 * `tarjeta` or `birth_date`. Suggestions are a starting point the user reviews.
 */
export interface MaskingSuggestion {
  strategy: MaskingStrategy;
  /** Short reason shown next to the suggestion. */
  reason: string;
  fixedValue?: string;
}

/** Strategies that keep distinct values distinct (valid for PK/UNIQUE/FK columns). */
export const KEY_SAFE_STRATEGIES: ReadonlySet<MaskingStrategy> = new Set(["keep", "hash", "email_synthetic"]);

export const DEFAULT_SHIFT_DAYS = 30;
const MAX_SHIFT_DAYS = 3650;
const MAX_FIXED_LEN = 1000;

/** Lowercase words of an identifier, accents removed: `fechaNacimiento` → ["fecha","nacimiento"]. */
export function identifierWords(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const STRING_TYPES = /char|text|enum|set|json|clob|string|varbinary|binary/i;
const DATE_TYPES = /date|time|year/i;
const NUMERIC_TYPES = /int|decimal|numeric|float|double|real/i;
const BOOLEAN_TYPE = /^(bool|boolean|bit|tinyint\(1\))/i;

/** Words that make a column metadata *about* personal data, not personal data itself. */
const META_WORDS = new Set([
  "verified", "verificado", "confirmed", "confirmado", "enabled", "habilitado", "count", "total",
  "optin", "opt", "valid", "valido", "status", "estado", "type", "tipo", "flag", "is", "has",
]);

/** Tables whose generic `name`/`nombre` column holds a person's name. */
const PERSON_TABLE_WORDS = new Set([
  "cliente", "clientes", "customer", "customers", "usuario", "usuarios", "user", "users",
  "empleado", "empleados", "employee", "employees", "persona", "personas", "person", "people",
  "contacto", "contactos", "contact", "contacts", "paciente", "pacientes", "patient", "patients",
  "alumno", "alumnos", "estudiante", "estudiantes", "student", "students", "socio", "socios",
  "member", "members", "miembro", "miembros", "proveedor", "proveedores", "autor", "autores",
]);

interface Pattern {
  /** Matches when every word of one alternative appears in the identifier. */
  any: string[][];
  strategy: MaskingStrategy;
  reason: string;
  fixedValue?: string;
  kind: "text" | "date" | "digits";
}

const PATTERNS: Pattern[] = [
  { any: [["email"], ["correo"], ["mail"], ["e", "mail"]], strategy: "email_synthetic", reason: "Correo electrónico", kind: "text" },
  {
    any: [["credit", "card"], ["tarjeta"], ["card", "number"], ["cc", "number"], ["pan"], ["iban"], ["clabe"], ["account", "number"], ["numero", "cuenta"], ["cuenta", "bancaria"]],
    strategy: "card_mask",
    reason: "Tarjeta o cuenta bancaria",
    kind: "digits",
  },
  {
    any: [["phone"], ["telefono"], ["tel"], ["celular"], ["movil"], ["mobile"], ["whatsapp"], ["fax"]],
    strategy: "phone_digits",
    reason: "Teléfono",
    kind: "digits",
  },
  {
    any: [["ssn"], ["dni"], ["curp"], ["rfc"], ["nif"], ["nie"], ["nss"], ["cedula"], ["passport"], ["pasaporte"], ["documento"], ["ine"], ["tax", "id"], ["national", "id"], ["cpf"], ["cuit"], ["cuil"], ["rut"]],
    strategy: "digits_zero",
    reason: "Documento de identidad",
    kind: "digits",
  },
  {
    any: [["birth"], ["birthday"], ["nacimiento"], ["dob"], ["fecha", "nac"], ["cumpleanos"]],
    strategy: "date_shift",
    reason: "Fecha de nacimiento",
    kind: "date",
  },
  {
    any: [["full", "name"], ["nombre", "completo"], ["display", "name"], ["razon", "social"]],
    strategy: "full_name",
    reason: "Nombre completo",
    kind: "text",
  },
  {
    any: [["first", "name"], ["given", "name"], ["firstname"], ["nombres"], ["primer", "nombre"]],
    strategy: "first_name",
    reason: "Nombre",
    kind: "text",
  },
  {
    any: [["last", "name"], ["surname"], ["lastname"], ["apellido"], ["apellidos"], ["family", "name"], ["apellido", "paterno"], ["apellido", "materno"]],
    strategy: "last_name",
    reason: "Apellido",
    kind: "text",
  },
  {
    any: [["address"], ["direccion"], ["domicilio"], ["calle"], ["street"], ["colonia"]],
    strategy: "fixed",
    reason: "Dirección postal",
    fixedValue: "REDACTADO",
    kind: "text",
  },
  {
    any: [["password"], ["contrasena"], ["passwd"], ["pwd"], ["secret"], ["token"], ["api", "key"], ["apikey"]],
    strategy: "hash",
    reason: "Credencial o secreto",
    kind: "text",
  },
  { any: [["ip"], ["ip", "address"], ["ipaddress"]], strategy: "hash", reason: "Dirección IP", kind: "text" },
];

function typeFits(kind: Pattern["kind"], type: string): boolean {
  if (!type) return true;
  if (BOOLEAN_TYPE.test(type)) return false;
  switch (kind) {
    case "date":
      return DATE_TYPES.test(type) || STRING_TYPES.test(type);
    case "digits":
      return STRING_TYPES.test(type) || NUMERIC_TYPES.test(type);
    case "text":
      return STRING_TYPES.test(type);
  }
}

/**
 * Suggested rule for a column, or null when it does not look like personal data.
 * `table` disambiguates generic names (`clientes.nombre` is a person, `productos.nombre` is not).
 */
export function inferMaskingStrategy(
  column: string,
  dataType = "",
  table = "",
): MaskingSuggestion | null {
  const words = identifierWords(column);
  if (words.length === 0) return null;
  if (words.some((w) => META_WORDS.has(w))) return null;
  // `*_id` columns reference other rows; FK propagation masks them when their parent is masked.
  if (words[words.length - 1] === "id" && words.length > 1) return null;
  const set = new Set(words);
  const joined = words.join("");

  for (const p of PATTERNS) {
    const hit = p.any.some((alt) => alt.every((w) => set.has(w)) || (alt.length > 1 && joined === alt.join("")));
    if (hit && typeFits(p.kind, dataType)) {
      return { strategy: p.strategy, reason: p.reason, fixedValue: p.fixedValue };
    }
  }

  // Generic `name`/`nombre`: only in tables that clearly hold people.
  if (words.length === 1 && (words[0] === "name" || words[0] === "nombre")) {
    const tableWords = identifierWords(table);
    if (tableWords.some((w) => PERSON_TABLE_WORDS.has(w)) && typeFits("text", dataType)) {
      return { strategy: "full_name", reason: "Nombre de persona" };
    }
  }
  return null;
}

/** Rules suggested for every column of a table. */
export function suggestRulesForTable(table: string, columns: Pick<ColumnMetadata, "name" | "data_type" | "column_type">[]): MaskingRule[] {
  return columns.flatMap((c) => {
    const s = inferMaskingStrategy(c.name, c.column_type || c.data_type, table);
    if (!s) return [];
    const rule: MaskingRule = { table, column: c.name, strategy: s.strategy };
    if (s.fixedValue) rule.fixedValue = s.fixedValue;
    return [rule];
  });
}

export interface ProfileIssue {
  level: "error" | "warning";
  message: string;
}

/**
 * Checks a profile before saving or exporting. Errors block; warnings point at rules
 * that would break unique keys. `columns` (table → metadata) enables the key checks.
 */
export function validateMaskingProfile(
  profile: Pick<MaskingProfile, "name" | "rules">,
  columns?: Record<string, Pick<ColumnMetadata, "name" | "column_key">[]>,
): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  if (!profile.name.trim()) issues.push({ level: "error", message: "El perfil necesita un nombre." });
  const seen = new Set<string>();
  for (const r of profile.rules) {
    const label = `${r.table}.${r.column}`;
    if (!r.table.trim() || !r.column.trim()) {
      issues.push({ level: "error", message: "Hay una regla sin tabla o columna." });
      continue;
    }
    const key = `${r.table.trim().toLowerCase()}.${r.column.trim().toLowerCase()}`;
    if (seen.has(key)) issues.push({ level: "error", message: `Regla duplicada para ${label}.` });
    seen.add(key);
    if (r.strategy === "date_shift") {
      const days = r.shiftDays ?? DEFAULT_SHIFT_DAYS;
      if (!Number.isInteger(days) || days < 1 || days > MAX_SHIFT_DAYS) {
        issues.push({ level: "error", message: `${label}: el desplazamiento debe estar entre 1 y ${MAX_SHIFT_DAYS} días.` });
      }
    }
    if (r.strategy === "fixed" && (r.fixedValue ?? "").length > MAX_FIXED_LEN) {
      issues.push({ level: "error", message: `${label}: el valor fijo es demasiado largo.` });
    }
    const meta = columns?.[r.table]?.find((c) => c.name.toLowerCase() === r.column.toLowerCase());
    if (meta && (meta.column_key === "PRI" || meta.column_key === "UNI") && !KEY_SAFE_STRATEGIES.has(r.strategy)) {
      issues.push({
        level: "warning",
        message: `${label} es ${meta.column_key === "PRI" ? "clave primaria" : "única"}: «${r.strategy}» puede repetir valores. Las claves se exportan con hash; use «Correo sintético» o «Hash» en columnas únicas.`,
      });
    }
  }
  return issues;
}

/** Only the rules that change data (drops `keep`). */
export function effectiveRules(rules: MaskingRule[]): MaskingRule[] {
  return rules.filter((r) => r.strategy !== "keep");
}
