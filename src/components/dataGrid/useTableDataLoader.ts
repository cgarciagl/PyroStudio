import { useCallback, useRef, useState } from "react";
import type { Rectangle } from "@glideapps/glide-data-grid";
import { dbService } from "../../services/tauriDb";
import { useUIStore } from "../../stores/uiStore";
import type { QueryExecutionResult, TableDataResult } from "../../types/database";

/** Below this estimate the exact COUNT(*) runs automatically in the background. */
const EXACT_COUNT_AUTO_LIMIT = 1_000_000;

interface TableDataLoaderParams {
  database: string;
  table: string;
  externalData: TableDataResult | QueryExecutionResult | null | undefined;
  onRefresh: (() => void) | undefined;
  infiniteScroll: boolean;
  sortColumn: string | null;
  sortDirection: "ASC" | "DESC" | null;
  serverFilter: string;
  isServerFilterActive: boolean;
}

/**
 * Table data fetching: paged or continuous (infinite scroll) loading, the
 * deferred exact row count and stale-response protection via a fetch id.
 */
export function useTableDataLoader({
  database,
  table,
  externalData,
  onRefresh,
  infiniteScroll,
  sortColumn,
  sortDirection,
  serverFilter,
  isServerFilterActive,
}: TableDataLoaderParams) {
  const [dataResult, setDataResult] = useState<TableDataResult | null>(null);
  const [isCountingRows, setIsCountingRows] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number>(0);
  const [lastPkValues, setLastPkValues] = useState<any[] | null>(null);
  const activeFetchIdRef = useRef<number>(0);

  /** Runs the exact COUNT(*) off the critical path and patches the total in place. */
  const countExactRows = useCallback(
    async (filterSql: string | null, fetchId: number = activeFetchIdRef.current) => {
      if (!table || externalData) return;
      setIsCountingRows(true);
      try {
        const total = await dbService.countTableRows(database, table, filterSql || undefined);
        if (fetchId !== activeFetchIdRef.current) return;
        setDataResult((prev) =>
          prev ? { ...prev, total_rows: total, total_rows_estimated: false } : prev,
        );
      } catch (err) {
        console.error("Failed to count table rows:", err);
      } finally {
        if (fetchId === activeFetchIdRef.current) setIsCountingRows(false);
      }
    },
    [database, table, externalData],
  );

  const loadData = useCallback(
    async (
      offset: number,
      limit: number,
      orderBy: string | null = sortColumn,
      orderDir: "ASC" | "DESC" | null = sortDirection,
      filterSql: string | null = isServerFilterActive ? serverFilter : null,
      resetContinuous: boolean = true,
    ) => {
      if (externalData) {
        onRefresh?.();
        return;
      }
      if (!table) return;

      const fetchId = ++activeFetchIdRef.current;
      setIsLoading(true);
      try {
        if (infiniteScroll && resetContinuous) {
          const chunk = await dbService.fetchTableChunk({
            database,
            table,
            chunk_size: limit > 0 ? limit : 500,
            offset: 0,
            order_by: orderBy || undefined,
            order_dir: orderDir || undefined,
            filter_sql: filterSql || undefined,
            last_primary_key_values: undefined,
            include_total_count: true,
          });
          if (fetchId !== activeFetchIdRef.current) return;
          setDataResult({
            columns: chunk.columns,
            column_types: chunk.column_types,
            rows: chunk.rows,
            total_rows: chunk.total_rows ?? (chunk.has_more ? undefined : chunk.rows.length),
            total_rows_estimated: chunk.total_rows_estimated,
            limit: chunk.rows.length,
            offset: 0,
            execution_time_ms: chunk.execution_time_ms,
          });
          setIsCountingRows(false);
          // Data is already on screen; the exact count runs afterwards. Huge tables
          // keep the instant estimate and count only on demand.
          const needsExactCount = chunk.total_rows_estimated
            ? (chunk.total_rows ?? 0) < EXACT_COUNT_AUTO_LIMIT
            : chunk.total_rows === undefined && chunk.has_more;
          if (needsExactCount) void countExactRows(filterSql, fetchId);
          setHasMore(chunk.has_more);
          setNextOffset(chunk.next_offset);
          setLastPkValues(chunk.next_primary_key_values ?? null);
        } else {
          const result = await dbService.queryTableData(
            database,
            table,
            limit,
            offset,
            orderBy || undefined,
            orderDir || undefined,
            filterSql || undefined,
          );
          if (fetchId !== activeFetchIdRef.current) return;
          setDataResult(result);
          setHasMore(false);
        }
      } catch (err: any) {
        if (fetchId !== activeFetchIdRef.current) return;
        console.error("Failed to load table data:", err);
        useUIStore.getState().showAlert({
          title: "Error al Cargar Datos",
          message:
            typeof err === "string"
              ? err
              : err?.message || "Error al consultar la tabla en MariaDB/MySQL",
          variant: "danger",
        });
      } finally {
        if (fetchId === activeFetchIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [
      externalData,
      onRefresh,
      database,
      table,
      sortColumn,
      sortDirection,
      isServerFilterActive,
      serverFilter,
      infiniteScroll,
      countExactRows,
    ],
  );

  const fetchNextChunk = useCallback(async () => {
    if (!infiniteScroll || !table || externalData || isLoading || isLoadingMore || !hasMore) {
      return;
    }
    const fetchId = activeFetchIdRef.current;
    setIsLoadingMore(true);
    try {
      const chunk = await dbService.fetchTableChunk({
        database,
        table,
        chunk_size: 500,
        offset: nextOffset,
        order_by: sortColumn || undefined,
        order_dir: sortDirection || undefined,
        filter_sql: isServerFilterActive ? serverFilter : undefined,
        last_primary_key_values: lastPkValues || undefined,
        include_total_count: false,
      });
      if (fetchId !== activeFetchIdRef.current) return;

      setDataResult((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          rows: [...prev.rows, ...chunk.rows],
          execution_time_ms: chunk.execution_time_ms,
        };
      });
      setHasMore(chunk.has_more);
      setNextOffset(chunk.next_offset);
      setLastPkValues(chunk.next_primary_key_values ?? null);
    } catch (err) {
      console.warn("Error cargando bloque de filas continuo:", err);
    } finally {
      if (fetchId === activeFetchIdRef.current) {
        setIsLoadingMore(false);
      }
    }
  }, [
    infiniteScroll,
    table,
    externalData,
    isLoading,
    isLoadingMore,
    hasMore,
    database,
    nextOffset,
    sortColumn,
    sortDirection,
    isServerFilterActive,
    serverFilter,
    lastPkValues,
  ]);

  const handleVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      if (!infiniteScroll || !hasMore || isLoadingMore || isLoading || !table || externalData) {
        return;
      }
      const loadedCount = dataResult?.rows?.length ?? 0;
      if (loadedCount === 0) return;

      const visibleBottom = range.y + range.height;
      if (visibleBottom >= loadedCount - 50 || visibleBottom >= loadedCount * 0.8) {
        fetchNextChunk();
      }
    },
    [
      infiniteScroll,
      hasMore,
      isLoadingMore,
      isLoading,
      table,
      externalData,
      dataResult?.rows?.length,
      fetchNextChunk,
    ],
  );

  return {
    dataResult,
    setDataResult,
    isCountingRows,
    isLoading,
    hasMore,
    isLoadingMore,
    countExactRows,
    loadData,
    handleVisibleRegionChanged,
  };
}
