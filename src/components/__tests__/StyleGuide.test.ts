import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Enforces the minimal visual guide from AGENTS.md (rule 9) and the ban on native dialogs (rule 7).
const componentsDir = path.resolve(__dirname, "..");

const listSources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : listSources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });

const forbidden: [string, RegExp][] = [
  ["gradiente decorativo", /(?<![\w-])bg-gradient-/],
  ["sombra arbitraria", /(?<![\w-])shadow-\[/],
  ["icono pulsante", /(?<![\w-])animate-pulse(?![\w-])/],
  ["escalado en hover", /hover:scale-/],
  ["desenfoque de fondo", /(?<![\w-])backdrop-blur/],
  ["diálogo nativo", /(?<![\w.])(?:window\.)?(?:alert|confirm|prompt)\(/],
];

describe("guía visual", () => {
  const files = listSources(componentsDir);

  it.each(forbidden)("no usa %s", (_name, pattern) => {
    const offenders = files.filter((file) => pattern.test(fs.readFileSync(file, "utf8")));
    expect(offenders.map((f) => path.relative(componentsDir, f))).toEqual([]);
  });
});
