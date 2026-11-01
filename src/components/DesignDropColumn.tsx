import React, { useEffect, useRef } from "react";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import type { DesignedSchema } from "../types/database";
import { DESIGN_ENGINE_NOTICE, useDesignMigration } from "../hooks/useDesignMigration";
import { Modal } from "./ui/Modal";
import { PreviewStagedSqlModal } from "./PreviewStagedSqlModal";
import { secondaryBtn } from "./ui/styles";

interface DesignDropColumnProps {
  database: string;
  table: string;
  column: string;
  onClose: () => void;
  onChanged: () => void;
}

/** `schema` without `table.column` and without the foreign keys that use it. */
export function withoutColumn(schema: DesignedSchema, table: string, column: string): DesignedSchema {
  return {
    tables: schema.tables.map((t) => ({
      ...t,
      columns: t.name === table ? t.columns.filter((c) => c.name !== column) : t.columns,
      foreign_keys: t.foreign_keys.filter(
        (f) =>
          !(t.name === table && f.columns.includes(column)) &&
          !(f.referenced_table === table && f.referenced_columns.includes(column)),
      ),
    })),
  };
}

/**
 * SQLite column drop. `ALTER TABLE … DROP COLUMN` refuses columns used by an
 * index, the primary key, a foreign key or UNIQUE; the designer engine rebuilds
 * the table instead and reports what is lost before it runs.
 */
export const DesignDropColumn: React.FC<DesignDropColumnProps> = ({
  database,
  table,
  column,
  onClose,
  onChanged,
}) => {
  const { schema, review, error, busy, startReview, apply } = useDesignMigration(database);
  const started = useRef(false);

  useEffect(() => {
    if (!schema || started.current) return;
    started.current = true;
    startReview(withoutColumn(schema, table, column));
  }, [schema, startReview, table, column]);

  if (review) {
    return (
      <PreviewStagedSqlModal
        isOpen
        onClose={onClose}
        onApply={async () => {
          if (await apply()) {
            onChanged();
            onClose();
          }
        }}
        sqlStatements={review.migration.up.map((s) => s.sql)}
        database={database}
        table={table}
        isApplying={busy}
        warnings={review.migration.warnings}
        notice={DESIGN_ENGINE_NOTICE}
      />
    );
  }

  return (
    <Modal isOpen onClose={onClose} title="Eliminar columna" subtitle={`${database}.${table}.${column}`} icon={<Trash2 className="w-4 h-4" />} size="sm">
      <div className="p-5 space-y-3 text-xs">
        {!error && (
          <div className="flex items-center justify-center py-6 text-fg-muted">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Preparando la migración…
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg border border-line text-danger flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex justify-end">
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
};
