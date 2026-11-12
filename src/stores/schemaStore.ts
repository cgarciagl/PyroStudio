import { create } from "zustand";
import { dbService } from "../services/tauriDb";
import { explainCache } from "../services/explainCache";
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
import { reportError } from "../utils/errors";

/** Objects the engine does not have are not requested (e.g. routines on SQLite). */
function listIfSupported<T>(feature: EngineFeature, load: () => Promise<T[]>): Promise<T[]> {
  if (!useCapabilitiesStore.getState().supportsFeature(feature)) return Promise.resolve([]);
  return load().catch(() => []);
}

const SCHEMA_CACHE_TTL_MS = 60_000;
const inFlightSchemaLoads = new Map<string, Promise<void>>();

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
  lastLoaded: Record<string, number>;

  setSelectedDatabase: (db: string | null) => void;
  loadDatabases: (targetDb?: string) => Promise<void>;
  loadSchemaObjects: (dbName: string, force?: boolean) => Promise<void>;
  invalidateSchema: (dbName?: string) => void;
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
  lastLoaded: {},

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
      reportError("No se pudo cargar la lista de bases de datos", err);
    } finally {
      set({ isDbListLoading: false });
    }
  },

  invalidateSchema: (dbName?: string) => {
    explainCache.invalidate(dbName);
    if (dbName) {
      set((state) => {
        const next = { ...state.lastLoaded };
        delete next[dbName];
        return { lastLoaded: next };
      });
    } else {
      set({ lastLoaded: {} });
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

  loadSchemaObjects: async (dbName: string, force = false) => {
    if (!dbName) return;

    // Cache hit check: skip query if already loaded within TTL unless forced
    const last = get().lastLoaded[dbName] ?? 0;
    const hasData = !!get().tables[dbName];
    if (!force && hasData && Date.now() - last < SCHEMA_CACHE_TTL_MS) {
      return;
    }

    // In-flight deduplication: return the running promise if already querying this db
    const existing = inFlightSchemaLoads.get(dbName);
    if (existing) {
      return existing;
    }

    const loadPromise = (async () => {
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
          lastLoaded: { ...state.lastLoaded, [dbName]: Date.now() },
        }));
      } catch (err) {
        reportError(`No se pudieron cargar los objetos de ${dbName}`, err);
      } finally {
        inFlightSchemaLoads.delete(dbName);
        set((state) => ({
          isLoadingTables: { ...state.isLoadingTables, [dbName]: false },
        }));
      }
    })();

    inFlightSchemaLoads.set(dbName, loadPromise);
    return loadPromise;
  },

  dropTable: async (dbName: string, tableName: string) => {
    await dbService.dropTable(dbName, tableName);
    get().invalidateSchema(dbName);
    await get().loadSchemaObjects(dbName, true);
    await get().loadDatabases();
  },

  dropSequence: async (dbName: string, sequenceName: string) => {
    await dbService.dropSequence(dbName, sequenceName);
    get().invalidateSchema(dbName);
    await get().loadSchemaObjects(dbName, true);
  },

  dropEvent: async (dbName: string, eventName: string) => {
    await dbService.dropEvent(dbName, eventName);
    get().invalidateSchema(dbName);
    await get().loadSchemaObjects(dbName, true);
  },

  toggleEvent: async (dbName: string, eventName: string, enable: boolean) => {
    await dbService.toggleEvent(dbName, eventName, enable);
    get().invalidateSchema(dbName);
    await get().loadSchemaObjects(dbName, true);
  },

  clearSchema: () => {
    inFlightSchemaLoads.clear();
    set({
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
      lastLoaded: {},
    });
  },
}));
