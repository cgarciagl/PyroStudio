import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Copy,
  FileDown,
  GitCompare,
  KeyRound,
  Link2,
  Maximize,
  Minus,
  Network,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { downloadFile } from "../services/diagnosticExport";
import {
  PRIMARY_KEY_PRESETS,
  uniqueColumnName,
  updateColumnInTable,
} from "../services/ddl/columnPresets";
import { useUIStore } from "../stores/uiStore";
import { useDdlBuilder } from "../services/ddl";
import type {
  DbEngine,
  DesignColumn,
  DesignForeignKey,
  DesignTable,
  DesignedSchema,
  ErRelation,
  ErSchema,
  ErTable,
  SchemaMigration,
} from "../types/database";
import {
  ER_HEADER_HEIGHT,
  ER_ROW_HEIGHT,
  layoutErDiagram,
  type ErLayout,
} from "../utils/erLayout";
import { ObjectIcon } from "./objectIcons";
import { EmptyState, Modal, Spinner } from "./ui/Modal";
import { RightDock, useDockWidth, useIsWideLayout } from "./ui/RightDock";
import {
  cardClass,
  dangerBtn,
  fieldLabel,
  ghostBtn,
  iconBtn,
  inputClass,
  mutedText,
  primaryBtn,
  secondaryBtn,
  sectionLabel,
  tabClass,
} from "./ui/styles";

interface SchemaDesignerTabProps {
  database: string;
  onClose: () => void;
  onApplied?: () => void;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.0;
const FIT_MARGIN = 32;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

const FK_ACTIONS = ["RESTRICT", "CASCADE", "SET NULL", "NO ACTION"];
const TYPE_SUGGESTIONS = [
  "bigint(20)",
  "int(11)",
  "tinyint(1)",
  "varchar(255)",
  "char(36)",
  "text",
  "longtext",
  "decimal(10,2)",
  "double",
  "date",
  "datetime",
  "timestamp",
  "json",
];

const SQLITE_TYPE_SUGGESTIONS = [
  "INTEGER",
  "TEXT",
  "REAL",
  "BLOB",
  "NUMERIC",
  "BOOLEAN",
  "DATETIME",
  "VARCHAR(255)",
];

/** Converts a design model into the lightweight schema layoutErDiagram expects. */
export function designToErSchema(database: string, design: DesignedSchema): ErSchema {
  const tables: ErTable[] = design.tables.map((t) => ({
    name: t.name,
    is_view: false,
    columns: t.columns.map((c) => ({
      name: c.name,
      column_type: c.column_type,
      is_nullable: c.nullable,
      is_primary_key: c.primary_key,
    })),
  }));

  const relations: ErRelation[] = [];
  for (const t of design.tables) {
    for (const fk of t.foreign_keys) {
      for (let i = 0; i < fk.columns.length; i++) {
        relations.push({
          table: t.name,
          foreign_key: {
            name: fk.name || `fk_${t.name}_${fk.columns[i]}`,
            column_name: fk.columns[i],
            referenced_table: fk.referenced_table,
            referenced_column: fk.referenced_columns[i] || fk.columns[i],
            update_rule: fk.on_update || "RESTRICT",
            delete_rule: fk.on_delete || "RESTRICT",
          },
        });
      }
    }
  }

  return { database, tables, relations };
}

/** Applies a PK/AI/type edit through the shared column rules (keeps keys valid). */
export function editDesignColumn(
  columns: DesignColumn[],
  index: number,
  changed: Partial<DesignColumn>,
  engine: DbEngine = "mysql",
): DesignColumn[] {
  const rows = columns.map((c, i) => ({
    id: String(i),
    dataType: c.column_type,
    isPrimaryKey: c.primary_key,
    isAutoIncrement: c.auto_increment,
    isNullable: c.nullable,
  }));
  const patch: Partial<(typeof rows)[number]> = {};
  if (changed.column_type !== undefined) patch.dataType = changed.column_type;
  if (changed.primary_key !== undefined) patch.isPrimaryKey = changed.primary_key;
  if (changed.auto_increment !== undefined) patch.isAutoIncrement = changed.auto_increment;
  if (changed.nullable !== undefined) patch.isNullable = changed.nullable;
  const updated = updateColumnInTable(rows, String(index), patch, engine);
  return columns.map((c, i) => {
    const r = updated[i];
    const base = i === index ? { ...c, ...changed } : c;
    return {
      ...base,
      column_type: r.dataType,
      primary_key: !!r.isPrimaryKey,
      auto_increment: !!r.isAutoIncrement,
      nullable: !!r.isNullable,
    };
  });
}

function getAnchorY(node: { y: number; visibleColumns: { name: string }[] }, colName: string): number {
  const index = node.visibleColumns.findIndex((c) => c.name === colName);
  if (index === -1) return node.y + ER_HEADER_HEIGHT / 2;
  return node.y + ER_HEADER_HEIGHT + index * ER_ROW_HEIGHT + ER_ROW_HEIGHT / 2;
}

function computeEdgePath(
  fromNode: { x: number; y: number; width: number; height: number; visibleColumns: { name: string }[] },
  toNode: { x: number; y: number; width: number; height: number; visibleColumns: { name: string }[] },
  fromCol: string,
  toCol: string,
): string {
  const y1 = getAnchorY(fromNode, fromCol);
  const y2 = getAnchorY(toNode, toCol);
  const bend = 48;
  if (fromNode === toNode || Math.abs(fromNode.x - toNode.x) < fromNode.width) {
    const x1 = fromNode.x + fromNode.width;
    const x2 = toNode.x + toNode.width;
    const out = Math.max(x1, x2) + bend;
    return `M ${x1} ${y1} C ${out} ${y1}, ${out} ${y2}, ${x2} ${y2}`;
  }
  const childOnRight = fromNode.x > toNode.x;
  const x1 = childOnRight ? fromNode.x : fromNode.x + fromNode.width;
  const x2 = childOnRight ? toNode.x + toNode.width : toNode.x;
  const dx = childOnRight ? -bend : bend;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/**
 * Name field that commits on blur or Enter. Renaming on every keystroke made an
 * intermediate value collide with another table or column and merge them.
 */
const NameInput: React.FC<{
  value: string;
  className: string;
  placeholder?: string;
  taken: string[];
  onCommit: (name: string) => void;
}> = ({ value, className, placeholder, taken, onCommit }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const trimmed = draft.trim();
  const clash =
    trimmed.toLowerCase() !== value.toLowerCase() &&
    taken.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const commit = () => {
    if (!trimmed || clash) {
      setDraft(value);
      return;
    }
    if (trimmed !== value) onCommit(trimmed);
  };
  return (
    <input
      className={`${className} ${clash ? "border-danger" : ""}`}
      placeholder={placeholder}
      value={draft}
      title={clash ? "Ya existe con ese nombre" : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
};

export const SchemaDesignerTab: React.FC<SchemaDesignerTabProps> = ({
  database,
  onClose,
  onApplied,
}) => {
  const { engine } = useDdlBuilder();
  const [schema, setSchema] = useState<DesignedSchema | null>(null);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [migration, setMigration] = useState<SchemaMigration | null>(null);
  const [sqlTab, setSqlTab] = useState<"up" | "down">("up");
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Canvas viewport, zoom and custom node positions
  const [view, setView] = useState({ x: FIT_MARGIN, y: FIT_MARGIN, zoom: 1 });
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const viewportRef = useRef<HTMLDivElement>(null);
  const panDragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // Connection dragging (Foreign Key creation by dragging ports)
  const [connecting, setConnecting] = useState<{
    fromTable: string;
    fromColumn: string;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<{ table: string; column: string } | null>(null);

  // RightDock panel state
  const isWide = useIsWideLayout();
  const [dockWidth, setDockWidth] = useDockWidth("pyro_designer_dock_width", 380);
  const [isDockOpen, setIsDockOpen] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const s = await dbService.getDesignSchema(database);
      setSchema(s);
      setSelectedTableName(s.tables[0]?.name ?? null);
      setNodePositions({});
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [database]);

  useEffect(() => {
    load();
  }, [load]);

  const tables = schema?.tables ?? [];
  const selectedTable = tables.find((t) => t.name === selectedTableName);

  // Base layout derived from tables & relations
  const layout: ErLayout | null = useMemo(
    () => (schema ? layoutErDiagram(designToErSchema(database, schema)) : null),
    [schema, database],
  );

  // Effective nodes combining auto-layout with user-dragged coordinates
  const effectiveNodes = useMemo(() => {
    if (!layout) return [];
    return layout.nodes.map((node) => {
      const custom = nodePositions[node.table.name];
      if (custom) {
        return { ...node, x: custom.x, y: custom.y };
      }
      return node;
    });
  }, [layout, nodePositions]);

  // Edges calculated dynamically using effective node positions
  const effectiveEdges = useMemo(() => {
    if (!schema || effectiveNodes.length === 0) return [];
    const nodeMap = new Map(effectiveNodes.map((n) => [n.table.name, n]));
    const edges: { id: string; from: string; to: string; path: string; label: string }[] = [];

    for (const table of schema.tables) {
      const fromNode = nodeMap.get(table.name);
      if (!fromNode) continue;
      for (const fk of table.foreign_keys) {
        const toNode = nodeMap.get(fk.referenced_table);
        if (!toNode) continue;
        for (let i = 0; i < fk.columns.length; i++) {
          const fromCol = fk.columns[i];
          const toCol = fk.referenced_columns[i] || fromCol;
          const path = computeEdgePath(fromNode, toNode, fromCol, toCol);
          edges.push({
            id: `${table.name}.${fk.name}.${fromCol}.${i}`,
            from: table.name,
            to: fk.referenced_table,
            path,
            label: `${table.name}.${fromCol} → ${fk.referenced_table}.${toCol}`,
          });
        }
      }
    }
    return edges;
  }, [schema, effectiveNodes]);

  // Fit diagram to view
  const fitToView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !layout || layout.nodes.length === 0) return;
    const availableWidth =
      isWide && isDockOpen ? Math.max(100, viewport.clientWidth - dockWidth) : viewport.clientWidth;
    const zoom = clampZoom(
      Math.min(
        (availableWidth - FIT_MARGIN * 2) / Math.max(layout.width, 100),
        (viewport.clientHeight - FIT_MARGIN * 2) / Math.max(layout.height, 100),
        1,
      ),
    );
    setView({
      zoom,
      x: (availableWidth - layout.width * zoom) / 2,
      y: Math.max(FIT_MARGIN, (viewport.clientHeight - layout.height * zoom) / 2),
    });
  }, [layout, isWide, isDockOpen, dockWidth]);

  useEffect(() => {
    if (layout) fitToView();
  }, [layout, fitToView]);

  // Native wheel zoom centered on cursor
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const zoom = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.0015));
        const k = zoom / v.zoom;
        return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const cx = viewport.clientWidth / 2;
    const cy = viewport.clientHeight / 2;
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      const k = zoom / v.zoom;
      return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  // Canvas background drag to pan
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    panDragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    // 1. Connection line drag tracking
    if (connecting) {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const currentX = (e.clientX - rect.left - view.x) / view.zoom;
        const currentY = (e.clientY - rect.top - view.y) / view.zoom;
        setConnecting((prev) => (prev ? { ...prev, currentX, currentY } : null));
      }
      return;
    }

    // 2. Canvas panning
    const drag = panDragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const onCanvasPointerUp = (e: React.PointerEvent) => {
    // Connection drop handler
    if (connecting) {
      if (hoveredTarget) {
        const { fromTable, fromColumn } = connecting;
        const { table: toTable, column: toColumn } = hoveredTarget;
        if (!(fromTable === toTable && fromColumn === toColumn)) {
          // Empty name: the backend generates a unique one of at most 64 characters.
          const fkName = "";
          setSchema((s) => {
            if (!s) return s;
            return {
              tables: s.tables.map((t) => {
                if (t.name !== fromTable) return t;
                const exists = t.foreign_keys.some(
                  (f) =>
                    f.referenced_table === toTable &&
                    f.columns.includes(fromColumn) &&
                    f.referenced_columns.includes(toColumn),
                );
                if (exists) return t;
                return {
                  ...t,
                  foreign_keys: [
                    ...t.foreign_keys,
                    {
                      name: fkName,
                      columns: [fromColumn],
                      referenced_table: toTable,
                      referenced_columns: [toColumn],
                      on_delete: "RESTRICT",
                      on_update: "RESTRICT",
                    },
                  ],
                };
              }),
            };
          });
          setSelectedTableName(fromTable);
          setIsDockOpen(true);
        }
      }
      setConnecting(null);
      setHoveredTarget(null);
      return;
    }

    const drag = panDragRef.current;
    panDragRef.current = null;
    if (drag && !drag.moved && e.target === e.currentTarget) {
      setSelectedTableName(null);
    }
  };

  // Node header dragging to freely position tables
  const startDragNode = (e: React.PointerEvent, tableName: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const current = nodePositions[tableName] ?? {
      x: effectiveNodes.find((n) => n.table.name === tableName)?.x ?? 0,
      y: effectiveNodes.find((n) => n.table.name === tableName)?.y ?? 0,
    };
    const startX = current.x;
    const startY = current.y;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startClientX) / view.zoom;
      const dy = (ev.clientY - startClientY) / view.zoom;
      setNodePositions((prev) => ({
        ...prev,
        [tableName]: { x: Math.round(startX + dx), y: Math.round(startY + dy) },
      }));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Port connection start
  const startConnecting = (e: React.PointerEvent, fromTable: string, fromColumn: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const fromNode = effectiveNodes.find((n) => n.table.name === fromTable);
    if (!fromNode) return;
    const startX = fromNode.x + fromNode.width;
    const startY = getAnchorY(fromNode, fromColumn);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const currentX = (e.clientX - rect.left - view.x) / view.zoom;
    const currentY = (e.clientY - rect.top - view.y) / view.zoom;

    setConnecting({
      fromTable,
      fromColumn,
      startX,
      startY,
      currentX,
      currentY,
    });
  };

  // Schema mutation helpers
  const updateSelectedTable = (fn: (t: DesignTable) => DesignTable) => {
    if (!selectedTableName) return;
    setSchema((s) =>
      s
        ? {
            tables: s.tables.map((t) => (t.name === selectedTableName ? fn(t) : t)),
          }
        : s,
    );
  };

  const addTable = () => {
    if (!schema) return;
    const name = uniqueColumnName("nueva_tabla", schema.tables.map((t) => t.name));
    const pk = PRIMARY_KEY_PRESETS[0].createColumn(engine);
    const colType = engine === "sqlite" ? "INTEGER" : "bigint(20)";
    const next: DesignTable = {
      name,
      columns: [
        {
          name: pk.name,
          column_type: colType,
          nullable: false,
          primary_key: true,
          auto_increment: true,
          default_value: null,
          comment: "",
        },
      ],
      foreign_keys: [],
    };
    setSchema({ tables: [...schema.tables, next] });
    setSelectedTableName(name);
    setIsDockOpen(true);
  };

  const removeTable = () => {
    if (!schema || !selectedTable) return;
    const name = selectedTable.name;
    useUIStore.getState().showConfirm({
      title: "Eliminar tabla del diseño",
      message: `La tabla «${name}» se eliminará de la base al aplicar la migración.`,
      variant: "danger",
      confirmText: "Quitar del diseño",
      onConfirm: () => {
        setSchema((s) =>
          s
            ? {
                tables: s.tables
                  .filter((t) => t.name !== name)
                  .map((t) => ({
                    ...t,
                    foreign_keys: t.foreign_keys.filter((f) => f.referenced_table !== name),
                  })),
              }
            : s,
        );
        setSelectedTableName(null);
      },
    });
  };

  const addColumn = () =>
    updateSelectedTable((t) => ({
      ...t,
      columns: [
        ...t.columns,
        {
          name: uniqueColumnName("columna", t.columns.map((c) => c.name)),
          column_type: engine === "sqlite" ? "TEXT" : "varchar(255)",
          nullable: true,
          primary_key: false,
          auto_increment: false,
          default_value: null,
          comment: "",
        },
      ],
    }));

  // Column edits that reach other tables: foreign keys pointing at the column.
  const removeColumn = (index: number) => {
    if (!selectedTable) return;
    const owner = selectedTable.name;
    const gone = selectedTable.columns[index].name;
    setSchema((s) =>
      s
        ? {
            tables: s.tables.map((t) => ({
              ...t,
              columns: t.name === owner ? t.columns.filter((_, i) => i !== index) : t.columns,
              foreign_keys: t.foreign_keys.filter(
                (f) =>
                  !(t.name === owner && f.columns.includes(gone)) &&
                  !(f.referenced_table === owner && f.referenced_columns.includes(gone)),
              ),
            })),
          }
        : s,
    );
  };

  const renameColumn = (index: number, name: string) => {
    if (!selectedTable) return;
    const owner = selectedTable.name;
    const old = selectedTable.columns[index].name;
    setSchema((s) =>
      s
        ? {
            tables: s.tables.map((t) => ({
              ...t,
              columns:
                t.name === owner
                  ? t.columns.map((c, i) => (i === index ? { ...c, name } : c))
                  : t.columns,
              foreign_keys: t.foreign_keys.map((f) => ({
                ...f,
                columns: t.name === owner ? f.columns.map((c) => (c === old ? name : c)) : f.columns,
                referenced_columns:
                  f.referenced_table === owner
                    ? f.referenced_columns.map((c) => (c === old ? name : c))
                    : f.referenced_columns,
              })),
            })),
          }
        : s,
    );
  };

  const renameTable = (name: string) => {
    if (!selectedTable) return;
    const old = selectedTable.name;
    setSchema((s) =>
      s
        ? {
            tables: s.tables.map((t) => ({
              ...t,
              name: t.name === old ? name : t.name,
              foreign_keys: t.foreign_keys.map((f) =>
                f.referenced_table === old ? { ...f, referenced_table: name } : f,
              ),
            })),
          }
        : s,
    );
    setSelectedTableName(name);
  };

  const addForeignKey = () => {
    if (!selectedTable || tables.length === 0) return;
    const target = tables[0];
    const fk: DesignForeignKey = {
      name: "",
      columns: [selectedTable.columns[0]?.name ?? ""],
      referenced_table: target.name,
      referenced_columns: [target.columns[0]?.name ?? ""],
      on_delete: "RESTRICT",
      on_update: "RESTRICT",
    };
    updateSelectedTable((t) => ({ ...t, foreign_keys: [...t.foreign_keys, fk] }));
  };

  const updateForeignKey = (index: number, patch: Partial<DesignForeignKey>) =>
    updateSelectedTable((t) => ({
      ...t,
      foreign_keys: t.foreign_keys.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }));

  // Migration review & execution
  const review = async () => {
    if (!schema) return;
    setBusy(true);
    setApplyError(null);
    try {
      const m = await dbService.generateSchemaMigration(database, schema);
      if (!m.has_changes) {
        useUIStore.getState().showAlert({
          title: "Sin cambios",
          message: "El diseño coincide con la base de datos; no hay nada que migrar.",
        });
      } else {
        setSqlTab("up");
        setMigration(m);
      }
    } catch (err) {
      useUIStore.getState().showAlert({
        title: "Diseño no válido",
        message: String(err),
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  const hasDestructive = useMemo(
    () => !!migration?.up.some((s) => s.is_destructive) || !!migration?.warnings.length,
    [migration],
  );

  const runMigration = async () => {
    if (!migration || !schema) return;
    setBusy(true);
    setApplyError(null);
    try {
      await dbService.applySchemaMigration(database, schema, migration.up_sql);
      setMigration(null);
      await load();
      onApplied?.();
    } catch (err) {
      setApplyError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // Every migration changes the schema, so it is always confirmed (Safe Mode).
  const confirmRun = () => {
    if (!migration) return;
    useUIStore.getState().showConfirm({
      title: hasDestructive ? "Aplicar migración con riesgo" : "Aplicar migración",
      message: hasDestructive
        ? "La migración contiene operaciones destructivas o con posible pérdida de datos."
        : `Se ejecutarán ${migration.up.length} sentencias del script UP en «${database}».`,
      variant: hasDestructive ? "danger" : "primary",
      confirmText: "Aplicar",
      onConfirm: runMigration,
    });
  };

  const currentSql = migration ? (sqlTab === "up" ? migration.up_sql : migration.down_sql) : "";

  if (isLoading && !schema) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState
        title="No se pudo cargar el esquema"
        description={error}
        action={
          <button className={ghostBtn} onClick={onClose}>
            Volver al diagrama
          </button>
        }
      />
    );
  }

  const canvasWidth = layout?.width ?? 1200;
  const canvasHeight = layout?.height ?? 800;

  return (
    <div className="pyro-view pyro-schema-workspace h-full flex flex-col bg-canvas select-none">
      {/* Top action toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-surface shrink-0 z-10">
        <button className={iconBtn} title="Volver al visor ER" onClick={onClose}>
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <Network className="w-4 h-4 text-fg-muted" />
        <span className="text-sm font-medium text-fg">Diseñador de esquemas</span>
        <span className={mutedText}>
          {database} · {tables.length} tablas · {effectiveEdges.length} relaciones
        </span>

        <div className="flex-1" />

        <div className="flex items-center mr-1">
          <button className={iconBtn} title="Alejar" onClick={() => zoomBy(1 / 1.2)}>
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="w-10 text-center text-[11px] text-fg-muted tabular-nums">
            {Math.round(view.zoom * 100)}%
          </span>
          <button className={iconBtn} title="Acercar" onClick={() => zoomBy(1.2)}>
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button className={iconBtn} title="Ajustar a la vista" onClick={fitToView}>
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>

        <button className={ghostBtn} onClick={addTable} title="Crear una nueva tabla en el diseño">
          <Plus className="w-3.5 h-3.5" /> Nueva tabla
        </button>
        <button className={ghostBtn} onClick={load} disabled={isLoading} title="Restablecer al esquema físico">
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} /> Descartar cambios
        </button>
        <button
          className={`${ghostBtn} ${isDockOpen ? "bg-accent-soft text-accent-text" : ""}`}
          onClick={() => setIsDockOpen((o) => !o)}
          title="Alternar panel de propiedades de tabla"
        >
          <PanelRight className="w-3.5 h-3.5" /> Inspector
        </button>
        <button className={primaryBtn} onClick={review} disabled={busy || !schema}>
          <GitCompare className="w-3.5 h-3.5" /> Revisar migración
        </button>
      </div>

      {/* Main workspace container with Canvas & RightDock */}
      <div className="flex-1 relative overflow-hidden flex">
        <div
          ref={viewportRef}
          className="flex-1 h-full relative overflow-hidden cursor-grab active:cursor-grabbing"
          style={{
            paddingRight: isWide && isDockOpen ? dockWidth : 0,
            transition: "padding-right 0.15s ease",
          }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
        >
          {tables.length === 0 ? (
            <EmptyState
              icon={<Network className="w-6 h-6" />}
              title="Esquema vacío"
              description="Añada su primera tabla para comenzar a modelar su base de datos."
              action={
                <button className={primaryBtn} onClick={addTable}>
                  <Plus className="w-3.5 h-3.5" /> Crear tabla
                </button>
              }
            />
          ) : (
            <div
              className="absolute left-0 top-0 origin-top-left pointer-events-none"
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                width: canvasWidth,
                height: canvasHeight,
              }}
            >
              {/* SVG Edges layer */}
              <svg
                className="absolute left-0 top-0 overflow-visible"
                width={canvasWidth}
                height={canvasHeight}
              >
                {effectiveEdges.map((edge) => {
                  const isHighlighted =
                    selectedTableName === edge.from || selectedTableName === edge.to;
                  return (
                    <path
                      key={edge.id}
                      d={edge.path}
                      fill="none"
                      stroke={isHighlighted ? "var(--color-accent)" : "var(--color-line-strong)"}
                      strokeWidth={isHighlighted ? 2.5 : 1.5}
                      opacity={selectedTableName && !isHighlighted ? 0.3 : 1}
                    >
                      <title>{edge.label}</title>
                    </path>
                  );
                })}

                {/* Live connection preview while dragging a port */}
                {connecting && (
                  <path
                    d={`M ${connecting.startX} ${connecting.startY} C ${
                      connecting.startX + Math.max(36, (connecting.currentX - connecting.startX) * 0.5)
                    } ${connecting.startY}, ${
                      connecting.currentX - Math.max(36, (connecting.currentX - connecting.startX) * 0.5)
                    } ${connecting.currentY}, ${connecting.currentX} ${connecting.currentY}`}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                  />
                )}
              </svg>

              {/* Table nodes */}
              {effectiveNodes.map((node) => {
                const isSelected = node.table.name === selectedTableName;
                const fkColumns = new Set(
                  effectiveEdges
                    .filter((e) => e.from === node.table.name)
                    .map((e) => e.label.split(" → ")[0]?.split(".")[1]),
                );

                return (
                  <div
                    key={node.table.name}
                    className={`absolute rounded-md border bg-surface pointer-events-auto transition-shadow ${
                      isSelected ? "border-accent shadow-pop" : "border-line"
                    }`}
                    style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTableName(node.table.name);
                      setIsDockOpen(true);
                    }}
                  >
                    {/* Draggable table header */}
                    <div
                      className="flex items-center gap-1.5 px-2 border-b border-line bg-raised rounded-t-md cursor-grab active:cursor-grabbing"
                      style={{ height: ER_HEADER_HEIGHT }}
                      onPointerDown={(e) => startDragNode(e, node.table.name)}
                      title="Arrastrar para mover tabla en el lienzo"
                    >
                      <ObjectIcon kind="tables" className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium text-fg truncate flex-1">
                        {node.table.name || "(sin nombre)"}
                      </span>
                    </div>

                    {/* Column rows with drag ports */}
                    {node.visibleColumns.map((col) => {
                      const isConnectingSource =
                        connecting?.fromTable === node.table.name &&
                        connecting?.fromColumn === col.name;
                      const isConnectingTarget =
                        hoveredTarget?.table === node.table.name &&
                        hoveredTarget?.column === col.name;

                      return (
                        <div
                          key={col.name}
                          className={`relative flex items-center gap-1.5 px-2 text-[11px] group/col ${
                            isConnectingTarget ? "bg-accent-soft" : ""
                          }`}
                          style={{ height: ER_ROW_HEIGHT }}
                        >
                          <span className="w-3 shrink-0 flex justify-center">
                            {col.is_primary_key ? (
                              <KeyRound className="w-3 h-3 text-warning" />
                            ) : fkColumns.has(col.name) ? (
                              <Link2 className="w-3 h-3 text-accent-text" />
                            ) : null}
                          </span>
                          <span
                            className={`truncate ${
                              col.is_primary_key ? "text-fg font-medium" : "text-fg"
                            }`}
                          >
                            {col.name}
                          </span>
                          <span className="ml-auto truncate text-fg-subtle mr-2.5">
                            {col.column_type}
                            {col.is_nullable ? "" : " ·"}
                          </span>

                          {/* Interactive Port Handle for Drag & Drop foreign keys */}
                          <button
                            type="button"
                            className={`absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border flex items-center justify-center cursor-crosshair z-10 transition-colors ${
                              isConnectingSource || isConnectingTarget
                                ? "border-accent bg-accent"
                                : "border-line bg-surface group-hover/col:border-accent group-hover/col:bg-accent-soft"
                            }`}
                            title="Arrastrar para crear clave foránea hacia otra tabla"
                            onPointerDown={(e) => startConnecting(e, node.table.name, col.name)}
                            onPointerEnter={() => {
                              if (
                                connecting &&
                                (connecting.fromTable !== node.table.name ||
                                  connecting.fromColumn !== col.name)
                              ) {
                                setHoveredTarget({ table: node.table.name, column: col.name });
                              }
                            }}
                            onPointerLeave={() => {
                              if (connecting) {
                                setHoveredTarget(null);
                              }
                            }}
                          >
                            <div
                              className={`w-1.5 h-1.5 rounded-full ${
                                isConnectingSource || isConnectingTarget
                                  ? "bg-surface"
                                  : "bg-fg-muted"
                              }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RightDock: Inspector and editor for the selected table */}
        {isDockOpen && (
          <RightDock width={dockWidth} onResize={setDockWidth}>
            <div className="h-full bg-surface border-l border-line flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-line shrink-0">
                <span className="text-xs font-medium text-fg flex items-center gap-1.5">
                  <ObjectIcon kind="tables" className="w-3.5 h-3.5" />
                  {selectedTable ? selectedTable.name : "Propiedades"}
                </span>
                <button
                  className={iconBtn}
                  title="Cerrar inspector"
                  onClick={() => setIsDockOpen(false)}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {!selectedTable ? (
                <div className="flex-1 p-4 flex items-center justify-center">
                  <EmptyState
                    title="Ninguna tabla seleccionada"
                    description="Haga clic en una tabla del diagrama o cree una nueva."
                    action={
                      <button className={primaryBtn} onClick={addTable}>
                        <Plus className="w-3.5 h-3.5" /> Nueva tabla
                      </button>
                    }
                  />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                  {/* Table Name */}
                  <div>
                    <label className={fieldLabel}>Nombre de la tabla</label>
                    <NameInput
                      className={inputClass}
                      value={selectedTable.name}
                      taken={tables.map((t) => t.name)}
                      onCommit={renameTable}
                    />
                  </div>

                  {/* Columns Section */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={sectionLabel}>Columnas</span>
                      <button className={ghostBtn} onClick={addColumn}>
                        <Plus className="w-3 h-3" /> Columna
                      </button>
                    </div>

                    <datalist id="designer-type-suggestions">
                      {(engine === "sqlite" ? SQLITE_TYPE_SUGGESTIONS : TYPE_SUGGESTIONS).map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>

                    <div className="space-y-1.5">
                      {selectedTable.columns.map((c, i) => (
                        <div
                          key={i}
                          className={`${cardClass} p-2 space-y-1.5 relative group/item`}
                        >
                          <div className="flex items-center gap-1.5">
                            <NameInput
                              className={`${inputClass} flex-1`}
                              placeholder="columna"
                              value={c.name}
                              taken={selectedTable.columns.map((col) => col.name)}
                              onCommit={(name) => renameColumn(i, name)}
                            />
                            <input
                              className={`${inputClass} w-28`}
                              list="designer-type-suggestions"
                              placeholder="tipo"
                              value={c.column_type}
                              onChange={(e) =>
                                updateSelectedTable((t) => ({
                                  ...t,
                                  columns: editDesignColumn(
                                    t.columns,
                                    i,
                                    { column_type: e.target.value },
                                    engine,
                                  ),
                                }))
                              }
                            />
                            <button
                              className={iconBtn}
                              title="Eliminar columna"
                              onClick={() => removeColumn(i)}
                            >
                              <Trash2 className="w-3 h-3 text-danger" />
                            </button>
                          </div>

                          <div className="flex items-center gap-4 text-[11px] text-fg-muted pl-1">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={c.primary_key}
                                onChange={(e) =>
                                  updateSelectedTable((t) => ({
                                    ...t,
                                    columns: editDesignColumn(
                                      t.columns,
                                      i,
                                      { primary_key: e.target.checked },
                                      engine,
                                    ),
                                  }))
                                }
                              />
                              PK
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={c.auto_increment}
                                onChange={(e) =>
                                  updateSelectedTable((t) => ({
                                    ...t,
                                    columns: editDesignColumn(
                                      t.columns,
                                      i,
                                      { auto_increment: e.target.checked },
                                      engine,
                                    ),
                                  }))
                                }
                              />
                              Auto-inc
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={c.nullable}
                                onChange={(e) =>
                                  updateSelectedTable((t) => ({
                                    ...t,
                                    columns: editDesignColumn(
                                      t.columns,
                                      i,
                                      { nullable: e.target.checked },
                                      engine,
                                    ),
                                  }))
                                }
                              />
                              NULL
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Foreign Keys Section */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={sectionLabel}>Claves foráneas</span>
                      <button className={ghostBtn} onClick={addForeignKey}>
                        <Plus className="w-3 h-3" /> Relación
                      </button>
                    </div>

                    {selectedTable.foreign_keys.length === 0 ? (
                      <p className={mutedText}>
                        Sin relaciones. Conecte arrastrando desde el puerto de una columna o pulse
                        «+ Relación».
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {selectedTable.foreign_keys.map((f, i) => {
                          const refTable = tables.find((t) => t.name === f.referenced_table);
                          return (
                            <div key={i} className={`${cardClass} p-2 space-y-1.5 text-xs`}>
                              <div className="flex items-center gap-1">
                                <select
                                  className={`${inputClass} flex-1`}
                                  value={f.columns[0]}
                                  onChange={(e) =>
                                    updateForeignKey(i, { columns: [e.target.value] })
                                  }
                                >
                                  {selectedTable.columns.map((c, k) => (
                                    <option key={k} value={c.name}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                                <span className={mutedText}>→</span>
                                <select
                                  className={`${inputClass} flex-1`}
                                  value={f.referenced_table}
                                  onChange={(e) => {
                                    const t = tables.find((x) => x.name === e.target.value);
                                    updateForeignKey(i, {
                                      referenced_table: e.target.value,
                                      referenced_columns: [t?.columns[0]?.name ?? ""],
                                    });
                                  }}
                                >
                                  {tables.map((t, k) => (
                                    <option key={k} value={t.name}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  className={`${inputClass} flex-1`}
                                  value={f.referenced_columns[0]}
                                  onChange={(e) =>
                                    updateForeignKey(i, {
                                      referenced_columns: [e.target.value],
                                    })
                                  }
                                >
                                  {(refTable?.columns ?? []).map((c, k) => (
                                    <option key={k} value={c.name}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className={iconBtn}
                                  title="Quitar relación"
                                  onClick={() =>
                                    updateSelectedTable((t) => ({
                                      ...t,
                                      foreign_keys: t.foreign_keys.filter((_, k) => k !== i),
                                    }))
                                  }
                                >
                                  <Trash2 className="w-3 h-3 text-danger" />
                                </button>
                              </div>

                              <div className="flex items-center gap-2 text-[11px]">
                                <span className={mutedText}>ON DELETE</span>
                                <select
                                  className={`${inputClass} flex-1 py-0.5`}
                                  value={f.on_delete}
                                  onChange={(e) =>
                                    updateForeignKey(i, { on_delete: e.target.value })
                                  }
                                >
                                  {FK_ACTIONS.map((a) => (
                                    <option key={a}>{a}</option>
                                  ))}
                                </select>

                                <span className={mutedText}>ON UPDATE</span>
                                <select
                                  className={`${inputClass} flex-1 py-0.5`}
                                  value={f.on_update}
                                  onChange={(e) =>
                                    updateForeignKey(i, { on_update: e.target.value })
                                  }
                                >
                                  {FK_ACTIONS.map((a) => (
                                    <option key={a}>{a}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Table Danger Zone */}
                  <div className="pt-2 border-t border-line flex justify-end">
                    <button className={ghostBtn} onClick={removeTable}>
                      <Trash2 className="w-3.5 h-3.5 text-danger" /> Quitar tabla
                    </button>
                  </div>
                </div>
              )}
            </div>
          </RightDock>
        )}
      </div>

      {/* Migration Review Modal */}
      <Modal
        isOpen={!!migration}
        onClose={() => setMigration(null)}
        title="Revisar migración DDL"
        size="xl"
        footer={
          <>
            <button className={secondaryBtn} onClick={() => setMigration(null)}>
              Cancelar
            </button>
            <button
              className={secondaryBtn}
              onClick={() =>
                downloadFile(
                  `${migration?.up_sql ?? ""}\n\n-- DOWN (revertir)\n${(migration?.down_sql ?? "")
                    .split("\n")
                    .map((l) => `-- ${l}`)
                    .join("\n")}\n`,
                  `schema_migration_${database}_${Date.now()}.sql`,
                  "application/sql",
                )
              }
            >
              <FileDown className="w-3.5 h-3.5" /> Exportar .sql
            </button>
            <button
              className={hasDestructive ? dangerBtn : primaryBtn}
              onClick={confirmRun}
              disabled={busy}
            >
              {busy ? <Spinner className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} Ejecutar
              UP
            </button>
          </>
        }
      >
        {migration && (
          <div className="space-y-3">
            {migration.warnings.length > 0 && (
              <div className={`${cardClass} p-3 space-y-1`}>
                <span className={sectionLabel}>Advertencias de pérdida de datos</span>
                {migration.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-warning">
                    {w}
                  </p>
                ))}
              </div>
            )}
            {applyError && <p className="text-xs text-danger whitespace-pre-wrap">{applyError}</p>}
            <div className="flex items-center gap-1">
              <button className={tabClass(sqlTab === "up")} onClick={() => setSqlTab("up")}>
                UP
              </button>
              <button className={tabClass(sqlTab === "down")} onClick={() => setSqlTab("down")}>
                DOWN
              </button>
              <div className="flex-1" />
              <button
                className={ghostBtn}
                onClick={() => navigator.clipboard.writeText(currentSql)}
              >
                <Copy className="w-3.5 h-3.5" /> Copiar
              </button>
            </div>
            <pre className="text-xs font-mono bg-raised border border-line rounded-md p-3 max-h-80 overflow-auto whitespace-pre-wrap">
              {currentSql}
            </pre>
          </div>
        )}
      </Modal>
    </div>
  );
};
