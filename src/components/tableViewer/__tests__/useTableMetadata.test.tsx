// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal renderHook (the project does not depend on Testing Library). */
function renderHook<P, R>(hook: (props: P) => R, opts?: { initialProps: P }) {
  const result = { current: undefined as unknown as R };
  const host = document.createElement("div");
  const root = createRoot(host);
  const Probe = ({ p }: { p: P }) => {
    result.current = hook(p);
    return null;
  };
  act(() => root.render(React.createElement(Probe, { p: opts?.initialProps as P })));
  return {
    result,
    rerender: (p: P) => act(() => root.render(React.createElement(Probe, { p }))),
  };
}

async function waitFor(check: () => void, timeout = 1000) {
  const start = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (e) {
      if (Date.now() - start > timeout) throw e;
      await act(async () => new Promise((r) => setTimeout(r, 10)));
    }
  }
}
import { useTableMetadata, type TableMetadataSource } from "../useTableMetadata";
import type { ColumnMetadata } from "../../../types/database";

const col = (name: string, key = ""): ColumnMetadata =>
  ({ name, column_key: key } as unknown as ColumnMetadata);

function fakeSource(overrides: Partial<TableMetadataSource> = {}): TableMetadataSource {
  return {
    getTableColumns: vi.fn(async (_db, t) => [col(`${t}_id`, "PRI"), col("name")]),
    getTableInspectorDetails: vi.fn(async () => ({ ddl: "CREATE TABLE x", foreign_keys: [], triggers: [] } as never)),
    analyzeTableIndexes: vi.fn(async () => ({ recommendations: [] } as never)),
    ...overrides,
  };
}

describe("useTableMetadata", () => {
  it("loads columns and derives the primary key", async () => {
    const source = fakeSource();
    const { result } = renderHook(() => useTableMetadata("db", "users", "data", vi.fn(), source));
    await waitFor(() => expect(result.current.columns).toHaveLength(2));
    expect(result.current.primaryKeyColumns).toEqual(["users_id"]);
    expect(source.getTableInspectorDetails).not.toHaveBeenCalled(); // lazy
  });

  it("loads the inspector details only when a tab needs them", async () => {
    const source = fakeSource();
    const { result } = renderHook(() => useTableMetadata("db", "users", "ddl", vi.fn(), source));
    await waitFor(() => expect(result.current.inspectorDetails?.ddl).toBe("CREATE TABLE x"));
    expect(source.analyzeTableIndexes).not.toHaveBeenCalled();
  });

  it("discards a late response for a table that is no longer shown", async () => {
    let releaseOld!: (cols: ColumnMetadata[]) => void;
    const source = fakeSource({
      getTableColumns: vi.fn((_db: string, t: string) =>
        t === "old"
          ? new Promise<ColumnMetadata[]>((r) => (releaseOld = r))
          : Promise.resolve([col("new_col")]),
      ),
    });
    const { result, rerender } = renderHook(
      ({ table }) => useTableMetadata("db", table, "data", vi.fn(), source),
      { initialProps: { table: "old" } },
    );
    rerender({ table: "new" });
    await waitFor(() => expect(result.current.columns[0]?.name).toBe("new_col"));
    await act(async () => releaseOld([col("old_col")]));
    expect(result.current.columns[0]?.name).toBe("new_col");
  });

  it("reports load errors through the injected callback", async () => {
    const onError = vi.fn();
    const source = fakeSource({ getTableColumns: vi.fn(async () => Promise.reject("sin permiso")) });
    renderHook(() => useTableMetadata("db", "users", "data", onError, source));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("No se pudieron cargar las columnas", "sin permiso"));
  });
});
