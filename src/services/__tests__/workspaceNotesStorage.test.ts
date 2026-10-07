import { describe, it, expect, beforeEach } from "vitest";
import { workspaceNotesStorage } from "../workspaceNotesStorage";

describe("workspaceNotesStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should return empty array initially", () => {
    expect(workspaceNotesStorage.getNotes("shop_db")).toEqual([]);
  });

  it("should add and retrieve notes", () => {
    const note = workspaceNotesStorage.saveNote(
      "shop_db",
      "column",
      "orders.customer_id",
      "Debe usarse para joins con customers.id. No modificar.",
    );

    expect(note.id).toBeDefined();
    expect(note.note_text).toContain("Debe usarse para joins");

    const notes = workspaceNotesStorage.getNotes("shop_db");
    expect(notes.length).toBe(1);
    expect(notes[0].target_name).toBe("orders.customer_id");
  });

  it("should update existing note for same target", () => {
    workspaceNotesStorage.saveNote(
      "shop_db",
      "table",
      "users",
      "Versión 1",
    );

    workspaceNotesStorage.saveNote(
      "shop_db",
      "table",
      "users",
      "Versión 2 actualizada",
    );

    const notes = workspaceNotesStorage.getNotes("shop_db");
    expect(notes.length).toBe(1);
    expect(notes[0].note_text).toBe("Versión 2 actualizada");
  });

  it("should delete note by id or empty text", () => {
    const note = workspaceNotesStorage.saveNote(
      "shop_db",
      "database",
      "shop_db",
      "Base de datos principal de ecommerce",
    );

    expect(workspaceNotesStorage.getNotes("shop_db").length).toBe(1);

    workspaceNotesStorage.deleteNote(note.id);
    expect(workspaceNotesStorage.getNotes("shop_db").length).toBe(0);
  });
});
