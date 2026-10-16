import { describe, it, expect, beforeEach } from "vitest";
import { useStagedChangesStore, formatSqlValue } from "../../stores/stagedChangesStore";
import {
  exportToTsv,
  exportToSqlInsert,
  exportToJsonArray,
  exportToMarkdownTable,
} from "../../utils/formatCopy";

describe("stagedChangesStore & formatCopy", () => {
  beforeEach(() => {
    useStagedChangesStore.setState({ changesByTable: {} });
  });

  it("stages cell updates and groups them into SQL statement", () => {
    const store = useStagedChangesStore.getState();
    store.stageCellUpdate({
      database: "testdb",
      table: "users",
      rowIndex: 0,
      colIndex: 1,
      columnName: "name",
      originalValue: "Alice",
      stagedValue: "Alicia",
      primaryKeys: [{ column: "id", value: 1 }],
    });

    expect(store.hasPendingChanges("testdb", "users")).toBe(true);
    const sql = store.generateSqlForTable("testdb", "users");
    expect(sql).toHaveLength(1);
    expect(sql[0]).toBe("UPDATE `testdb`.`users` SET `name` = 'Alicia' WHERE `id` = 1 LIMIT 1;");
  });

  it("distinguishes SQL NULL, empty string, and literal string 'NULL'", () => {
    expect(formatSqlValue(null)).toBe("NULL");
    expect(formatSqlValue(undefined)).toBe("NULL");
    expect(formatSqlValue("")).toBe("''");
    expect(formatSqlValue("NULL")).toBe("'NULL'");
    expect(formatSqlValue("null")).toBe("'null'");
  });

  it("stages batch cell updates efficiently in a single operation", () => {
    const store = useStagedChangesStore.getState();
    store.stageBatchCellUpdates([
      {
        database: "testdb",
        table: "users",
        rowIndex: 0,
        colIndex: 1,
        columnName: "name",
        originalValue: "Alice",
        stagedValue: "Alicia",
        primaryKeys: [{ column: "id", value: 1 }],
      },
      {
        database: "testdb",
        table: "users",
        rowIndex: 1,
        colIndex: 1,
        columnName: "name",
        originalValue: "Bob",
        stagedValue: "Robert",
        primaryKeys: [{ column: "id", value: 2 }],
      },
    ]);

    const changes = store.getTableChanges("testdb", "users");
    expect(changes).toHaveLength(2);
    const sql = store.generateSqlForTable("testdb", "users");
    expect(sql).toHaveLength(2);
    expect(sql[0]).toContain("'Alicia'");
    expect(sql[1]).toContain("'Robert'");
  });

  it("stages change when empty string is changed to null (varchar empty to NULL)", () => {
    const store = useStagedChangesStore.getState();
    store.stageCellUpdate({
      database: "testdb",
      table: "users",
      rowIndex: 0,
      colIndex: 1,
      columnName: "notes",
      originalValue: "",
      stagedValue: null,
      primaryKeys: [{ column: "id", value: 1 }],
    });

    expect(store.hasPendingChanges("testdb", "users")).toBe(true);
    const sql = store.generateSqlForTable("testdb", "users");
    expect(sql).toHaveLength(1);
    expect(sql[0]).toBe("UPDATE `testdb`.`users` SET `notes` = NULL WHERE `id` = 1 LIMIT 1;");
  });

  it("stages row deletion into DELETE SQL statement", () => {
    const store = useStagedChangesStore.getState();
    store.stageRowDelete({
      database: "testdb",
      table: "users",
      rowIndex: 2,
      originalRow: [3, "Charlie"],
      primaryKeys: [{ column: "id", value: 3 }],
    });

    const sql = store.generateSqlForTable("testdb", "users");
    expect(sql).toHaveLength(1);
    expect(sql[0]).toBe("DELETE FROM `testdb`.`users` WHERE `id` = 3 LIMIT 1;");
  });

  it("stages multiple row deletions in batch", () => {
    const store = useStagedChangesStore.getState();
    store.stageBatchRowDeletes([
      {
        database: "testdb",
        table: "users",
        rowIndex: 0,
        originalRow: [1, "Alice"],
        primaryKeys: [{ column: "id", value: 1 }],
      },
      {
        database: "testdb",
        table: "users",
        rowIndex: 1,
        originalRow: [2, "Bob"],
        primaryKeys: [{ column: "id", value: 2 }],
      },
      {
        database: "testdb",
        table: "users",
        rowIndex: 2,
        originalRow: [3, "Charlie"],
        primaryKeys: [{ column: "id", value: 3 }],
      },
    ]);

    const changes = store.getTableChanges("testdb", "users");
    expect(changes).toHaveLength(3);
    const sql = store.generateSqlForTable("testdb", "users");
    expect(sql).toHaveLength(3);
    expect(sql[0]).toBe("DELETE FROM `testdb`.`users` WHERE `id` = 1 LIMIT 1;");
    expect(sql[1]).toBe("DELETE FROM `testdb`.`users` WHERE `id` = 2 LIMIT 1;");
    expect(sql[2]).toBe("DELETE FROM `testdb`.`users` WHERE `id` = 3 LIMIT 1;");
  });

  it("clears changes on table reset", () => {
    const store = useStagedChangesStore.getState();
    store.stageCellUpdate({
      database: "testdb",
      table: "users",
      rowIndex: 0,
      colIndex: 1,
      columnName: "name",
      originalValue: "Alice",
      stagedValue: "Alicia",
      primaryKeys: [{ column: "id", value: 1 }],
    });
    expect(store.hasPendingChanges("testdb", "users")).toBe(true);

    store.clearTableChanges("testdb", "users");
    expect(store.hasPendingChanges("testdb", "users")).toBe(false);
  });

  it("exports multi-format correctly", () => {
    const cols = ["id", "username", "role"];
    const rows = [
      [1, "admin", "superuser"],
      [2, "guest", null],
    ];

    const tsv = exportToTsv(cols, rows);
    expect(tsv).toContain("id\tusername\trole");
    expect(tsv).toContain("1\tadmin\tsuperuser");
    expect(tsv).toContain("2\tguest\tNULL");

    const sql = exportToSqlInsert("mydb", "accounts", cols, rows);
    expect(sql).toContain("INSERT INTO `mydb`.`accounts` (`id`, `username`, `role`) VALUES (1, 'admin', 'superuser');");
    expect(sql).toContain("INSERT INTO `mydb`.`accounts` (`id`, `username`, `role`) VALUES (2, 'guest', NULL);");

    const json = exportToJsonArray(cols, rows);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].username).toBe("admin");

    const md = exportToMarkdownTable(cols, rows);
    expect(md).toContain("| id | username | role |");
    expect(md).toContain("| 1 | admin | superuser |");
  });
});
