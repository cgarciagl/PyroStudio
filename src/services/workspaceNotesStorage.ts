import type { DatabaseNote } from "../types/database";

const NOTES_STORAGE_KEY = "pyro_workspace_notes_v1";

export const workspaceNotesStorage = {
  getNotes(database: string): DatabaseNote[] {
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY);
      if (!raw) return [];
      const all: DatabaseNote[] = JSON.parse(raw);
      return all.filter((n) => n.database.toLowerCase() === database.toLowerCase());
    } catch {
      return [];
    }
  },

  getNote(database: string, targetType: string, targetName: string): DatabaseNote | undefined {
    const notes = this.getNotes(database);
    return notes.find(
      (n) =>
        n.target_type === targetType &&
        n.target_name.toLowerCase() === targetName.toLowerCase(),
    );
  },

  saveNote(
    database: string,
    targetType: "database" | "table" | "column" | "query",
    targetName: string,
    noteText: string,
  ): DatabaseNote {
    const all = this.getAllNotes();
    const existingIdx = all.findIndex(
      (n) =>
        n.database.toLowerCase() === database.toLowerCase() &&
        n.target_type === targetType &&
        n.target_name.toLowerCase() === targetName.toLowerCase(),
    );

    const updatedNote: DatabaseNote = {
      id: existingIdx !== -1 ? all[existingIdx].id : `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      database,
      target_type: targetType,
      target_name: targetName,
      note_text: noteText,
      updated_at: new Date().toISOString(),
    };

    if (existingIdx !== -1) {
      if (!noteText.trim()) {
        all.splice(existingIdx, 1);
      } else {
        all[existingIdx] = updatedNote;
      }
    } else if (noteText.trim()) {
      all.push(updatedNote);
    }

    try {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(all));
    } catch {
      // ignore
    }

    return updatedNote;
  },

  deleteNote(id: string): void {
    const all = this.getAllNotes().filter((n) => n.id !== id);
    try {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(all));
    } catch {
      // ignore
    }
  },

  getAllNotes(): DatabaseNote[] {
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },
};
