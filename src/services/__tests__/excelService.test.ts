import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbService } from "../tauriDb";

// Mock @tauri-apps/api/core invoke & Channel
vi.mock("@tauri-apps/api/core", () => {
  class MockChannel<T> {
    onmessage: ((message: T) => void) | null = null;
  }
  return {
    invoke: vi.fn(),
    Channel: MockChannel,
  };
});

import { Channel, invoke } from "@tauri-apps/api/core";

describe("Excel dbService Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = (globalThis as any).window || {};
    (globalThis as any).window.__TAURI_INTERNALS__ = {};
  });

  it("should pass compatible defaultName arguments to save_excel_dialog", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("C:\\exports\\users.xlsx");

    const result = await dbService.saveExcelDialog("users.xlsx");

    expect(result).toBe("C:\\exports\\users.xlsx");
    expect(invoke).toHaveBeenCalledWith("save_excel_dialog", {
      defaultName: "users.xlsx",
      default_name: "users.xlsx",
      defaultFilename: "users.xlsx",
      default_filename: "users.xlsx",
    });
  });

  it("should pass compatible title arguments to pick_excel_file", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("C:\\imports\\data.xlsx");

    const result = await dbService.pickExcelFile("Seleccionar archivo");

    expect(result).toBe("C:\\imports\\data.xlsx");
    expect(invoke).toHaveBeenCalledWith("pick_excel_file", {
      dialogTitle: "Seleccionar archivo",
      dialog_title: "Seleccionar archivo",
      title: "Seleccionar archivo",
    });
  });

  it("should pass valid payload to export_dataset_file", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      file_path: "C:\\exports\\results.xlsx",
      total_rows: 2,
      execution_time_ms: 15,
      file_size_bytes: 4096,
    });

    const columns = ["id", "name"];
    const rows = [[1, "Alice"], [2, "Bob"]];
    const filePath = "C:\\exports\\results.xlsx";

    const summary = await dbService.exportDataset(columns, rows, filePath);

    expect(summary.total_rows).toBe(2);
    expect(invoke).toHaveBeenCalledWith("export_dataset_file", {
      columns,
      rows,
      filePath,
      file_path: filePath,
    });
  });

  it("should pass Channel progress callback and truncate_before_import to import_excel_file", async () => {
    vi.mocked(invoke).mockImplementationOnce(async (_cmd, args: any) => {
      args.onProgress.onmessage({
        current_row: 500,
        total_rows: 1000,
        percentage: 50,
        successful_rows: 500,
        failed_rows: 0,
        stage: "Importando lotes",
        rows_per_sec: 1200,
      });
      return {
        total_processed: 1000,
        successful_rows: 1000,
        failed_rows: 0,
        execution_time_ms: 800,
        errors: [],
      };
    });

    const progressUpdates: number[] = [];
    const req = {
      file_path: "/tmp/big.xlsx",
      database: "app",
      table: "items",
      mappings: [],
      mode: { type: "Append" as const },
      truncate_before_import: true,
    };

    const summary = await dbService.importExcelFile(req, (event) => {
      progressUpdates.push(event.percentage);
    });

    expect(summary.successful_rows).toBe(1000);
    expect(progressUpdates).toEqual([50]);
    const callArgs = vi.mocked(invoke).mock.calls[0]?.[1] as any;
    expect(callArgs.req.truncate_before_import).toBe(true);
    expect(callArgs.onProgress).toBeInstanceOf(Channel);
  });
});
