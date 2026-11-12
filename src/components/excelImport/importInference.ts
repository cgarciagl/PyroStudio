import type { ColumnMapping, ImportModeType, NewTableColumnDef } from "../../types/database";
import { isPrimaryKeyHeader, uniqueColumnName } from "../../services/ddl";

/**
 * Pure rules of the import wizard: type inference, automatic mapping, generated id key
 * and the backend import mode. No React, no I/O: easy to test and to reuse.
 */

export type AdvancedImportMode =
  | "append"
  | "update"
  | "append_update"
  | "append_without_update"
  | "delete"
  | "copy";

export const buildGeneratedIdColumn = (name: string): NewTableColumnDef => ({
  name,
  data_type: "BIGINT",
  is_primary_key: true,
  is_nullable: false,
  auto_increment: true,
});

/** Infer data types for a new table from the preview rows. */
export function inferColumnTypes(
  headers: string[],
  rows: unknown[][],
): NewTableColumnDef[] {
  return headers.map((header, colIdx) => {
    let hasString = false;
    let hasFloat = false;
    let hasInt = false;
    let hasDate = false;
    let hasBool = false;
    let maxLen = 0;

    for (const row of rows) {
      const val = row[colIdx];
      if (val === null || val === undefined || val === "") continue;

      const strVal = String(val).trim();
      maxLen = Math.max(maxLen, strVal.length);

      if (
        typeof val === "boolean" ||
        strVal.toLowerCase() === "true" ||
        strVal.toLowerCase() === "false"
      ) {
        hasBool = true;
      } else if (
        !isNaN(Number(strVal)) &&
        Number.isInteger(Number(strVal)) &&
        !strVal.includes(".")
      ) {
        hasInt = true;
      } else if (!isNaN(Number(strVal))) {
        hasFloat = true;
      } else if (
        /^\d{4}-\d{2}-\d{2}/.test(strVal) ||
        /^\d{2}\/\d{2}\/\d{4}/.test(strVal)
      ) {
        hasDate = true;
      } else {
        hasString = true;
      }
    }

    let dataType = "VARCHAR(255)";
    if (hasString) {
      dataType = maxLen > 255 ? "TEXT" : "VARCHAR(255)";
    } else if (hasDate) {
      dataType = "DATETIME";
    } else if (hasFloat) {
      dataType = "DOUBLE";
    } else if (hasInt) {
      dataType = maxLen > 9 ? "BIGINT" : "INT";
    } else if (hasBool) {
      dataType = "TINYINT(1)";
    }

    const cleanName =
      header.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase() ||
      `col_${colIdx + 1}`;
    const isPkCandidate = colIdx === 0 && isPrimaryKeyHeader(cleanName);

    return {
      name: cleanName,
      data_type: dataType,
      is_primary_key: isPkCandidate,
      is_nullable: !isPkCandidate,
      auto_increment:
        isPkCandidate && (dataType === "INT" || dataType === "BIGINT"),
    };
  });
}

/** Match file headers to table columns (case, spaces, dashes and accents ignored). */
export function buildAutoMappings(
  headers: string[],
  targetCols: { name: string; column_key?: string; is_primary_key?: boolean }[],
) {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\s_-]+/g, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  return headers.map((excelCol) => {
    const normExcel = normalize(excelCol);
    const match = targetCols.find((c) => normalize(c.name) === normExcel);
    const isKeyCandidate =
      match?.column_key === "PRI" ||
      match?.is_primary_key ||
      normExcel === "id" ||
      normExcel === "codigo" ||
      normExcel === "matricula" ||
      normExcel === "noper";

    return {
      excel_column: excelCol,
      db_column: match ? match.name : targetCols.find((c) => c.name === excelCol)?.name || "",
      ignored: !match && !targetCols.some((c) => c.name === excelCol),
      is_key: Boolean(isKeyCandidate),
    };
  });
}

/** Table name suggested from the sheet or the file name. */
export function defaultTableName(path: string, sheet?: string | null): string {
  const base = path.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, "") || "nueva_tabla";
  return (sheet || base).replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

export type DisplacedKeys = Record<string, Pick<NewTableColumnDef, "is_primary_key" | "is_nullable" | "auto_increment">>;

export interface GeneratedIdState {
  columns: NewTableColumnDef[];
  generatedIdName: string | null;
  displacedKeys: DisplacedKeys;
}

/**
 * Initial columns of a new table: adds an "id" key unless the file already has a key
 * candidate or an "id" header (it would duplicate the column).
 */
export function initialNewTableColumns(inferred: NewTableColumnDef[], autoAddId: boolean): GeneratedIdState {
  const hasPkCandidate = inferred.some((c) => c.is_primary_key);
  const hasIdHeader = inferred.some((c) => c.name.toLowerCase() === "id");
  if (!autoAddId || hasPkCandidate || hasIdHeader) {
    return { columns: inferred, generatedIdName: null, displacedKeys: {} };
  }
  return { columns: [buildGeneratedIdColumn("id"), ...inferred], generatedIdName: "id", displacedKeys: {} };
}

/**
 * Turn the generated "id" key on or off. Turning it on demotes the file's own key
 * columns (remembered); turning it off restores them.
 */
export function toggleGeneratedId(state: GeneratedIdState, enabled: boolean): GeneratedIdState {
  if (enabled) {
    if (state.generatedIdName) return state;
    const name = uniqueColumnName("id", state.columns.map((c) => c.name));
    const displaced: DisplacedKeys = {};
    const demoted = state.columns.map((c) => {
      if (!c.is_primary_key && !c.auto_increment) return c;
      displaced[c.name] = { is_primary_key: c.is_primary_key, is_nullable: c.is_nullable, auto_increment: c.auto_increment };
      return { ...c, is_primary_key: false, auto_increment: false };
    });
    return { columns: [buildGeneratedIdColumn(name), ...demoted], generatedIdName: name, displacedKeys: displaced };
  }
  if (!state.generatedIdName) return state;
  const restored = state.columns
    .filter((c) => c.name !== state.generatedIdName)
    .map((c) => (state.displacedKeys[c.name] ? { ...c, ...state.displacedKeys[c.name] } : c));
  return { columns: restored, generatedIdName: null, displacedKeys: {} };
}

/** Modes that match rows by key (need the key columns). */
export const KEYED_MODES: ReadonlySet<AdvancedImportMode> = new Set(["update", "append_update", "delete"]);

const MODE_TYPES: Record<AdvancedImportMode, ImportModeType["type"]> = {
  append: "Append",
  update: "Update",
  append_update: "AppendUpdate",
  append_without_update: "AppendWithoutUpdate",
  delete: "Delete",
  copy: "Copy",
};

/** Backend payload of a wizard mode (a lookup table instead of a switch per mode). */
export function buildImportMode(mode: AdvancedImportMode, primaryKeyDb: string, primaryKeyExcel: string): ImportModeType {
  const type = MODE_TYPES[mode] ?? "Append";
  return (KEYED_MODES.has(mode)
    ? { type, config: { primary_key_db: primaryKeyDb, primary_key_excel: primaryKeyExcel } }
    : { type }) as ImportModeType;
}

export type { ColumnMapping };
