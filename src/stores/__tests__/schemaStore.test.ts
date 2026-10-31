import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListTables = vi.fn();
const mockListRoutines = vi.fn();
const mockListTriggers = vi.fn();
const mockListSequences = vi.fn();
const mockListEvents = vi.fn();
const mockGetCompletionSchema = vi.fn();
const mockDropTable = vi.fn();

vi.mock("../../services/tauriDb", () => ({
  dbService: {
    listDatabases: vi.fn().mockResolvedValue([{ name: "test_db", tables_count: 2 }]),
    listTables: (...args: unknown[]) => mockListTables(...args),
    listRoutines: (...args: unknown[]) => mockListRoutines(...args),
    listTriggers: (...args: unknown[]) => mockListTriggers(...args),
    listSequences: (...args: unknown[]) => mockListSequences(...args),
    listEvents: (...args: unknown[]) => mockListEvents(...args),
    getDatabaseCompletionSchema: (...args: unknown[]) => mockGetCompletionSchema(...args),
    dropTable: (...args: unknown[]) => mockDropTable(...args),
  },
}));

import { useSchemaStore } from "../schemaStore";

describe("useSchemaStore smart caching and deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSchemaStore.getState().clearSchema();

    mockListTables.mockResolvedValue([
      { name: "users", table_type: "BASE TABLE", engine: "InnoDB" },
      { name: "orders", table_type: "BASE TABLE", engine: "InnoDB" },
    ]);
    mockListRoutines.mockResolvedValue([]);
    mockListTriggers.mockResolvedValue([]);
    mockListSequences.mockResolvedValue([]);
    mockListEvents.mockResolvedValue([]);
    mockGetCompletionSchema.mockResolvedValue({ users: ["id", "name"] });
    mockDropTable.mockResolvedValue(undefined);
  });

  it("loads schema objects from backend on cold cache", async () => {
    await useSchemaStore.getState().loadSchemaObjects("test_db");

    expect(mockListTables).toHaveBeenCalledTimes(1);
    expect(mockListTables).toHaveBeenCalledWith("test_db");
    expect(useSchemaStore.getState().tables["test_db"]).toHaveLength(2);
    expect(useSchemaStore.getState().lastLoaded["test_db"]).toBeGreaterThan(0);
  });

  it("skips backend query on subsequent calls within TTL", async () => {
    await useSchemaStore.getState().loadSchemaObjects("test_db");
    expect(mockListTables).toHaveBeenCalledTimes(1);

    // Second call within TTL should hit cache
    await useSchemaStore.getState().loadSchemaObjects("test_db");
    expect(mockListTables).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when force=true is passed", async () => {
    await useSchemaStore.getState().loadSchemaObjects("test_db");
    expect(mockListTables).toHaveBeenCalledTimes(1);

    // Call with force = true should query backend again
    await useSchemaStore.getState().loadSchemaObjects("test_db", true);
    expect(mockListTables).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent in-flight requests for the same database", async () => {
    // Fire 3 simultaneous loads for the same database
    const p1 = useSchemaStore.getState().loadSchemaObjects("test_db");
    const p2 = useSchemaStore.getState().loadSchemaObjects("test_db");
    const p3 = useSchemaStore.getState().loadSchemaObjects("test_db");

    await Promise.all([p1, p2, p3]);

    // Despite 3 calls, backend should only be called once
    expect(mockListTables).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache selectively by database", async () => {
    await useSchemaStore.getState().loadSchemaObjects("db_1");
    await useSchemaStore.getState().loadSchemaObjects("db_2");
    expect(mockListTables).toHaveBeenCalledTimes(2);

    // Invalidate only db_1
    useSchemaStore.getState().invalidateSchema("db_1");
    expect(useSchemaStore.getState().lastLoaded["db_1"]).toBeUndefined();
    expect(useSchemaStore.getState().lastLoaded["db_2"]).toBeDefined();

    // db_1 should re-query, db_2 should hit cache
    await useSchemaStore.getState().loadSchemaObjects("db_1");
    await useSchemaStore.getState().loadSchemaObjects("db_2");
    expect(mockListTables).toHaveBeenCalledTimes(3);
  });

  it("invalidates and forces reload on dropTable", async () => {
    await useSchemaStore.getState().loadSchemaObjects("test_db");
    expect(mockListTables).toHaveBeenCalledTimes(1);

    await useSchemaStore.getState().dropTable("test_db", "orders");
    expect(mockDropTable).toHaveBeenCalledWith("test_db", "orders");
    // dropTable forces a fresh reload
    expect(mockListTables).toHaveBeenCalledTimes(2);
  });
});
