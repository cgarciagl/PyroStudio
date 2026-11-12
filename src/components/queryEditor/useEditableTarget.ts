import { useEffect, useMemo, useState } from "react";
import type { QueryExecutionResult } from "../../types/database";
import { dbService } from "../../services/tauriDb";
import { extractTargetTableAndDb } from "./sqlTarget";

interface EditableTargetParams {
  database: string;
  /** SQL that produced the visible result (falls back to the editor text). */
  sql: string;
  result: QueryExecutionResult | null;
  readOnly: boolean;
  noPrimaryKeyMode: string;
}

/**
 * Decides whether a query result can be edited in the grid and against which table
 * and key: detects the target table from the SQL (overridable), loads its real primary
 * key (overridable) and checks the key columns are part of the result.
 */
export function useEditableTarget({ database, sql, result, readOnly, noPrimaryKeyMode }: EditableTargetParams) {
  const [targetTableOverride, setTargetTableOverride] = useState("");
  const [targetPkOverride, setTargetPkOverride] = useState("");
  const [tablePkColumns, setTablePkColumns] = useState<string[]>([]);

  const detectedTarget = useMemo(() => extractTargetTableAndDb(sql), [sql]);
  const activeTargetTable = targetTableOverride.trim() || detectedTarget.table || "";
  const activeTargetDb = detectedTarget.db || database;

  useEffect(() => {
    if (!activeTargetTable || !activeTargetDb) {
      setTablePkColumns([]);
      return;
    }
    let alive = true;
    dbService
      .getTablePrimaryKey(activeTargetDb, activeTargetTable)
      .then((pk) => {
        if (alive) setTablePkColumns(pk?.columns ?? []);
      })
      .catch(() => {
        if (alive) setTablePkColumns([]);
      });
    return () => {
      alive = false;
    };
  }, [activeTargetDb, activeTargetTable]);

  const activePkColumns = useMemo(() => {
    if (targetPkOverride.trim()) {
      return targetPkOverride.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return tablePkColumns;
  }, [targetPkOverride, tablePkColumns]);

  const hasPrimaryKey = activePkColumns.length > 0;

  const pkColumnsPresent = useMemo(() => {
    if (!result?.columns || !hasPrimaryKey) return false;
    const lower = result.columns.map((c) => c.toLowerCase());
    return activePkColumns.every((pk) => lower.includes(pk.toLowerCase()));
  }, [result, activePkColumns, hasPrimaryKey]);

  const canEditResult = Boolean(
    !readOnly &&
      activeTargetTable &&
      (hasPrimaryKey ? pkColumnsPresent : noPrimaryKeyMode === "use_all_columns"),
  );

  return {
    targetTableOverride,
    setTargetTableOverride,
    targetPkOverride,
    setTargetPkOverride,
    detectedTarget,
    activeTargetTable,
    activeTargetDb,
    /** Key reported by the database (before any override). */
    tablePkColumns,
    activePkColumns,
    hasPrimaryKey,
    pkColumnsPresent,
    canEditResult,
  };
}
