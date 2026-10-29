import { describe, expect, it } from "vitest";
import { MYSQL_DDL } from "../ddl/mysqlDdl";
import { SQLITE_DDL } from "../ddl/sqliteDdl";
import type { ColumnSpec } from "../ddl/types";

const idColumn: ColumnSpec = {
  name: "id",
  dataType: "BIGINT",
  length: "20",
  nullable: false,
  primaryKey: true,
  autoIncrement: true,
  comment: "Identificador único",
};
const nameColumn: ColumnSpec = { name: "nombre", dataType: "VARCHAR", length: "150", nullable: false };

describe("MariaDB/MySQL DDL keeps the dialogs' previous output", () => {
  it("creates tables with engine, collation and comments", () => {
    expect(
      MYSQL_DDL.createTable({
        database: "app",
        table: "t",
        columns: [idColumn, nameColumn],
        engine: "InnoDB",
        collation: "utf8mb4_unicode_ci",
        comment: "",
      }),
    ).toBe(
      "CREATE TABLE `app`.`t` (\n" +
        "  `id` BIGINT(20) NOT NULL AUTO_INCREMENT COMMENT 'Identificador único',\n" +
        "  `nombre` VARCHAR(150) NOT NULL,\n" +
        "  PRIMARY KEY (`id`)\n" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;",
    );
  });

  it("adds columns at a position", () => {
    expect(
      MYSQL_DDL.addColumn({
        database: "app",
        table: "t",
        column: { name: "nota", dataType: "VARCHAR", length: "255", nullable: true, defaultValue: "x", comment: "c" },
        position: "id",
      }),
    ).toBe("ALTER TABLE `app`.`t` ADD COLUMN `nota` VARCHAR(255) NULL DEFAULT 'x' COMMENT 'c' AFTER `id`;");
  });

  it("changes columns with CHANGE COLUMN", async () => {
    const spec = {
      database: "app",
      table: "t",
      column: "a",
      definition: { name: "b", dataType: "TIMESTAMP", nullable: false, defaultValue: "now()" },
    };
    const expected = "ALTER TABLE `app`.`t` CHANGE COLUMN `a` `b` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;";
    expect(MYSQL_DDL.describeColumnChange(spec)).toBe(expected);
    expect(await MYSQL_DDL.planColumnChange(spec)).toEqual([expected]);
  });
});

describe("SQLite DDL", () => {
  it("turns a single auto-increment key into the row id", () => {
    expect(
      SQLITE_DDL.createTable({
        database: "main",
        table: "t",
        columns: [idColumn, { ...nameColumn, defaultValue: "sin nombre", unique: true }],
      }),
    ).toBe(
      'CREATE TABLE "main"."t" (\n' +
        '  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n' +
        "  \"nombre\" VARCHAR(150) NOT NULL DEFAULT 'sin nombre' UNIQUE\n" +
        ");",
    );
  });

  it("declares composite keys as a table constraint", () => {
    const sql = SQLITE_DDL.createTable({
      database: "main",
      table: "line",
      columns: [
        { name: "order_id", dataType: "INTEGER", nullable: false, primaryKey: true },
        { name: "line_no", dataType: "INTEGER", nullable: false, primaryKey: true },
      ],
    });
    expect(sql).toContain('PRIMARY KEY ("order_id", "line_no")');
    expect(sql).not.toContain("AUTOINCREMENT");
  });

  it("rejects columns that ALTER TABLE ADD COLUMN cannot create", () => {
    const base = { database: "main", table: "t" };
    expect(() => SQLITE_DDL.addColumn({ ...base, column: { ...nameColumn, primaryKey: true } })).toThrow(
      /PRIMARY KEY/,
    );
    expect(() => SQLITE_DDL.addColumn({ ...base, column: nameColumn })).toThrow(/valor por defecto/);
    expect(
      SQLITE_DDL.addColumn({ ...base, column: { ...nameColumn, defaultValue: "0" } }),
    ).toBe('ALTER TABLE "main"."t" ADD COLUMN "nombre" VARCHAR(150) NOT NULL DEFAULT 0;');
  });
});
