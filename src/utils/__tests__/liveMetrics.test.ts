import { describe, it, expect } from "vitest";
import { calculateLiveRates, appendSample } from "../liveMetrics";
import type { LiveEngineMetrics } from "../../types/database";

describe("liveMetrics calculation", () => {
  const sampleA: LiveEngineMetrics = {
    timestamp_ms: 1000000,
    uptime_seconds: 500,
    queries_total: 1000,
    threads_connected: 10,
    threads_running: 2,
    max_connections: 100,
    buffer_pool_hit_ratio: 99.5,
    innodb_rows_read: 5000,
    innodb_rows_inserted: 100,
    innodb_rows_updated: 50,
    innodb_rows_deleted: 10,
    row_lock_current_waits: 0,
    table_locks_waited: 1,
    slow_queries: 0,
    bytes_received: 10000,
    bytes_sent: 50000,
  };

  it("returns zero rates on first sample without previous", () => {
    const rates = calculateLiveRates(sampleA, null);
    expect(rates.qps).toBe(0);
    expect(rates.rowsReadSec).toBe(0);
    expect(rates.connPct).toBe(10);
    expect(rates.bufferHitRatio).toBe(99.5);
  });

  it("calculates accurate per-second rates between two consecutive samples", () => {
    const sampleB: LiveEngineMetrics = {
      ...sampleA,
      timestamp_ms: 1002000, // 2 seconds later
      queries_total: 1050, // +50 queries -> 25 QPS
      innodb_rows_read: 5200, // +200 rows -> 100/s
      innodb_rows_inserted: 120, // +20 rows -> 10/s
      innodb_rows_updated: 60, // +10 rows -> 5/s
      innodb_rows_deleted: 14, // +4 rows -> 2/s
      threads_connected: 20,
    };

    const rates = calculateLiveRates(sampleB, sampleA);
    expect(rates.deltaSeconds).toBe(2);
    expect(rates.qps).toBe(25);
    expect(rates.rowsReadSec).toBe(100);
    expect(rates.rowsInsertedSec).toBe(10);
    expect(rates.rowsUpdatedSec).toBe(5);
    expect(rates.rowsDeletedSec).toBe(2);
    expect(rates.totalRowOpsSec).toBe(117);
    expect(rates.connPct).toBe(20);
  });

  it("appends to rolling history buffer respecting max length", () => {
    let buf: number[] = [];
    for (let i = 0; i < 70; i++) {
      buf = appendSample(buf, i, 60);
    }
    expect(buf.length).toBe(60);
    expect(buf[0]).toBe(10);
    expect(buf[59]).toBe(69);
  });
});
