import { describe, it, expect } from "vitest";
import { buildGenerationPrompt } from "../SqlCopilotDrawer";

describe("buildGenerationPrompt", () => {
  it("sends the request alone when there is no base SQL", () => {
    expect(buildGenerationPrompt("  ventas por mes  ")).toBe("ventas por mes");
    expect(buildGenerationPrompt("ventas por mes", "   ")).toBe("ventas por mes");
  });

  it("attaches the SQL to refine as the starting point", () => {
    const prompt = buildGenerationPrompt("ordena por total", "SELECT * FROM ventas;");
    expect(prompt.startsWith("ordena por total")).toBe(true);
    expect(prompt).toContain("punto de partida");
    expect(prompt.endsWith("SELECT * FROM ventas;")).toBe(true);
  });
});
