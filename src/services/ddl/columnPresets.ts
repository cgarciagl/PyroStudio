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
  const base = dataType.toUpperCase().split("(")[0].trim().split(/\s+/)[0];
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

/** What the rest of the table looks like, so the sync never builds invalid keys. */
export interface ColumnSyncContext {
  /** Primary key columns other than the one being edited. */
  otherPrimaryKeys: number;
  /** Whether another column is already auto-increment. */
  otherAutoIncrement: boolean;
}

const NO_OTHER_COLUMNS: ColumnSyncContext = { otherPrimaryKeys: 0, otherAutoIncrement: false };

/** SQLite only autoincrements an `INTEGER PRIMARY KEY` row id. */
function canAutoIncrement(dataType: string, engine: DbEngine): boolean {
  if (engine === "sqlite") return dataType.trim().toUpperCase() === "INTEGER";
  return isIntegerType(dataType);
}

/**
 * Bidirectional synchronization of column attributes:
 * - Marking PK unchecks Nullable, and enables Auto-increment only when the column
 *   would be the single integer key and no other column is auto-increment.
 * - Marking Auto-increment ensures an integer type, checks PK and unchecks Nullable.
 * - Changing dataType to a type that cannot autoincrement disables Auto-increment
 *   (it never re-enables it, so a manual choice sticks).
 */
export function synchronizeColumnAttributes<
  T extends {
    dataType: string;
    length?: string;
    isPrimaryKey?: boolean;
    isAutoIncrement?: boolean;
    isNullable?: boolean;
  },
>(
  current: T,
  changed: Partial<T>,
  engine: DbEngine = "mysql",
  context: ColumnSyncContext = NO_OTHER_COLUMNS,
): T {
  const next: T = { ...current, ...changed };

  if (changed.dataType !== undefined && !canAutoIncrement(next.dataType, engine)) {
    next.isAutoIncrement = false;
  }

  if (changed.isAutoIncrement !== undefined && changed.isAutoIncrement) {
    next.isPrimaryKey = true;
    next.isNullable = false;
    if (!canAutoIncrement(next.dataType, engine)) {
      next.dataType = engine === "sqlite" ? "INTEGER" : "BIGINT";
      next.length = engine === "sqlite" ? "" : "20";
    }
  }

  if (changed.isPrimaryKey !== undefined) {
    if (changed.isPrimaryKey) {
      next.isNullable = false;
      const isSoleKey = context.otherPrimaryKeys === 0 && !context.otherAutoIncrement;
      if (isSoleKey && canAutoIncrement(next.dataType, engine)) {
        next.isAutoIncrement = true;
      }
    } else {
      next.isAutoIncrement = false;
    }
  }

  if (next.isPrimaryKey || next.isAutoIncrement) {
    next.isNullable = false;
  }

  return next;
}

/**
 * Applies `changed` to column `id` and keeps the whole table valid: only one
 * auto-increment column, and in SQLite an auto-increment column is the only key.
 */
export function updateColumnInTable<
  T extends {
    id: string;
    dataType: string;
    length?: string;
    isPrimaryKey?: boolean;
    isAutoIncrement?: boolean;
    isNullable?: boolean;
  },
>(columns: T[], id: string, changed: Partial<T>, engine: DbEngine = "mysql"): T[] {
  const others = columns.filter((c) => c.id !== id);
  const context: ColumnSyncContext = {
    otherPrimaryKeys: others.filter((c) => c.isPrimaryKey).length,
    otherAutoIncrement: others.some((c) => c.isAutoIncrement),
  };
  const updated = columns.map((c) =>
    c.id === id ? synchronizeColumnAttributes(c, changed, engine, context) : c,
  );
  const target = updated.find((c) => c.id === id);
  if (!target) return updated;

  return updated.map((c) => {
    if (c.id === id) return c;
    let other = c;
    // A table has at most one auto-increment column.
    if (target.isAutoIncrement && other.isAutoIncrement) {
      other = { ...other, isAutoIncrement: false };
    }
    // A key that becomes composite cannot stay auto-increment.
    if (target.isPrimaryKey && other.isPrimaryKey && other.isAutoIncrement) {
      other = { ...other, isAutoIncrement: false };
    }
    // SQLite: AUTOINCREMENT only exists on a single-column INTEGER PRIMARY KEY.
    if (engine === "sqlite" && target.isAutoIncrement && other.isPrimaryKey) {
      other = { ...other, isPrimaryKey: false };
    }
    return other;
  });
}

/** Prepends `column` as the table's only primary key (drops keys and AI elsewhere). */
export function prependPrimaryKeyColumn<
  T extends { name: string; isPrimaryKey?: boolean; isAutoIncrement?: boolean },
>(columns: T[], column: T): T[] {
  const others = columns.map((c) =>
    c.isPrimaryKey || c.isAutoIncrement ? { ...c, isPrimaryKey: false, isAutoIncrement: false } : c,
  );
  return [column, ...others];
}

/** First free name among `base`, `base_1`, `base_2`… (case-insensitive). */
export function uniqueColumnName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let i = 1;
  while (taken.has(`${base}_${i}`.toLowerCase())) i++;
  return `${base}_${i}`;
}

/** Default length for a type picked in a column dialog; never carries over the old one. */
export function defaultLengthFor(dataType: string): string {
  switch (dataType.toUpperCase()) {
    case "VARCHAR":
      return "255";
    case "CHAR":
      return "36";
    case "INT":
      return "11";
    case "BIGINT":
      return "20";
    case "DECIMAL":
      return "10,2";
    case "TINYINT":
      return "1";
    default:
      return "";
  }
}
