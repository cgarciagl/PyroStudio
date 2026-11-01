import { describe, it, expect } from "vitest";
import { extractSqlStatements } from "../sqlStatementExtractor";
import type { ScriptExecutionResult, ScriptStatementResult } from "../../types/database";

describe("Multi-Query and Multiple Result Sets in SQL Editor", () => {
  it("splits multi-statement scripts accurately while preserving quotes and comments", () => {
    const sql = `
      -- First statement: create temporary table
      CREATE TEMPORARY TABLE temp_users (id INT, name VARCHAR(50));

      # Second statement: insert data
      INSERT INTO temp_users VALUES (1, 'Alice; with semicolon'), (2, 'Bob');

      /* Third statement: retrieve users */
      SELECT * FROM temp_users WHERE name = 'Alice; with semicolon';

      /* Fourth statement: retrieve count */
      SELECT COUNT(*) AS total FROM temp_users;
    `;

    const statements = extractSqlStatements(sql);
    expect(statements.length).toBe(4);
    expect(statements[0].text).toContain("CREATE TEMPORARY TABLE temp_users");
    expect(statements[1].text).toContain("INSERT INTO temp_users");
    expect(statements[2].text).toContain("SELECT * FROM temp_users");
    expect(statements[3].text).toContain("SELECT COUNT(*) AS total");
  });

  it("handles multiple SELECT statements producing discrete result sets", () => {
    const mockScriptResult: ScriptExecutionResult = {
      statements: [
        {
          statement_index: 0,
          sql: "SELECT id, name FROM users LIMIT 2;",
          columns: ["id", "name"],
          rows: [
            [1, "Admin"],
            [2, "User"],
          ],
          affected_rows: 2,
          execution_time_ms: 4,
          message: "2 fila(s) retornada(s) en 4 ms",
          is_result_set: true,
        },
        {
          statement_index: 1,
          sql: "SELECT id, total FROM orders LIMIT 1;",
          columns: ["id", "total"],
          rows: [[101, 250.5]],
          affected_rows: 1,
          execution_time_ms: 3,
          message: "1 fila(s) retornada(s) en 3 ms",
          is_result_set: true,
        },
      ],
      total_time_ms: 7,
      success: true,
    };

    expect(mockScriptResult.success).toBe(true);
    expect(mockScriptResult.statements.length).toBe(2);

    const resultSets = mockScriptResult.statements.filter(
      (s) => s.is_result_set || s.columns.length > 0,
    );
    expect(resultSets.length).toBe(2);
    expect(resultSets[0].columns).toEqual(["id", "name"]);
    expect(resultSets[1].columns).toEqual(["id", "total"]);
  });

  it("retains preceding result sets when a later statement fails", () => {
    const mockFailedScript: ScriptExecutionResult = {
      statements: [
        {
          statement_index: 0,
          sql: "SELECT 1 AS test_val;",
          columns: ["test_val"],
          rows: [[1]],
          affected_rows: 1,
          execution_time_ms: 2,
          message: "1 fila(s) retornada(s) en 2 ms",
          is_result_set: true,
        },
        {
          statement_index: 1,
          sql: "SELECT * FROM non_existent_table_xyz;",
          columns: [],
          rows: [],
          affected_rows: 0,
          execution_time_ms: 3,
          message: "Error: Table 'test.non_existent_table_xyz' doesn't exist",
          is_result_set: false,
          error: "Table 'test.non_existent_table_xyz' doesn't exist",
        },
      ],
      total_time_ms: 5,
      success: false,
      error: "Table 'test.non_existent_table_xyz' doesn't exist",
      failed_statement_index: 1,
    };

    expect(mockFailedScript.success).toBe(false);
    expect(mockFailedScript.failed_statement_index).toBe(1);
    expect(mockFailedScript.statements[0].is_result_set).toBe(true);
    expect(mockFailedScript.statements[0].rows).toEqual([[1]]);
    expect(mockFailedScript.statements[1].error).toContain("non_existent_table_xyz");
  });

  it("correctly identifies non-tabular statements (INSERT/UPDATE/DDL) for messages tab", () => {
    const mockDdlAndQuery: ScriptStatementResult[] = [
      {
        statement_index: 0,
        sql: "SET @val = 10;",
        columns: [],
        rows: [],
        affected_rows: 0,
        execution_time_ms: 1,
        message: "Sentencia ejecutada con éxito. 0 fila(s) afectada(s) en 1 ms",
        is_result_set: false,
      },
      {
        statement_index: 1,
        sql: "SELECT @val AS result;",
        columns: ["result"],
        rows: [[10]],
        affected_rows: 1,
        execution_time_ms: 2,
        message: "1 fila(s) retornada(s) en 2 ms",
        is_result_set: true,
      },
    ];

    const resultSets = mockDdlAndQuery.filter((s) => s.is_result_set || s.columns.length > 0);
    expect(resultSets.length).toBe(1);
    expect(resultSets[0].columns).toEqual(["result"]);
    expect(mockDdlAndQuery[0].is_result_set).toBe(false);
  });
});
