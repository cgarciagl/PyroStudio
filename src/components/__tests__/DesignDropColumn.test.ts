import { describe, expect, it } from "vitest";
import { withoutColumn } from "../DesignDropColumn";
import type { DesignColumn, DesignedSchema } from "../../types/database";

const col = (name: string): DesignColumn => ({
  name,
  column_type: "INTEGER",
  nullable: true,
  primary_key: false,
  auto_increment: false,
  default_value: null,
  comment: "",
});

describe("withoutColumn", () => {
  it("removes the column and every foreign key that uses it on either side", () => {
    const schema: DesignedSchema = {
      tables: [
        {
          name: "clientes",
          columns: [col("id"), col("codigo")],
          foreign_keys: [],
        },
        {
          name: "pedidos",
          columns: [col("id"), col("cliente_codigo")],
          foreign_keys: [
            {
              name: "fk",
              columns: ["cliente_codigo"],
              referenced_table: "clientes",
              referenced_columns: ["codigo"],
              on_delete: "RESTRICT",
              on_update: "RESTRICT",
            },
          ],
        },
      ],
    };
    const out = withoutColumn(schema, "clientes", "codigo");
    expect(out.tables[0].columns.map((c) => c.name)).toEqual(["id"]);
    expect(out.tables[1].foreign_keys).toEqual([]);
  });
});
