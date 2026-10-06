import { describe, it, expect } from "vitest";
import { diagnoseSqlError } from "../sqlDiagnostics";

describe("sqlDiagnostics", () => {
  it("should diagnose syntax error (1064 / 42000)", () => {
    const rawError = "Error 1064 (42000): You have an error in your SQL syntax; check the manual near 'SELEC * FROM users'";
    const res = diagnoseSqlError(rawError);

    expect(res.error_code).toBe(1064);
    expect(res.sqlstate).toBe("42000");
    expect(res.category).toBe("Sintaxis SQL (Error 1064)");
    expect(res.suggested_action).toContain("Revisa la sintaxis");
    expect(res.original_error).toBe(rawError);
  });

  it("should diagnose missing table error (1146 / 42S02)", () => {
    const rawError = "Error 1146 (42S02): Table 'mydb.non_existent_table' doesn't exist";
    const res = diagnoseSqlError(rawError);

    expect(res.error_code).toBe(1146);
    expect(res.sqlstate).toBe("42S02");
    expect(res.category).toBe("Objeto no Encontrado (Error 1146)");
    expect(res.suggested_action).toContain("Verifica que el nombre de la tabla");
    expect(res.explanation).toContain("esquema seleccionado");
  });

  it("should diagnose unknown column error (1054 / 42S22)", () => {
    const rawError = "Error 1054 (42S22): Unknown column 'invalid_col' in 'field list'";
    const res = diagnoseSqlError(rawError);

    expect(res.error_code).toBe(1054);
    expect(res.sqlstate).toBe("42S22");
    expect(res.category).toBe("Columna Desconocida (Error 1054)");
    expect(res.suggested_action).toContain("Verifica los nombres de las columnas");
  });

  it("should diagnose duplicate key error (1062 / 23000)", () => {
    const rawError = "Error 1062 (23000): Duplicate entry '100' for key 'PRIMARY'";
    const res = diagnoseSqlError(rawError);

    expect(res.error_code).toBe(1062);
    expect(res.sqlstate).toBe("23000");
    expect(res.category).toBe("Violación de Clave Única (Error 1062)");
    expect(res.suggested_action).toContain("Verifica si el registro ya existe");
  });

  it("should diagnose foreign key failure on delete (1451 / 23000)", () => {
    const rawError = "Error 1451 (23000): Cannot delete or update a parent row: a foreign key constraint fails";
    const res = diagnoseSqlError(rawError);

    expect(res.error_code).toBe(1451);
    expect(res.category).toBe("Restricción de Clave Foránea (Error 1451)");
    expect(res.suggested_action).toContain("registros hijos");
  });

  it("should diagnose foreign key failure on insert (1452 / 23000)", () => {
    const rawError = "Error 1452 (23000): Cannot add or update a child row: a foreign key constraint fails";
    const res = diagnoseSqlError(rawError);

    expect(res.error_code).toBe(1452);
    expect(res.category).toBe("Restricción de Clave Foránea (Error 1452)");
    expect(res.suggested_action).toContain("tabla padre referenciada");
  });

  it("should diagnose lock wait timeout (1205 / HY000)", () => {
    const rawError = "Error 1205 (HY000): Lock wait timeout exceeded; try restarting transaction";
    const res = diagnoseSqlError(rawError);

    expect(res.error_code).toBe(1205);
    expect(res.category).toBe("Tiempo de Espera de Bloqueo Excedido (Error 1205)");
  });

  it("should diagnose deadlock (1213 / 40001)", () => {
    const rawError = "Error 1213 (40001): Deadlock found when trying to get lock; try restarting transaction";
    const res = diagnoseSqlError(rawError);

    expect(res.error_code).toBe(1213);
    expect(res.category).toBe("Interbloqueo (Deadlock 1213)");
    expect(res.suggested_action).toContain("Reintenta la transacción");
  });

  it("should handle unknown / unclassified error gracefully without hiding raw error", () => {
    const rawError = "Custom backend driver crashed or unexpected network packet";
    const res = diagnoseSqlError(rawError);

    expect(res.error_code).toBeUndefined();
    expect(res.original_error).toBe(rawError);
    expect(res.category).toBe("Error de Ejecución SQL");
    expect(res.suggested_action).toBeDefined();
  });
});
