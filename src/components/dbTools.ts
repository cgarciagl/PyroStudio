import {
  Activity,
  Archive,
  Bot,
  FileDown,
  FileText,
  Flame,
  GitCompare,
  GitCompareArrows,
  LayoutDashboard,
  Network,
  ShieldCheck,
  Sparkles,
  Table2,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Single catalogue of the database-scoped tools. The header "Herramientas" menu and the
 * sidebar "Herramientas" section both render from it, so a tool cannot exist in one and
 * be missing from the other.
 */
export type DbToolId =
  | "dashboard"
  | "health"
  | "slowQuery"
  | "indexAdvisor"
  | "operations"
  | "schemaDiff"
  | "erDiagram"
  | "tablesOverview"
  | "dataCompare"
  | "backupRestore"
  | "sqlExport"
  | "dataMasking"
  | "agent"
  | "reports";

export type DbToolGroup = "diagnostics" | "schema" | "data" | "ai";

export interface DbToolDef {
  id: DbToolId;
  group: DbToolGroup;
  icon: LucideIcon;
  label: string;
  hint: string;
}

/** A tool the current engine supports, bound to the action that opens it for a database. */
export interface DbTool extends DbToolDef {
  run: (database: string) => void;
}

/** Display order: groups appear in this order, tools in list order inside each group. */
export const DB_TOOL_DEFS: readonly DbToolDef[] = [
  { id: "dashboard", group: "diagnostics", icon: LayoutDashboard, label: "Panel de control", hint: "Métricas, almacenamiento y QPS" },
  { id: "health", group: "diagnostics", icon: Activity, label: "Monitor de salud", hint: "Auditoría de rendimiento 0-100" },
  { id: "slowQuery", group: "diagnostics", icon: Flame, label: "Consultas lentas y EXPLAIN", hint: "Árbol visual y cuellos de botella" },
  { id: "indexAdvisor", group: "diagnostics", icon: Sparkles, label: "Asesor de índices", hint: "Índices redundantes y FK sin índice" },
  { id: "operations", group: "diagnostics", icon: Wrench, label: "Operaciones y mantenimiento", hint: "ANALYZE, OPTIMIZE, CHECK, REPAIR" },
  { id: "schemaDiff", group: "schema", icon: GitCompare, label: "Diferencias de esquema", hint: "Comparación y generador DDL" },
  { id: "erDiagram", group: "schema", icon: Network, label: "Diagrama ER", hint: "Tablas y relaciones de la base" },
  { id: "tablesOverview", group: "schema", icon: Table2, label: "Lista de tablas & espacio", hint: "Tamaño, filas y motor por tabla" },
  { id: "dataCompare", group: "schema", icon: GitCompareArrows, label: "Comparar datos", hint: "Comparar el contenido de dos tablas" },
  { id: "backupRestore", group: "data", icon: Archive, label: "Respaldar / restaurar", hint: "Volcado .sql y restauración" },
  { id: "sqlExport", group: "data", icon: FileDown, label: "Exportación SQL", hint: "Exportar estructura y datos a .sql" },
  { id: "dataMasking", group: "data", icon: ShieldCheck, label: "Exportación anonimizada", hint: "Enmascarar datos personales para desarrollo" },
  { id: "agent", group: "ai", icon: Bot, label: "Agente de base de datos", hint: "Diagnóstico autónomo con IA" },
  { id: "reports", group: "ai", icon: FileText, label: "Generador de informes", hint: "Diccionario y reporte de salud (IA)" },
];

/**
 * Binds each catalogued tool to its action. Tools whose action is undefined (for example,
 * gated off for the current engine) are dropped.
 */
export function buildDbTools(
  actions: Partial<Record<DbToolId, ((database: string) => void) | undefined>>,
): DbTool[] {
  return DB_TOOL_DEFS.flatMap((def) => {
    const run = actions[def.id];
    return run ? [{ ...def, run }] : [];
  });
}

/** Splits tools into their non-empty groups, keeping catalogue order. */
export function groupDbTools(tools: readonly DbTool[]): DbTool[][] {
  const groups = new Map<DbToolGroup, DbTool[]>();
  for (const tool of tools) {
    const list = groups.get(tool.group);
    if (list) list.push(tool);
    else groups.set(tool.group, [tool]);
  }
  return [...groups.values()];
}
