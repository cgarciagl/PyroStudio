import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportHealthReportHtml, exportIndexAdvisorCsv, downloadFile } from "../diagnosticExport";
import type { HealthReport, IndexAdvisorReport } from "../../types/database";

describe("diagnosticExport", () => {
  let clickedElement: any = null;

  beforeEach(() => {
    clickedElement = null;

    globalThis.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    globalThis.URL.revokeObjectURL = vi.fn();

    // Mock document and createElement
    const mockAnchor = {
      href: "",
      download: "",
      click: vi.fn(function (this: any) {
        clickedElement = this;
      }),
    };

    (globalThis as any).document = {
      createElement: vi.fn().mockImplementation((tagName: string) => {
        if (tagName === "a") {
          return { ...mockAnchor };
        }
        return {};
      }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    };
  });

  it("should generate and trigger download for health report HTML", () => {
    const mockReport: HealthReport = {
      database_name: "ecommerce_db",
      server_version: "10.11.6-MariaDB",
      uptime_seconds: 3600,
      overall_score: 85,
      issues: [
        {
          id: "buf_pool",
          severity: "Information",
          category: "Performance",
          title: "Tasa de Acierto del Buffer Pool Excelente",
          description: "La tasa de aciertos es 99.8%",
          metric_name: "Buffer Pool Hit Rate",
          metric_value: "99.8%",
        },
      ],
      summary: {
        critical_count: 0,
        warning_count: 0,
        info_count: 1,
      },
    };

    exportHealthReportHtml(mockReport);

    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    expect(clickedElement).not.toBeNull();
    expect(clickedElement?.download).toContain("health_report_ecommerce_db_");
    expect(clickedElement?.download).toContain(".html");
  });

  it("should generate and trigger download for index advisor CSV", () => {
    const mockReport: IndexAdvisorReport = {
      database_name: "analytics_db",
      recommendations: [
        {
          table_name: "orders",
          recommendation: "Índice redundante detectado",
          reason: "El índice idx_customer es prefijo de idx_customer_date",
          estimated_benefit: "Ahorro de I/O en escrituras",
          potential_cost: "Ninguno",
          sql_proposal: "ALTER TABLE `orders` DROP INDEX `idx_customer`;",
          index_name: "idx_customer",
          columns: ["customer_id"],
          is_redundant: true,
          redundant_with: "idx_customer_date",
        },
      ],
      redundant_indexes_count: 1,
      missing_indexes_count: 0,
      analyzed_tables_count: 5,
    };

    exportIndexAdvisorCsv(mockReport);

    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    expect(clickedElement).not.toBeNull();
    expect(clickedElement?.download).toContain("index_advisor_analytics_db_");
    expect(clickedElement?.download).toContain(".csv");
  });

  it("should invoke browser download flow in downloadFile", () => {
    downloadFile("test content", "test.txt", "text/plain");

    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    expect(clickedElement?.download).toBe("test.txt");
  });
});
