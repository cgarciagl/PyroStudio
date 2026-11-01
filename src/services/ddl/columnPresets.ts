import type { DbEngine, ColumnDefinition } from "../../types/database";

export const INTEGER_TYPES = [
  "INT",
  "INTEGER",
  "BIGINT",
  "SMALLINT",
  "TINYINT",
  "MEDIUMINT",
];

export function isIntegerType(dataType: string): boolean {
  if (!dataType) return false;
  const base = dataType.toUpperCase().split("(")[0].trim();
  return INTEGER_TYPES.includes(base);
}

export type PkPresetType = "id_autoincrement" | "uuid" | "code";

export interface PkPreset {
  id: PkPresetType;
  label: string;
  description: string;
  badge: string;
  createColumn: (engine: DbEngine) => Omit<ColumnDefinition, "id">;
}

export const PRIMARY_KEY_PRESETS: PkPreset[] = [
  {
    id: "id_autoincrement",
    label: "ID Autoincremental",
    description: "Estándar relacional recomendado (BIGINT / INTEGER AUTO_INCREMENT)",
    badge: "1 Clic",
    createColumn: (engine: DbEngine) => ({
      name: "id",
      dataType: engine === "sqlite" ? "INTEGER" : "BIGINT",
      length: engine === "sqlite" ? "" : "20",
      isPrimaryKey: true,
      isAutoIncrement: true,
      isNullable: false,
      isUnique: false,
      defaultValue: "",
      comment: "Identificador único autoincremental",
    }),
  },
  {
    id: "uuid",
    label: "UUID v4",
    description: "Identificador universal distribuido de 36 caracteres",
    badge: "Universal",
    createColumn: (engine: DbEngine) => ({
      name: "uuid",
      dataType: engine === "sqlite" ? "TEXT" : "CHAR",
      length: engine === "sqlite" ? "" : "36",
      isPrimaryKey: true,
      isAutoIncrement: false,
      isNullable: false,
      isUnique: false,
      defaultValue: "",
      comment: "Identificador único universal (UUID)",
    }),
  },
  {
    id: "code",
    label: "Código de Negocio",
    description: "Clave alfanumérica única de catálogo o negocio",
    badge: "Negocio",
    createColumn: () => ({
      name: "codigo",
      dataType: "VARCHAR",
      length: "50",
      isPrimaryKey: true,
      isAutoIncrement: false,
      isNullable: false,
      isUnique: false,
      defaultValue: "",
      comment: "Código identificador de negocio",
    }),
  },
];

/**
 * Intelligent bidirectional synchronization of column attributes:
 * - When marking PK on an integer column: auto-enables Auto-increment and unchecks Nullable.
 * - When marking Auto-increment: automatically ensures integer type, checks PK, unchecks Nullable.
 * - When changing dataType to non-integer: automatically disables Auto-increment to prevent invalid SQL.
 */
export function synchronizeColumnAttributes<
  T extends {
    dataType: string;
    length?: string;
    isPrimaryKey?: boolean;
    isAutoIncrement?: boolean;
    isNullable?: boolean;
  },
>(current: T, changed: Partial<T>, engine: DbEngine = "mysql"): T {
  const next: T = { ...current, ...changed };

  // 1. If dataType changed
  if (changed.dataType !== undefined) {
    if (!isIntegerType(changed.dataType)) {
      if (next.isAutoIncrement) {
        next.isAutoIncrement = false;
      }
    } else if (next.isPrimaryKey) {
      next.isAutoIncrement = true;
    }
  }

  // 2. If isAutoIncrement changed
  if (changed.isAutoIncrement !== undefined) {
    if (changed.isAutoIncrement) {
      next.isPrimaryKey = true;
      next.isNullable = false;
      if (!isIntegerType(next.dataType)) {
        next.dataType = engine === "sqlite" ? "INTEGER" : "BIGINT";
        next.length = engine === "sqlite" ? "" : "20";
      }
    }
  }

  // 3. If isPrimaryKey changed
  if (changed.isPrimaryKey !== undefined) {
    if (changed.isPrimaryKey) {
      next.isNullable = false;
      // Auto-suggest / enable auto-increment if it's an integer type
      if (isIntegerType(next.dataType)) {
        next.isAutoIncrement = true;
      }
    } else {
      // Unmarking PK implies it cannot be auto-increment in MySQL / SQLite
      next.isAutoIncrement = false;
    }
  }

  // 4. Primary key or auto-increment can never be nullable
  if (next.isPrimaryKey || next.isAutoIncrement) {
    next.isNullable = false;
  }

  return next;
}
