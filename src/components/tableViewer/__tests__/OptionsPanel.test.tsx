// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TableOptionsInfo } from "../../../types/database";

vi.mock("../../../services/tauriDb", () => ({
  dbService: {
    getTableOptions: vi.fn(),
    previewTableOptions: vi.fn(),
    applyTableOptions: vi.fn(),
  },
}));

import { dbService } from "../../../services/tauriDb";
import { OptionsPanel } from "../OptionsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function sampleInfo(overrides: Partial<TableOptionsInfo["options"]> = {}): TableOptionsInfo {
  return {
    options: {
      engine: "INNODB",
      charset: "UTF8MB4",
      collation: "UTF8MB4_UNICODE_CI",
      auto_increment: 49,
      row_format: "DYNAMIC",
      avg_row_length: null,
      max_rows: null,
      key_block_size: null,
      stats_auto_recalc: "",
      stats_persistent: "",
      stats_sample_pages: null,
      checksum: false,
      encrypted: false,
      comment: "",
      ...overrides,
    },
    engines: ["InnoDB", "MyISAM"],
    charsets: [
      { name: "utf8mb4", default_collation: "utf8mb4_unicode_ci" },
      { name: "latin1", default_collation: "latin1_swedish_ci" },
    ],
    collations: [
      { name: "utf8mb4_unicode_ci", charset: "utf8mb4" },
      { name: "latin1_swedish_ci", charset: "latin1" },
    ],
    row_formats: ["DYNAMIC", "COMPACT"],
    is_mariadb: false,
    partitioned: false,
  };
}

function setInputValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe("OptionsPanel", () => {
  it("normalizes casing and clears convertCharset when charset is reverted to original", async () => {
    vi.mocked(dbService.getTableOptions).mockResolvedValueOnce(sampleInfo());
    vi.mocked(dbService.previewTableOptions).mockResolvedValue("ALTER TABLE `app`.`orders` CONVERT TO CHARACTER SET latin1;");

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<OptionsPanel database="app" table="orders" onApplied={vi.fn()} onError={vi.fn()} />);
      await Promise.resolve();
    });

    const selects = host.querySelectorAll("select");
    const engineSelect = selects[0] as HTMLSelectElement;
    const charsetSelect = selects[1] as HTMLSelectElement;
    const collationSelect = selects[2] as HTMLSelectElement;

    // Server returned uppercase INNODB/UTF8MB4; selects match canonical list entries.
    expect(engineSelect.value).toBe("InnoDB");
    expect(charsetSelect.value).toBe("utf8mb4");
    expect(collationSelect.value).toBe("utf8mb4_unicode_ci");

    // Change charset -> convertCharset checkbox appears -> check it.
    await act(async () => setInputValue(charsetSelect, "latin1"));
    const checkboxes = host.querySelectorAll("input[type='checkbox']");
    const convertCheckbox = checkboxes[0] as HTMLInputElement;
    await act(async () => convertCheckbox.click());
    expect(convertCheckbox.checked).toBe(true);

    // Revert charset back to utf8mb4: convertCharset must auto-reset so form is clean again.
    await act(async () => setInputValue(charsetSelect, "utf8mb4"));
    const buttons = Array.from(host.querySelectorAll("button"));
    const applyBtn = buttons[buttons.length - 1] as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    expect(host.textContent).not.toContain("ALTER TABLE");
  });

  it("shows no-effective-changes instead of ellipsis when preview returns null and ignores stale responses", async () => {
    vi.mocked(dbService.getTableOptions).mockResolvedValueOnce(sampleInfo());

    let resolveFirst!: (val: string | null) => void;
    vi.mocked(dbService.previewTableOptions)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce(null);

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<OptionsPanel database="app" table="orders" onApplied={vi.fn()} onError={vi.fn()} />);
      await Promise.resolve();
    });

    const numberInputs = host.querySelectorAll("input[type='number']");
    const autoIncInput = numberInputs[0] as HTMLInputElement;

    // Edit 1: set AUTO_INCREMENT to 100 and fire debounced preview (stays pending).
    await act(async () => setInputValue(autoIncInput, "100"));
    await act(async () => {
      vi.advanceTimersByTime(260);
      await Promise.resolve();
    });

    // Edit 2: clear AUTO_INCREMENT -> preview returns null (no effective SQL).
    await act(async () => setInputValue(autoIncInput, ""));
    await act(async () => {
      vi.advanceTimersByTime(260);
      await Promise.resolve();
    });

    // Resolve stale first preview AFTER second edit completed: must be ignored.
    await act(async () => {
      resolveFirst("ALTER TABLE `app`.`orders` AUTO_INCREMENT=100;");
      await Promise.resolve();
    });

    const pre = host.querySelector("pre");
    expect(pre).toBeNull();
    expect(host.textContent).not.toContain("ALTER TABLE `app`.`orders` AUTO_INCREMENT=100;");
    const buttons = Array.from(host.querySelectorAll("button"));
    const applyBtn = buttons[buttons.length - 1] as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });
});
