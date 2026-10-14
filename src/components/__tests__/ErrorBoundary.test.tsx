import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { ErrorBoundary } from "../ErrorBoundary";

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    const html = renderToString(
      <ErrorBoundary>
        <div data-testid="child">Contenido sin error</div>
      </ErrorBoundary>
    );
    expect(html).toContain("Contenido sin error");
  });

  it("updates state correctly with getDerivedStateFromError", () => {
    const error = new Error("Test error message");
    const nextState = ErrorBoundary.getDerivedStateFromError(error);
    expect(nextState.hasError).toBe(true);
    expect(nextState.error).toBe(error);
  });
});
