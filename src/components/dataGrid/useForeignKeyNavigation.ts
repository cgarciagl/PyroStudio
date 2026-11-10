import { useUIStore } from "../../stores/uiStore";
import type { ErRelation, ForeignKeyMetadata, TableDataResult } from "../../types/database";
import type { useSqlLiteralRules } from "../../services/sqlLiterals";
import { formatCellForSql } from "../../utils/formatCopy";

interface ForeignKeyNavigationParams {
  database: string;
  dialect: ReturnType<typeof useSqlLiteralRules>;
  dataResult: TableDataResult | null;
  displayRows: any[][];
  effectiveColumnNames: string[];
  getRawColIndex: (visualCol: number) => number;
  foreignKeys: ForeignKeyMetadata[];
  fkByColumn: Map<string, ForeignKeyMetadata>;
}

/**
 * Foreign key navigation from a row: jump to the referenced row, or to the
 * rows of another table that reference this one. Each jump opens a filtered tab.
 */
export function useForeignKeyNavigation({
  database,
  dialect,
  dataResult,
  displayRows,
  effectiveColumnNames,
  getRawColIndex,
  foreignKeys,
  fkByColumn,
}: ForeignKeyNavigationParams) {
  /** Value of a column (by name) in a displayed row; undefined when the result lacks it. */
  const getRowValueByName = (rowIndex: number, colName: string): any => {
    if (!dataResult || !displayRows[rowIndex]) return undefined;
    const idx = dataResult.columns.findIndex((c) => c.toLowerCase() === colName.toLowerCase());
    return idx === -1 ? undefined : displayRows[rowIndex][idx];
  };

  /**
   * Opens `targetTable` filtered by `pairs` (column in the target → value). Each
   * distinct filter gets its own tab so earlier jumps stay available.
   */
  const openFilteredTable = (targetTable: string, pairs: [string, any][]) => {
    const where = pairs
      .map(([col, val]) => `${dialect.quoteIdentifier(col)} = ${formatCellForSql(val, dialect)}`)
      .join(" AND ");
    const label = pairs.map(([col, val]) => `${col} = ${val}`).join(", ");
    useUIStore.getState().openTab({
      id: `tab_table_${database}_${targetTable}_where_${where}`,
      type: "table",
      title: `${targetTable} (${label})`,
      database,
      tableName: targetTable,
      initialFilter: where,
    });
  };

  const showNullKeyAlert = (columns: string[], targetTable: string) => {
    useUIStore.getState().showAlert({
      title: "Clave sin valor",
      message: `'${columns.join(", ")}' no tiene valor en esta fila, así que no hay registros relacionados en '${targetTable}'.`,
      variant: "info",
      icon: "info",
    });
  };

  // Foreign Key Quick-Jump: opens the referenced row (all columns of composite keys)
  const handleForeignKeyJump = (colIndex: number, rowIndex: number) => {
    if (!dataResult || !displayRows[rowIndex]) return;
    const rawColIdx = getRawColIndex(colIndex);
    const colName = effectiveColumnNames[colIndex] || dataResult.columns[rawColIdx];
    const fk = fkByColumn.get(colName.toLowerCase());
    if (!fk) return;

    const constraint = foreignKeys.filter(
      (f) => f.name === fk.name && f.referenced_table === fk.referenced_table,
    );
    const pairs = constraint.map(
      (f) => [f.referenced_column, getRowValueByName(rowIndex, f.column_name)] as [string, any],
    );
    if (pairs.some(([, val]) => val === null || val === undefined)) {
      showNullKeyAlert(constraint.map((f) => f.column_name), fk.referenced_table);
      return;
    }
    openFilteredTable(fk.referenced_table, pairs);
  };

  // Reverse navigation: rows of another table whose foreign key points at this row
  const handleReferencingJump = (constraint: ErRelation[], rowIndex: number) => {
    const childTable = constraint[0].table;
    const pairs = constraint.map(
      (r) =>
        [r.foreign_key.column_name, getRowValueByName(rowIndex, r.foreign_key.referenced_column)] as [
          string,
          any,
        ],
    );
    if (pairs.some(([, val]) => val === null || val === undefined)) {
      showNullKeyAlert(constraint.map((r) => r.foreign_key.referenced_column), childTable);
      return;
    }
    openFilteredTable(childTable, pairs);
  };

  return { getRowValueByName, handleForeignKeyJump, handleReferencingJump };
}
