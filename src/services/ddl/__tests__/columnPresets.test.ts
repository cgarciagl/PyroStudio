import { describe, expect, it } from "vitest";
import {
  isIntegerType,
  synchronizeColumnAttributes,
  updateColumnInTable,
  prependPrimaryKeyColumn,
  uniqueColumnName,
  defaultLengthFor,
  isPrimaryKeyHeader,
  PRIMARY_KEY_PRESETS,
} from "../columnPresets";
import { MYSQL_DDL } from "../mysqlDdl";
import { SQLITE_DDL } from "../sqliteDdl";

describe("columnPresets — Phase 5 Primary Key & Auto-Increment", () => {
  describe("isIntegerType", () => {
    it("recognizes standard integer types in any casing", () => {
      expect(isIntegerType("INT")).toBe(true);
      expect(isIntegerType("int")).toBe(true);
      expect(isIntegerType("BIGINT")).toBe(true);
      expect(isIntegerType("bigint")).toBe(true);
      expect(isIntegerType("SMALLINT")).toBe(true);
      expect(isIntegerType("TINYINT")).toBe(true);
      expect(isIntegerType("MEDIUMINT")).toBe(true);
      expect(isIntegerType("INTEGER")).toBe(true);
    });

    it("recognizes integer types with length or attributes", () => {
      expect(isIntegerType("INT(11)")).toBe(true);
      expect(isIntegerType("BIGINT(20)")).toBe(true);
      expect(isIntegerType("TINYINT(1)")).toBe(true);
    });

    it("rejects non-integer types", () => {
      expect(isIntegerType("VARCHAR")).toBe(false);
      expect(isIntegerType("VARCHAR(255)")).toBe(false);
      expect(isIntegerType("TEXT")).toBe(false);
      expect(isIntegerType("CHAR(36)")).toBe(false);
      expect(isIntegerType("DOUBLE")).toBe(false);
      expect(isIntegerType("DECIMAL(10,2)")).toBe(false);
      expect(isIntegerType("DATETIME")).toBe(false);
      expect(isIntegerType("TIMESTAMP")).toBe(false);
      expect(isIntegerType("JSON")).toBe(false);
      expect(isIntegerType("")).toBe(false);
    });
  });

  describe("synchronizeColumnAttributes", () => {
    it("marking PK on an integer column auto-enables auto-increment and sets nullable to false", () => {
      const col = {
        dataType: "BIGINT",
        length: "20",
        isPrimaryKey: false,
        isAutoIncrement: false,
        isNullable: true,
      };

      const result = synchronizeColumnAttributes(col, { isPrimaryKey: true }, "mysql");

      expect(result.isPrimaryKey).toBe(true);
      expect(result.isAutoIncrement).toBe(true);
      expect(result.isNullable).toBe(false);
    });

    it("marking PK on a text column does NOT enable auto-increment but sets nullable to false", () => {
      const col = {
        dataType: "VARCHAR",
        length: "100",
        isPrimaryKey: false,
        isAutoIncrement: false,
        isNullable: true,
      };

      const result = synchronizeColumnAttributes(col, { isPrimaryKey: true }, "mysql");

      expect(result.isPrimaryKey).toBe(true);
      expect(result.isAutoIncrement).toBe(false);
      expect(result.isNullable).toBe(false);
    });

    it("marking Auto-Increment ensures integer type, checks PK, and unchecks nullable", () => {
      const col = {
        dataType: "VARCHAR",
        length: "100",
        isPrimaryKey: false,
        isAutoIncrement: false,
        isNullable: true,
      };

      const result = synchronizeColumnAttributes(col, { isAutoIncrement: true }, "mysql");

      expect(result.dataType).toBe("BIGINT");
      expect(result.length).toBe("20");
      expect(result.isPrimaryKey).toBe(true);
      expect(result.isAutoIncrement).toBe(true);
      expect(result.isNullable).toBe(false);
    });

    it("marking Auto-Increment in SQLite sets INTEGER without length", () => {
      const col = {
        dataType: "TEXT",
        length: "",
        isPrimaryKey: false,
        isAutoIncrement: false,
        isNullable: true,
      };

      const result = synchronizeColumnAttributes(col, { isAutoIncrement: true }, "sqlite");

      expect(result.dataType).toBe("INTEGER");
      expect(result.length).toBe("");
      expect(result.isPrimaryKey).toBe(true);
      expect(result.isAutoIncrement).toBe(true);
      expect(result.isNullable).toBe(false);
    });

    it("changing dataType to non-integer disables auto-increment", () => {
      const col = {
        dataType: "BIGINT",
        length: "20",
        isPrimaryKey: true,
        isAutoIncrement: true,
        isNullable: false,
      };

      const result = synchronizeColumnAttributes(col, { dataType: "VARCHAR", length: "255" }, "mysql");

      expect(result.dataType).toBe("VARCHAR");
      expect(result.isPrimaryKey).toBe(true);
      expect(result.isAutoIncrement).toBe(false);
      expect(result.isNullable).toBe(false);
    });

    it("unchecking PK disables auto-increment", () => {
      const col = {
        dataType: "BIGINT",
        length: "20",
        isPrimaryKey: true,
        isAutoIncrement: true,
        isNullable: false,
      };

      const result = synchronizeColumnAttributes(col, { isPrimaryKey: false }, "mysql");

      expect(result.isPrimaryKey).toBe(false);
      expect(result.isAutoIncrement).toBe(false);
    });

    it("cannot set isNullable to true while isPrimaryKey is true", () => {
      const col = {
        dataType: "BIGINT",
        length: "20",
        isPrimaryKey: true,
        isAutoIncrement: true,
        isNullable: false,
      };

      const result = synchronizeColumnAttributes(col, { isNullable: true }, "mysql");

      expect(result.isNullable).toBe(false);
    });
  });

  describe("PRIMARY_KEY_PRESETS", () => {
    it("provides the 3 standard database templates", () => {
      const presetIds = PRIMARY_KEY_PRESETS.map((p) => p.id);
      expect(presetIds).toEqual(["id_autoincrement", "uuid", "code"]);
    });

    it("id_autoincrement preset adapts to MySQL and SQLite", () => {
      const preset = PRIMARY_KEY_PRESETS.find((p) => p.id === "id_autoincrement")!;

      const mysqlCol = preset.createColumn("mysql");
      expect(mysqlCol.name).toBe("id");
      expect(mysqlCol.dataType).toBe("BIGINT");
      expect(mysqlCol.length).toBe("20");
      expect(mysqlCol.isPrimaryKey).toBe(true);
      expect(mysqlCol.isAutoIncrement).toBe(true);
      expect(mysqlCol.isNullable).toBe(false);

      const sqliteCol = preset.createColumn("sqlite");
      expect(sqliteCol.name).toBe("id");
      expect(sqliteCol.dataType).toBe("INTEGER");
      expect(sqliteCol.isPrimaryKey).toBe(true);
      expect(sqliteCol.isAutoIncrement).toBe(true);
      expect(sqliteCol.isNullable).toBe(false);
    });

    it("uuid preset creates CHAR(36) for MySQL and TEXT for SQLite", () => {
      const preset = PRIMARY_KEY_PRESETS.find((p) => p.id === "uuid")!;

      const mysqlCol = preset.createColumn("mysql");
      expect(mysqlCol.name).toBe("uuid");
      expect(mysqlCol.dataType).toBe("CHAR");
      expect(mysqlCol.length).toBe("36");
      expect(mysqlCol.isPrimaryKey).toBe(true);

      const sqliteCol = preset.createColumn("sqlite");
      expect(sqliteCol.name).toBe("uuid");
      expect(sqliteCol.dataType).toBe("TEXT");
      expect(sqliteCol.isPrimaryKey).toBe(true);
    });

    it("code preset creates VARCHAR(50) for catalogue/business keys", () => {
      const preset = PRIMARY_KEY_PRESETS.find((p) => p.id === "code")!;
      const col = preset.createColumn("mysql");
      expect(col.name).toBe("codigo");
      expect(col.dataType).toBe("VARCHAR");
      expect(col.length).toBe("50");
      expect(col.isPrimaryKey).toBe(true);
      expect(col.isAutoIncrement).toBe(false);
    });
  });

  describe("DDL builder generation with presets", () => {
    it("MYSQL_DDL adds an AUTO_INCREMENT PRIMARY KEY column FIRST via ALTER TABLE", () => {
      const sql = MYSQL_DDL.addColumn({
        database: "tienda",
        table: "productos",
        column: {
          name: "id",
          dataType: "BIGINT",
          length: "20",
          nullable: false,
          primaryKey: true,
          autoIncrement: true,
        },
        position: "FIRST",
      });

      expect(sql).toBe(
        "ALTER TABLE `tienda`.`productos` ADD COLUMN `id` BIGINT(20) NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST;",
      );
    });

    it("MYSQL_DDL creates a table with an autoincrement PK", () => {
      const sql = MYSQL_DDL.createTable({
        database: "tienda",
        table: "clientes",
        columns: [
          {
            name: "id",
            dataType: "BIGINT",
            length: "20",
            nullable: false,
            primaryKey: true,
            autoIncrement: true,
          },
          {
            name: "nombre",
            dataType: "VARCHAR",
            length: "100",
            nullable: false,
          },
        ],
        engine: "InnoDB",
        collation: "utf8mb4_unicode_ci",
      });

      expect(sql).toContain("`id` BIGINT(20) NOT NULL AUTO_INCREMENT");
      expect(sql).toContain("PRIMARY KEY (`id`)");
    });

    it("SQLITE_DDL creates a table with INTEGER PRIMARY KEY AUTOINCREMENT", () => {
      const sql = SQLITE_DDL.createTable({
        database: "main",
        table: "clientes",
        columns: [
          {
            name: "id",
            dataType: "INTEGER",
            nullable: false,
            primaryKey: true,
            autoIncrement: true,
          },
          {
            name: "nombre",
            dataType: "TEXT",
            nullable: false,
          },
        ],
        engine: "SQLite",
        collation: "",
      });

      expect(sql).toBe(
        'CREATE TABLE "main"."clientes" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n  "nombre" TEXT NOT NULL\n);',
      );
    });

    it("SQLITE_DDL rejects addColumn with PRIMARY KEY or AUTOINCREMENT", () => {
      expect(() =>
        SQLITE_DDL.addColumn({
          database: "main",
          table: "clientes",
          column: {
            name: "id",
            dataType: "INTEGER",
            nullable: false,
            primaryKey: true,
            autoIncrement: true,
          },
        }),
      ).toThrow("SQLite no permite añadir columnas PRIMARY KEY, UNIQUE o autoincrementales");
    });
  });

  describe("table-aware synchronization", () => {
    const col = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      name: id,
      dataType: "INT",
      length: "11",
      isPrimaryKey: false,
      isAutoIncrement: false,
      isNullable: true,
      ...over,
    });

    it("recognizes integer types with attributes like UNSIGNED", () => {
      expect(isIntegerType("INT UNSIGNED")).toBe(true);
      expect(isIntegerType("bigint(20) unsigned")).toBe(true);
    });

    it("a second integer PK makes a composite key without any auto-increment column", () => {
      let cols = [col("a"), col("b")];
      cols = updateColumnInTable(cols, "a", { isPrimaryKey: true }, "mysql");
      expect(cols[0].isAutoIncrement).toBe(true);
      cols = updateColumnInTable(cols, "b", { isPrimaryKey: true }, "mysql");
      expect(cols.map((c) => c.isPrimaryKey)).toEqual([true, true]);
      expect(cols.filter((c) => c.isAutoIncrement)).toHaveLength(0);
    });

    it("keeps at most one auto-increment column", () => {
      let cols = [col("a", { isPrimaryKey: true, isAutoIncrement: true, isNullable: false }), col("b")];
      cols = updateColumnInTable(cols, "b", { isAutoIncrement: true }, "mysql");
      expect(cols.filter((c) => c.isAutoIncrement).map((c) => c.id)).toEqual(["b"]);
    });

    it("SQLite only auto-enables AI on a single INTEGER key, not BIGINT", () => {
      const cols = updateColumnInTable([col("a", { dataType: "BIGINT", length: "" })], "a", { isPrimaryKey: true }, "sqlite");
      expect(cols[0].isAutoIncrement).toBe(false);
    });

    it("SQLite auto-increment column becomes the only key", () => {
      let cols = [col("a", { dataType: "TEXT", isPrimaryKey: true, isNullable: false }), col("b", { dataType: "INTEGER" })];
      cols = updateColumnInTable(cols, "b", { isAutoIncrement: true }, "sqlite");
      expect(cols.find((c) => c.id === "a")!.isPrimaryKey).toBe(false);
      expect(cols.find((c) => c.id === "b")!.isPrimaryKey).toBe(true);
    });

    it("changing between integer types does not re-enable a manually disabled AI", () => {
      const result = synchronizeColumnAttributes(
        { dataType: "INT", isPrimaryKey: true, isAutoIncrement: false, isNullable: false },
        { dataType: "BIGINT" },
        "mysql",
      );
      expect(result.isAutoIncrement).toBe(false);
    });

    it("prependPrimaryKeyColumn makes the new column the only key", () => {
      const cols = prependPrimaryKeyColumn(
        [col("a", { isPrimaryKey: true, isAutoIncrement: true })],
        col("id", { isPrimaryKey: true, isAutoIncrement: true }),
      );
      expect(cols.map((c) => [c.id, c.isPrimaryKey, c.isAutoIncrement])).toEqual([
        ["id", true, true],
        ["a", false, false],
      ]);
    });

    it("uniqueColumnName avoids duplicates case-insensitively", () => {
      expect(uniqueColumnName("id", ["nombre"])).toBe("id");
      expect(uniqueColumnName("id", ["ID", "id_1"])).toBe("id_2");
    });

    it("defaultLengthFor never carries over a previous length", () => {
      expect(defaultLengthFor("DECIMAL")).toBe("10,2");
      expect(defaultLengthFor("VARCHAR")).toBe("255");
      expect(defaultLengthFor("DATETIME")).toBe("");
    });
  });

  describe("isPrimaryKeyHeader", () => {
    it("accepts whole identifier names in any casing", () => {
      for (const n of ["id", "ID", "codigo", "Code", "clave"]) expect(isPrimaryKeyHeader(n)).toBe(true);
    });

    it("rejects names that only contain those letters", () => {
      for (const n of ["ciudad", "rapidez", "video", "codigo_postal", "cliente_id", "identidad"]) {
        expect(isPrimaryKeyHeader(n)).toBe(false);
      }
    });
  });
});
