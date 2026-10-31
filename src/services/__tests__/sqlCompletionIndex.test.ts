import { describe, expect, it } from "vitest";
import { SqlCompletionIndex, SQL_STATIC_COMPLETIONS } from "../sqlCompletionIndex";
import type { Completion, CompletionContext } from "@codemirror/autocomplete";

function createMockContext(textBefore: string, explicit = false): CompletionContext {
  return {
    pos: textBefore.length,
    explicit,
    matchBefore: (regex: RegExp) => {
      const anchored = new RegExp(regex.source + "$");
      const match = textBefore.match(anchored);
      if (!match) return null;
      return {
        from: textBefore.length - match[0].length,
        to: textBefore.length,
        text: match[0],
      };
    },
  } as unknown as CompletionContext;
}

describe("SqlCompletionIndex", () => {
  const schema = {
    users: ["id", "username", "email", "created_at"],
    orders: ["id", "user_id", "total_cents", "status"],
  };

  const routines = [
    {
      name: "calculate_tax",
      routine_type: "FUNCTION" as const,
      data_type: "DECIMAL",
    },
  ];

  const snippets: Completion[] = [
    {
      label: "selusers",
      detail: "Select all users",
      info: "Quick user query",
      type: "text",
      boost: 50,
    },
  ];

  it("indexes static SQL functions and MariaDB Vector extensions", () => {
    expect(SQL_STATIC_COMPLETIONS.some((c) => c.label === "COUNT")).toBe(true);
    expect(SQL_STATIC_COMPLETIONS.some((c) => c.label === "VEC_DISTANCE")).toBe(true);
    expect(SQL_STATIC_COMPLETIONS.some((c) => c.label === "FOR SYSTEM_TIME ALL")).toBe(true);
  });

  it("completes general word prefixes accurately", () => {
    const index = new SqlCompletionIndex();
    index.buildIndex(schema, routines, snippets);

    const context = createMockContext("use");
    const result = index.getCompletions(context);

    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("users");
    expect(labels).toContain("username");
    expect(labels).toContain("user_id");
  });

  it("resolves table dot notation for columns", () => {
    const index = new SqlCompletionIndex();
    index.buildIndex(schema, routines, snippets);

    // Typing `users.`
    const context = createMockContext("SELECT * FROM users.");
    const result = index.getCompletions(context);

    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(["id", "username", "email", "created_at"]);
  });

  it("filters table dot notation with column prefix", () => {
    const index = new SqlCompletionIndex();
    index.buildIndex(schema, routines, snippets);

    // Typing `users.em`
    const context = createMockContext("SELECT users.em");
    const result = index.getCompletions(context);

    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(["email"]);
  });

  it("prioritizes snippets with high boost", () => {
    const index = new SqlCompletionIndex();
    index.buildIndex(schema, routines, snippets);

    const context = createMockContext("sel");
    const result = index.getCompletions(context);

    expect(result).not.toBeNull();
    const snippetItem = result!.options.find((o) => o.label === "selusers");
    expect(snippetItem).toBeDefined();
    expect(snippetItem!.boost).toBe(50);
  });

  it("returns null on whitespace when completion is not explicit", () => {
    const index = new SqlCompletionIndex();
    index.buildIndex(schema, routines, snippets);

    const context = createMockContext("SELECT   ", false);
    const result = index.getCompletions(context);

    expect(result).toBeNull();
  });

  it("returns completions on whitespace when completion is explicit (Ctrl+Space)", () => {
    const index = new SqlCompletionIndex();
    index.buildIndex(schema, routines, snippets);

    const context = createMockContext("   ", true);
    const result = index.getCompletions(context);

    expect(result).not.toBeNull();
    expect(result!.options.length).toBeGreaterThan(0);
  });
});
