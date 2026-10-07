import { invoke } from "@tauri-apps/api/core";
import type {
  AiConfig,
  AiCompletionResponse,
  SqlExplanationResult,
  SqlGenerationResult,
  SqlOptimizationResult,
  SqlErrorFixResult,
  SqlTestCasesResult,
  SqlDocumentationResult,
  AgentRunResult,
  SmartSearchResult,
  DatabaseHealthSummaryResult,
  MigrationReviewResult,
  GeneratedReport,
  SchemaDiffResult,
} from "../types/database";

export const aiService = {
  /**
   * Explains a SQL query combining execution plan and LLM reasoning.
   */
  async explainSqlAi(
    database: string,
    sql: string,
    config: AiConfig,
  ): Promise<SqlExplanationResult> {
    return await invoke<SqlExplanationResult>("explain_sql_ai", {
      database,
      sql,
      config,
    });
  },

  /**
   * Generates MariaDB/MySQL SQL from a natural language prompt with schema context.
   */
  async generateSqlAi(
    database: string,
    prompt: string,
    config: AiConfig,
  ): Promise<SqlGenerationResult> {
    return await invoke<SqlGenerationResult>("generate_sql_ai", {
      database,
      prompt,
      config,
    });
  },

  /**
   * Optimizes a SQL query and suggests missing indexes with explanation.
   */
  async optimizeSqlAi(
    database: string,
    sql: string,
    config: AiConfig,
  ): Promise<SqlOptimizationResult> {
    return await invoke<SqlOptimizationResult>("optimize_sql_ai", {
      database,
      sql,
      config,
    });
  },

  /**
   * Diagnoses a query execution error and proposes corrected SQL.
   */
  async fixSqlErrorAi(
    database: string,
    sql: string,
    errorMessage: string,
    sqlstate?: string,
    errorCode?: number,
    config?: AiConfig,
  ): Promise<SqlErrorFixResult> {
    return await invoke<SqlErrorFixResult>("fix_sql_error_ai", {
      database,
      sql,
      errorMessage,
      sqlstate,
      errorCode,
      config: config || {
        enabled: true,
        provider: "none",
        model: "gemini-3.8-flash",
        privacy_mode: true,
      },
    });
  },

  /**
   * Generates comprehensive SQL test cases (normal, empty, null, edge values).
   */
  async generateSqlTestsAi(
    database: string,
    sql: string,
    config: AiConfig,
  ): Promise<SqlTestCasesResult> {
    return await invoke<SqlTestCasesResult>("generate_sql_tests_ai", {
      database,
      sql,
      config,
    });
  },

  /**
   * Generates documentation (Markdown, HTML, SQL comments) for schema objects.
   */
  async generateDocumentationAi(
    database: string,
    targetType: string,
    targetName: string,
    config: AiConfig,
  ): Promise<SqlDocumentationResult> {
    return await invoke<SqlDocumentationResult>("generate_documentation_ai", {
      database,
      targetType,
      targetName,
      config,
    });
  },

  /**
   * Runs the autonomous, multi-step Database Agent with tool calling in Read-Only mode.
   */
  async runDatabaseAgentAi(
    database: string,
    question: string,
    config: AiConfig,
    maxSteps?: number,
  ): Promise<AgentRunResult> {
    return await invoke<AgentRunResult>("run_database_agent_ai", {
      database,
      question,
      config,
      maxSteps,
    });
  },

  /**
   * Performs smart search over schema tables, columns, and comments.
   */
  async smartSearchSchemaAi(
    database: string,
    query: string,
    config?: AiConfig,
  ): Promise<SmartSearchResult> {
    return await invoke<SmartSearchResult>("smart_search_schema_ai", {
      database,
      query,
      config,
    });
  },

  /**
   * Generates Database Health summary separating facts from AI insights.
   */
  async getDatabaseHealthSummaryAi(
    database: string,
    config?: AiConfig,
  ): Promise<DatabaseHealthSummaryResult> {
    return await invoke<DatabaseHealthSummaryResult>(
      "get_database_health_summary_ai",
      {
        database,
        config,
      },
    );
  },

  /**
   * Reviews Schema Diff / Migration plan for potential data loss, lock risks, and strategies.
   */
  async reviewSchemaMigrationAi(
    diff: SchemaDiffResult,
    config: AiConfig,
  ): Promise<MigrationReviewResult> {
    return await invoke<MigrationReviewResult>("review_schema_migration_ai", {
      diff,
      config,
    });
  },

  /**
   * Generates technical reports in Markdown, HTML, and JSON.
   */
  async generateDatabaseReportAi(
    database: string,
    reportType: string,
    config?: AiConfig,
  ): Promise<GeneratedReport> {
    return await invoke<GeneratedReport>("generate_database_report_ai", {
      database,
      reportType,
      config,
    });
  },

  /**
   * Tests AI provider connectivity and latency.
   */
  async testAiProvider(config: AiConfig): Promise<AiCompletionResponse> {
    return await invoke<AiCompletionResponse>("test_ai_provider", {
      config,
    });
  },

  /**
   * Stores an API Key safely in the AES-256-GCM encrypted Vault (P0).
   * NEVER stored in localStorage or exposed to logs.
   */
  async saveAiApiKey(credentialId: string, apiKey: string): Promise<void> {
    return await invoke<void>("save_credential", {
      id: credentialId,
      secret: apiKey,
    });
  },

  /**
   * Checks if an API Key exists in the secure vault.
   */
  async hasAiApiKey(credentialId: string): Promise<boolean> {
    return await invoke<boolean>("has_credential", {
      id: credentialId,
    });
  },
};
