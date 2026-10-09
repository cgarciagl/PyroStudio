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
  completionSchemas: Record<string, Record<string, string[]>>;
  isLoadingTables: Record<string, boolean>;
  isDbListLoading: boolean;

  setSelectedDatabase: (db: string | null) => void;
  loadDatabases: (targetDb?: string) => Promise<void>;
  loadSchemaObjects: (dbName: string) => Promise<void>;
  loadCompletionSchema: (dbName: string) => Promise<Record<string, string[]>>;
  dropTable: (dbName: string, tableName: string) => Promise<void>;
  clearSchema: () => void;
}

export const useSchemaStore = create<SchemaState>((set, get) => ({
  databases: [],
  selectedDatabase: null,
  tables: {},
  routines: {},
  triggers: {},
  completionSchemas: {},
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

  loadCompletionSchema: async (dbName: string) => {
    const existing = get().completionSchemas[dbName];
    if (existing && Object.keys(existing).length > 0) {
      return existing;
    }
    try {
      const schemaMap = await dbService.getDatabaseCompletionSchema(dbName);
      set((state) => ({
        completionSchemas: { ...state.completionSchemas, [dbName]: schemaMap },
      }));
      return schemaMap;
    } catch (err) {
      console.warn(`Could not load completion schema for ${dbName}:`, err);
      return {};
    }
  },

  loadSchemaObjects: async (dbName: string) => {
    set((state) => ({
      isLoadingTables: { ...state.isLoadingTables, [dbName]: true },
    }));

    try {
      const [tbls, rts, trgs, compSchema] = await Promise.all([
        dbService.listTables(dbName).catch(() => []),
        dbService.listRoutines(dbName).catch(() => []),
        dbService.listTriggers(dbName).catch(() => []),
        dbService.getDatabaseCompletionSchema(dbName).catch(() => ({})),
      ]);

      set((state) => ({
        tables: { ...state.tables, [dbName]: tbls },
        routines: { ...state.routines, [dbName]: rts },
        triggers: { ...state.triggers, [dbName]: trgs },
        completionSchemas: { ...state.completionSchemas, [dbName]: compSchema },
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
      completionSchemas: {},
      isLoadingTables: {},
      isDbListLoading: false,
    });
  },
}));
