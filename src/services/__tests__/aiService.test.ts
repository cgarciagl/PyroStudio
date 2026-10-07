import { describe, it, expect, vi, beforeEach } from "vitest";
import { aiService } from "../aiService";
import type { AiConfig } from "../../types/database";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const testConfig: AiConfig = {
  enabled: true,
  provider: "mock",
  model: "mock-model",
  credential_id: "test_key",
  temperature: 0.2,
  max_tokens: 1024,
  privacy_mode: true,
};

describe("aiService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call explain_sql_ai", async () => {
    const mockResult = {
      sql: "SELECT * FROM users WHERE active = 1;",
      summary: "Consulta que lista usuarios",
      tables_involved: ["users"],
      potential_issues: [],
      full_markdown: "## Explicación\nLista usuarios activos.",
    };
    vi.mocked(invoke).mockResolvedValueOnce(mockResult);

    const res = await aiService.explainSqlAi("shop_db", "SELECT * FROM users WHERE active = 1;", testConfig);

    expect(invoke).toHaveBeenCalledWith("explain_sql_ai", {
      database: "shop_db",
      sql: "SELECT * FROM users WHERE active = 1;",
      config: testConfig,
    });
    expect(res.summary).toBe("Consulta que lista usuarios");
    expect(res.tables_involved).toContain("users");
  });

  it("should call optimize_sql_ai", async () => {
    const mockResult = {
      original_sql: "SELECT * FROM orders WHERE customer_id = 5;",
      suggested_sql: "SELECT id, total FROM orders WHERE customer_id = 5;",
      why: "Evita transferir columnas innecesarias",
      expected_improvement: "Menor I/O y uso de memoria",
      risks: "Ninguno",
      suggested_indexes: [],
      full_markdown: "## Optimización recomendada",
    };
    vi.mocked(invoke).mockResolvedValueOnce(mockResult);

    const res = await aiService.optimizeSqlAi("shop_db", "SELECT * FROM orders WHERE customer_id = 5;", testConfig);

    expect(invoke).toHaveBeenCalledWith("optimize_sql_ai", {
      database: "shop_db",
      sql: "SELECT * FROM orders WHERE customer_id = 5;",
      config: testConfig,
    });
    expect(res.suggested_sql).toContain("SELECT id, total");
  });

  it("should call fix_sql_error_ai", async () => {
    const mockResult = {
      original_sql: "SELECT * FORM users;",
      error_message: "You have an error in your SQL syntax",
      what_happened: "Error de sintaxis",
      likely_cause: "Palabra reservada FROM mal escrita como FORM",
      how_to_fix: "Reemplazar FORM por FROM",
      corrected_sql: "SELECT * FROM users;",
      full_markdown: "## Diagnóstico de error",
    };
    vi.mocked(invoke).mockResolvedValueOnce(mockResult);

    const res = await aiService.fixSqlErrorAi(
      "shop_db",
      "SELECT * FORM users;",
      "You have an error in your SQL syntax",
      "42000",
      1064,
      testConfig,
    );

    expect(invoke).toHaveBeenCalledWith("fix_sql_error_ai", {
      database: "shop_db",
      sql: "SELECT * FORM users;",
      errorMessage: "You have an error in your SQL syntax",
      sqlstate: "42000",
      errorCode: 1064,
      config: testConfig,
    });
    expect(res.corrected_sql).toBe("SELECT * FROM users;");
  });

  it("should call run_database_agent_ai", async () => {
    const mockResult = {
      question: "¿Por qué orders está lenta?",
      final_answer: "Falta un índice compuesto en (customer_id, created_at)",
      activity_steps: [
        {
          step_number: 1,
          title: "Inspeccionando índices de orders",
          tool_name: "get_table_indexes",
          status: "completed",
          details: "Solo PK encontrada",
        },
      ],
      proposed_actions: [
        {
          title: "Crear índice idx_orders_cust",
          sql: "CREATE INDEX idx_orders_cust ON orders(customer_id);",
          description: "Acelera los filtros por cliente",
          risk_level: "low",
          requires_confirmation: true,
        },
      ],
      audit_entry: {
        id: "audit_1",
        timestamp: "2026-10-07T12:00:00Z",
        question: "¿Por qué orders está lenta?",
        tools_invoked: ["get_table_indexes"],
        total_steps: 1,
        duration_ms: 450,
        proposed_actions: [],
        summary: "Diagnóstico completado",
      },
      duration_ms: 450,
    };
    vi.mocked(invoke).mockResolvedValueOnce(mockResult);

    const res = await aiService.runDatabaseAgentAi("shop_db", "¿Por qué orders está lenta?", testConfig, 10);

    expect(invoke).toHaveBeenCalledWith("run_database_agent_ai", {
      database: "shop_db",
      question: "¿Por qué orders está lenta?",
      config: testConfig,
      maxSteps: 10,
    });
    expect(res.activity_steps.length).toBe(1);
    expect(res.proposed_actions.length).toBe(1);
  });

  it("should call smart_search_schema_ai", async () => {
    const mockResult = {
      query: "donde se guarda el email",
      results: [
        {
          item_type: "column",
          database: "shop_db",
          table_name: "users",
          name: "email",
          relevance_score: 95,
          snippet: "Columna con tipo VARCHAR para email",
        },
      ],
    };
    vi.mocked(invoke).mockResolvedValueOnce(mockResult);

    const res = await aiService.smartSearchSchemaAi("shop_db", "donde se guarda el email", testConfig);

    expect(invoke).toHaveBeenCalledWith("smart_search_schema_ai", {
      database: "shop_db",
      query: "donde se guarda el email",
      config: testConfig,
    });
    expect(res.results[0].table_name).toBe("users");
  });
});
