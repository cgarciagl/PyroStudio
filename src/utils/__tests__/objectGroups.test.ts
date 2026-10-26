import { describe, expect, it } from "vitest";
import { createFolder, deleteFolder, folderOf, getFolders, moveObject, pruneMissing, renameFolder } from "../objectGroups";

describe("objectGroups", () => {
  it("moves objects between folders, one folder at most, without mutating input", () => {
    const g0 = {};
    const g1 = moveObject(g0, "db", "tables", "alumnos", "rolado");
    expect(g0).toEqual({});
    expect(folderOf(g1, "db", "tables", "alumnos")).toBe("rolado");
    const g2 = moveObject(g1, "db", "tables", "alumnos", "planea");
    expect(getFolders(g2, "db", "tables")).toEqual({ rolado: [], planea: ["alumnos"] });
    const g3 = moveObject(g2, "db", "tables", "alumnos", null);
    expect(folderOf(g3, "db", "tables", "alumnos")).toBeNull();
    expect(getFolders(g3, "db", "views")).toEqual({});
  });

  it("creates, renames (merging) and deletes folders", () => {
    let g = createFolder({}, "db", "tables", " nueva ");
    expect(getFolders(g, "db", "tables")).toEqual({ nueva: [] });
    g = moveObject(g, "db", "tables", "t1", "nueva");
    g = moveObject(g, "db", "tables", "t2", "otra");
    g = renameFolder(g, "db", "tables", "nueva", "otra");
    expect(getFolders(g, "db", "tables")).toEqual({ otra: ["t2", "t1"] });
    g = deleteFolder(g, "db", "tables", "otra");
    expect(getFolders(g, "db", "tables")).toEqual({});
  });

  it("prunes objects that no longer exist but keeps empty folders", () => {
    let g = moveObject({}, "db", "tables", "gone", "f");
    g = moveObject(g, "db", "tables", "kept", "f");
    g = pruneMissing(g, "db", "tables", new Set(["kept"]));
    expect(getFolders(g, "db", "tables")).toEqual({ f: ["kept"] });
  });
});
