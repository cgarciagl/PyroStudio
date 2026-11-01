import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Link2, Loader2 } from "lucide-react";
import { dbService } from "../services/tauriDb";
import type { DesignedSchema, DesignForeignKey, SchemaMigration } from "../types/database";
import { Modal } from "./ui/Modal";
import { PreviewStagedSqlModal } from "./PreviewStagedSqlModal";
import { primaryBtn, secondaryBtn } from "./ui/styles";

const FK_ACTIONS = ["RESTRICT", "CASCADE", "SET NULL", "NO ACTION", "SET DEFAULT"];

const selectClass =
  "w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg focus:outline-none focus:border-accent font-mono";

interface ForeignKeyEditorProps {
  database: string;
  table: string;
  /** `add` opens the form; a constraint name asks to drop that key. */
  action: { kind: "add" } | { kind: "drop"; name: string };
  onClose: () => void;
  onChanged: () => void;
}

/**
 * Adds or drops a foreign key through the schema designer's migration engine,
 * so the Relations tab gets the same validation (existing columns, unique
 * names of at most 64 characters, SQLite rebuild that keeps the table's
 * constraints and aborts on broken references) and the same SQL review.
 */
export const ForeignKeyEditor: React.FC<ForeignKeyEditorProps> = ({
  database,
  table,
  action,
  onClose,
  onChanged,
}) => {
  const [schema, setSchema] = useState<DesignedSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ desired: DesignedSchema; migration: SchemaMigration } | null>(
    null,
  );

  const [column, setColumn] = useState("");
  const [targetTable, setTargetTable] = useState("");
  const [targetColumn, setTargetColumn] = useState("");
  const [onDelete, setOnDelete] = useState("RESTRICT");
  const [onUpdate, setOnUpdate] = useState("RESTRICT");

  useEffect(() => {
    let cancelled = false;
    dbService
      .getDesignSchema(database)
      .then((s) => {
        if (cancelled) return;
        setSchema(s);
        const own = s.tables.find((t) => t.name === table);
        setColumn(own?.columns[0]?.name ?? "");
        const target = s.tables.find((t) => t.name !== table) ?? own;
        setTargetTable(target?.name ?? "");
        setTargetColumn(target?.columns.find((c) => c.primary_key)?.name ?? target?.columns[0]?.name ?? "");
      })
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [database, table]);

  const ownTable = schema?.tables.find((t) => t.name === table);
  const target = schema?.tables.find((t) => t.name === targetTable);

  const desiredSchema = useMemo((): DesignedSchema | null => {
    if (!schema || !ownTable) return null;
    const editKeys = (keys: DesignForeignKey[]): DesignForeignKey[] => {
      if (action.kind === "drop") return keys.filter((k) => k.name !== action.name);
      return [
        ...keys,
        {
          // Empty name: the engine generates a unique one of at most 64 characters.
          name: "",
          columns: [column],
          referenced_table: targetTable,
          referenced_columns: [targetColumn],
          on_delete: onDelete,
          on_update: onUpdate,
        },
      ];
    };
    return {
      tables: schema.tables.map((t) =>
        t.name === table ? { ...t, foreign_keys: editKeys(t.foreign_keys) } : t,
      ),
    };
  }, [schema, ownTable, action, table, column, targetTable, targetColumn, onDelete, onUpdate]);

  const startReview = async () => {
    if (!desiredSchema) return;
    setBusy(true);
    setError(null);
    try {
      const migration = await dbService.generateSchemaMigration(database, desiredSchema);
      if (!migration.has_changes) {
        setError("No hay cambios que aplicar.");
      } else {
        setReview({ desired: desiredSchema, migration });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // Dropping needs no form: review right away.
  useEffect(() => {
    if (action.kind === "drop" && desiredSchema && !review && !error && !busy) startReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.kind, desiredSchema]);

  const apply = async () => {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      await dbService.applySchemaMigration(database, review.desired, review.migration.up_sql);
      onChanged();
      onClose();
    } catch (err) {
      setReview(null);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (review) {
    return (
      <PreviewStagedSqlModal
        isOpen
        onClose={() => (action.kind === "drop" ? onClose() : setReview(null))}
        onApply={apply}
        sqlStatements={review.migration.up.map((s) => s.sql)}
        database={database}
        table={table}
        isApplying={busy}
        warnings={review.migration.warnings}
        notice="Se aplicará con el mismo motor que el diseñador de esquemas. En SQLite la tabla se recrea dentro de una transacción que se revierte si alguna clave foránea queda rota."
      />
    );
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={action.kind === "add" ? "Nueva clave foránea" : "Eliminar clave foránea"}
      subtitle={`${database}.${table}`}
      icon={<Link2 className="w-4 h-4" />}
      size="sm"
    >
      <div className="p-5 space-y-3 text-xs">
        {!schema && !error && (
          <div className="flex items-center justify-center py-6 text-fg-muted">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando esquema…
          </div>
        )}
        {schema && action.kind === "add" && ownTable && (
          <>
            <label className="block space-y-1">
              <span className="text-fg">Columna de {table}</span>
              <select className={selectClass} value={column} onChange={(e) => setColumn(e.target.value)}>
                {ownTable.columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} — {c.column_type}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-fg">Tabla referenciada</span>
              <select
                className={selectClass}
                value={targetTable}
                onChange={(e) => {
                  const next = schema.tables.find((t) => t.name === e.target.value);
                  setTargetTable(e.target.value);
                  setTargetColumn(next?.columns.find((c) => c.primary_key)?.name ?? next?.columns[0]?.name ?? "");
                }}
              >
                {schema.tables.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-fg">Columna referenciada</span>
              <select
                className={selectClass}
                value={targetColumn}
                onChange={(e) => setTargetColumn(e.target.value)}
              >
                {target?.columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} — {c.column_type}
                    {c.primary_key ? " (PK)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-fg">ON DELETE</span>
                <select className={selectClass} value={onDelete} onChange={(e) => setOnDelete(e.target.value)}>
                  {FK_ACTIONS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-fg">ON UPDATE</span>
                <select className={selectClass} value={onUpdate} onChange={(e) => setOnUpdate(e.target.value)}>
                  {FK_ACTIONS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
        {error && (
          <div className="p-3 rounded-lg border border-line text-danger flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <div className="pt-2 flex justify-end gap-2">
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Cancelar
          </button>
          {action.kind === "add" && (
            <button
              type="button"
              className={primaryBtn}
              disabled={busy || !schema || !column || !targetTable || !targetColumn}
              onClick={startReview}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              <span>Revisar SQL</span>
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
