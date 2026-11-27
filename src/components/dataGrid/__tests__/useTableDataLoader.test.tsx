// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TableDataResult } from "../../../types/database";

vi.mock("../../../services/tauriDb", () => ({
  dbService: {
    queryTableData: vi.fn(),
    fetchTableChunk: vi.fn(),
    countTableRows: vi.fn(),
  },
}));

import { dbService } from "../../../services/tauriDb";
import { useTableDataLoader } from "../useTableDataLoader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: ReturnType<typeof useTableDataLoader> | null = null;

function Harness({ infiniteScroll = false }: { infiniteScroll?: boolean }) {
  latest = useTableDataLoader({
    database: "app",
    table: "events",
    externalData: null,
    onRefresh: undefined,
    infiniteScroll,
    sortColumn: null,
    sortDirection: null,
    serverFilter: "",
    isServerFilterActive: false,
  });
  return null;
}

function makePage(overrides: Partial<TableDataResult> = {}): TableDataResult {
  return {
    columns: ["id"],
    column_types: ["bigint"],
    rows: [[1], [2]],
    total_rows: 5_000_000,
    total_rows_estimated: true,
    has_more: true,
    limit: 2,
    offset: 0,
    execution_time_ms: 4,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  latest = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

describe("useTableDataLoader (paged mode)", () => {
  it("keeps the instant estimate on huge tables without auto-running COUNT(*)", async () => {
    vi.mocked(dbService.queryTableData).mockResolvedValueOnce(makePage());

    act(() => {
      root!.render(<Harness infiniteScroll={false} />);
    });

    await act(async () => {
      await latest!.loadData(0, 2, null, null, null, true);
    });

    expect(latest!.dataResult?.rows).toEqual([[1], [2]]);
    expect(latest!.dataResult?.total_rows).toBe(5_000_000);
    expect(latest!.dataResult?.total_rows_estimated).toBe(true);
    expect(latest!.hasMore).toBe(true);
    expect(dbService.countTableRows).not.toHaveBeenCalled();
  });

  it("runs exact COUNT(*) in background for medium tables and reuses it across page turns", async () => {
    vi.mocked(dbService.queryTableData)
      .mockResolvedValueOnce(makePage({ total_rows: 50_000, total_rows_estimated: true, has_more: true }))
      .mockResolvedValueOnce(
        makePage({ rows: [[3], [4]], offset: 2, total_rows: 50_000, total_rows_estimated: true, has_more: true }),
      );
    vi.mocked(dbService.countTableRows).mockResolvedValueOnce(51_234);

    act(() => {
      root!.render(<Harness infiniteScroll={false} />);
    });

    await act(async () => {
      await latest!.loadData(0, 2, null, null, null, true);
    });

    expect(dbService.countTableRows).toHaveBeenCalledTimes(1);
    expect(latest!.dataResult?.total_rows).toBe(51_234);
    expect(latest!.dataResult?.total_rows_estimated).toBe(false);

    // Paging to offset 2 (resetContinuous = false) reuses the cached exact count without re-counting.
    await act(async () => {
      await latest!.loadData(2, 2, null, null, null, false);
    });

    expect(dbService.countTableRows).toHaveBeenCalledTimes(1);
    expect(latest!.dataResult?.total_rows).toBe(51_234);
    expect(latest!.dataResult?.total_rows_estimated).toBe(false);
    expect(latest!.hasMore).toBe(true);
  });
});
