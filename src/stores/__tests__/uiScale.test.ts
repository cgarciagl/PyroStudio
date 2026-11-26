import { describe, expect, it } from "vitest";
import { MAX_UI_SCALE, MIN_UI_SCALE, usePreferenceStore } from "../preferenceStore";

describe("interface scale", () => {
  it("zooms in steps of 10%, clamps to the range and resets to 100%", () => {
    const store = usePreferenceStore.getState();
    store.setUiScale(100);
    store.zoomUi(1);
    expect(usePreferenceStore.getState().uiScale).toBe(110);
    store.zoomUi(-1);
    store.zoomUi(-1);
    expect(usePreferenceStore.getState().uiScale).toBe(90);
    store.setUiScale(999);
    expect(usePreferenceStore.getState().uiScale).toBe(MAX_UI_SCALE);
    store.setUiScale(1);
    expect(usePreferenceStore.getState().uiScale).toBe(MIN_UI_SCALE);
    store.zoomUi("reset");
    expect(usePreferenceStore.getState().uiScale).toBe(100);
  });
});
