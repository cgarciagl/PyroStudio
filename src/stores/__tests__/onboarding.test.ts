import { describe, it, expect, beforeEach } from "vitest";
import { usePreferenceStore } from "../preferenceStore";
import { useUIStore } from "../uiStore";

describe("onboarding", () => {
  beforeEach(() => {
    localStorage.clear();
    usePreferenceStore.getState().setOnboardingCompleted(false);
    useUIStore.getState().closeOnboarding();
  });

  it("persists that the introduction was completed or skipped", () => {
    usePreferenceStore.getState().setOnboardingCompleted(true);
    expect(usePreferenceStore.getState().onboardingCompleted).toBe(true);
    expect(JSON.parse(localStorage.getItem("pyro_preferences_v1") || "{}").onboardingCompleted).toBe(true);
  });

  it("can be reopened from preferences after completion", () => {
    usePreferenceStore.getState().setOnboardingCompleted(true);
    useUIStore.getState().openOnboarding();
    expect(useUIStore.getState().isOnboardingOpen).toBe(true);
    useUIStore.getState().closeOnboarding();
    expect(useUIStore.getState().isOnboardingOpen).toBe(false);
  });
});
