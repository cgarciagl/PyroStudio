// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { renderHook } from "../../../test/renderHook";
import { useElapsedTimer } from "../useElapsedTimer";
import { useSavedQueryLink } from "../useSavedQueryLink";
import { favoritesStorage } from "../../../services/favoritesStorage";

describe("useElapsedTimer", () => {
  it("counts while running and freezes at the real duration", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useElapsedTimer());
    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(150);
    let final = 0;
    act(() => {
      result.current.stop();
      final = result.current.finish();
    });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.elapsedMs).toBe(final);
    vi.useRealTimers();
  });
});

describe("useSavedQueryLink", () => {
  beforeEach(() => localStorage.clear());

  it("is dirty only when the SQL differs from the saved one (ignoring outer spaces)", () => {
    const [fav] = favoritesStorage.saveFavorite({ title: "Q", category: "General", sql: "SELECT 1" });
    const opts = (query: string) => ({
      savedQueryId: fav.id, query, initialQuery: "SELECT 1", onSaveAsNew: vi.fn(), onStatus: vi.fn(),
    });
    const { result, rerender } = renderHook((q: string) => useSavedQueryLink(opts(q)), { initialProps: "  SELECT 1 " });
    expect(result.current.isDirty).toBe(false);
    rerender("SELECT 2");
    expect(result.current.isDirty).toBe(true);
  });

  it("asks where to save when the tab is not linked to a saved query", async () => {
    const onSaveAsNew = vi.fn();
    const { result } = renderHook(() =>
      useSavedQueryLink({ query: "SELECT 9", initialQuery: "", onSaveAsNew, onStatus: vi.fn() }),
    );
    await act(() => result.current.saveCurrentQuery());
    expect(onSaveAsNew).toHaveBeenCalledWith("SELECT 9");
  });
});
