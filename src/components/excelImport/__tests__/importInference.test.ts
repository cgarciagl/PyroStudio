import { describe, it, expect } from "vitest";
import {
  buildAutoMappings,
  buildImportMode,
  defaultTableName,
  inferColumnTypes,
  initialNewTableColumns,
  toggleGeneratedId,
} from "../importInference";

describe("import inference", () => {
  it("infers column types from the preview", () => {
    const cols = inferColumnTypes(
      ["Nombre", "Edad", "Saldo", "Alta", "Activo"],
      [["Ana", 30, "10.5", "2024-01-02", "true"], ["Luis", 41, "3", "2024-02-03", "false"]],
    );
    expect(cols.map((c) => c.data_type)).toEqual(["VARCHAR(255)", "INT", "DOUBLE", "DATETIME", "TINYINT(1)"]);
    expect(cols[0].name).toBe("nombre");
  });

  it("maps headers ignoring case, spaces and accents", () => {
    const m = buildAutoMappings(["Código Postal", "extra"], [{ name: "codigopostal" }]);
    expect(m[0]).toMatchObject({ db_column: "codigopostal", ignored: false });
    expect(m[1]).toMatchObject({ db_column: "", ignored: true });
  });

  it("adds an id key only when the file has none", () => {
    expect(initialNewTableColumns(inferColumnTypes(["nombre"], [["a"]]), true).generatedIdName).toBe("id");
    expect(initialNewTableColumns(inferColumnTypes(["id", "nombre"], [[1, "a"]]), true).generatedIdName).toBeNull();
  });

  it("restores the file's own key after turning the generated id off", () => {
    const base = initialNewTableColumns(inferColumnTypes(["id", "x"], [[1, "a"]]), false);
    expect(base.columns[0].is_primary_key).toBe(true);
    const on = toggleGeneratedId(base, true);
    expect(on.generatedIdName).toBe("id_1");
    expect(on.columns.find((c) => c.name === "id")?.is_primary_key).toBe(false);
    const off = toggleGeneratedId(on, false);
    expect(off.columns).toEqual(base.columns);
  });

  it("builds the backend mode with keys only for keyed modes", () => {
    expect(buildImportMode("append", "id", "ID")).toEqual({ type: "Append" });
    expect(buildImportMode("append_update", "id", "ID")).toEqual({
      type: "AppendUpdate",
      config: { primary_key_db: "id", primary_key_excel: "ID" },
    });
  });

  it("suggests a table name from the sheet or the file", () => {
    expect(defaultTableName("C:\\datos\\Ventas 2024.xlsx")).toBe("ventas_2024");
    expect(defaultTableName("/x/a.csv", "Hoja 1")).toBe("hoja_1");
  });
});
