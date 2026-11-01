import type { LiveEngineMetrics } from "../types/database";

export interface ComputedLiveRates {
  timestampMs: number;
  deltaSeconds: number;
  qps: number;
  rowsReadSec: number;
  rowsInsertedSec: number;
  rowsUpdatedSec: number;
  rowsDeletedSec: number;
  totalRowOpsSec: number;
  bytesReceivedSec: number;
  bytesSentSec: number;
  bufferHitRatio: number;
  threadsConnected: number;
  threadsRunning: number;
  maxConnections: number;
  connPct: number;
  rowLockWaits: number;
  tableLocksWaited: number;
  slowQueries: number;
  uptimeSeconds: number;
  queriesTotal: number;
}

/**
 * Calculates instantaneous rates from two consecutive telemetry samples.
 * Prevents negative spikes or infinity if timestamp delta is zero or negative.
 */
export function calculateLiveRates(
  current: LiveEngineMetrics,
  previous: LiveEngineMetrics | null,
): ComputedLiveRates {
  const currentTs = current.timestamp_ms || Date.now();
  const prevTs = previous?.timestamp_ms ?? 0;
  const rawDelta = (currentTs - prevTs) / 1000;
  const deltaSeconds = previous && rawDelta > 0.05 ? rawDelta : 0;

  const calcRate = (currVal: number, prevVal?: number): number => {
    if (!previous || deltaSeconds <= 0 || prevVal === undefined) return 0;
    const diff = currVal - prevVal;
    return diff > 0 ? Math.round((diff / deltaSeconds) * 10) / 10 : 0;
  };

  const qps = calcRate(current.queries_total, previous?.queries_total);
  const rowsReadSec = calcRate(current.innodb_rows_read, previous?.innodb_rows_read);
  const rowsInsertedSec = calcRate(current.innodb_rows_inserted, previous?.innodb_rows_inserted);
  const rowsUpdatedSec = calcRate(current.innodb_rows_updated, previous?.innodb_rows_updated);
  const rowsDeletedSec = calcRate(current.innodb_rows_deleted, previous?.innodb_rows_deleted);
  const totalRowOpsSec = Math.round((rowsReadSec + rowsInsertedSec + rowsUpdatedSec + rowsDeletedSec) * 10) / 10;
  const bytesReceivedSec = calcRate(current.bytes_received, previous?.bytes_received);
  const bytesSentSec = calcRate(current.bytes_sent, previous?.bytes_sent);

  const maxConn = current.max_connections > 0 ? current.max_connections : 151;
  const connPct = Math.min(100, Math.round((current.threads_connected / maxConn) * 100));

  return {
    timestampMs: currentTs,
    deltaSeconds,
    qps,
    rowsReadSec,
    rowsInsertedSec,
    rowsUpdatedSec,
    rowsDeletedSec,
    totalRowOpsSec,
    bytesReceivedSec,
    bytesSentSec,
    bufferHitRatio: current.buffer_pool_hit_ratio,
    threadsConnected: current.threads_connected,
    threadsRunning: current.threads_running,
    maxConnections: maxConn,
    connPct,
    rowLockWaits: current.row_lock_current_waits,
    tableLocksWaited: current.table_locks_waited,
    slowQueries: current.slow_queries,
    uptimeSeconds: current.uptime_seconds,
    queriesTotal: current.queries_total,
  };
}

/**
 * Keeps a rolling buffer of up to `maxSamples` values.
 */
export function appendSample(history: number[], newValue: number, maxSamples = 60): number[] {
  const next = [...history, newValue];
  if (next.length > maxSamples) {
    return next.slice(next.length - maxSamples);
  }
  return next;
}
