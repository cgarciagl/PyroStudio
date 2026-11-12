import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnMetadata, IndexAdvisorReport, TableInspectorDetails } from "../../types/database";
import { dbService } from "../../services/tauriDb";

/** Data source of the hook (Dependency Inversion: tests or other engines can pass their own). */
export interface TableMetadataSource {
  getTableColumns(database: string, table: string): Promise<ColumnMetadata[]>;
  getTableInspectorDetails(database: string, table: string): Promise<TableInspectorDetails>;
  analyzeTableIndexes(database: string, table: string): Promise<IndexAdvisorReport>;
}

export type InspectorTab =
  | "data"
  | "structure"
  | "indexes"
  | "advisor"
  | "foreign_keys"
  | "triggers"
  | "statistics"
  | "ddl";

/** Tabs whose content comes from the inspector details. */
const INSPECTOR_TABS: InspectorTab[] = ["foreign_keys", "triggers", "statistics", "ddl"];

/**
 * Loads and caches the metadata of one table (columns, inspector details, index advice).
 * Single responsibility: knows nothing about tabs' rendering, modals or exports.
 *
 * - Details and advice load lazily, when the tab that shows them is visible.
 * - Responses for a table that is no longer shown are discarded.
 * - `afterSchemaChange` / `invalidateIndexes` drop what a change made stale.
 */
export function useTableMetadata(
  database: string,
  table: string,
  activeTab: InspectorTab,
  onError: (what: string, err: unknown) => void,
  source: TableMetadataSource = dbService,
) {
  const [columns, setColumns] = useState<ColumnMetadata[]>([]);
  const [isLoadingCols, setIsLoadingCols] = useState(false);
  const [inspectorDetails, setInspectorDetails] = useState<TableInspectorDetails | null>(null);
  const [isLoadingInspector, setIsLoadingInspector] = useState(false);
  const [advisorReport, setAdvisorReport] = useState<IndexAdvisorReport | null>(null);
  const [isLoadingAdvisor, setIsLoadingAdvisor] = useState(false);

  const currentKey = `${database}.${table}`;
  const currentRef = useRef(currentKey);
  currentRef.current = currentKey;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fetchColumns = useCallback(async () => {
    const key = `${database}.${table}`;
    setIsLoadingCols(true);
    try {
      const cols = await source.getTableColumns(database, table);
      if (currentRef.current === key) setColumns(cols);
    } catch (err) {
      onErrorRef.current("No se pudieron cargar las columnas", err);
    } finally {
      setIsLoadingCols(false);
    }
  }, [database, table, source]);

  const fetchInspectorDetails = useCallback(async () => {
    const key = `${database}.${table}`;
    setIsLoadingInspector(true);
    try {
      const details = await source.getTableInspectorDetails(database, table);
      if (currentRef.current !== key) return;
      setInspectorDetails(details);
      if (details.structure?.length) setColumns(details.structure);
    } catch (err) {
      onErrorRef.current("No se pudieron cargar los detalles de la tabla", err);
    } finally {
      setIsLoadingInspector(false);
    }
  }, [database, table, source]);

  const fetchAdvisorReport = useCallback(async () => {
    const key = `${database}.${table}`;
    setIsLoadingAdvisor(true);
    try {
      const rep = await source.analyzeTableIndexes(database, table);
      if (currentRef.current === key) setAdvisorReport(rep);
    } catch (err) {
      onErrorRef.current("No se pudo analizar los índices", err);
    } finally {
      setIsLoadingAdvisor(false);
    }
  }, [database, table, source]);

  // New table: forget everything about the previous one.
  useEffect(() => {
    setInspectorDetails(null);
    setAdvisorReport(null);
    fetchColumns();
  }, [fetchColumns]);

  // Lazy load for the visible tab. The cached values are deps so that invalidating
  // them (table switch, schema change) reloads the tab being shown.
  useEffect(() => {
    if (INSPECTOR_TABS.includes(activeTab)) {
      if (!inspectorDetails && !isLoadingInspector) fetchInspectorDetails();
    } else if (activeTab === "advisor") {
      if (!advisorReport && !isLoadingAdvisor) fetchAdvisorReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentKey, inspectorDetails, advisorReport]);

  /** Columns, keys, DDL and advice all change with the structure. */
  const afterSchemaChange = useCallback(() => {
    fetchColumns();
    fetchInspectorDetails();
    setAdvisorReport(null);
  }, [fetchColumns, fetchInspectorDetails]);

  /** Index changes alter the DDL and the advice, not the columns. */
  const invalidateIndexes = useCallback(() => {
    setInspectorDetails(null);
    setAdvisorReport(null);
  }, []);

  const primaryKeyColumns = useMemo(
    () => columns.filter((c) => c.column_key === "PRI").map((c) => c.name),
    [columns],
  );

  return {
    columns,
    primaryKeyColumns,
    isLoadingCols,
    inspectorDetails,
    isLoadingInspector,
    advisorReport,
    isLoadingAdvisor,
    fetchColumns,
    fetchInspectorDetails,
    fetchAdvisorReport,
    afterSchemaChange,
    invalidateIndexes,
  };
}
