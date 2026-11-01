import { describe, expect, it } from "vitest";
import { editDesignColumn } from "../SchemaDesignerTab";
import type { DesignColumn } from "../../types/database";

const col = (name: string, over: Partial<DesignColumn> = {}): DesignColumn => ({
  name,
  column_type: "bigint(20)",
  nullable: true,
  primary_key: false,
  auto_increment: false,
  default_value: null,
  comment: "",
  ...over,
});

describe("editDesignColumn", () => {
  it("auto-increment forces PK and NOT NULL", () => {
    const out = editDesignColumn([col("id")], 0, { auto_increment: true });
    expect(out[0]).toMatchObject({ primary_key: true, auto_increment: true, nullable: false });
  });

  it("only one auto-increment column survives", () => {
    const cols = [col("a", { primary_key: true, auto_increment: true, nullable: false }), col("b")];
    const out = editDesignColumn(cols, 1, { auto_increment: true });
    expect(out[0].auto_increment).toBe(false);
    expect(out[1].auto_increment).toBe(true);
  });

  it("a non-integer type disables auto-increment", () => {
    const cols = [col("a", { primary_key: true, auto_increment: true, nullable: false })];
    const out = editDesignColumn(cols, 0, { column_type: "varchar(10)" });
    expect(out[0].auto_increment).toBe(false);
  });

  it("supports sqlite engine column edits", () => {
    const cols = [col("id", { column_type: "INTEGER" })];
    const out = editDesignColumn(cols, 0, { auto_increment: true }, "sqlite");
    expect(out[0]).toMatchObject({ column_type: "INTEGER", primary_key: true, auto_increment: true, nullable: false });

    const out2 = editDesignColumn(out, 0, { column_type: "TEXT" }, "sqlite");
    expect(out2[0].auto_increment).toBe(false);
  });
});

describe("designToErSchema", () => {
  it("converts design tables and foreign keys to ErSchema format", async () => {
    const { designToErSchema } = await import("../SchemaDesignerTab");
    const er = designToErSchema("test_db", {
      tables: [
        {
          name: "users",
          columns: [col("id", { primary_key: true, auto_increment: true, nullable: false })],
          foreign_keys: [],
        },
        {
          name: "orders",
          columns: [
            col("id", { primary_key: true, auto_increment: true, nullable: false }),
            col("user_id", { nullable: false }),
          ],
          foreign_keys: [
            {
              name: "fk_orders_user_id",
              columns: ["user_id"],
              referenced_table: "users",
              referenced_columns: ["id"],
              on_delete: "CASCADE",
              on_update: "RESTRICT",
            },
          ],
        },
      ],
    });

    expect(er.database).toBe("test_db");
    expect(er.tables).toHaveLength(2);
    expect(er.relations).toHaveLength(1);
    expect(er.relations[0]).toEqual({
      table: "orders",
      foreign_key: {
        name: "fk_orders_user_id",
        column_name: "user_id",
        referenced_table: "users",
        referenced_column: "id",
        update_rule: "RESTRICT",
        delete_rule: "CASCADE",
      },
    });
  });
});

