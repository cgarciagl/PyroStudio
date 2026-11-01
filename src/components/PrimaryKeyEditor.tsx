import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Key, Loader2 } from "lucide-react";
import type { DbEngine, DesignedSchema } from "../types/database";
import { isIntegerType } from "../services/ddl";
import { DESIGN_ENGINE_NOTICE, useDesignMigration } from "../hooks/useDesignMigration";
import { Modal } from "./ui/Modal";
import { PreviewStagedSqlModal } from "./PreviewStagedSqlModal";
import { primaryBtn, secondaryBtn } from "./ui/styles";

interface PrimaryKeyEditorProps {
  database: string;
  table: string;
  engine: DbEngine;
  onClose: () => void;
  onChanged: () => void;
}

/** Can `columnType` autoincrement on `engine` (SQLite: exactly INTEGER). */
function canAutoIncrement(columnType: string, engine: DbEngine): boolean {
  return engine === "sqlite" ? columnType.trim().toUpperCase() === "INTEGER" : isIntegerType(columnType);
}

/**
 * Chooses the primary key columns of an existing table (and its auto-increment
 * column) with the schema designer's engine and SQL review.
 */
export const PrimaryKeyEditor: React.FC<PrimaryKeyEditorProps> = ({
  database,
  table,
  engine,
  onClose,
  onChanged,
}) => {
  const { schema, review, setReview, error, busy, startReview, apply } = useDesignMigration(database);
  const own = schema?.tables.find((t) => t.name === table);
  const [keys, setKeys] = useState<string[]>([]);
  const [autoColumn, setAutoColumn] = useState("");

  useEffect(() => {
    if (!own) return;
    setKeys(own.columns.filter((c) => c.primary_key).map((c) => c.name));
    setAutoColumn(own.columns.find((c) => c.auto_increment)?.name ?? "");
  }, [own]);

  // Auto-increment needs a single integer key column.
  const autoCandidate =
    own && keys.length === 1
      ? own.columns.find((c) => c.name === keys[0] && canAutoIncrement(c.column_type, engine))
      : undefined;
  const effectiveAuto = autoCandidate && autoColumn === autoCandidate.name ? autoColumn : "";

  const desired = useMemo((): DesignedSchema | null => {
    if (!schema || !own) return null;
    return {
      tables: schema.tables.map((t) =>
        t.name !== table
          ? t
          : {
              ...t,
              columns: t.columns.map((c) => {
                const isKey = keys.includes(c.name);
                return {
                  ...c,
                  primary_key: isKey,
                  auto_increment: c.name === effectiveAuto,
                  nullable: isKey ? false : c.nullable,
                };
              }),
            },
      ),
    };
  }, [schema, own, table, keys, effectiveAuto]);

  if (review) {
    return (
      <PreviewStagedSqlModal
        isOpen
        onClose={() => setReview(null)}
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

  const toggle = (name: string, checked: boolean) =>
    setKeys((prev) => (checked ? [...prev, name] : prev.filter((k) => k !== name)));

  return (
    <Modal isOpen onClose={onClose} title="Llave primaria" subtitle={`${database}.${table}`} icon={<Key className="w-4 h-4" />} size="sm">
      <div className="p-5 space-y-3 text-xs">
        {!schema && !error && (
          <div className="flex items-center justify-center py-6 text-fg-muted">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando esquema…
          </div>
        )}
        {own && (
          <>
            <p className="text-fg-muted">
              Marca las columnas que forman la clave primaria. Las columnas de la clave pasan a NOT NULL.
            </p>
            <div className="border border-line rounded-md divide-y divide-line">
              {own.columns.map((c) => (
                <label key={c.name} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-hover">
                  <input type="checkbox" checked={keys.includes(c.name)} onChange={(e) => toggle(c.name, e.target.checked)} />
                  <span className="font-mono text-fg flex-1">{c.name}</span>
                  <span className="font-mono text-fg-muted">{c.column_type}</span>
                </label>
              ))}
            </div>
            <label className={`flex items-center gap-2 ${autoCandidate ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}>
              <input
                type="checkbox"
                disabled={!autoCandidate}
                checked={!!effectiveAuto}
                onChange={(e) => setAutoColumn(e.target.checked && autoCandidate ? autoCandidate.name : "")}
              />
              <span>
                Autoincremental
                {!autoCandidate &&
                  (engine === "sqlite"
                    ? " (requiere una sola columna INTEGER)"
                    : " (requiere una sola columna entera)")}
              </span>
            </label>
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
          <button type="button" className={primaryBtn} disabled={busy || !desired} onClick={() => desired && startReview(desired)}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
            <span>Revisar SQL</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
