import { describe, expect, it, vi } from "vitest";
import { DB_TOOL_DEFS, buildDbTools, groupDbTools } from "../dbTools";

describe("dbTools", () => {
  it("drops tools without an action and keeps catalogue order", () => {
    const er = vi.fn();
    const tools = buildDbTools({ reports: vi.fn(), erDiagram: er, dashboard: undefined });
    expect(tools.map((t) => t.id)).toEqual(["erDiagram", "reports"]);
    tools[0].run("shop");
    expect(er).toHaveBeenCalledWith("shop");
  });

  it("groups tools without empty groups", () => {
    const tools = buildDbTools({ health: vi.fn(), agent: vi.fn(), reports: vi.fn() });
    expect(groupDbTools(tools).map((g) => g.map((t) => t.id))).toEqual([["health"], ["agent", "reports"]]);
  });

  it("has unique ids and labels", () => {
    expect(new Set(DB_TOOL_DEFS.map((d) => d.id)).size).toBe(DB_TOOL_DEFS.length);
    expect(new Set(DB_TOOL_DEFS.map((d) => d.label)).size).toBe(DB_TOOL_DEFS.length);
  });
});
