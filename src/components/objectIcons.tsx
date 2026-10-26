import React from "react";
import {
  CalendarClock,
  Database,
  Eye,
  FileCode2,
  Folder,
  FolderOpen,
  LayoutDashboard,
  ListOrdered,
  Sheet,
  SquareFunction,
  Workflow,
  Zap,
} from "lucide-react";

/**
 * Database object kinds shown in the explorer and the object browser.
 * Each kind has a recognizable shape and a soft tint (the one place where hue is
 * used for identity rather than state — see AGENTS.md, UI guide).
 */
export type DbObjectKind =
  | "database"
  | "tables"
  | "views"
  | "functions"
  | "procedures"
  | "triggers"
  | "events"
  | "sequences"
  | "queries"
  | "folder"
  | "summary";

const ICONS: Record<DbObjectKind, { icon: React.ElementType; tint: string }> = {
  database: { icon: Database, tint: "text-fg-muted" },
  tables: { icon: Sheet, tint: "text-sky-500" },
  views: { icon: Eye, tint: "text-indigo-400" },
  functions: { icon: SquareFunction, tint: "text-violet-400" },
  procedures: { icon: Workflow, tint: "text-amber-500" },
  triggers: { icon: Zap, tint: "text-yellow-500" },
  events: { icon: CalendarClock, tint: "text-emerald-500" },
  sequences: { icon: ListOrdered, tint: "text-teal-500" },
  queries: { icon: FileCode2, tint: "text-rose-400" },
  folder: { icon: Folder, tint: "text-amber-400" },
  summary: { icon: LayoutDashboard, tint: "text-fg-muted" },
};

export const OBJECT_LABELS: Record<DbObjectKind, string> = {
  database: "Base de datos",
  tables: "Tablas",
  views: "Vistas",
  functions: "Funciones",
  procedures: "Procedimientos",
  triggers: "Triggers",
  events: "Eventos",
  sequences: "Secuencias",
  queries: "Consultas",
  folder: "Carpeta",
  summary: "Resumen",
};

interface ObjectIconProps {
  kind: DbObjectKind;
  className?: string;
  /** Open state for folders / active databases. */
  open?: boolean;
}

export const ObjectIcon: React.FC<ObjectIconProps> = ({ kind, className = "w-3.5 h-3.5", open }) => {
  const { icon, tint } = ICONS[kind];
  const Icon = kind === "folder" && open ? FolderOpen : icon;
  const color = kind === "database" && open ? "text-emerald-500" : tint;
  return <Icon className={`${className} shrink-0 ${color}`} />;
};
