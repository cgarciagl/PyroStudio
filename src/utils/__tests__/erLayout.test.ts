import { describe, expect, it } from "vitest";
import type { ErRelation, ErSchema, ErTable } from "../../types/database";
import { ER_MAX_ROWS, filterErSchema, layoutErDiagram, pickVisibleColumns } from "../erLayout";

const table = (name: string, columns: string[] = ["id"], pk = "id"): ErTable => ({
  name,
  is_view: false,
  columns: columns.map((c) => ({
    name: c,
    column_type: "int",
    is_nullable: false,
    is_primary_key: c === pk,
  })),
});

const fk = (from: string, column: string, to: string, toColumn = "id"): ErRelation => ({
  table: from,
  foreign_key: {
    name: `fk_${from}_${column}`,
    column_name: column,
    referenced_table: to,
    referenced_column: toColumn,
    update_rule: "CASCADE",
    delete_rule: "RESTRICT",
  },
});

const shop: ErSchema = {
  database: "shop",
  tables: [
    table("customers"),
    table("orders", ["id", "customer_id"]),
    table("order_items", ["id", "order_id", "product_id"]),
    table("products"),
    table("settings", ["key"], "key"),
  ],
  relations: [
    fk("orders", "customer_id", "customers"),
    fk("order_items", "order_id", "orders"),
    fk("order_items", "product_id", "products"),
  ],
};

const byName = (schema: ErSchema) =>
  new Map(layoutErDiagram(schema).nodes.map((n) => [n.table.name, n]));

describe("layoutErDiagram", () => {
  it("coloca las tablas referenciadas a la izquierda de las que las referencian", () => {
    const nodes = byName(shop);
    expect(nodes.get("customers")!.x).toBeLessThan(nodes.get("orders")!.x);
    expect(nodes.get("orders")!.x).toBeLessThan(nodes.get("order_items")!.x);
    expect(nodes.get("products")!.x).toBeLessThan(nodes.get("order_items")!.x);
  });

  it("deja las tablas sin relaciones debajo del grafo", () => {
    const nodes = byName(shop);
    const graphBottom = Math.max(
      ...["customers", "orders", "order_items", "products"].map(
        (n) => nodes.get(n)!.y + nodes.get(n)!.height,
      ),
    );
    expect(nodes.get("settings")!.y).toBeGreaterThan(graphBottom);
  });

  it("no solapa nodos", () => {
    const nodes = layoutErDiagram(shop).nodes;
    for (const a of nodes) {
      for (const b of nodes) {
        if (a === b) continue;
        const overlap =
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap, `${a.table.name} / ${b.table.name}`).toBe(false);
      }
    }
  });

  it("tolera ciclos y autorreferencias", () => {
    const schema: ErSchema = {
      database: "x",
      tables: [table("a", ["id", "b_id"]), table("b", ["id", "a_id"]), table("tree", ["id", "parent_id"])],
      relations: [fk("a", "b_id", "b"), fk("b", "a_id", "a"), fk("tree", "parent_id", "tree")],
    };
    const layout = layoutErDiagram(schema);
    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges).toHaveLength(3);
    expect(layout.edges.every((e) => e.path.startsWith("M "))).toBe(true);
  });

  it("ignora relaciones hacia tablas que no se dibujan", () => {
    const layout = layoutErDiagram({ ...shop, tables: shop.tables.filter((t) => t.name !== "products") });
    expect(layout.edges.map((e) => e.to)).not.toContain("products");
  });
});

describe("pickVisibleColumns", () => {
  it("recorta tablas anchas sin ocultar claves", () => {
    const many = Array.from({ length: 40 }, (_, i) => `c${i}`);
    const wide = table("wide", ["id", ...many, "owner_id"]);
    const visible = pickVisibleColumns(wide, new Set(["owner_id"]));
    expect(visible).toHaveLength(ER_MAX_ROWS);
    expect(visible.map((c) => c.name)).toContain("id");
    expect(visible.map((c) => c.name)).toContain("owner_id");
  });
});

describe("filterErSchema", () => {
  it("sin filtro devuelve el esquema completo", () => {
    expect(filterErSchema(shop, "  ", true)).toBe(shop);
  });

  it("solo las coincidencias cuando no se incluyen relacionadas", () => {
    const result = filterErSchema(shop, "orders", false);
    expect(result.tables.map((t) => t.name).sort()).toEqual(["orders"]);
    expect(result.relations).toHaveLength(0);
  });

  it("añade solo los vecinos directos de las coincidencias", () => {
    const result = filterErSchema(shop, "customers", true);
    expect(result.tables.map((t) => t.name).sort()).toEqual(["customers", "orders"]);
  });
});
