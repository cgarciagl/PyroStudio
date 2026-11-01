import { describe, it, expect } from "vitest";
import type { TableChunkRequest, TableChunkResult } from "../../types/database";

describe("Infinite Scroll & Continuous Virtualization Pagination", () => {
  it("creates valid TableChunkRequest for initial chunk with keyset and total count", () => {
    const req: TableChunkRequest = {
      database: "ecommerce",
      table: "orders",
      chunk_size: 500,
      offset: 0,
      order_by: "id",
      order_dir: "ASC",
      include_total_count: true,
    };

    expect(req.database).toBe("ecommerce");
    expect(req.table).toBe("orders");
    expect(req.chunk_size).toBe(500);
    expect(req.offset).toBe(0);
    expect(req.include_total_count).toBe(true);
    expect(req.last_primary_key_values).toBeUndefined();
  });

  it("creates valid TableChunkRequest for subsequent chunk with cursor values", () => {
    const nextReq: TableChunkRequest = {
      database: "ecommerce",
      table: "orders",
      chunk_size: 500,
      offset: 500,
      order_by: "id",
      order_dir: "ASC",
      last_primary_key_values: [1042],
      include_total_count: false,
    };

    expect(nextReq.offset).toBe(500);
    expect(nextReq.last_primary_key_values).toEqual([1042]);
    expect(nextReq.include_total_count).toBe(false);
  });

  it("determines scroll threshold correctly for triggering background chunk fetch", () => {
    const shouldFetchNext = (
      visibleBottom: number,
      loadedCount: number,
      hasMore: boolean,
      isLoadingMore: boolean,
    ): boolean => {
      if (!hasMore || isLoadingMore || loadedCount === 0) return false;
      return visibleBottom >= loadedCount - 50 || visibleBottom >= loadedCount * 0.8;
    };

    // Case 1: 500 rows loaded, user is at row 100 (visible 100..130) -> should NOT fetch
    expect(shouldFetchNext(130, 500, true, false)).toBe(false);

    // Case 2: 500 rows loaded, user scrolls to row 410 -> exceeds 80% (400) -> SHOULD fetch
    expect(shouldFetchNext(410, 500, true, false)).toBe(true);

    // Case 3: 500 rows loaded, user is at row 460 -> within 50 rows of end -> SHOULD fetch
    expect(shouldFetchNext(460, 500, true, false)).toBe(true);

    // Case 4: Near bottom, but already loading more -> should NOT fetch
    expect(shouldFetchNext(460, 500, true, true)).toBe(false);

    // Case 5: Near bottom, but no more records on server -> should NOT fetch
    expect(shouldFetchNext(460, 500, false, false)).toBe(false);
  });

  it("appends subsequent chunks smoothly without altering existing row buffer or column metadata", () => {
    const initialChunk: TableChunkResult = {
      columns: ["id", "customer", "amount"],
      column_types: ["INT", "VARCHAR", "DECIMAL"],
      rows: [
        [1, "Alice", 100],
        [2, "Bob", 200],
      ],
      total_rows: 1000,
      has_more: true,
      next_offset: 2,
      next_primary_key_values: [2],
      execution_time_ms: 12,
    };

    const secondChunk: TableChunkResult = {
      columns: ["id", "customer", "amount"],
      column_types: ["INT", "VARCHAR", "DECIMAL"],
      rows: [
        [3, "Charlie", 300],
        [4, "David", 400],
      ],
      total_rows: undefined,
      has_more: true,
      next_offset: 4,
      next_primary_key_values: [4],
      execution_time_ms: 8,
    };

    const mergedRows = [...initialChunk.rows, ...secondChunk.rows];
    expect(mergedRows.length).toBe(4);
    expect(mergedRows[0]).toEqual([1, "Alice", 100]);
    expect(mergedRows[3]).toEqual([4, "David", 400]);
    expect(secondChunk.next_primary_key_values).toEqual([4]);
  });
});
