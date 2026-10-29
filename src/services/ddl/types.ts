/** Column as edited in the table and column dialogs. */
export interface ColumnSpec {
  name: string;
  dataType: string;
  length?: string;
  nullable: boolean;
  /** As typed: `NULL`, `CURRENT_TIMESTAMP`, a number or plain text. */
  defaultValue?: string;
  autoIncrement?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  charset?: string;
  collation?: string;
  comment?: string;
}

export interface CreateTableSpec {
  database: string;
  table: string;
  columns: ColumnSpec[];
  /** MariaDB/MySQL table options. */
  engine?: string;
  collation?: string;
  comment?: string;
}

export interface AddColumnSpec {
  database: string;
  table: string;
  column: ColumnSpec;
  /** `END`, `FIRST` or the column to add it after (MariaDB/MySQL). */
  position?: string;
}

export interface ChangeColumnSpec {
  database: string;
  table: string;
  /** Current name of the column. */
  column: string;
  definition: ColumnSpec;
}

/** DDL in one engine's syntax for the table and column dialogs. */
export interface DdlBuilder {
  /** Types offered in the type pickers. */
  dataTypes: string[];
  createTable: (spec: CreateTableSpec) => string;
  /** Throws when the engine cannot add such a column. */
  addColumn: (spec: AddColumnSpec) => string;
  /** Live preview of a column change while it is being edited. */
  describeColumnChange: (spec: ChangeColumnSpec) => string;
  /** Statements that change a column (may read the current schema). */
  planColumnChange: (spec: ChangeColumnSpec) => Promise<string[]>;
  applyColumnChange: (spec: ChangeColumnSpec, statements: string[]) => Promise<void>;
  /** Column changes that rebuild the table are shown before they run. */
  previewsColumnChanges: boolean;
  /** Whether a column change can turn auto-increment on or off. */
  changesAutoIncrement: boolean;
}
