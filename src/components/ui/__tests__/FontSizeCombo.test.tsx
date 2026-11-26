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
});
