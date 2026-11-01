import { useCallback, useEffect, useState } from "react";
import { dbService } from "../services/tauriDb";
import type { DesignedSchema, SchemaMigration } from "../types/database";

/** A designed schema and the migration the user is reviewing for it. */
export interface DesignReview {
  desired: DesignedSchema;
  migration: SchemaMigration;
}

/**
 * Review-then-apply through the schema designer's engine, for dialogs outside
 * the designer (primary key, SQLite auto-increment, SQLite column drop, foreign
 * keys). They get the designer's validation, warnings and SQLite rebuild.
 */
export function useDesignMigration(database: string, enabled = true) {
  const [schema, setSchema] = useState<DesignedSchema | null>(null);
  const [review, setReview] = useState<DesignReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    dbService
      .getDesignSchema(database)
      .then((s) => !cancelled && setSchema(s))
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [database, enabled]);

  /** Computes the migration for `desired`; `false` when it failed or changes nothing. */
  const startReview = useCallback(
    async (desired: DesignedSchema): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const migration = await dbService.generateSchemaMigration(database, desired);
        if (!migration.has_changes) {
          setError("No hay cambios que aplicar.");
          return false;
        }
        setReview({ desired, migration });
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [database],
  );

  /** Applies the reviewed migration; `true` on success. */
  const apply = useCallback(async (): Promise<boolean> => {
    if (!review) return false;
    setBusy(true);
    setError(null);
    try {
      await dbService.applySchemaMigration(database, review.desired, review.migration.up_sql);
      setReview(null);
      return true;
    } catch (err) {
      setReview(null);
      setError(String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [database, review]);

  return { schema, review, setReview, error, setError, busy, startReview, apply };
}

/** Note shown above designer-engine statements in the review dialog. */
export const DESIGN_ENGINE_NOTICE =
  "Se aplicará con el mismo motor que el diseñador de esquemas. En SQLite la tabla se recrea dentro de una transacción que se revierte si algo falla o si alguna clave foránea queda rota.";
