import { describe, it, expect, beforeEach } from "vitest";
import { useStagedChangesStore } from "../../../stores/stagedChangesStore";
import { inheritRowKey, rowKeyOf } from "../rowIdentity";

describe("staged changes keyed by row identity", () => {
  beforeEach(() => useStagedChangesStore.setState({ changesByTable: {} }));

  it("does not merge edits of two records that shared a visible position", () => {
    // Same rowIndex (e.g. first row after a search, then first row after clearing it),
    // but different records: they must stay two UPDATEs with their own WHERE.
    const store = useStagedChangesStore.getState();
    const base = { database: "db", table: "t", rowIndex: 0, originalValue: "x" };
    store.stageCellUpdate({
      ...base, rowKey: "pk:[1]", colIndex: 1, columnName: "a", stagedValue: "A",
      primaryKeys: [{ column: "id", value: 1 }],
    });
    store.stageCellUpdate({
      ...base, rowKey: "pk:[2]", colIndex: 2, columnName: "b", stagedValue: "B",
      primaryKeys: [{ column: "id", value: 2 }],
    });
    store.stageCellUpdate({
      ...base, rowKey: "pk:[2]", colIndex: 1, columnName: "a", stagedValue: "A2",
      primaryKeys: [{ column: "id", value: 2 }],
    });
    const sql = store.generateSqlForTable("db", "t");
    expect(sql).toEqual([
      "UPDATE `db`.`t` SET `a` = 'A' WHERE `id` = 1 LIMIT 1;",
      "UPDATE `db`.`t` SET `b` = 'B', `a` = 'A2' WHERE `id` = 2 LIMIT 1;",
    ]);
  });

  it("keys rows by primary key and keeps the identity of edited copies", () => {
    const cols = ["id", "name"];
    expect(rowKeyOf([7, "a"], cols, ["ID"])).toBe(rowKeyOf([7, "b"], cols, ["id"]));
    const noPk = [1, "a"];
    const key = rowKeyOf(noPk, cols, []); // keyed when the change is staged
    const copy = [...noPk];
    inheritRowKey(noPk, copy);
    expect(rowKeyOf(copy, cols, [])).toBe(key);
    expect(rowKeyOf([1, "a"], cols, [])).not.toBe(rowKeyOf(noPk, cols, []));
  });
});
