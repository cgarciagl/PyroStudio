import { describe, expect, it } from "vitest";
import { confirmationMatches, requiredConfirmationText } from "../SafeExecutionModal";

describe("confirmación reforzada en producción", () => {
  it("exige el nombre de la base en producción", () => {
    expect(requiredConfirmationText(true, "ventas")).toBe("ventas");
  });

  it("usa CONFIRMAR fuera de producción o sin base activa", () => {
    expect(requiredConfirmationText(false, "ventas")).toBe("CONFIRMAR");
    expect(requiredConfirmationText(true, undefined)).toBe("CONFIRMAR");
    expect(requiredConfirmationText(true, "  ")).toBe("CONFIRMAR");
  });

  it("compara el nombre de la base respetando mayúsculas", () => {
    expect(confirmationMatches("ventas", "ventas")).toBe(true);
    expect(confirmationMatches(" ventas ", "ventas")).toBe(true);
    expect(confirmationMatches("Ventas", "ventas")).toBe(false);
    expect(confirmationMatches("confirmar", "CONFIRMAR")).toBe(true);
  });
});
