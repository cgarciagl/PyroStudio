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
});

