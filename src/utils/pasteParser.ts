import type { PrimaryKeyCondition } from "../types/database";

export interface ParsedPasteCell {
  col: number;
  row: number;
  columnName: string;
  originalValue: any;
  proposedValue: any;
  isPk: boolean;
  typeWarning?: string;
  primaryKeys: PrimaryKeyCondition[];
}

export interface PasteValidationResult {
  totalCells: number;
  affectedRowsCount: number;
  changes: ParsedPasteCell[];
  errors: string[];
  warnings: string[];
  pkColumnsAffected: string[];
}

/**
 * Coerces a raw clipboard string value according to SQL semantics:
 * - "\N" -> null
 * - Literal quoted strings e.g. '"NULL"' -> 'NULL'
 * - '""' -> ''
 * - "NULL" (case insensitive) -> null
 * - Unquoted string -> trimmed string
 */
export const coercePasteValue = (raw: string): any => {
  const trimmed = raw.trim();

  // Explicit NULL markers
  if (trimmed === "\\N" || trimmed.toUpperCase() === "NULL") {
    return null;
  }

  // Quoted literals: preserve quotes unwrapped
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }

  return raw;
};

/**
 * Standardizes numeric strings by ensuring dot decimal separator and no thousands separators:
 * - "1234,56" -> "1234.56"
 * - "1,234,567.89" -> "1234567.89"
 * - "1.234.567,89" -> "1234567.89"
 */
export const standardizeNumericString = (val: string): string => {
  const trimmed = val.trim();
  if (!trimmed) return trimmed;
  if (/^-?\d+,\d+$/.test(trimmed)) {
    return trimmed.replace(",", ".");
  }
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) {
    return trimmed.replace(/,/g, "");
  }
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)) {
    return trimmed.replace(/\./g, "").replace(",", ".");
  }
  return trimmed;
};

/**
 * Validates a value against an expected SQL column type
 */
export const checkTypeCompatibility = (
  value: any,
  colType?: string,
): string | undefined => {
  if (value === null || value === undefined || !colType) return undefined;
  const upperType = colType.toUpperCase();

  // Integer types
  if (
    upperType.includes("INT") &&
    !upperType.includes("POINT")
  ) {
    const rawStr = typeof value === "string" ? standardizeNumericString(value) : String(value);
    const num = Number(rawStr);
    if (isNaN(num) || !Number.isInteger(num)) {
      return `Valor '${value}' no es un entero válido para '${colType}'`;
    }
  }

  // Decimal / Float / Double / Numeric
  if (
    upperType.includes("DECIMAL") ||
    upperType.includes("FLOAT") ||
    upperType.includes("DOUBLE") ||
    upperType.includes("NUMERIC") ||
    upperType.includes("REAL")
  ) {
    const rawStr = typeof value === "string" ? standardizeNumericString(value) : String(value);
    const num = Number(rawStr);
    if (isNaN(num)) {
      return `Valor '${value}' no es un número válido para '${colType}'`;
    }
  }

  // Date / Datetime
  if (upperType.includes("DATE") || upperType.includes("TIME")) {
    const str = String(value).trim();
    if (str !== "" && isNaN(Date.parse(str)) && !/^\d{4}-\d{2}-\d{2}/.test(str)) {
      return `Valor '${value}' podría no coincidir con el formato fecha/hora de '${colType}'`;
    }
  }

  return undefined;
};

/**
 * Parses and validates a 2D matrix of values pasted at target [col, row].
 */
export const parseClipboardMatrix = ({
  targetCol,
  targetRow,
  matrix,
  columns,
  columnTypes,
  rawColumns,
  displayRows,
  activePkColumns,
  hasPrimaryKey,
  isEditingAllowed,
}: {
  targetCol: number;
  targetRow: number;
  matrix: readonly (readonly string[])[];
  columns: string[];
  columnTypes?: string[];
  rawColumns?: string[];
  displayRows: any[][];
  activePkColumns: string[];
  hasPrimaryKey: boolean;
  isEditingAllowed: boolean;
}): PasteValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const changes: ParsedPasteCell[] = [];
  const affectedRowsSet = new Set<number>();
  const pkColumnsAffectedSet = new Set<string>();

  if (!isEditingAllowed) {
    errors.push(
      "La edición está bloqueada para esta tabla (sin clave primaria en modo estricto).",
    );
    return {
      totalCells: 0,
      affectedRowsCount: 0,
      changes: [],
      errors,
      warnings,
      pkColumnsAffected: [],
    };
  }

  if (targetRow < 0 || targetCol < 0 || matrix.length === 0) {
    errors.push("Coordenadas de destino de pegado inválidas.");
    return {
      totalCells: 0,
      affectedRowsCount: 0,
      changes: [],
      errors,
      warnings,
      pkColumnsAffected: [],
    };
  }

  const targetRawColumns = rawColumns || columns;
  const rawLowerCols = targetRawColumns.map((c) => c.toLowerCase());

  for (let r = 0; r < matrix.length; r++) {
    const gridRow = targetRow + r;
    if (gridRow >= displayRows.length) {
      warnings.push(
        `Se truncaron ${matrix.length - r} fila(s) del portapapeles porque superan el límite de filas cargadas en esta página.`,
      );
      break;
    }

    const rowData = displayRows[gridRow];
    if (!rowData) continue;

    // Snapshot original primary keys for this row
    const primaryKeys: PrimaryKeyCondition[] = [];
    let validRowPk = true;

    if (hasPrimaryKey) {
      for (const pkCol of activePkColumns) {
        const pkIdx = rawLowerCols.indexOf(pkCol.toLowerCase());
        if (pkIdx === -1) {
          validRowPk = false;
          break;
        }
        const pkVal = rowData[pkIdx];
        if (pkVal === undefined || pkVal === null) {
          validRowPk = false;
          break;
        }
        primaryKeys.push({ column: pkCol, value: pkVal });
      }
    } else {
      for (let idx = 0; idx < targetRawColumns.length; idx++) {
        primaryKeys.push({
          column: targetRawColumns[idx],
          value: rowData[idx] ?? null,
        });
      }
    }

    if (!validRowPk) {
      warnings.push(
        `Fila #${gridRow + 1} omitida: no tiene un valor válido de clave primaria para identificar el registro.`,
      );
      continue;
    }

    const rowValues = matrix[r];
    for (let c = 0; c < rowValues.length; c++) {
      const gridCol = targetCol + c;
      if (gridCol >= columns.length) {
        // Exceeded available columns in table, ignore trailing clipboard columns
        continue;
      }

      const colName = columns[gridCol];
      const colType = columnTypes?.[gridCol];
      const isPk = activePkColumns.includes(colName);
      if (isPk) {
        pkColumnsAffectedSet.add(colName);
      }

      const rawColIdx = rawLowerCols.indexOf(colName.toLowerCase());
      const originalVal = rawColIdx !== -1 ? rowData[rawColIdx] : rowData[gridCol];

      let proposedVal = coercePasteValue(rowValues[c]);
      const upperColType = colType?.toUpperCase() || "";
      const isColNumeric =
        upperColType.includes("INT") ||
        upperColType.includes("DECIMAL") ||
        upperColType.includes("FLOAT") ||
        upperColType.includes("DOUBLE") ||
        upperColType.includes("NUMERIC") ||
        upperColType.includes("REAL");
      if (isColNumeric && typeof proposedVal === "string") {
        proposedVal = standardizeNumericString(proposedVal);
      }

      const typeWarning = checkTypeCompatibility(proposedVal, colType);
      if (typeWarning) {
        warnings.push(`Fila #${gridRow + 1}, ${colName}: ${typeWarning}`);
      }

      changes.push({
        col: gridCol,
        row: gridRow,
        columnName: colName,
        originalValue: originalVal,
        proposedValue: proposedVal,
        isPk,
        typeWarning,
        primaryKeys,
      });

      affectedRowsSet.add(gridRow);
    }
  }

  const pkColumnsAffected = Array.from(pkColumnsAffectedSet);
  if (pkColumnsAffected.length > 0) {
    warnings.unshift(
      `Atención: Esta operación sobrescribirá valores en columna(s) de Clave Primaria: [${pkColumnsAffected.join(
        ", ",
      )}]. Esto cambiará la identidad del registro en base de datos.`,
    );
  }

  return {
    totalCells: changes.length,
    affectedRowsCount: affectedRowsSet.size,
    changes,
    errors,
    warnings,
    pkColumnsAffected,
  };
};

