/**
 * Smart Multi-Format Copy Utilities for Data Grid
 */

const escapeSql = (str: string): string => {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "''")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\x1a/g, "\\Z");
};

export const formatCellForSql = (val: any): string => {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "1" : "0";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  if (typeof val === "object") return `'${escapeSql(JSON.stringify(val))}'`;
  const str = String(val);
  if (str.toUpperCase() === "NULL") return "NULL";
  return `'${escapeSql(str)}'`;
};

export const exportToTsv = (columns: string[], rows: any[][]): string => {
  const header = columns.join("\t");
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
  return `${header}\n${data}`;
};

export const exportToSqlInsert = (
  database: string,
  table: string,
  columns: string[],
  rows: any[][],
): string => {
  const quotedCols = columns.map((c) => `\`${c.replace(/`/g, "``")}\``).join(", ");
  const targetTable = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``;

  const lines = rows.map((row) => {
    const values = row.map(formatCellForSql).join(", ");
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
