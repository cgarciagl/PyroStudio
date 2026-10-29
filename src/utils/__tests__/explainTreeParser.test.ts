import { describe, it, expect } from "vitest";
import { buildExplainTree } from "../explainTreeParser";
import type { ExplainRow } from "../../types/database";

describe("explainTreeParser", () => {
  it("should parse MySQL optimizer JSON plan with nested_loop", () => {
    const jsonPlan = {
      query_block: {
        select_id: 1,
        cost_info: {
          query_cost: "2.40",
        },
        ordering_operation: {
          using_filesort: true,
          nested_loop: [
            {
              table: {
                table_name: "users",
                access_type: "ALL",
                rows_examined_per_scan: 100,
                cost_info: { read_cost: "1.00" },
              },
            },
            {
              table: {
                table_name: "orders",
                access_type: "ref",
                key: "idx_user_id",
                ref: ["shop.users.id"],
                rows_examined_per_scan: 5,
              },
            },
          ],
        },
      },
    };

    const tree = buildExplainTree({ jsonPlan });
    expect(tree).toBeDefined();
    expect(tree.operationType).toBe("query_block");
    expect(tree.children.length).toBe(1);

    const sortNode = tree.children[0];
    expect(sortNode.operationType).toBe("ordering");
    expect(sortNode.flags).toContain("Using filesort");

    const joinNode = sortNode.children[0];
    expect(joinNode.operationType).toBe("nested_loop");
    expect(joinNode.children.length).toBe(2);

    const userTable = joinNode.children[0];
    expect(userTable.tableName).toBe("users");
    expect(userTable.operationType).toBe("table_scan");
    expect(userTable.rowsExamined).toBe(100);

    const orderTable = joinNode.children[1];
    expect(orderTable.tableName).toBe("orders");
    expect(orderTable.operationType).toBe("index_scan");
    expect(orderTable.keyUsed).toBe("idx_user_id");
  });

  it("should fallback to tabular ExplainRow array when jsonPlan is missing", () => {
    const rows: ExplainRow[] = [
      {
        id: 1,
        select_type: "SIMPLE",
        table: "products",
        type: "ALL",
        rows: 500,
        extra: "Using where; Using filesort",
      },
    ];

    const tree = buildExplainTree({ executionPlan: rows });
    expect(tree).toBeDefined();
    expect(tree.children.length).toBe(1);
    expect(tree.children[0].tableName).toBe("products");
    expect(tree.children[0].operationType).toBe("table_scan");
    expect(tree.children[0].flags).toContain("Using filesort");
  });

  it("should return fallback empty node if no data is passed", () => {
    const tree = buildExplainTree({});
    expect(tree.id).toBe("empty");
    expect(tree.children.length).toBe(0);
  });

  it("should parse SQLite EXPLAIN QUERY PLAN hierarchical rows", () => {
    const sqliteRows = [
      { id: 2, parent: 0, detail: "SCAN users" },
      { id: 4, parent: 0, detail: "SEARCH orders USING INDEX idx_orders_user_id (user_id=?)" },
      { id: 7, parent: 0, detail: "USE TEMP B-TREE FOR ORDER BY" },
    ];

    const tree = buildExplainTree({ sqliteRows });
    expect(tree.id).toBe("root-sqlite");
    expect(tree.children.length).toBe(3);

    const scanNode = tree.children[0];
    expect(scanNode.operationType).toBe("table_scan");
    expect(scanNode.tableName).toBe("users");

    const searchNode = tree.children[1];
    expect(searchNode.operationType).toBe("index_scan");
    expect(searchNode.tableName).toBe("orders");
    expect(searchNode.keyUsed).toBe("idx_orders_user_id");
    expect(searchNode.condition).toBe("user_id=?");

    const orderNode = tree.children[2];
    expect(orderNode.operationType).toBe("ordering");
    expect(orderNode.flags).toContain("Using filesort (Temp B-Tree)");
  });

  it("should nest SQLite parent-child relationships correctly", () => {
    const sqliteRows = [
      { id: 2, parent: 0, detail: "CO-ROUTINE (subquery-1)" },
      { id: 4, parent: 2, detail: "SCAN items" },
      { id: 7, parent: 0, detail: "SCAN subquery-1" },
    ];

    const tree = buildExplainTree({ sqliteRows });
    expect(tree.children.length).toBe(2);

    const coroutine = tree.children[0];
    expect(coroutine.operationType).toBe("subquery");
    expect(coroutine.children.length).toBe(1);
    expect(coroutine.children[0].tableName).toBe("items");
    expect(coroutine.children[0].operationType).toBe("table_scan");
  });
});

