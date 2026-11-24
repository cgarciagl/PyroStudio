import { describe, it, expect } from "vitest";
import i18n, { resources, resolveLanguage } from "../index";

function collectEntries(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, collectEntries(value as Record<string, unknown>, fullKey));
    } else {
      out[fullKey] = value;
    }
  }
  return out;
}

function extractPlaceholders(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const matches = value.match(/\{\{\s*([^}\s]+)\s*\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/[{}]/g, "").trim()))].sort();
}

describe("i18n quality and parity", () => {
  const esNamespaces = Object.keys(resources.es).sort();
  const enNamespaces = Object.keys(resources.en).sort();

  it("should have identical namespaces in es and en", () => {
    expect(enNamespaces).toEqual(esNamespaces);
  });

  it("should register all namespaces in i18next config", () => {
    const configured = Array.isArray(i18n.options.ns)
      ? [...i18n.options.ns].sort()
      : [String(i18n.options.ns)];
    expect(configured).toEqual(esNamespaces);
  });

  it("should resolve explicit languages consistently", () => {
    expect(resolveLanguage("es")).toBe("es");
    expect(resolveLanguage("en")).toBe("en");
  });

  for (const ns of esNamespaces) {
    it(`should have identical keys, non-empty values, and matching placeholders in "${ns}"`, () => {
      const esEntries = collectEntries(resources.es[ns as keyof typeof resources.es] as Record<string, unknown>);
      const enEntries = collectEntries(resources.en[ns as keyof typeof resources.en] as Record<string, unknown>);

      const esKeys = Object.keys(esEntries).sort();
      const enKeys = Object.keys(enEntries).sort();
      expect(enKeys).toEqual(esKeys);

      for (const key of esKeys) {
        const esVal = esEntries[key];
        const enVal = enEntries[key];
        if (typeof esVal === "string") {
          expect(esVal.trim().length, `Empty es value at ${ns}:${key}`).toBeGreaterThan(0);
        }
        if (typeof enVal === "string") {
          expect(enVal.trim().length, `Empty en value at ${ns}:${key}`).toBeGreaterThan(0);
        }
        expect(
          extractPlaceholders(enVal),
          `Placeholder mismatch at ${ns}:${key}`,
        ).toEqual(extractPlaceholders(esVal));
      }
    });
  }
});
