import { dbService } from "../tauriDb";
import type { AddColumnSpec, ChangeColumnSpec, ColumnSpec, CreateTableSpec, DdlBuilder } from "./types";

export const MYSQL_DATA_TYPES = [
  "BIGINT",
  "INT",
  "SMALLINT",
  "TINYINT",
  "VARCHAR",
  "CHAR",
  "TEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "DECIMAL",
  "FLOAT",
  "DOUBLE",
  "BOOLEAN",
  "DATETIME",
  "TIMESTAMP",
  "DATE",
  "TIME",
  "JSON",
  "BLOB",
  "ENUM",
];

/** Types written without a length even if one was typed. */
const TYPES_WITHOUT_LENGTH = ["TEXT", "MEDIUMTEXT", "LONGTEXT", "DATETIME", "TIMESTAMP", "DATE", "JSON", "BLOB", "BOOLEAN"];

const TEXT_TYPES = ["VARCHAR", "CHAR", "TEXT", "MEDIUMTEXT", "LONGTEXT", "TINYTEXT", "ENUM", "SET"];

const quote = (name: string): string => `\`${name.replace(/`/g, "``")}\``;

/** MariaDB/MySQL single-quoted text with the backslash escape for quotes. */
const quotedText = (text: string): string => `'${text.replace(/'/g, "\\'")}'`;

export const isTextType = (dataType: string): boolean => TEXT_TYPES.includes(dataType.toUpperCase());

function typeSql(column: ColumnSpec): string {
  const length = column.length?.trim();
  return length && !TYPES_WITHOUT_LENGTH.includes(column.dataType)
    ? `${column.dataType}(${length})`
    : column.dataType;
}

/** `value` is used as given: callers decide whether surrounding spaces matter. */
function defaultSql(value: string | undefined): string {
  if (!value?.trim()) return "";
  const upper = value.toUpperCase();
  if (upper === "NULL") return "DEFAULT NULL";
  if (upper === "CURRENT_TIMESTAMP" || upper === "NOW()" || upper === "CURRENT_TIMESTAMP()") {
    return "DEFAULT CURRENT_TIMESTAMP";
  }
  return `DEFAULT ${quotedText(value)}`;
}

/** `TYPE [CHARACTER SET] [COLLATE] NULL|NOT NULL [DEFAULT] [AUTO_INCREMENT]`. */
function definitionParts(column: ColumnSpec): string[] {
  const textType = isTextType(column.dataType);
  return [
    typeSql(column),
    textType && column.charset?.trim() ? `CHARACTER SET ${column.charset.trim()}` : "",
    textType && column.collation?.trim() ? `COLLATE ${column.collation.trim()}` : "",
    column.nullable ? "NULL" : "NOT NULL",
    defaultSql(column.defaultValue),
    column.autoIncrement ? "AUTO_INCREMENT" : "",
  ];
}

const commentSql = (comment: string | undefined): string =>
  comment?.trim() ? `COMMENT ${quotedText(comment)}` : "";

const statement = (parts: string[]): string => parts.filter(Boolean).join(" ") + ";";

function createTable(spec: CreateTableSpec): string {
  const columns = spec.columns.filter((column) => column.name.trim());
  const lines = columns.map((column) =>
    [`  ${quote(column.name.trim())}`, ...definitionParts(column), commentSql(column.comment)]
      .filter(Boolean)
      .join(" "),
  );
  const keys = columns.filter((column) => column.primaryKey).map((column) => quote(column.name.trim()));
  if (keys.length > 0) lines.push(`  PRIMARY KEY (${keys.join(", ")})`);
  for (const column of columns.filter((c) => c.unique && !c.primaryKey)) {
    lines.push(`  UNIQUE KEY (${quote(column.name.trim())})`);
  }
  const tableComment = spec.comment?.trim() ? ` COMMENT=${quotedText(spec.comment)}` : "";
  return `CREATE TABLE ${quote(spec.database)}.${quote(spec.table)} (\n${lines.join(",\n")}\n) ENGINE=${spec.engine} DEFAULT CHARSET=utf8mb4 COLLATE=${spec.collation}${tableComment};`;
}

function addColumn({ database, table, column, position = "END" }: AddColumnSpec): string {
  const positionSql = position === "FIRST" ? "FIRST" : position === "END" ? "" : `AFTER ${quote(position)}`;
  return statement([
    `ALTER TABLE ${quote(database)}.${quote(table)}`,
    `ADD COLUMN ${quote(column.name.trim())}`,
    ...definitionParts(column),
    column.primaryKey ? "PRIMARY KEY" : column.unique ? "UNIQUE" : "",
    commentSql(column.comment),
    positionSql,
  ]);
}

function changeColumn({ database, table, column, definition }: ChangeColumnSpec): string {
  return statement([
    `ALTER TABLE ${quote(database)}.${quote(table)}`,
    `CHANGE COLUMN ${quote(column)} ${quote(definition.name.trim() || column)}`,
    ...definitionParts(definition),
    commentSql(definition.comment),
  ]);
}

export const MYSQL_DDL: DdlBuilder = {
  dataTypes: MYSQL_DATA_TYPES,
  createTable,
  addColumn,
  describeColumnChange: changeColumn,
  planColumnChange: async (spec) => [changeColumn(spec)],
  applyColumnChange: async (spec, statements) => {
    for (const sql of statements) await dbService.executeConfirmedQuery(sql, spec.database);
  },
  previewsColumnChanges: false,
  changesAutoIncrement: true,
};
