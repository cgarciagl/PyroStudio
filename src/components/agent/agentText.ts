/** Pure helpers of the database agent: message parsing, prompt context and errors. */

export interface MessageChunk {
  type: "markdown" | "code";
  language: string;
  content: string;
}

/**
 * Split a message into markdown prose and fenced code blocks. Handles an unclosed fence
 * at the end (the answer is still streaming).
 */
export function parseMessageChunks(text: string): MessageChunk[] {
  const chunks: MessageChunk[] = [];
  const regex = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index === text.length) break;
    if (match.index > lastIndex) {
      const prose = text.slice(lastIndex, match.index);
      if (prose.trim()) chunks.push({ type: "markdown", language: "", content: prose });
    }
    const lang = (match[1] || "").trim().toLowerCase();
    const code = match[2];
    if (code.length > 0 || lang.length > 0) chunks.push({ type: "code", language: lang, content: code });
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) regex.lastIndex++;
  }
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining.trim()) chunks.push({ type: "markdown", language: "", content: remaining });
  }
  if (chunks.length === 0 && text.trim()) chunks.push({ type: "markdown", language: "", content: text });
  return chunks;
}

/** SQL blocks get highlighting and "open in editor", also when the fence has no language. */
export function isSqlChunk(chunk: MessageChunk): boolean {
  return (
    chunk.language === "sql" ||
    (!chunk.language && /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|SHOW|DESCRIBE|EXPLAIN|WITH)\b/i.test(chunk.content))
  );
}

/** Prompt sent to the agent: the question plus the tables the user focused on. */
export function promptWithFocus(text: string, database: string, pinnedTables: string[]): string {
  if (pinnedTables.length === 0) return text;
  return `${text}\n\n[CONTEXTO PRIORITARIO - SCHEMA PINNING ACTIVADO]:\nEl usuario ha fijado y priorizado específicamente las siguientes tablas de '${database}': ${pinnedTables
    .map((t) => `\`${t}\``)
    .join(", ")}.\nEnfoca tu análisis, explicaciones y consultas de inspección preferentemente en estas tablas.`;
}

/** Provider busy or out of quota: worth retrying later, not a configuration problem. */
export function isOverloadedError(message: string): boolean {
  return /ocupado|overloaded|exhausted|quota|429|503|529|saturado|busy|demanda|resource_exhausted/i.test(message);
}

export interface TranscriptMessage {
  sender: "user" | "agent";
  timestamp: string;
  text: string;
}

/** Conversation as Markdown, for copying out. */
export function transcriptMarkdown(messages: TranscriptMessage[]): string {
  return messages
    .map((m) => `### ${m.sender === "user" ? "Usuario" : "Agente de base de datos"} (${m.timestamp})\n\n${m.text}\n`)
    .join("\n---\n\n");
}

/** Questions offered before (and during) a conversation. */
export const SUGGESTED_PROMPTS = [
  "¿Hay índices redundantes o duplicados?",
  "¿Qué tablas no tienen clave primaria?",
  "¿Cuáles son las 5 tablas con más filas?",
  "¿Por qué esta consulta no usa índices eficientes?",
  "Audita la salud general y los cuellos de botella de este esquema",
];
