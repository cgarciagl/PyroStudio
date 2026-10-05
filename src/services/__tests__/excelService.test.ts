import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbService } from "../tauriDb";

// Mock @tauri-apps/api/core invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

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
});
