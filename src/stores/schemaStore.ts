import { create } from "zustand";
import { dbService } from "../services/tauriDb";
import type {
  DatabaseSchema,
  RoutineMetadata,
  TableMetadata,
  TriggerMetadata,
} from "../types/database";

interface SchemaState {
  databases: DatabaseSchema[];
  selectedDatabase: string | null;
  tables: Record<string, TableMetadata[]>;
  routines: Record<string, RoutineMetadata[]>;
  triggers: Record<string, TriggerMetadata[]>;
  isLoadingTables: Record<string, boolean>;
  isDbListLoading: boolean;

  setSelectedDatabase: (db: string | null) => void;
  loadDatabases: (targetDb?: string) => Promise<void>;
  loadSchemaObjects: (dbName: string) => Promise<void>;
  dropTable: (dbName: string, tableName: string) => Promise<void>;
  clearSchema: () => void;
}

export const useSchemaStore = create<SchemaState>((set, get) => ({
  databases: [],
  selectedDatabase: null,
  tables: {},
  routines: {},
  triggers: {},
  isLoadingTables: {},
  isDbListLoading: false,

  setSelectedDatabase: (db) => set({ selectedDatabase: db }),

  loadDatabases: async (targetDb?: string) => {
    set({ isDbListLoading: true });
    try {
      const dbs = await dbService.listDatabases();
      set({ databases: dbs });
      if (targetDb && targetDb.trim()) {
        const trimmed = targetDb.trim();
        set({ selectedDatabase: trimmed });
        await get().loadSchemaObjects(trimmed);
      }
    } catch (err) {
      console.error("Failed to load databases:", err);
    } finally {
      set({ isDbListLoading: false });
    }
  },

  loadSchemaObjects: async (dbName: string) => {
    set((state) => ({
      isLoadingTables: { ...state.isLoadingTables, [dbName]: true },
    }));

    try {
      const [tbls, rts, trgs] = await Promise.all([
        dbService.listTables(dbName).catch(() => []),
        dbService.listRoutines(dbName).catch(() => []),
        dbService.listTriggers(dbName).catch(() => []),
      ]);

      set((state) => ({
        tables: { ...state.tables, [dbName]: tbls },
        routines: { ...state.routines, [dbName]: rts },
        triggers: { ...state.triggers, [dbName]: trgs },
      }));
    } catch (err) {
      console.error(`Failed to load schema objects for ${dbName}:`, err);
    } finally {
      set((state) => ({
        isLoadingTables: { ...state.isLoadingTables, [dbName]: false },
      }));
    }
  },

  dropTable: async (dbName: string, tableName: string) => {
    await dbService.dropTable(dbName, tableName);
    await get().loadSchemaObjects(dbName);
    await get().loadDatabases();
  },

  clearSchema: () => {
    set({
      databases: [],
      selectedDatabase: null,
      tables: {},
      routines: {},
      triggers: {},
      isLoadingTables: {},
      isDbListLoading: false,
    });
  },
}));
