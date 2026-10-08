import type { EnvironmentTag, OpenTab } from "../types/database";

export interface RecentTableItem {
  database: string;
  table: string;
  timestamp: number;
}

export interface RecentQueryItem {
  database: string;
  sqlPreview: string;
  timestamp: number;
}

export interface RecentConnectionInfo {
  profileId: string;
  profileName: string;
  environment: EnvironmentTag;
  database?: string;
  host: string;
  port: number;
  user: string;
  connectedAt: number;
}

export interface SavedSessionState {
  connectionProfileId: string;
  connectionName: string;
  environment: EnvironmentTag;
  database: string;
  tabs: Array<{
    id: string;
    title: string;
    type: OpenTab["type"];
    database: string;
    tableName?: string;
    routineName?: string;
    routineType?: "PROCEDURE" | "FUNCTION";
    triggerName?: string;
    isPinned?: boolean;
    queryContent?: string;
  }>;
  activeTabId: string | null;
  savedAt: number;
}

export interface RecentWorkData {
  lastConnection: RecentConnectionInfo | null;
  recentDatabases: string[];
  recentTables: RecentTableItem[];
  recentQueries: RecentQueryItem[];
  savedSession: SavedSessionState | null;
}

const STORAGE_KEY = "pyro_recent_work_v1";

export const recentWorkStorage = {
  getRecentWork(): RecentWorkData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return {
          lastConnection: null,
          recentDatabases: [],
          recentTables: [],
          recentQueries: [],
          savedSession: null,
        };
      }
      return JSON.parse(raw);
    } catch {
      return {
        lastConnection: null,
        recentDatabases: [],
        recentTables: [],
        recentQueries: [],
        savedSession: null,
      };
    }
  },

  saveLastConnection(conn: RecentConnectionInfo): void {
    const data = this.getRecentWork();
    data.lastConnection = conn;
    if (conn.database && !data.recentDatabases.includes(conn.database)) {
      data.recentDatabases = [conn.database, ...data.recentDatabases].slice(0, 8);
    }
    this._persist(data);
  },

  recordTableOpened(database: string, table: string): void {
    if (!database || !table) return;
    const data = this.getRecentWork();
    const filtered = data.recentTables.filter(
      (t) => !(t.database === database && t.table === table),
    );
    data.recentTables = [{ database, table, timestamp: Date.now() }, ...filtered].slice(
      0,
      12,
    );
    this._persist(data);
  },

  recordQueryExecuted(database: string, sql: string): void {
    if (!sql.trim()) return;
    const data = this.getRecentWork();
    const preview = sql.trim().replace(/\s+/g, " ").slice(0, 120);
    const filtered = data.recentQueries.filter(
      (q) => !(q.database === database && q.sqlPreview === preview),
    );
    data.recentQueries = [
      { database, sqlPreview: preview, timestamp: Date.now() },
      ...filtered,
    ].slice(0, 10);
    this._persist(data);
  },

  saveSessionState(session: SavedSessionState): void {
    const data = this.getRecentWork();
    data.savedSession = session;
    this._persist(data);
  },

  clearSavedSession(): void {
    const data = this.getRecentWork();
    data.savedSession = null;
    this._persist(data);
  },

  clearAll(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignored
    }
  },

  _persist(data: RecentWorkData): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Ignored
    }
  },
};

