import type { QueryHistoryItem } from "../types/database";

const HISTORY_STORAGE_KEY = "pyro_query_history_v1";
const DEFAULT_MAX_HISTORY_ENTRIES = 2000;

export const queryHistoryStorage = {
  getHistory(): QueryHistoryItem[] {
    try {
      const data = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [];
    } catch (e) {
      console.warn("Failed to load query history from localStorage:", e);
      return [];
    }
  },

  addEntry(entry: Omit<QueryHistoryItem, "id" | "timestamp"> & { timestamp?: number }): QueryHistoryItem {
    try {
      const items = this.getHistory();
      const newItem: QueryHistoryItem = {
        id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: entry.timestamp || Date.now(),
        connectionName: entry.connectionName || "Local",
        database: entry.database || "",
        sql: entry.sql.trim(),
        durationMs: entry.durationMs,
        success: entry.success,
        errorMessage: entry.errorMessage,
        affectedRows: entry.affectedRows,
      };

      // Prepend the new item (most recent first)
      const updated = [newItem, ...items];

      // Enforce reasonable limit (FIFO eviction)
      if (updated.length > DEFAULT_MAX_HISTORY_ENTRIES) {
        updated.length = DEFAULT_MAX_HISTORY_ENTRIES;
      }

      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
      return newItem;
    } catch (e) {
      console.warn("Failed to save query history entry:", e);
      return {
        id: `hist-${Date.now()}`,
        timestamp: Date.now(),
        connectionName: entry.connectionName,
        database: entry.database,
        sql: entry.sql,
        durationMs: entry.durationMs,
        success: entry.success,
      };
    }
  },

  deleteEntry(id: string): QueryHistoryItem[] {
    try {
      const items = this.getHistory();
      const updated = items.filter((item) => item.id !== id);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.warn("Failed to delete history item:", e);
      return [];
    }
  },

  clearHistory(): void {
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch (e) {
      console.warn("Failed to clear query history:", e);
    }
  },

  searchHistory(searchTerm: string, databaseFilter?: string): QueryHistoryItem[] {
    const items = this.getHistory();
    const term = searchTerm.toLowerCase().trim();

    return items.filter((item) => {
      if (databaseFilter && databaseFilter.trim() && item.database !== databaseFilter.trim()) {
        return false;
      }
      if (!term) return true;
      return (
        item.sql.toLowerCase().includes(term) ||
        item.database.toLowerCase().includes(term) ||
        item.connectionName.toLowerCase().includes(term)
      );
    });
  },
};
