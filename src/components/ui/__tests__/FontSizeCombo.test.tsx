// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FontSizeCombo } from "../FontSizeCombo";
import { usePreferenceStore } from "../../../stores/preferenceStore";
import { fontZoomStep } from "../../../utils/fontZoom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Same wiring as Settings: the combo reads the editor size from the store. */
function EditorSizeControl() {
  const size = usePreferenceStore((s) => s.editorFontSize);
  const setSize = usePreferenceStore((s) => s.setEditorFontSize);
  return <FontSizeCombo value={size} presets={[12, 14, 16]} defaultSize={13} onChange={setSize} />;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("FontSizeCombo", () => {
  it("follows Ctrl + / Ctrl - zoom from the editor and accepts typed sizes", async () => {
    usePreferenceStore.getState().setEditorFontSize(14);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<EditorSizeControl />));
    const input = host.querySelector("input")!;
    expect(input.value).toBe("14");

    // What the editor's keydown handler does on Ctrl + "+".
    const step = fontZoomStep({ key: "+", code: "", ctrlKey: true, metaKey: false, altKey: false });
    await act(async () => usePreferenceStore.getState().zoomEditorFont(step!));
    expect(input.value).toBe("15");

    await act(async () => usePreferenceStore.getState().zoomEditorFont(-1));
    expect(input.value).toBe("14");

    // Out-of-range typed value is clamped on blur.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "99");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(usePreferenceStore.getState().editorFontSize).toBe(24);
    expect(input.value).toBe("24");
  });

  it("closes the preset menu on Escape without propagating to a parent modal and ignores empty input when min is 0", async () => {
    let parentEscapes = 0;
    let changedTo: number | null = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () =>
      root!.render(
        <div onKeyDown={(e) => { if (e.key === "Escape") parentEscapes += 1; }}>
          <FontSizeCombo
            value={14}
            presets={[12, 14, 16]}
            defaultSize={14}
            min={0}
            max={24}
            onChange={(v) => { changedTo = v; }}
          />
        </div>,
      ),
    );

    const input = host.querySelector("input")!;
    const toggle = host.querySelector("button[aria-haspopup='listbox']") as HTMLButtonElement;

    // Clearing the input when min=0 must not immediately emit 0.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(changedTo).toBeNull();

    // Open dropdown, then press Escape: closes dropdown, restores text, does not bubble Escape.
    await act(async () => toggle.click());
    expect(host.querySelector("[role='listbox']")).not.toBeNull();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector("[role='listbox']")).toBeNull();
    expect(input.value).toBe("14");
    expect(parentEscapes).toBe(0);
  });
});
