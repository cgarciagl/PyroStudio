import { describe, expect, it } from "vitest";
import { folderNames, groupByFolder, normalizeFolder } from "../connectionFolders";
import type { SavedConnection } from "../../types/database";

const c = (id: string, name: string, folder?: string): SavedConnection => ({
  id,
  name,
  folder,
  host: "h",
  port: 3306,
  user: "u",
  createdAt: 0,
});

describe("connectionFolders", () => {
  it("normalizes folder names", () => {
    expect(normalizeFolder("  UV  ")).toBe("UV");
    expect(normalizeFolder("Examenes   IDEAS")).toBe("Examenes IDEAS");
    expect(normalizeFolder("")).toBeNull();
    expect(normalizeFolder(undefined)).toBeNull();
  });

  it("groups by folder, named first (alphabetical), ungrouped last, items sorted", () => {
    const groups = groupByFolder([
      c("1", "Planea en UV", "UV"),
      c("2", "local"),
      c("3", "nuevo ingreso uv", " UV"),
      c("4", "ingresodgb", "Examenes IDEAS"),
      c("5", "UPV", "Examenes IDEAS"),
      c("6", "ingreso10", "Examenes IDEAS"),
      c("7", "ingreso2", "Examenes IDEAS"),
    ]);
    expect(groups.map((g) => g.folder)).toEqual(["Examenes IDEAS", "UV", null]);
    expect(groups[0].connections.map((x) => x.name)).toEqual(["ingreso2", "ingreso10", "ingresodgb", "UPV"]);
    expect(groups[1].connections.map((x) => x.id)).toEqual(["3", "1"]);
    expect(folderNames([c("1", "a", "B"), c("2", "b", "A"), c("3", "c")])).toEqual(["A", "B"]);
  });
});
