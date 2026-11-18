import { describe, it, expect } from "vitest";
import {
  buildQueryExportDefaultName,
  buildTableExportDefaultName,
  isGenericQueryTabTitle,
  sanitizeFilenameSegment,
} from "../exportFilename";

describe("exportFilename", () => {
  const fixedDate = new Date(2026, 10, 17, 15, 23, 45); // 2026-11-17 15:23:45 local

  it("uses custom query title with local date/time suffix", () => {
    expect(buildQueryExportDefaultName("Reporte de Ventas", "prod_db", fixedDate)).toBe(
      "Reporte de Ventas_2026-11-17_15-23-45",
    );
  });

  it("strips .sql extension and invalid filesystem characters from title", () => {
    expect(buildQueryExportDefaultName("Ventas: Q4 / 2026?.sql", "prod_db", fixedDate)).toBe(
      "Ventas_ Q4 _ 2026_2026-11-17_15-23-45",
    );
    expect(sanitizeFilenameSegment("  ...my/query*name...  ")).toBe("my_query_name");
  });

  it("falls back to consulta_<database>_<timestamp> for generic tab titles", () => {
    expect(buildQueryExportDefaultName("Consulta 1", "ventas_db", fixedDate)).toBe(
      "consulta_ventas_db_2026-11-17_15-23-45",
    );
    expect(buildQueryExportDefaultName("Consulta 2 (Copia)", "ventas_db", fixedDate)).toBe(
      "consulta_ventas_db_2026-11-17_15-23-45",
    );
    expect(isGenericQueryTabTitle("Consulta · ventas_db")).toBe(true);
    expect(buildQueryExportDefaultName(undefined, "", fixedDate)).toBe(
      "consulta_2026-11-17_15-23-45",
    );
  });

  it("builds table export filename with local date/time suffix", () => {
    expect(buildTableExportDefaultName("usuarios", fixedDate)).toBe(
      "usuarios_2026-11-17_15-23-45",
    );
  });
});
