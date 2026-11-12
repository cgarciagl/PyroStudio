import { describe, it, expect } from "vitest";
import { isOverloadedError, isSqlChunk, parseMessageChunks, promptWithFocus, transcriptMarkdown } from "../agentText";
import { aiReadiness } from "../../../services/aiReadiness";

describe("agent text helpers", () => {
  it("splits prose and code, also with an unclosed fence while streaming", () => {
    const chunks = parseMessageChunks("Hola\n```sql\nSELECT 1;\n```\nfin\n```sql\nSELECT 2");
    expect(chunks.map((c) => c.type)).toEqual(["markdown", "code", "markdown", "code"]);
    expect(chunks[3].content).toBe("SELECT 2");
  });

  it("treats unlabeled fences that start with SQL as SQL", () => {
    expect(isSqlChunk({ type: "code", language: "", content: "  WITH x AS (SELECT 1) SELECT * FROM x" })).toBe(true);
    expect(isSqlChunk({ type: "code", language: "json", content: "{}" })).toBe(false);
  });

  it("adds the focus tables to the prompt only when there are some", () => {
    expect(promptWithFocus("¿índices?", "db", [])).toBe("¿índices?");
    expect(promptWithFocus("¿índices?", "db", ["a", "b"])).toContain("`a`, `b`");
  });

  it("recognizes provider overload / quota errors", () => {
    expect(isOverloadedError("429 RESOURCE_EXHAUSTED")).toBe(true);
    expect(isOverloadedError("Invalid API key")).toBe(false);
  });

  it("exports the conversation as Markdown", () => {
    const md = transcriptMarkdown([
      { sender: "user", timestamp: "10:00", text: "hola" },
      { sender: "agent", timestamp: "10:01", text: "respuesta" },
    ]);
    expect(md).toContain("### Usuario (10:00)");
    expect(md).toContain("---");
  });
});

describe("aiReadiness", () => {
  it("explains why the AI cannot answer", () => {
    expect(aiReadiness({ enabled: false, privacy_mode: false, provider: "gemini" })).toMatchObject({ ready: false, reason: "disabled" });
    expect(aiReadiness({ enabled: true, privacy_mode: true, provider: "gemini" })).toMatchObject({ ready: false, reason: "privacy" });
    expect(aiReadiness({ enabled: true, privacy_mode: true, provider: "ollama" }).ready).toBe(true);
    expect(aiReadiness({ enabled: true, privacy_mode: false, provider: "gemini" }).ready).toBe(true);
  });
});
