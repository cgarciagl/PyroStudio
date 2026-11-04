import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const readComponent = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

describe("contratos de accesibilidad de componentes críticos", () => {
  it("expone el diálogo con nombre y descripción accesibles", () => {
    const source = readComponent("ui/Modal.tsx");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("aria-labelledby={titleId}");
    expect(source).toContain("aria-describedby=");
    expect(source).toContain("describedBy?: string");
  });

  it("contiene el foco y lo restaura solo si el origen sigue disponible", () => {
    const source = readComponent("ui/Modal.tsx");
    expect(source).toContain('e.key !== "Tab"');
    expect(source).toContain("e.currentTarget.contains(document.activeElement)");
    expect(source).toContain("previousFocusRef.current?.isConnected");
    expect(source).toContain('e.key === "Escape" && closeOnEscape');
  });

  it("asocia el mensaje de confirmación al diálogo y anuncia su actualización", () => {
    const source = readComponent("ConfirmModal.tsx");
    expect(source).toContain("describedBy={messageId}");
    expect(source).toContain('aria-live={variant === "danger" ? "assertive" : "polite"}');
    expect(source).toContain("aria-atomic=\"true\"");
  });

  it("publica estado de conexión y nombres accesibles para reconexión/latencia", () => {
    const source = readComponent("StatusFooter.tsx");
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("aria-busy={isReconnecting}");
    expect(source).toContain("Midiendo latencia");
  });


  it("hace accesible el diálogo de configuración y su navegación por teclado", () => {
    const source = readComponent("SettingsModal.tsx");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("aria-labelledby={titleId}");
    expect(source).toContain("aria-describedby={descriptionId}");
    expect(source).toContain('aria-label="Secciones de configuración"');
    expect(source).toContain('aria-current={activeTab === "appearance" ? "page" : undefined}');
    expect(source).toContain("previousFocusRef.current?.isConnected");
    expect(source).toContain('e.key !== "Tab"');
    expect(source).toContain('e.key === "Escape"');
  });
});
