import { describe, it, expect } from "vitest";
import { resources } from "../index";

function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj)
    .flatMap(([key, value]) => {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return collectKeys(value as Record<string, unknown>, fullKey);
      }
      return [fullKey];
    })
    .sort();
}

describe("i18n key parity", () => {
  const esNamespaces = Object.keys(resources.es).sort();
  const enNamespaces = Object.keys(resources.en).sort();

  it("should have identical namespaces in es and en", () => {
    expect(enNamespaces).toEqual(esNamespaces);
  });

  for (const ns of esNamespaces) {
    it(`should have identical keys in namespace "${ns}"`, () => {
      const esKeys = collectKeys(resources.es[ns as keyof typeof resources.es] as Record<string, unknown>);
      const enKeys = collectKeys(resources.en[ns as keyof typeof resources.en] as Record<string, unknown>);
      expect(enKeys).toEqual(esKeys);
    });
  }
});
