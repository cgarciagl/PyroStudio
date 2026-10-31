import { dbService } from "./tauriDb";
import type { SlowQueryAnalysis } from "../types/database";

export const EXPLAIN_CACHE_MAX_ENTRIES = 50;
export const EXPLAIN_CACHE_TTL_MS = 60_000; // 1 minute

export interface ExplainCacheEntry {
  key: string;
  database: string;
  analysis: SlowQueryAnalysis;
  timestamp: number;
}

export interface AnalyzeResultWithMeta {
  analysis: SlowQueryAnalysis;
  fromCache: boolean;
}

/**
 * Normalizes SQL query string for consistent cache key hashing:
 * - Trims leading/trailing whitespace and semicolons.
 * - Collapses consecutive whitespace characters.
 */
export function normalizeSqlForCacheKey(sql: string): string {
  return sql
    .trim()
    .replace(/;+\s*$/, "")
    .replace(/\s+/g, " ");
}

/**
 * Builds a deterministic cache key based on database and SQL query.
 */
export function buildExplainCacheKey(sql: string, database?: string): string {
  const normDb = (database || "__default__").toLowerCase().trim();
  const normSql = normalizeSqlForCacheKey(sql);
  return `${normDb}::${normSql}`;
}

export class ExplainCache {
  private cache = new Map<string, ExplainCacheEntry>();
  private inFlight = new Map<string, Promise<SlowQueryAnalysis>>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = EXPLAIN_CACHE_MAX_ENTRIES, ttlMs = EXPLAIN_CACHE_TTL_MS) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /**
   * Retrieves a cached analysis if present and not expired.
   * Accessing a valid entry moves it to the most-recently-used position.
   */
  get(sql: string, database?: string): SlowQueryAnalysis | null {
    const key = buildExplainCacheKey(sql, database);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Refresh LRU order (delete + re-set)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.analysis;
  }

  /**
   * Stores an analysis in the cache, evicting the least-recently-used entry if capacity is reached.
   */
  set(sql: string, database: string | undefined, analysis: SlowQueryAnalysis): void {
    const key = buildExplainCacheKey(sql, database);
    const entry: ExplainCacheEntry = {
      key,
      database: (database || "__default__").toLowerCase().trim(),
      analysis,
      timestamp: Date.now(),
    };

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict least-recently-used entry (first key in Map iterator)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, entry);
  }

  /**
   * Analyzes the query using cache when available, deduplicating concurrent in-flight requests.
   */
  async analyzeWithCache(
    sql: string,
    database?: string,
    options?: { forceRefresh?: boolean },
  ): Promise<AnalyzeResultWithMeta> {
    const key = buildExplainCacheKey(sql, database);

    if (!options?.forceRefresh) {
      const cached = this.get(sql, database);
      if (cached) {
        return { analysis: cached, fromCache: true };
      }
    }

    // Deduplicate in-flight requests for the same query/database
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const result = await dbService.analyzeSlowQuery(sql, database);
          this.set(sql, database, result);
          return result;
        } finally {
          this.inFlight.delete(key);
        }
      })();
      this.inFlight.set(key, pending);
    }

    const analysis = await pending;
    return { analysis, fromCache: false };
  }

  /**
   * Invalidates cached entries. If database is specified, only entries for that database are purged.
   */
  invalidate(database?: string): void {
    if (!database) {
      this.cache.clear();
      return;
    }
    const targetDb = database.toLowerCase().trim();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.database === targetDb) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clears all cached entries and in-flight tracking.
   */
  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  /**
   * Current number of cached entries.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Current number of in-flight requests.
   */
  inFlightCount(): number {
    return this.inFlight.size;
  }
}

export const explainCache = new ExplainCache();
