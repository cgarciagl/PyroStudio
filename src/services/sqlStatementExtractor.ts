/**
 * SQL Statement Extractor & Resolver
 * Accurately parses multi-statement SQL scripts considering strings, backticks,
 * line comments (-- and #), and block comments (/* ... *\/).
 */

export interface SqlStatementSegment {
  text: string;
  start: number;
  end: number;
  index: number;
}

export type ExecutionTargetMode = "auto" | "selection" | "statement" | "all";

export interface ExecutionTargetResult {
  sql: string;
  mode: "selection" | "statement" | "all";
  statementIndex?: number;
  totalStatements: number;
  hasSelection: boolean;
  preview: string;
}

/**
 * Splits SQL script into discrete statements, respecting quotes and comments.
 */
export function extractSqlStatements(sql: string): SqlStatementSegment[] {
  const statements: SqlStatementSegment[] = [];
  if (!sql || !sql.trim()) return statements;

  const len = sql.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let currentStart = 0;

  for (let i = 0; i < len; i++) {
    const ch = sql[i];
    const nextCh = i + 1 < len ? sql[i + 1] : "";

    // 1. Inside line comment
    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false;
      }
      continue;
    }

    // 2. Inside block comment
    if (inBlockComment) {
      if (ch === "*" && nextCh === "/") {
        inBlockComment = false;
        i++; // skip /
      }
      continue;
    }

    // 3. Inside single quote string
    if (inSingleQuote) {
      if (ch === "\\") {
        i++; // skip escaped char
      } else if (ch === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    // 4. Inside double quote string
    if (inDoubleQuote) {
      if (ch === "\\") {
        i++; // skip escaped char
      } else if (ch === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    // 5. Inside backticks
    if (inBacktick) {
      if (ch === "\\") {
        i++; // skip escaped char
      } else if (ch === "`") {
        inBacktick = false;
      }
      continue;
    }

    // 6. Check transitions into comments or quotes
    if (ch === "-" && nextCh === "-") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "#") {
      inLineComment = true;
      continue;
    }
    if (ch === "/" && nextCh === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === "`") {
      inBacktick = true;
      continue;
    }

    // 7. Statement boundary: semicolon
    if (ch === ";") {
      const rawText = sql.slice(currentStart, i).trim();
      if (rawText.length > 0) {
        statements.push({
          text: rawText,
          start: currentStart,
          end: i + 1,
          index: statements.length,
        });
      }
      currentStart = i + 1;
    }
  }

  // Final trailing statement without semicolon
  if (currentStart < len) {
    const rawText = sql.slice(currentStart, len).trim();
    if (rawText.length > 0) {
      statements.push({
        text: rawText,
        start: currentStart,
        end: len,
        index: statements.length,
      });
    }
  }

  return statements;
}

/**
 * Determines which SQL should be executed based on user selection, cursor position,
 * and requested execution mode.
 */
export function resolveExecutionTarget({
  fullText,
  selectionText,
  cursorOffset,
  preferredMode = "auto",
}: {
  fullText: string;
  selectionText?: string | null;
  cursorOffset?: number | null;
  preferredMode?: ExecutionTargetMode;
}): ExecutionTargetResult {
  const trimmedFull = (fullText || "").trim();
  const trimmedSelection = (selectionText || "").trim();
  const hasSelection = trimmedSelection.length > 0;

  // 1. Explicit selection mode or auto with active selection
  if ((preferredMode === "selection" && hasSelection) || (preferredMode === "auto" && hasSelection)) {
    return {
      sql: trimmedSelection,
      mode: "selection",
      totalStatements: 1,
      hasSelection: true,
      preview: createPreview(trimmedSelection),
    };
  }

  // 2. Explicit "all" mode
  if (preferredMode === "all") {
    const statements = extractSqlStatements(trimmedFull);
    return {
      sql: trimmedFull,
      mode: "all",
      totalStatements: statements.length || 1,
      hasSelection,
      preview: createPreview(trimmedFull),
    };
  }

  // 3. Statement mode (or auto without selection)
  const statements = extractSqlStatements(fullText);

  if (statements.length === 0) {
    return {
      sql: trimmedFull,
      mode: "all",
      totalStatements: 0,
      hasSelection: false,
      preview: "",
    };
  }

  if (statements.length === 1) {
    return {
      sql: statements[0].text,
      mode: "statement",
      statementIndex: 0,
      totalStatements: 1,
      hasSelection: false,
      preview: createPreview(statements[0].text),
    };
  }

  // Multiple statements: locate which statement encompasses cursorOffset
  const offset = cursorOffset ?? 0;
  let matchedStatement = statements.find((s) => offset >= s.start && offset <= s.end);

  // If cursor is outside boundaries (e.g. at end of file after whitespace), use last statement
  if (!matchedStatement) {
    if (offset >= statements[statements.length - 1].end) {
      matchedStatement = statements[statements.length - 1];
    } else {
      matchedStatement = statements[0];
    }
  }

  return {
    sql: matchedStatement.text,
    mode: "statement",
    statementIndex: matchedStatement.index,
    totalStatements: statements.length,
    hasSelection: false,
    preview: createPreview(matchedStatement.text),
  };
}

function createPreview(sql: string, maxLen = 45): string {
  const singleLine = sql.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen) + "…";
}

