import { describe, expect, it } from "vitest";
import { redactValue } from "../DiagnosticsModal";

describe("informe de diagnóstico", () => {
  it("oculta hosts y deja solo la última carpeta de las rutas", () => {
    expect(redactValue("db.empresa.com:3306", "host")).toBe("[oculto]");
    expect(redactValue(String.raw`C:\Users\ana\AppData\Roaming\PyroStudio`, "path")).toBe("…/PyroStudio");
    expect(redactValue("/home/ana/proyectos/ws", "path")).toBe("…/ws");
  });
});
