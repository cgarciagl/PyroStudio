/**
 * Smart Multi-Format Copy Utilities for Data Grid
 */

import { SQL_LITERALS, qualifiedTable, type SqlLiteralRules } from "../services/sqlLiterals";

/** SQL literal for a grid cell; the text `NULL` means SQL `NULL`. */
export const formatCellForSql = (val: any, rules: SqlLiteralRules = SQL_LITERALS.mysql): string => {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "1" : "0";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  if (typeof val === "object") return rules.stringLiteral(JSON.stringify(val));
  const str = String(val);
  if (str.toUpperCase() === "NULL") return "NULL";
  return rules.stringLiteral(str);
};

export const exportToTsv = (
  columns: string[],
  rows: any[][],
  includeHeaders = true,
): string => {
  const data = rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return "NULL";
          if (typeof cell === "object") return JSON.stringify(cell);
          return String(cell).replace(/[\t\r\n]/g, " ");
        })
        .join("\t"),
    )
    .join("\n");
  if (!includeHeaders || columns.length === 0) {
    return data;
  }
  const header = columns.join("\t");
  return `${header}\n${data}`;
};

export const formatValueForCommaSeparated = (
  val: any,
  rules: SqlLiteralRules = SQL_LITERALS.mysql,
): string => {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "1" : "0";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  const str = String(val);
  if (str.toUpperCase() === "NULL") return "NULL";
  // Numeric string check (integers and decimals)
  if (/^-?\d+(\.\d+)?$/.test(str.trim())) {
    return str.trim();
  }
  return rules.stringLiteral(str);
};

export const exportToCommaSeparated = (
  rows: any[][],
  rules: SqlLiteralRules = SQL_LITERALS.mysql,
): string => {
  const values: string[] = [];
  for (const row of rows) {
    for (const cell of row) {
      values.push(formatValueForCommaSeparated(cell, rules));
    }
  }
  return values.join(", ");
};

export const exportToSqlInsert = (
  database: string,
  table: string,
  columns: string[],
  rows: any[][],
  rules: SqlLiteralRules = SQL_LITERALS.mysql,
): string => {
  const quotedCols = columns.map(rules.quoteIdentifier).join(", ");
  const targetTable = qualifiedTable(rules, database, table || "query_result");

  const lines = rows.map((row) => {
    const values = row.map((cell) => formatCellForSql(cell, rules)).join(", ");
    return `INSERT INTO ${targetTable} (${quotedCols}) VALUES (${values});`;
  });

  return lines.join("\n");
};

export const exportToJsonArray = (columns: string[], rows: any[][]): string => {
  const objects = rows.map((row) => {
    const obj: Record<string, any> = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
};

export const exportToMarkdownTable = (columns: string[], rows: any[][]): string => {
  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const dataRows = rows
    .map(
      (row) =>
        `| ${row
          .map((cell) => {
            if (cell === null || cell === undefined) return "*NULL*";
            if (typeof cell === "object") return JSON.stringify(cell);
            return String(cell).replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
          })
          .join(" | ")} |`,
    )
    .join("\n");

  return `${header}\n${separator}\n${dataRows}`;
};

export const exportToPhpArray = (columns: string[], rows: any[][]): string => {
  const phpRows = rows.map((row) => {
    const entries = columns.map((col, idx) => {
      const val = row[idx];
      let formatted: string;
      if (val === null || val === undefined) formatted = "null";
      else if (typeof val === "number") formatted = String(val);
      else if (typeof val === "boolean") formatted = val ? "true" : "false";
      else formatted = `'${String(val).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
      return `        '${col}' => ${formatted}`;
    });
    return `    [\n${entries.join(",\n")}\n    ]`;
  });

  return `[\n${phpRows.join(",\n")}\n];`;
};

export const exportToTsArray = (columns: string[], rows: any[][]): string => {
  const tsRows = rows.map((row) => {
    const entries = columns.map((col, idx) => {
      const val = row[idx];
      let formatted: string;
      if (val === null || val === undefined) formatted = "null";
      else if (typeof val === "number") formatted = String(val);
      else if (typeof val === "boolean") formatted = val ? "true" : "false";
      else formatted = JSON.stringify(String(val));
      return `    ${JSON.stringify(col)}: ${formatted}`;
    });
    return `  {\n${entries.join(",\n")}\n  }`;
  });

  return `[\n${tsRows.join(",\n")}\n];`;
};
