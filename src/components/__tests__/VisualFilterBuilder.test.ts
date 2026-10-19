import { describe, it, expect } from "vitest";
import {
  buildFilterSql,
  buildSortSql,
  evaluateFilterRuleClient,
  type FilterRule,
  type SortRule,
} from "../VisualFilterBuilder";

describe("VisualFilterBuilder", () => {
  it("builds SQL for exact match and contains operators", () => {
    const rules: FilterRule[] = [
      {
        id: "1",
        enabled: true,
        column: "usu_id",
        operator: "=",
        value: "2",
        connector: "AND",
      },
      {
        id: "2",
        enabled: true,
        column: "FOLIO_ADMISION",
        operator: "contains",
        value: "119",
        connector: "AND",
      },
    ];

    const sql = buildFilterSql(rules);
    expect(sql).toBe("`usu_id` = 2 AND `FOLIO_ADMISION` LIKE '%119%'");
  });

  it("skips disabled rules", () => {
    const rules: FilterRule[] = [
      {
        id: "1",
        enabled: false,
        column: "usu_id",
        operator: "=",
        value: "2",
        connector: "AND",
      },
      {
        id: "2",
        enabled: true,
        column: "FOLIO_ADMISION",
        operator: "contains",
        value: "119",
        connector: "AND",
      },
    ];

    const sql = buildFilterSql(rules);
    expect(sql).toBe("`FOLIO_ADMISION` LIKE '%119%'");
  });

  it("handles is null, is not null, is empty, is not empty", () => {
    const rules: FilterRule[] = [
      {
        id: "1",
        enabled: true,
        column: "deleted_at",
        operator: "is null",
        value: "",
        connector: "AND",
      },
      {
        id: "2",
        enabled: true,
        column: "email",
        operator: "is not empty",
        value: "",
        connector: "OR",
      },
    ];

    const sql = buildFilterSql(rules);
    expect(sql).toBe("`deleted_at` IS NULL AND (`email` != '' AND `email` IS NOT NULL)");
  });

  it("handles between and in list with quoting and escaping", () => {
    const rules: FilterRule[] = [
      {
        id: "1",
        enabled: true,
        column: "age",
        operator: "is between",
        value: "18",
        valueTo: "65",
        connector: "AND",
      },
      {
        id: "2",
        enabled: true,
        column: "status",
        operator: "is in list",
        value: "active, pending, 'blocked'",
        connector: "AND",
      },
    ];

    const sql = buildFilterSql(rules);
    expect(sql).toBe("`age` BETWEEN 18 AND 65 AND `status` IN ('active', 'pending', 'blocked')");
  });

  it("supports grouping parentheses", () => {
    const rules: FilterRule[] = [
      {
        id: "1",
        enabled: true,
        column: "role",
        operator: "=",
        value: "admin",
        connector: "OR",
        openParen: true,
      },
      {
        id: "2",
        enabled: true,
        column: "role",
        operator: "=",
        value: "editor",
        connector: "AND",
        closeParen: true,
      },
      {
        id: "3",
        enabled: true,
        column: "active",
        operator: "=",
        value: "1",
        connector: "AND",
      },
    ];

    const sql = buildFilterSql(rules);
    expect(sql).toBe("(`role` = 'admin' OR `role` = 'editor') AND `active` = 1");
  });

  it("builds multi-column sort SQL", () => {
    const sorts: SortRule[] = [
      { id: "1", column: "usu_id", direction: "ASC" },
      { id: "2", column: "FOLIO_ADMISION", direction: "DESC" },
    ];

    const sortSql = buildSortSql(sorts);
    expect(sortSql).toBe("`usu_id` ASC, `FOLIO_ADMISION` DESC");
  });

  it("evaluates rules client-side accurately", () => {
    const ruleContains: FilterRule = {
      id: "1",
      enabled: true,
      column: "name",
      operator: "contains",
      value: "carlos",
      connector: "AND",
    };
    expect(evaluateFilterRuleClient("Juan Carlos Pérez", ruleContains)).toBe(true);
    expect(evaluateFilterRuleClient("María López", ruleContains)).toBe(false);

    const ruleBetween: FilterRule = {
      id: "2",
      enabled: true,
      column: "score",
      operator: "is between",
      value: "10",
      valueTo: "20",
      connector: "AND",
    };
    expect(evaluateFilterRuleClient(15, ruleBetween)).toBe(true);
    expect(evaluateFilterRuleClient(25, ruleBetween)).toBe(false);

    const ruleInList: FilterRule = {
      id: "3",
      enabled: true,
      column: "cat",
      operator: "is in list",
      value: "A, B, C",
      connector: "AND",
    };
    expect(evaluateFilterRuleClient("B", ruleInList)).toBe(true);
    expect(evaluateFilterRuleClient("Z", ruleInList)).toBe(false);
  });
});
