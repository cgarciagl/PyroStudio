import { create } from "zustand";
import type { PrimaryKeyCondition } from "../types/database";

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
  unstageCellUpdate: (database: string, table: string, rowIndex: number, colIndex: number) => void;
  unstageRowDelete: (database: string, table: string, rowIndex: number) => void;
  unstageRowInsert: (database: string, table: string, tempId: string) => void;
  clearTableChanges: (database: string, table: string) => void;
  getTableChanges: (database: string, table: string) => StagedChange[];
  hasPendingChanges: (database: string, table: string) => boolean;
  generateSqlForTable: (database: string, table: string) => string[];
}

const tableKey = (db: string, tbl: string) => `${db}.${tbl}`;

const escapeSqlString = (str: string): string => {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "''")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\x1a/g, "\\Z");
};

export const formatSqlValue = (val: any): string => {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "1" : "0";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  if (typeof val === "object") return `'${escapeSqlString(JSON.stringify(val))}'`;
  const str = String(val);
  return `'${escapeSqlString(str)}'`;
};

const quoteId = (name: string): string => `\`${name.replace(/`/g, "``")}\``;

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
      // If there are cell updates staged on this row, remove them since the row is marked for deletion
      const filtered = currentList.filter(
        (c) => !(c.type === "cell_update" && c.rowIndex === change.rowIndex),
      );
      return {
        changesByTable: {
          ...state.changesByTable,
          [key]: [...filtered, { ...change, type: "row_delete" }],
        },
      };
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

  generateSqlForTable: (database, table) => {
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

    // 1. UPDATE statements
    for (const rowIndexStr of Object.keys(updatesByRow)) {
      const updates = updatesByRow[Number(rowIndexStr)];
      if (updates.length === 0) continue;

      const setClauses = updates.map(
        (u) => `${quoteId(u.columnName)} = ${formatSqlValue(u.stagedValue)}`,
      );

      const pks = updates[0].primaryKeys;
      const whereClauses = pks.map((pk) => {
        if (pk.value === null || pk.value === undefined) {
          return `${quoteId(pk.column)} IS NULL`;
        }
        return `${quoteId(pk.column)} = ${formatSqlValue(pk.value)}`;
      });

      const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";
      sqlStatements.push(
        `UPDATE ${quoteId(database)}.${quoteId(table)} SET ${setClauses.join(", ")}${whereSql} LIMIT 1;`,
      );
    }

    // 2. DELETE statements
    for (const del of deletes) {
      const whereClauses = del.primaryKeys.map((pk) => {
        if (pk.value === null || pk.value === undefined) {
          return `${quoteId(pk.column)} IS NULL`;
        }
        return `${quoteId(pk.column)} = ${formatSqlValue(pk.value)}`;
      });
      const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";
      sqlStatements.push(`DELETE FROM ${quoteId(database)}.${quoteId(table)}${whereSql} LIMIT 1;`);
    }

    // 3. INSERT statements
    for (const ins of inserts) {
      const cols = Object.keys(ins.values);
      if (cols.length === 0) continue;
      const colNames = cols.map(quoteId).join(", ");
      const valLiterals = cols.map((c) => formatSqlValue(ins.values[c])).join(", ");
      sqlStatements.push(
        `INSERT INTO ${quoteId(database)}.${quoteId(table)} (${colNames}) VALUES (${valLiterals});`,
      );
    }

    return sqlStatements;
  },
}));
