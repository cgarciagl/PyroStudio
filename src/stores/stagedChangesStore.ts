import { create } from "zustand";
import type { PrimaryKeyCondition } from "../types/database";
import { SQL_LITERALS, qualifiedTable, type SqlLiteralRules } from "../services/sqlLiterals";

export interface StagedCellUpdate {
  type: "cell_update";
  database: string;
  table: string;
  rowIndex: number;
  colIndex: number;
  columnName: string;
  originalValue: any;
  stagedValue: any;
  primaryKeys: PrimaryKeyCondition[];
}

export interface StagedRowInsert {
  type: "row_insert";
  tempId: string;
  database: string;
  table: string;
  values: Record<string, any>;
}

export interface StagedRowDelete {
  type: "row_delete";
  database: string;
  table: string;
  rowIndex: number;
  originalRow: any[];
  primaryKeys: PrimaryKeyCondition[];
}

export type StagedChange = StagedCellUpdate | StagedRowInsert | StagedRowDelete;

interface StagedChangesState {
  // Keyed by `${database}.${table}`
  changesByTable: Record<string, StagedChange[]>;

  stageCellUpdate: (change: Omit<StagedCellUpdate, "type">) => void;
  stageBatchCellUpdates: (changes: Omit<StagedCellUpdate, "type">[]) => void;
  stageRowInsert: (change: Omit<StagedRowInsert, "type">) => void;
  stageRowDelete: (change: Omit<StagedRowDelete, "type">) => void;
  stageBatchRowDeletes: (changes: Omit<StagedRowDelete, "type">[]) => void;
  unstageCellUpdate: (database: string, table: string, rowIndex: number, colIndex: number) => void;
  unstageRowDelete: (database: string, table: string, rowIndex: number) => void;
  unstageRowInsert: (database: string, table: string, tempId: string) => void;
  clearTableChanges: (database: string, table: string) => void;
  getTableChanges: (database: string, table: string) => StagedChange[];
  hasPendingChanges: (database: string, table: string) => boolean;
  /** Statements that apply the staged changes, in the session's SQL syntax. */
  generateSqlForTable: (database: string, table: string, rules?: SqlLiteralRules) => string[];
}

const tableKey = (db: string, tbl: string) => `${db}.${tbl}`;

export const formatSqlValue = (val: any, rules: SqlLiteralRules = SQL_LITERALS.mysql): string => {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "1" : "0";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  if (typeof val === "object") return rules.stringLiteral(JSON.stringify(val));
  return rules.stringLiteral(String(val));
};

/** ` WHERE pk1 = v1 AND pk2 IS NULL`, or empty when there is no key. */
const primaryKeyFilter = (primaryKeys: PrimaryKeyCondition[], rules: SqlLiteralRules): string => {
  const conditions = primaryKeys.map((pk) =>
    pk.value === null || pk.value === undefined
      ? `${rules.quoteIdentifier(pk.column)} IS NULL`
      : `${rules.quoteIdentifier(pk.column)} = ${formatSqlValue(pk.value, rules)}`,
  );
  return conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
};

export const areValuesEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
};

export const useStagedChangesStore = create<StagedChangesState>((set, get) => ({
  changesByTable: {},

  stageCellUpdate: (change) => {
    const key = tableKey(change.database, change.table);
    set((state) => {
      const currentList = state.changesByTable[key] || [];
      // Remove any prior staged update for the exact same cell
      const filtered = currentList.filter(
        (c) =>
          !(
            c.type === "cell_update" &&
            c.rowIndex === change.rowIndex &&
            c.colIndex === change.colIndex
          ),
      );

      // If reverting back to original value, simply unstage
      if (areValuesEqual(change.stagedValue, change.originalValue)) {
        return {
          changesByTable: {
            ...state.changesByTable,
            [key]: filtered,
          },
        };
      }

      return {
        changesByTable: {
          ...state.changesByTable,
          [key]: [...filtered, { ...change, type: "cell_update" }],
        },
      };
    });
  },

  stageBatchCellUpdates: (changes) => {
    if (changes.length === 0) return;
    set((state) => {
      const newChangesByTable = { ...state.changesByTable };

      for (const change of changes) {
        const key = tableKey(change.database, change.table);
        const currentList = newChangesByTable[key] || [];

        const filtered = currentList.filter(
          (c) =>
            !(
              c.type === "cell_update" &&
              c.rowIndex === change.rowIndex &&
              c.colIndex === change.colIndex
            ),
        );

        if (areValuesEqual(change.stagedValue, change.originalValue)) {
          newChangesByTable[key] = filtered;
        } else {
          newChangesByTable[key] = [...filtered, { ...change, type: "cell_update" }];
        }
      }

      return { changesByTable: newChangesByTable };
    });
  },

  stageRowInsert: (change) => {
    const key = tableKey(change.database, change.table);
    set((state) => {
      const currentList = state.changesByTable[key] || [];
      return {
        changesByTable: {
          ...state.changesByTable,
          [key]: [...currentList, { ...change, type: "row_insert" }],
        },
      };
    });
  },

  stageRowDelete: (change) => {
    const key = tableKey(change.database, change.table);
    set((state) => {
      const currentList = state.changesByTable[key] || [];
      // Remove any cell updates or existing delete on this row
      const filtered = currentList.filter(
        (c) =>
          !(
            (c.type === "cell_update" || c.type === "row_delete") &&
            c.rowIndex === change.rowIndex
          ),
      );
      return {
        changesByTable: {
          ...state.changesByTable,
          [key]: [...filtered, { ...change, type: "row_delete" }],
        },
      };
    });
  },

  stageBatchRowDeletes: (changes) => {
    if (changes.length === 0) return;
    set((state) => {
      const newChangesByTable = { ...state.changesByTable };

      for (const change of changes) {
        const key = tableKey(change.database, change.table);
        const currentList = newChangesByTable[key] || [];

        // Remove any cell updates and any previous row_delete for this rowIndex
        const filtered = currentList.filter(
          (c) =>
            !(
              (c.type === "cell_update" || c.type === "row_delete") &&
              c.rowIndex === change.rowIndex
            ),
        );

        newChangesByTable[key] = [...filtered, { ...change, type: "row_delete" }];
      }

      return { changesByTable: newChangesByTable };
    });
  },

  unstageCellUpdate: (database, table, rowIndex, colIndex) => {
    const key = tableKey(database, table);
    set((state) => {
      const list = state.changesByTable[key] || [];
      return {
        changesByTable: {
          ...state.changesByTable,
          [key]: list.filter(
            (c) => !(c.type === "cell_update" && c.rowIndex === rowIndex && c.colIndex === colIndex),
          ),
        },
      };
    });
  },

  unstageRowDelete: (database, table, rowIndex) => {
    const key = tableKey(database, table);
    set((state) => {
      const list = state.changesByTable[key] || [];
      return {
        changesByTable: {
          ...state.changesByTable,
          [key]: list.filter((c) => !(c.type === "row_delete" && c.rowIndex === rowIndex)),
        },
      };
    });
  },

  unstageRowInsert: (database, table, tempId) => {
    const key = tableKey(database, table);
    set((state) => {
      const list = state.changesByTable[key] || [];
      return {
        changesByTable: {
          ...state.changesByTable,
          [key]: list.filter((c) => !(c.type === "row_insert" && c.tempId === tempId)),
        },
      };
    });
  },

  clearTableChanges: (database, table) => {
    const key = tableKey(database, table);
    set((state) => {
      const next = { ...state.changesByTable };
      delete next[key];
      return { changesByTable: next };
    });
  },

  getTableChanges: (database, table) => {
    const key = tableKey(database, table);
    return get().changesByTable[key] || [];
  },

  hasPendingChanges: (database, table) => {
    const key = tableKey(database, table);
    const list = get().changesByTable[key];
    return Boolean(list && list.length > 0);
  },

  generateSqlForTable: (database, table, rules = SQL_LITERALS.mysql) => {
    const key = tableKey(database, table);
    const changes = get().changesByTable[key] || [];
    const sqlStatements: string[] = [];

    // Group cell updates by row to generate a single UPDATE statement per row if multiple columns changed
    const updatesByRow: Record<number, StagedCellUpdate[]> = {};
    const deletes: StagedRowDelete[] = [];
    const inserts: StagedRowInsert[] = [];

    for (const change of changes) {
      if (change.type === "cell_update") {
        updatesByRow[change.rowIndex] = updatesByRow[change.rowIndex] || [];
        updatesByRow[change.rowIndex].push(change);
      } else if (change.type === "row_delete") {
        deletes.push(change);
      } else if (change.type === "row_insert") {
        inserts.push(change);
      }
    }

    const target = qualifiedTable(rules, database, table);

    // 1. UPDATE statements
    for (const rowIndexStr of Object.keys(updatesByRow)) {
      const updates = updatesByRow[Number(rowIndexStr)];
      if (updates.length === 0) continue;

      const setClauses = updates.map(
        (u) => `${rules.quoteIdentifier(u.columnName)} = ${formatSqlValue(u.stagedValue, rules)}`,
      );
      const filter = primaryKeyFilter(updates[0].primaryKeys, rules);
      sqlStatements.push(
        `UPDATE ${target} SET ${setClauses.join(", ")}${filter}${rules.singleRowLimit};`,
      );
    }

    // 2. DELETE statements
    for (const del of deletes) {
      const filter = primaryKeyFilter(del.primaryKeys, rules);
      sqlStatements.push(`DELETE FROM ${target}${filter}${rules.singleRowLimit};`);
    }

    // 3. INSERT statements
    for (const ins of inserts) {
      const cols = Object.keys(ins.values);
      if (cols.length === 0) continue;
      const colNames = cols.map(rules.quoteIdentifier).join(", ");
      const valLiterals = cols.map((c) => formatSqlValue(ins.values[c], rules)).join(", ");
      sqlStatements.push(`INSERT INTO ${target} (${colNames}) VALUES (${valLiterals});`);
    }

    return sqlStatements;
  },
}));
