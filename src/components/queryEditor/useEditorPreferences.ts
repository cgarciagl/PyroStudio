import { useMemo } from "react";
import type { BasicSetupOptions } from "@uiw/react-codemirror";
import { usePreferenceStore } from "../../stores/preferenceStore";

/**
 * CodeMirror props driven by the editor preferences (font size, line numbers,
 * autocomplete) so every SQL editor honours what the user picked in Settings.
 */
export function useEditorPreferences() {
  const fontSize = usePreferenceStore((s) => s.editorFontSize);
  const lineNumbers = usePreferenceStore((s) => s.editorLineNumbers);
  const autocompletion = usePreferenceStore((s) => s.editorAutocomplete);

  return useMemo(
    () => ({
      style: { fontSize: `${fontSize}px` },
      basicSetup: {
        lineNumbers,
        autocompletion,
        foldGutter: true,
        highlightActiveLine: true,
      } satisfies BasicSetupOptions,
    }),
    [fontSize, lineNumbers, autocompletion],
  );
}
