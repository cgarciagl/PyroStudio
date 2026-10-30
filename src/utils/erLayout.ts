import type { ErColumn, ErRelation, ErSchema, ErTable } from "../types/database";

/**
 * Layered layout for the ER diagram. Referenced (parent) tables go to the left
 * and the tables pointing at them to the right, so most relation lines flow in
 * one direction. Tables without relations are packed in a grid underneath.
 */

export const ER_NODE_WIDTH = 232;
export const ER_HEADER_HEIGHT = 30;
export const ER_ROW_HEIGHT = 20;
export const ER_MAX_ROWS = 14;
const NODE_PADDING_BOTTOM = 6;
const GAP_X = 96;
const GAP_Y = 28;
const ORDER_SWEEPS = 4;

export interface ErNode {
  table: ErTable;
  x: number;
  y: number;
  width: number;
  height: number;
  visibleColumns: ErColumn[];
  hiddenColumns: number;
}

export interface ErEdge {
  id: string;
  from: string;
  to: string;
  relation: ErRelation;
  path: string;
}

export interface ErLayout {
  nodes: ErNode[];
  edges: ErEdge[];
  width: number;
  height: number;
}

/** Columns drawn in a node: keys always stay visible, the rest fill up to the limit. */
export function pickVisibleColumns(table: ErTable, fkColumns: Set<string>): ErColumn[] {
  if (table.columns.length <= ER_MAX_ROWS) return table.columns;
  const isKey = (c: ErColumn) => c.is_primary_key || fkColumns.has(c.name);
  let budget = ER_MAX_ROWS - table.columns.filter(isKey).length;
  return table.columns.filter((c) => {
    if (isKey(c)) return true;
    if (budget <= 0) return false;
    budget--;
    return true;
  });
}

function nodeHeight(visible: number, hidden: number): number {
  const rows = visible + (hidden > 0 ? 1 : 0);
  return ER_HEADER_HEIGHT + rows * ER_ROW_HEIGHT + NODE_PADDING_BOTTOM;
}

/** Longest path from a root (a table that references nothing); cycles are cut where found. */
function assignLayers(names: string[], parents: Map<string, Set<string>>): Map<string, number> {
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (name: string): number => {
    const known = layer.get(name);
    if (known !== undefined) return known;
    if (visiting.has(name)) return -1;
    visiting.add(name);
    let depth = 0;
    for (const parent of parents.get(name) ?? []) {
      depth = Math.max(depth, visit(parent) + 1);
    }
    visiting.delete(name);
    layer.set(name, depth);
    return depth;
  };
  names.forEach(visit);
  return layer;
}

/** Barycenter ordering: each table moves toward the average position of its neighbors. */
function orderLayers(layers: string[][], neighbors: Map<string, Set<string>>): void {
  const position = new Map<string, number>();
  const record = () => layers.forEach((l) => l.forEach((name, i) => position.set(name, i)));
  record();
  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep++) {
    const sequence = sweep % 2 === 0 ? layers : [...layers].reverse();
    for (const l of sequence) {
      const weight = new Map<string, number>();
      for (const name of l) {
        const around = [...(neighbors.get(name) ?? [])].map((n) => position.get(n) ?? 0);
        weight.set(
          name,
          around.length ? around.reduce((a, b) => a + b, 0) / around.length : (position.get(name) ?? 0),
        );
      }
      l.sort((a, b) => weight.get(a)! - weight.get(b)! || a.localeCompare(b));
      l.forEach((name, i) => position.set(name, i));
    }
  }
}

function anchorY(node: ErNode, column: string): number {
  const index = node.visibleColumns.findIndex((c) => c.name === column);
  if (index === -1) return node.y + ER_HEADER_HEIGHT / 2;
  return node.y + ER_HEADER_HEIGHT + index * ER_ROW_HEIGHT + ER_ROW_HEIGHT / 2;
}

/** Cubic curve from the referencing column to the referenced one. */
function edgePath(child: ErNode, parent: ErNode, relation: ErRelation): string {
  const y1 = anchorY(child, relation.foreign_key.column_name);
  const y2 = anchorY(parent, relation.foreign_key.referenced_column);
  const bend = 48;
  if (child === parent || Math.abs(child.x - parent.x) < ER_NODE_WIDTH) {
    // Same column of the layout: loop out on the right side.
    const x1 = child.x + child.width;
    const x2 = parent.x + parent.width;
    const out = Math.max(x1, x2) + bend;
    return `M ${x1} ${y1} C ${out} ${y1}, ${out} ${y2}, ${x2} ${y2}`;
  }
  const childOnRight = child.x > parent.x;
  const x1 = childOnRight ? child.x : child.x + child.width;
  const x2 = childOnRight ? parent.x + parent.width : parent.x;
  const dx = childOnRight ? -bend : bend;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function layoutErDiagram(schema: ErSchema): ErLayout {
  const names = schema.tables.map((t) => t.name);
  const known = new Set(names);
  const relations = schema.relations.filter(
    (r) => known.has(r.table) && known.has(r.foreign_key.referenced_table),
  );

  const parents = new Map<string, Set<string>>();
  const neighbors = new Map<string, Set<string>>();
  const fkColumns = new Map<string, Set<string>>();
  const link = (map: Map<string, Set<string>>, a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const r of relations) {
    link(fkColumns, r.table, r.foreign_key.column_name);
    const parent = r.foreign_key.referenced_table;
    if (parent === r.table) continue;
    link(parents, r.table, parent);
    link(neighbors, r.table, parent);
    link(neighbors, parent, r.table);
  }

  const nodes = new Map<string, ErNode>();
  for (const table of schema.tables) {
    const visibleColumns = pickVisibleColumns(table, fkColumns.get(table.name) ?? new Set());
    const hiddenColumns = table.columns.length - visibleColumns.length;
    nodes.set(table.name, {
      table,
      x: 0,
      y: 0,
      width: ER_NODE_WIDTH,
      height: nodeHeight(visibleColumns.length, hiddenColumns),
      visibleColumns,
      hiddenColumns,
    });
  }

  const connected = names.filter((n) => neighbors.has(n));
  const isolated = names.filter((n) => !neighbors.has(n));

  const layerOf = assignLayers(connected, parents);
  const layers: string[][] = [];
  for (const name of [...connected].sort()) {
    const l = layerOf.get(name) ?? 0;
    (layers[l] ??= []).push(name);
  }
  const denseLayers = layers.filter((l) => l && l.length > 0);
  orderLayers(denseLayers, neighbors);

  let width = 0;
  let height = 0;
  denseLayers.forEach((l, column) => {
    let y = 0;
    for (const name of l) {
      const node = nodes.get(name)!;
      node.x = column * (ER_NODE_WIDTH + GAP_X);
      node.y = y;
      y += node.height + GAP_Y;
    }
    width = Math.max(width, column * (ER_NODE_WIDTH + GAP_X) + ER_NODE_WIDTH);
    height = Math.max(height, y - GAP_Y);
  });

  if (isolated.length > 0) {
    const perRow = Math.max(4, denseLayers.length);
    let top = denseLayers.length > 0 ? height + GAP_Y * 3 : 0;
    for (let start = 0; start < isolated.length; start += perRow) {
      const row = isolated.slice(start, start + perRow).map((n) => nodes.get(n)!);
      row.forEach((node, i) => {
        node.x = i * (ER_NODE_WIDTH + GAP_X / 2);
        node.y = top;
        width = Math.max(width, node.x + ER_NODE_WIDTH);
      });
      top += Math.max(...row.map((n) => n.height)) + GAP_Y;
    }
    height = Math.max(height, top - GAP_Y);
  }

  const edges: ErEdge[] = relations.map((relation, i) => {
    const child = nodes.get(relation.table)!;
    const parent = nodes.get(relation.foreign_key.referenced_table)!;
    return {
      id: `${relation.table}.${relation.foreign_key.name}.${relation.foreign_key.column_name}.${i}`,
      from: relation.table,
      to: relation.foreign_key.referenced_table,
      relation,
      path: edgePath(child, parent, relation),
    };
  });

  return { nodes: [...nodes.values()], edges, width, height };
}

/**
 * Tables to draw for a filter: the matching ones plus, optionally, every table
 * directly related to them.
 */
export function filterErSchema(schema: ErSchema, query: string, withNeighbors: boolean): ErSchema {
  const term = query.trim().toLowerCase();
  if (!term) return schema;
  const matches = new Set(
    schema.tables.filter((t) => t.name.toLowerCase().includes(term)).map((t) => t.name),
  );
  const keep = new Set(matches);
  if (withNeighbors) {
    for (const r of schema.relations) {
      const parent = r.foreign_key.referenced_table;
      if (matches.has(r.table)) keep.add(parent);
      if (matches.has(parent)) keep.add(r.table);
    }
  }
  return {
    ...schema,
    tables: schema.tables.filter((t) => keep.has(t.name)),
    relations: schema.relations.filter(
      (r) => keep.has(r.table) && keep.has(r.foreign_key.referenced_table),
    ),
  };
}
