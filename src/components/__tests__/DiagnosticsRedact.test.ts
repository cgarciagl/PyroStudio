import { describe, expect, it } from "vitest";
import { redactValue } from "../DiagnosticsModal";

describe("informe de diagnóstico", () => {
  it("oculta hosts y deja solo la última carpeta de las rutas", () => {
    expect(redactValue("db.empresa.com:3306", "host")).toBe("[oculto]");
    expect(redactValue(String.raw`C:\Users\ana\AppData\Roaming\PyroStudio`, "path")).toBe("…/PyroStudio");
    expect(redactValue("/home/ana/proyectos/ws", "path")).toBe("…/ws");
  });
});

describe("log reciente", () => {
  it("se queda solo con errores y avisos, los más nuevos al final", async () => {
    const { problemLines } = await import("../DiagnosticsModal");
    const lines = [
      "2026-10-30T10:00:00Z  INFO pyro: inicio",
      "2026-10-30T10:00:01Z  WARN pyro: lento",
      "2026-10-30T10:00:02Z ERROR pyro: falló",
    ];
    expect(problemLines(lines)).toEqual(lines.slice(1));
    expect(problemLines(lines, 1)).toEqual([lines[2]]);
  });
});
