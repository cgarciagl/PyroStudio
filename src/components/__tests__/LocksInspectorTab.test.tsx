// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocksInspectorTab, formatDuration, sortTransactions } from "../LocksInspectorTab";
import { dbService } from "../../services/tauriDb";
import { useUIStore } from "../../stores/uiStore";
import type { ActiveTransactionEntry, LocksAndTransactionsReport } from "../../types/database";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../services/tauriDb", () => ({
  dbService: {
    getActiveLocksAndTransactions: vi.fn(),
    killServerThread: vi.fn(),
  },
}));

const sampleReport: LocksAndTransactionsReport = {
  engine_label: "MySQL 8.0.36",
  detection_source: "performance_schema.data_lock_waits + innodb_trx",
  current_connection_id: 99,
  total_active_transactions: 2,
  total_blocked_threads: 1,
  root_blockers_count: 1,
  lock_tree: [
    {
      thread_id: 10,
      trx_id: "100",
      user: "app_user",
      host: "10.0.0.1",
      db: "shop",
      trx_state: "RUNNING",
      process_state: "Sleep",
      isolation_level: "REPEATABLE READ",
      duration_seconds: 45,
      rows_locked: 12,
      rows_modified: 1,
      lock_mode: null,
      lock_type: null,
      locked_table: null,
      locked_index: null,
      sql_text: "UPDATE orders SET status = 'paid' WHERE id = 5",
      is_root_blocker: true,
      blocking_thread_id: null,
      has_cycle: false,
      children: [
        {
          thread_id: 20,
          trx_id: "101",
          user: "worker",
          host: "10.0.0.2",
          db: "shop",
          trx_state: "LOCK WAIT",
          process_state: "updating",
          isolation_level: "REPEATABLE READ",
          duration_seconds: 18,
          rows_locked: 1,
          rows_modified: 0,
          lock_mode: "X",
          lock_type: "RECORD",
          locked_table: "shop.orders",
          locked_index: "PRIMARY",
          sql_text: "UPDATE orders SET total = 99 WHERE id = 5",
          is_root_blocker: false,
          blocking_thread_id: 10,
          has_cycle: false,
          children: [],
        },
      ],
    },
  ],
  transactions: [
    {
      thread_id: 10,
      trx_id: "100",
      user: "app_user",
      host: "10.0.0.1",
      db: "shop",
      command: "Sleep",
      process_state: null,
      trx_state: "RUNNING",
      isolation_level: "REPEATABLE READ",
      duration_seconds: 45,
      rows_locked: 12,
      rows_modified: 1,
      lock_structs: 3,
      sql_text: "UPDATE orders SET status = 'paid' WHERE id = 5",
      blocking_thread_id: null,
      waiting_count: 1,
      is_root_blocker: true,
    },
    {
      thread_id: 20,
      trx_id: "101",
      user: "worker",
      host: "10.0.0.2",
      db: "shop",
      command: "Query",
      process_state: "updating",
      trx_state: "LOCK WAIT",
      isolation_level: "READ COMMITTED",
      duration_seconds: 18,
      rows_locked: 1,
      rows_modified: 0,
      lock_structs: 2,
      lock_mode: "X",
      locked_table: "shop.orders",
      sql_text: "UPDATE orders SET total = 99 WHERE id = 5",
      blocking_thread_id: 10,
      waiting_count: 0,
      is_root_blocker: false,
    },
  ],
  wait_edges: [],
  sqlite_info: null,
  warnings: [],
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const renderTab = async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<LocksInspectorTab database="shop" />));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
};

describe("LocksInspectorTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.getState().closeDialog();
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("formats durations cleanly", () => {
    expect(formatDuration(12)).toBe("12s");
    expect(formatDuration(75)).toBe("1m 15s");
    expect(formatDuration(3665)).toBe("1h 1m");
  });

  it("sorts active transactions by duration and rows_locked", () => {
    const entries = sampleReport.transactions as ActiveTransactionEntry[];
    const byDurAsc = sortTransactions(entries, "duration", "asc");
    expect(byDurAsc.map((t) => t.thread_id)).toEqual([20, 10]);

    const byRowsDesc = sortTransactions(entries, "rows_locked", "desc");
    expect(byRowsDesc.map((t) => t.thread_id)).toEqual([10, 20]);
  });

  it("renders dependency tree and requires confirmation before killing a thread", async () => {
    vi.mocked(dbService.getActiveLocksAndTransactions).mockResolvedValue(sampleReport);
    vi.mocked(dbService.killServerThread).mockResolvedValue(undefined);

    await renderTab();

    expect(host?.textContent).toContain("Hilo #10");
    expect(host?.textContent).toContain("Hilo #20");
    expect(host?.textContent).toContain("Bloqueador raíz");

    const buttons = Array.from(host?.querySelectorAll("button") ?? []);
    const killBtn = buttons.find((b) => b.textContent?.includes("Terminar Consulta"));
    expect(killBtn).toBeTruthy();

    await act(async () => {
      killBtn!.click();
    });

    // Must NOT call backend directly without user confirmation
    expect(dbService.killServerThread).not.toHaveBeenCalled();

    const dialog = useUIStore.getState().activeDialog;
    expect(dialog).toBeTruthy();
    expect(dialog?.variant).toBe("danger");
    expect(dialog?.message).toContain("KILL QUERY 10");

    await act(async () => {
      await dialog?.onConfirm?.();
    });
    expect(dbService.killServerThread).toHaveBeenCalledWith(10, "query");
  });

  it("switches to active transactions table and filters by search query", async () => {
    vi.mocked(dbService.getActiveLocksAndTransactions).mockResolvedValue(sampleReport);

    await renderTab();

    const buttons = Array.from(host?.querySelectorAll("button") ?? []);
    const tableTabBtn = buttons.find((b) => b.textContent?.includes("Transacciones activas (2)"));
    expect(tableTabBtn).toBeTruthy();

    await act(async () => {
      tableTabBtn!.click();
    });

    expect(host?.textContent).toContain("#10");
    expect(host?.textContent).toContain("#20");

    const input = host?.querySelector<HTMLInputElement>(
      'input[placeholder="Filtrar por hilo, usuario, tabla o SQL..."]',
    );
    expect(input).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "worker");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(host?.textContent).toContain("1 de 2");
    expect(host?.textContent).not.toContain("app_user");
    expect(host?.textContent).toContain("#20");
  });
});
