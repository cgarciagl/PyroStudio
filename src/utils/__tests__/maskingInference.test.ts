import { describe, expect, it } from "vitest";
import {
  identifierWords,
  inferMaskingStrategy,
  suggestRulesForTable,
  validateMaskingProfile,
} from "../maskingInference";

const strategy = (col: string, type = "varchar(100)", table = "t") => inferMaskingStrategy(col, type, table)?.strategy ?? null;

describe("inferMaskingStrategy", () => {
  it("splits identifiers in snake, camel and accented forms", () => {
    expect(identifierWords("fechaNacimiento")).toEqual(["fecha", "nacimiento"]);
    expect(identifierWords("Teléfono_Móvil")).toEqual(["telefono", "movil"]);
  });

  it("detects the sensitive columns named in the roadmap", () => {
    expect(strategy("email")).toBe("email_synthetic");
    expect(strategy("correo_electronico")).toBe("email_synthetic");
    expect(strategy("phone")).toBe("phone_digits");
    expect(strategy("telefono")).toBe("phone_digits");
    expect(strategy("celular", "bigint")).toBe("phone_digits");
    expect(strategy("ssn")).toBe("digits_zero");
    expect(strategy("dni")).toBe("digits_zero");
    expect(strategy("curp")).toBe("digits_zero");
    expect(strategy("tarjeta")).toBe("card_mask");
    expect(strategy("credit_card")).toBe("card_mask");
    expect(strategy("birth_date", "date")).toBe("date_shift");
    expect(strategy("fecha_nacimiento", "datetime")).toBe("date_shift");
    expect(strategy("first_name")).toBe("first_name");
    expect(strategy("apellido_paterno")).toBe("last_name");
    expect(strategy("password_hash")).toBe("hash");
    expect(inferMaskingStrategy("direccion", "text")?.fixedValue).toBe("REDACTADO");
  });

  it("ignores metadata about personal data and incompatible types", () => {
    expect(strategy("email_verified", "tinyint(1)")).toBeNull();
    expect(strategy("email_verified_at", "timestamp")).toBeNull();
    expect(strategy("phone_count", "int")).toBeNull();
    expect(strategy("cliente_id", "int")).toBeNull();
    expect(strategy("birth_date", "tinyint(1)")).toBeNull();
    expect(strategy("email", "datetime")).toBeNull();
    expect(strategy("hotel")).toBeNull();
    expect(strategy("zip")).toBeNull();
  });

  it("treats a generic name column as personal only in person tables", () => {
    expect(strategy("nombre", "varchar(80)", "clientes")).toBe("full_name");
    expect(strategy("name", "varchar(80)", "users")).toBe("full_name");
    expect(strategy("nombre", "varchar(80)", "productos")).toBeNull();
  });

  it("builds rules for a whole table", () => {
    const rules = suggestRulesForTable("clientes", [
      { name: "id", data_type: "int", column_type: "int(11)" },
      { name: "nombre", data_type: "varchar", column_type: "varchar(80)" },
      { name: "email", data_type: "varchar", column_type: "varchar(120)" },
      { name: "creado", data_type: "datetime", column_type: "datetime" },
    ]);
    expect(rules.map((r) => `${r.column}:${r.strategy}`)).toEqual(["nombre:full_name", "email:email_synthetic"]);
  });
});

describe("validateMaskingProfile", () => {
  it("requires a name and rejects duplicates and bad parameters", () => {
    const issues = validateMaskingProfile({
      name: " ",
      rules: [
        { table: "c", column: "email", strategy: "hash" },
        { table: "C", column: "EMAIL", strategy: "hash" },
        { table: "c", column: "nac", strategy: "date_shift", shiftDays: 0 },
      ],
    });
    const errors = issues.filter((i) => i.level === "error").map((i) => i.message);
    expect(errors).toHaveLength(3);
  });

  it("warns when a unique column would get a strategy that repeats values", () => {
    const issues = validateMaskingProfile(
      { name: "Perfil", rules: [{ table: "c", column: "email", strategy: "email_partial" }, { table: "c", column: "rfc", strategy: "hash" }] },
      { c: [{ name: "email", column_key: "UNI" }, { name: "rfc", column_key: "UNI" }] },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warning");
    expect(issues[0].message).toContain("c.email");
  });

  it("accepts a valid profile", () => {
    expect(
      validateMaskingProfile({ name: "Dev", rules: [{ table: "c", column: "nac", strategy: "date_shift", shiftDays: 15 }] }),
    ).toEqual([]);
  });
});
