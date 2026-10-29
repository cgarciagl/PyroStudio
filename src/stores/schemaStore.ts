import { create } from "zustand";
import { dbService } from "../services/tauriDb";
import { useUIStore } from "./uiStore";
import { useCapabilitiesStore } from "./capabilitiesStore";
import type {
  DatabaseSchema,
  EngineFeature,
  EventMetadata,
  RoutineMetadata,
  SequenceMetadata,
  TableMetadata,
  TriggerMetadata,
} from "../types/database";

/** Objects the engine does not have are not requested (e.g. routines on SQLite). */
function listIfSupported<T>(feature: EngineFeature, load: () => Promise<T[]>): Promise<T[]> {
  if (!useCapabilitiesStore.getState().supportsFeature(feature)) return Promise.resolve([]);
  return load().catch(() => []);
}

interface SchemaState {
  databases: DatabaseSchema[];
  selectedDatabase: string | null;
  tables: Record<string, TableMetadata[]>;
  routines: Record<string, RoutineMetadata[]>;
  triggers: Record<string, TriggerMetadata[]>;
  sequences: Record<string, SequenceMetadata[]>;
  events: Record<string, EventMetadata[]>;
  completionSchemas: Record<string, Record<string, string[]>>;
  isLoadingTables: Record<string, boolean>;
  isDbListLoading: boolean;

  setSelectedDatabase: (db: string | null) => void;
  loadDatabases: (targetDb?: string) => Promise<void>;
  loadSchemaObjects: (dbName: string) => Promise<void>;
  loadCompletionSchema: (dbName: string) => Promise<Record<string, string[]>>;
  dropTable: (dbName: string, tableName: string) => Promise<void>;
  dropSequence: (dbName: string, sequenceName: string) => Promise<void>;
  dropEvent: (dbName: string, eventName: string) => Promise<void>;
  toggleEvent: (dbName: string, eventName: string, enable: boolean) => Promise<void>;
  clearSchema: () => void;
}

export const useSchemaStore = create<SchemaState>((set, get) => ({
  databases: [],
  selectedDatabase: null,
  tables: {},
  routines: {},
  triggers: {},
  sequences: {},
  events: {},
  completionSchemas: {},
  isLoadingTables: {},
  isDbListLoading: false,

  // Single active database: switching closes every tab bound to another one,
  // so no tab can silently keep working against the previous database.
  setSelectedDatabase: (db) => {
    if (db && db !== get().selectedDatabase) {
      useUIStore.getState().closeTabsNotInDatabase(db);
    }
    set({ selectedDatabase: db });
  },

  loadDatabases: async (targetDb?: string) => {
    set({ isDbListLoading: true });
    try {
      const dbs = await dbService.listDatabases();
      set({ databases: dbs });
      if (targetDb && targetDb.trim()) {
        const trimmed = targetDb.trim();
        get().setSelectedDatabase(trimmed);
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
      const [tbls, rts, trgs, seqs, evts, compSchema] = await Promise.all([
        dbService.listTables(dbName).catch(() => []),
        listIfSupported("routines", () => dbService.listRoutines(dbName)),
        dbService.listTriggers(dbName).catch(() => []),
        listIfSupported("sequences", () => dbService.listSequences(dbName)),
        listIfSupported("events", () => dbService.listEvents(dbName)),
        dbService.getDatabaseCompletionSchema(dbName).catch(() => ({})),
      ]);

      set((state) => ({
        tables: { ...state.tables, [dbName]: tbls },
        routines: { ...state.routines, [dbName]: rts },
        triggers: { ...state.triggers, [dbName]: trgs },
        sequences: { ...state.sequences, [dbName]: seqs },
        events: { ...state.events, [dbName]: evts },
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

  dropSequence: async (dbName: string, sequenceName: string) => {
    await dbService.dropSequence(dbName, sequenceName);
    await get().loadSchemaObjects(dbName);
  },

  dropEvent: async (dbName: string, eventName: string) => {
    await dbService.dropEvent(dbName, eventName);
    await get().loadSchemaObjects(dbName);
  },

  toggleEvent: async (dbName: string, eventName: string, enable: boolean) => {
    await dbService.toggleEvent(dbName, eventName, enable);
    await get().loadSchemaObjects(dbName);
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
