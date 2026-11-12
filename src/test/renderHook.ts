// Minimal renderHook / waitFor (the project does not depend on Testing Library).
import React, { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal renderHook (the project does not depend on Testing Library). */
export function renderHook<P, R>(hook: (props: P) => R, opts?: { initialProps: P }) {
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

export async function waitFor(check: () => void, timeout = 1000) {
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
