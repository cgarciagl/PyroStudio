import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, KeyRound, Link2, Maximize, Minus, Network, Plus, RefreshCw } from "lucide-react";
import { dbService } from "../services/tauriDb";
import { useUIStore } from "../stores/uiStore";
import type { ErSchema } from "../types/database";
import {
  ER_HEADER_HEIGHT,
  ER_ROW_HEIGHT,
  filterErSchema,
  layoutErDiagram,
  type ErLayout,
} from "../utils/erLayout";
import { ObjectIcon } from "./objectIcons";
import { EmptyState, Spinner } from "./ui/Modal";
import { ghostBtn, iconBtn, inputClass, menuItem, menuPanel, mutedText } from "./ui/styles";

interface ErDiagramTabProps {
  database: string;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const FIT_MARGIN = 32;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const ErDiagramTab: React.FC<ErDiagramTabProps> = ({ database }) => {
  const [schema, setSchema] = useState<ErSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [withNeighbors, setWithNeighbors] = useState(true);
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState({ x: FIT_MARGIN, y: FIT_MARGIN, zoom: 1 });
  const [isExportOpen, setIsExportOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setSchema(await dbService.getErSchema(database));
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [database]);

  useEffect(() => {
    load();
  }, [load]);

  const layout: ErLayout | null = useMemo(
    () => (schema ? layoutErDiagram(filterErSchema(schema, query, withNeighbors)) : null),
    [schema, query, withNeighbors],
  );

  const fitToView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !layout || layout.nodes.length === 0) return;
    const zoom = clampZoom(
      Math.min(
        (viewport.clientWidth - FIT_MARGIN * 2) / layout.width,
        (viewport.clientHeight - FIT_MARGIN * 2) / layout.height,
        1,
      ),
    );
    setView({
      zoom,
      x: (viewport.clientWidth - layout.width * zoom) / 2,
      y: Math.max(FIT_MARGIN, (viewport.clientHeight - layout.height * zoom) / 2),
    });
  }, [layout]);

  // Re-fit whenever the drawn set of tables changes (load, filter).
  useEffect(() => {
    fitToView();
  }, [fitToView]);

  // Wheel zoom around the cursor; registered natively so preventDefault works.
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
  }, [layout]);

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

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    // A click on the empty background clears the focused table.
    if (drag && !drag.moved && e.target === e.currentTarget) setFocused(null);
  };

  // The focused (clicked) table wins over the hovered one for highlighting.
  const highlight = focused ?? hovered;
  const related = useMemo(() => {
    if (!highlight || !layout) return null;
    const set = new Set([highlight]);
    for (const edge of layout.edges) {
      if (edge.from === highlight) set.add(edge.to);
      if (edge.to === highlight) set.add(edge.from);
    }
    return set;
  }, [highlight, layout]);

  const openTable = (table: string) => {
    useUIStore.getState().openTab({
      id: `tab_table_${database}_${table}`,
      type: "table",
      title: table,
      database,
      tableName: table,
    });
  };

  const exportAs = async (format: "svg" | "png") => {
    setIsExportOpen(false);
    if (!layout) return;
    const svg = buildStandaloneSvg(layout, database);
    const filename = `er_${database}.${format}`;
    if (format === "svg") {
      triggerDownload(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);
      return;
    }
    try {
      triggerDownload(await rasterizeSvg(svg, layout), filename);
    } catch (err) {
      useUIStore.getState().showAlert({
        title: "No se pudo exportar a PNG",
        message: String(err),
        variant: "warning",
        icon: "alert",
      });
    }
  };

  if (isLoading && !schema) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-fg-muted">
        <Spinner /> Leyendo el esquema de {database}…
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<Network className="w-6 h-6" />}
        title="No se pudo leer el esquema"
        description={error}
        action={
          <button className={ghostBtn} onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" /> Reintentar
          </button>
        }
      />
    );
  }

  const tableCount = layout?.nodes.length ?? 0;
  const relationCount = layout?.edges.length ?? 0;

  return (
    <div className="h-full flex flex-col bg-canvas">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-surface shrink-0">
        <Network className="w-4 h-4 text-fg-muted" />
        <span className="text-sm font-medium text-fg">Diagrama ER</span>
        <span className={mutedText}>
          {database} · {tableCount} tablas · {relationCount} relaciones
        </span>
        <div className="flex-1" />
        <input
          className={`${inputClass} max-w-[220px]`}
          placeholder="Filtrar tablas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs text-fg-muted select-none">
          <input
            type="checkbox"
            checked={withNeighbors}
            onChange={(e) => setWithNeighbors(e.target.checked)}
          />
          Incluir relacionadas
        </label>
        <div className="flex items-center">
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
          <button className={iconBtn} title="Recargar esquema" onClick={load} disabled={isLoading}>
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="relative">
          <button
            className={ghostBtn}
            onClick={() => setIsExportOpen((o) => !o)}
            disabled={tableCount === 0}
          >
            <Download className="w-3.5 h-3.5" /> Exportar
          </button>
          {isExportOpen && (
            <div className={menuPanel}>
              <button className={menuItem} onClick={() => exportAs("svg")}>
                Imagen vectorial (SVG)
              </button>
              <button className={menuItem} onClick={() => exportAs("png")}>
                Imagen PNG
              </button>
            </div>
          )}
        </div>
      </div>

      {tableCount === 0 ? (
        <EmptyState
          icon={<Network className="w-6 h-6" />}
          title={query ? "Ninguna tabla coincide con el filtro" : "Esta base no tiene tablas"}
        />
      ) : (
        <div
          ref={viewportRef}
          className="relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div
            className="absolute left-0 top-0 origin-top-left pointer-events-none"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              width: layout!.width,
              height: layout!.height,
            }}
          >
            <svg
              className="absolute left-0 top-0 overflow-visible"
              width={layout!.width}
              height={layout!.height}
            >
              {layout!.edges.map((edge) => {
                const active = related?.has(edge.from) && related?.has(edge.to) &&
                  (edge.from === highlight || edge.to === highlight);
                return (
                  <path
                    key={edge.id}
                    d={edge.path}
                    fill="none"
                    stroke={active ? "var(--color-accent)" : "var(--color-line-strong)"}
                    strokeWidth={active ? 2 : 1.25}
                    opacity={related && !active ? 0.25 : 1}
                  >
                    <title>
                      {`${edge.from}.${edge.relation.foreign_key.column_name} → ${edge.to}.${edge.relation.foreign_key.referenced_column}`}
                    </title>
                  </path>
                );
              })}
            </svg>
            {layout!.nodes.map((node) => {
              const dimmed = related && !related.has(node.table.name);
              const isFocus = node.table.name === highlight;
              const fkColumns = new Set(
                layout!.edges
                  .filter((e) => e.from === node.table.name)
                  .map((e) => e.relation.foreign_key.column_name),
              );
              return (
                <div
                  key={node.table.name}
                  className={`absolute rounded-md border bg-surface pointer-events-auto cursor-pointer transition-opacity ${
                    isFocus ? "border-accent" : "border-line"
                  } ${dimmed ? "opacity-30" : ""}`}
                  style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => setHovered(node.table.name)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setFocused((f) => (f === node.table.name ? null : node.table.name))}
                  onDoubleClick={() => openTable(node.table.name)}
                  title="Clic: resaltar relaciones · Doble clic: abrir tabla"
                >
                  <div
                    className="flex items-center gap-1.5 px-2 border-b border-line bg-raised rounded-t-md"
                    style={{ height: ER_HEADER_HEIGHT }}
                  >
                    <ObjectIcon kind={node.table.is_view ? "views" : "tables"} />
                    <span className="text-xs font-medium text-fg truncate">{node.table.name}</span>
                  </div>
                  {node.visibleColumns.map((col) => (
                    <div
                      key={col.name}
                      className="flex items-center gap-1.5 px-2 text-[11px]"
                      style={{ height: ER_ROW_HEIGHT }}
                    >
                      <span className="w-3 shrink-0 flex justify-center">
                        {col.is_primary_key ? (
                          <KeyRound className="w-3 h-3 text-warning" />
                        ) : fkColumns.has(col.name) ? (
                          <Link2 className="w-3 h-3 text-accent-text" />
                        ) : null}
                      </span>
                      <span className={`truncate ${col.is_primary_key ? "text-fg font-medium" : "text-fg"}`}>
                        {col.name}
                      </span>
                      <span className="ml-auto truncate text-fg-subtle">
                        {col.column_type}
                        {col.is_nullable ? "" : " ·"}
                      </span>
                    </div>
                  ))}
                  {node.hiddenColumns > 0 && (
                    <div className="px-2 text-[11px] text-fg-subtle" style={{ height: ER_ROW_HEIGHT }}>
                      … {node.hiddenColumns} columnas más
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className={`absolute left-3 bottom-2 ${mutedText} pointer-events-none`}>
            Arrastre para desplazar · Rueda para zoom · Doble clic en una tabla para abrirla
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Export ────────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Theme tokens resolved to concrete colors, so the file looks the same outside the app. */
function resolveThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    canvas: read("--pyro-canvas", "#ffffff"),
    surface: read("--pyro-surface", "#ffffff"),
    raised: read("--pyro-raised", "#f4f4f5"),
    line: read("--pyro-line", "#d4d4d8"),
    lineStrong: read("--pyro-line-strong", "#a1a1aa"),
    fg: read("--pyro-fg", "#18181b"),
    fgSubtle: read("--pyro-fg-subtle", "#71717a"),
  };
}

const EXPORT_PADDING = 24;
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

function buildStandaloneSvg(layout: ErLayout, database: string): string {
  const c = resolveThemeColors();
  const w = layout.width + EXPORT_PADDING * 2;
  const h = layout.height + EXPORT_PADDING * 2;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">`,
    `<title>${escapeXml(`Diagrama ER · ${database}`)}</title>`,
    `<rect width="100%" height="100%" fill="${c.canvas}"/>`,
    `<g transform="translate(${EXPORT_PADDING} ${EXPORT_PADDING})">`,
  ];
  for (const edge of layout.edges) {
    parts.push(`<path d="${edge.path}" fill="none" stroke="${c.lineStrong}" stroke-width="1.25"/>`);
  }
  for (const node of layout.nodes) {
    const { x, y, width, height } = node;
    parts.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="${c.surface}" stroke="${c.line}"/>`,
      `<path d="M ${x} ${y + ER_HEADER_HEIGHT} V ${y + 6} Q ${x} ${y} ${x + 6} ${y} H ${x + width - 6} Q ${x + width} ${y} ${x + width} ${y + 6} V ${y + ER_HEADER_HEIGHT} Z" fill="${c.raised}" stroke="${c.line}"/>`,
      `<text x="${x + 10}" y="${y + ER_HEADER_HEIGHT / 2 + 4}" font-size="12" font-weight="600" fill="${c.fg}">${escapeXml(node.table.name)}${node.table.is_view ? " (vista)" : ""}</text>`,
    );
    node.visibleColumns.forEach((col, i) => {
      const ty = y + ER_HEADER_HEIGHT + i * ER_ROW_HEIGHT + ER_ROW_HEIGHT / 2 + 4;
      const label = `${col.is_primary_key ? "🔑 " : ""}${col.name}`;
      parts.push(
        `<text x="${x + 10}" y="${ty}" font-size="11" fill="${c.fg}" font-weight="${col.is_primary_key ? 600 : 400}">${escapeXml(label)}</text>`,
        `<text x="${x + width - 8}" y="${ty}" font-size="11" fill="${c.fgSubtle}" text-anchor="end">${escapeXml(col.column_type)}</text>`,
      );
    });
    if (node.hiddenColumns > 0) {
      const ty = y + ER_HEADER_HEIGHT + node.visibleColumns.length * ER_ROW_HEIGHT + ER_ROW_HEIGHT / 2 + 4;
      parts.push(
        `<text x="${x + 10}" y="${ty}" font-size="11" fill="${c.fgSubtle}">… ${node.hiddenColumns} columnas más</text>`,
      );
    }
  }
  parts.push("</g></svg>");
  return parts.join("\n");
}

/** Draws the SVG on a canvas at 2× for a sharp PNG; browsers cap canvas size, so big diagrams scale down. */
async function rasterizeSvg(svg: string, layout: ErLayout): Promise<Blob> {
  const w = layout.width + EXPORT_PADDING * 2;
  const h = layout.height + EXPORT_PADDING * 2;
  const MAX_SIDE = 16000;
  const scale = Math.min(2, MAX_SIDE / w, MAX_SIDE / h);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("El navegador no pudo dibujar el diagrama."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No hay contexto 2D disponible.");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("El diagrama es demasiado grande."))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
