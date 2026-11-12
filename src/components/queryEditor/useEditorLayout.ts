import { useCallback, useEffect, useState } from "react";
import { WIDE_LAYOUT_QUERY, useDockWidth, useIsWideLayout } from "../ui/RightDock";

export type ResultsLayout = "bottom" | "right";
const RESULTS_LAYOUT_KEY = "pyro_query_results_layout";
const RESULTS_LAYOUT_EVENT = "pyro:query-results-layout";
const HEIGHT_KEY = "pyro_query_editor_height";
const WIDTH_KEY = "pyro_query_editor_width";

export const readResultsLayout = (): ResultsLayout => {
  try {
    const saved = localStorage.getItem(RESULTS_LAYOUT_KEY);
    if (saved === "right" || saved === "bottom") return saved;
    // No saved preference: on widescreen monitors results go to the right.
    return window.matchMedia?.(WIDE_LAYOUT_QUERY).matches && window.innerWidth / window.innerHeight >= 1.6
      ? "right"
      : "bottom";
  } catch {
    return "bottom";
  }
};

function readNumber(key: string, min: number, max: number): number | null {
  try {
    const parsed = parseInt(localStorage.getItem(key) || "", 10);
    if (!isNaN(parsed) && parsed >= min && parsed <= max) return parsed;
  } catch {
    /* storage unavailable */
  }
  return null;
}

function store(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable */
  }
}

/** Drag on the window with the right cursor; `onMove` gets the pointer delta. */
function startDrag(e: React.MouseEvent, axis: "x" | "y", onMove: (delta: number) => void) {
  e.preventDefault();
  const start = axis === "x" ? e.clientX : e.clientY;
  const move = (ev: MouseEvent) => onMove((axis === "x" ? ev.clientX : ev.clientY) - start);
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

/**
 * Layout of the query editor: editor height/width (persisted), results below or beside
 * (shared by every tab) and the width of the docked side panels.
 */
export function useEditorLayout() {
  const [editorHeight, setEditorHeight] = useState<number>(() => readNumber(HEIGHT_KEY, 80, 900) ?? 190);
  const [editorWidth, setEditorWidth] = useState<number>(
    () => readNumber(WIDTH_KEY, 200, Number.MAX_SAFE_INTEGER) ?? Math.round(window.innerWidth * 0.4),
  );
  const [resultsLayout, setResultsLayout] = useState<ResultsLayout>(readResultsLayout);
  const isWideLayout = useIsWideLayout();
  const [dockWidth, setDockWidth] = useDockWidth("pyro_editor_dock_width", 560);

  useEffect(() => {
    const sync = () => setResultsLayout(readResultsLayout());
    window.addEventListener(RESULTS_LAYOUT_EVENT, sync);
    return () => window.removeEventListener(RESULTS_LAYOUT_EVENT, sync);
  }, []);

  const toggleResultsLayout = () => {
    const next: ResultsLayout = resultsLayout === "right" ? "bottom" : "right";
    try {
      localStorage.setItem(RESULTS_LAYOUT_KEY, next);
    } catch {
      /* storage unavailable */
    }
    setResultsLayout(next);
    window.dispatchEvent(new Event(RESULTS_LAYOUT_EVENT));
  };

  const handleSplitterMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const startHeight = editorHeight;
      startDrag(e, "y", (dy) => {
        const h = Math.max(80, Math.min(window.innerHeight - 200, startHeight + dy));
        setEditorHeight(h);
        store(HEIGHT_KEY, h);
      });
    },
    [editorHeight],
  );

  const handleVerticalSplitterMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const startWidth = editorWidth;
      startDrag(e, "x", (dx) => {
        const w = Math.max(200, Math.min(window.innerWidth - 300, startWidth + dx));
        setEditorWidth(w);
        store(WIDTH_KEY, w);
      });
    },
    [editorWidth],
  );

  return {
    editorHeight,
    editorWidth,
    resultsLayout,
    isSideBySide: resultsLayout === "right",
    toggleResultsLayout,
    isWideLayout,
    dockWidth,
    setDockWidth,
    handleSplitterMouseDown,
    handleVerticalSplitterMouseDown,
  };
}
