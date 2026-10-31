import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ExplainCache,
  buildExplainCacheKey,
  normalizeSqlForCacheKey,
} from "../explainCache";
import { dbService } from "../tauriDb";
import type { SlowQueryAnalysis } from "../../types/database";

vi.mock("../tauriDb", () => ({
  dbService: {
    analyzeSlowQuery: vi.fn(),
  },
}));

const mockAnalysis: SlowQueryAnalysis = {
  sql: "SELECT * FROM users WHERE id = 1;",
  execution_plan: [],
  json_plan: null,
  visual_nodes: [],
  bottlenecks: [],
  indexes_involved: ["PRIMARY"],
  estimated_total_rows: 1,
  actual_rows: undefined,
  actual_time_ms: undefined,
  join_strategy: undefined,
  potential_optimizations: ["Optimizado"],
  is_analyze_supported: true,
  tree_plan: undefined,
};

describe("explainCache", () => {
  let cache: ExplainCache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new ExplainCache(3, 1000); // Max 3 items, 1000ms TTL for testing
  });

  describe("SQL normalization and cache keys", () => {
    it("normalizes queries by trimming whitespace and trailing semicolons", () => {
      const q1 = "   SELECT * FROM users   WHERE id = 1;;;  ";
      const q2 = "SELECT * FROM users WHERE id = 1";
      expect(normalizeSqlForCacheKey(q1)).toBe(normalizeSqlForCacheKey(q2));
    });

    it("builds consistent keys regardless of database casing", () => {
      const key1 = buildExplainCacheKey("SELECT 1", "MyDatabase");
      const key2 = buildExplainCacheKey("SELECT 1", "mydatabase");
      expect(key1).toBe(key2);
    });
  });

  describe("LRU eviction and TTL", () => {
    it("stores and retrieves cached analysis", () => {
      cache.set("SELECT 1", "test_db", mockAnalysis);
      const res = cache.get("SELECT 1", "test_db");
      expect(res).toEqual(mockAnalysis);
    });

    it("returns null on cache miss", () => {
      expect(cache.get("SELECT 2", "test_db")).toBeNull();
    });

    it("evicts least recently used item when capacity is exceeded", () => {
      cache.set("SELECT 1", "db", mockAnalysis);
      cache.set("SELECT 2", "db", mockAnalysis);
      cache.set("SELECT 3", "db", mockAnalysis);

      // Access SELECT 1 to make it recently used
      cache.get("SELECT 1", "db");

      // Insert 4th item, should evict SELECT 2 (oldest unaccessed)
      cache.set("SELECT 4", "db", mockAnalysis);

      expect(cache.get("SELECT 1", "db")).not.toBeNull();
      expect(cache.get("SELECT 2", "db")).toBeNull();
      expect(cache.get("SELECT 3", "db")).not.toBeNull();
      expect(cache.get("SELECT 4", "db")).not.toBeNull();
    });

    it("respects TTL expiration", async () => {
      const shortTtlCache = new ExplainCache(10, 50); // 50ms TTL
      shortTtlCache.set("SELECT 1", "db", mockAnalysis);

      expect(shortTtlCache.get("SELECT 1", "db")).not.toBeNull();

      // Wait 60ms
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(shortTtlCache.get("SELECT 1", "db")).toBeNull();
    });
  });

  describe("analyzeWithCache and deduplication", () => {
    it("calls dbService on first request and returns from cache on second", async () => {
      vi.mocked(dbService.analyzeSlowQuery).mockResolvedValueOnce(mockAnalysis);

      const first = await cache.analyzeWithCache("SELECT 1", "db");
      expect(first.fromCache).toBe(false);
      expect(first.analysis).toEqual(mockAnalysis);
      expect(dbService.analyzeSlowQuery).toHaveBeenCalledTimes(1);

      const second = await cache.analyzeWithCache("SELECT 1", "db");
      expect(second.fromCache).toBe(true);
      expect(second.analysis).toEqual(mockAnalysis);
      expect(dbService.analyzeSlowQuery).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent in-flight requests for the same query", async () => {
      let resolvePromise: (val: SlowQueryAnalysis) => void;
      const delayedPromise = new Promise<SlowQueryAnalysis>((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(dbService.analyzeSlowQuery).mockImplementationOnce(() => delayedPromise);

      const promise1 = cache.analyzeWithCache("SELECT * FROM heavy_table", "db");
      const promise2 = cache.analyzeWithCache("SELECT * FROM heavy_table", "db");

      expect(cache.inFlightCount()).toBe(1);

      resolvePromise!(mockAnalysis);

      const [res1, res2] = await Promise.all([promise1, promise2]);
      expect(res1.analysis).toEqual(mockAnalysis);
      expect(res2.analysis).toEqual(mockAnalysis);
      expect(dbService.analyzeSlowQuery).toHaveBeenCalledTimes(1);
      expect(cache.inFlightCount()).toBe(0);
    });

    it("bypasses cache when forceRefresh is true", async () => {
      vi.mocked(dbService.analyzeSlowQuery).mockResolvedValue(mockAnalysis);

      await cache.analyzeWithCache("SELECT 1", "db");
      expect(dbService.analyzeSlowQuery).toHaveBeenCalledTimes(1);

      const forced = await cache.analyzeWithCache("SELECT 1", "db", { forceRefresh: true });
      expect(forced.fromCache).toBe(false);
      expect(dbService.analyzeSlowQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalidation and clear", () => {
    it("invalidates entries for a specific database", () => {
      cache.set("SELECT 1", "db_a", mockAnalysis);
      cache.set("SELECT 2", "db_b", mockAnalysis);

      cache.invalidate("db_a");

      expect(cache.get("SELECT 1", "db_a")).toBeNull();
      expect(cache.get("SELECT 2", "db_b")).not.toBeNull();
    });

    it("clears all entries when invalidating without database", () => {
      cache.set("SELECT 1", "db_a", mockAnalysis);
      cache.set("SELECT 2", "db_b", mockAnalysis);

      cache.invalidate();

      expect(cache.size()).toBe(0);
    });
  });
});
