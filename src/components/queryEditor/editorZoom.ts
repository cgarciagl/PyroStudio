import { EditorView, Prec } from "@uiw/react-codemirror";
import { usePreferenceStore } from "../../stores/preferenceStore";
import { fontZoomStep } from "../../utils/fontZoom";

/**
 * Ctrl/Cmd + / - / 0 inside a SQL editor changes the editor font size, which
 * is saved in the preferences and shared by every editor.
 */
export const editorZoomExtension = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event) {
      const step = fontZoomStep(event);
      if (step === null) return false;
      event.preventDefault();
      usePreferenceStore.getState().zoomEditorFont(step);
      return true;
    },
  }),
);
