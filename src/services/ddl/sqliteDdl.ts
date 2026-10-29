import { dbService } from "../tauriDb";
import { SQL_LITERALS, qualifiedTable } from "../sqlLiterals";
import type { AddColumnSpec, ChangeColumnSpec, ColumnSpec, CreateTableSpec, DdlBuilder } from "./types";

/** Common declared types; SQLite maps any name to an affinity. */
export const SQLITE_DATA_TYPES = [
  "INTEGER",
  "TEXT",
  "REAL",
  "NUMERIC",
  "BLOB",
  "VARCHAR",
  "BOOLEAN",
  "DATE",
  "DATETIME",
];

const rules = SQL_LITERALS.sqlite;

const DEFAULT_KEYWORDS = ["NULL", "CURRENT_TIMESTAMP", "CURRENT_DATE", "CURRENT_TIME", "TRUE", "FALSE"];

/** Same rules as the Rust column rebuild (`sqlite::alter::default_expression`). */
export function sqliteDefault(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (DEFAULT_KEYWORDS.includes(upper)) return upper;
  const isNumber = raw !== "" && !Number.isNaN(Number(raw));
  const isExpression = raw.startsWith("(") && raw.endsWith(")");
  const isLiteral = raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'");
  return isNumber || isExpression || isLiteral ? raw : rules.stringLiteral(raw);
}

function typeSql(column: ColumnSpec): string {
  const length = column.length?.trim();
  return length ? `${column.dataType}(${length})` : column.dataType;
}

/** `INTEGER PRIMARY KEY AUTOINCREMENT` makes the column the row id. */
function isRowIdKey(column: ColumnSpec, keyCount: number): boolean {
  return keyCount === 1 && !!column.primaryKey && !!column.autoIncrement;
}

function columnSql(column: ColumnSpec, keyCount: number): string {
  const name = rules.quoteIdentifier(column.name.trim());
  if (isRowIdKey(column, keyCount)) return `${name} INTEGER PRIMARY KEY AUTOINCREMENT`;
  const fallback = sqliteDefault(column.defaultValue);
  return [
    name,
    typeSql(column),
    column.nullable ? "" : "NOT NULL",
    fallback ? `DEFAULT ${fallback}` : "",
    column.unique && !column.primaryKey ? "UNIQUE" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function createTable(spec: CreateTableSpec): string {
  const columns = spec.columns.filter((column) => column.name.trim());
  const keys = columns.filter((column) => column.primaryKey);
  const lines = columns.map((column) => `  ${columnSql(column, keys.length)}`);
  const keyIsRowId = keys.length === 1 && isRowIdKey(keys[0], 1);
  if (keys.length > 0 && !keyIsRowId) {
    const keyNames = keys.map((column) => rules.quoteIdentifier(column.name.trim()));
    lines.push(`  PRIMARY KEY (${keyNames.join(", ")})`);
  }
  return `CREATE TABLE ${qualifiedTable(rules, spec.database, spec.table)} (\n${lines.join(",\n")}\n);`;
}

/** `ALTER TABLE … ADD COLUMN` cannot add keys, and NOT NULL needs a default. */
function addColumn({ database, table, column }: AddColumnSpec): string {
  if (column.primaryKey || column.unique || column.autoIncrement) {
    throw new Error(
      "SQLite no permite añadir columnas PRIMARY KEY, UNIQUE o autoincrementales a una tabla existente.",
    );
  }
  if (!column.nullable && !sqliteDefault(column.defaultValue)) {
    throw new Error("En SQLite, una columna nueva NOT NULL necesita un valor por defecto.");
  }
  return `ALTER TABLE ${qualifiedTable(rules, database, table)} ADD COLUMN ${columnSql(column, 0)};`;
}

const columnChangeRequest = ({ database, table, column, definition }: ChangeColumnSpec) => ({
  database,
  table,
  column,
  new_name: definition.name.trim() || column,
  new_type: typeSql(definition),
  nullable: definition.nullable,
  default_value: definition.defaultValue?.trim() || null,
});

export const SQLITE_DDL: DdlBuilder = {
  dataTypes: SQLITE_DATA_TYPES,
  createTable,
  addColumn,
  describeColumnChange: () =>
    [
      "-- SQLite reconstruye la tabla para cambiar el tipo, NULL o el valor por defecto",
      "-- (procedimiento oficial de 12 pasos). Verás el script completo antes de aplicarlo.",
    ].join("\n"),
  planColumnChange: (spec) => dbService.planSqliteColumnChange(columnChangeRequest(spec)),
  applyColumnChange: (spec) => dbService.applySqliteColumnChange(columnChangeRequest(spec)),
  previewsColumnChanges: true,
  changesAutoIncrement: false,
};
