// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "../Modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const render = async (ui: React.ReactElement) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(ui));
  // Deja correr el requestAnimationFrame del modal.
  await act(async () => new Promise((r) => setTimeout(r, 50)));
};

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("Modal: foco inicial", () => {
  it("respeta autoFocus de un hijo en lugar de mover el foco a la X", async () => {
    await render(
      <Modal isOpen onClose={() => {}} title="Renombrar">
        <input data-testid="name" autoFocus />
      </Modal>,
    );
    expect((document.activeElement as HTMLElement).dataset.testid).toBe("name");
  });

  it("respeta autoFocus en el pie (botón de confirmar)", async () => {
    await render(
      <Modal isOpen onClose={() => {}} title="¿Eliminar?" footer={<button data-testid="ok" autoFocus>OK</button>}>
        <p>Mensaje</p>
      </Modal>,
    );
    expect((document.activeElement as HTMLElement).dataset.testid).toBe("ok");
  });

  it("sin autoFocus prioriza el cuerpo sobre el botón de cerrar", async () => {
    await render(
      <Modal isOpen onClose={() => {}} title="Form">
        <input data-testid="first" />
      </Modal>,
    );
    expect((document.activeElement as HTMLElement).dataset.testid).toBe("first");
  });
});
