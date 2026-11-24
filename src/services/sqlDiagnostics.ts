import type { SqlDiagnosticResult } from "../types/database";
import i18n from "../i18n";

/**
 * Diagnostic patterns for common MySQL and MariaDB error codes and error text.
 */
interface ErrorDiagnosticPattern {
  code?: number;
  sqlstate?: string;
  pattern?: RegExp;
  key: string;
  docLink?: string;
}

const ERROR_PATTERNS: ErrorDiagnosticPattern[] = [
  {
    code: 1064,
    sqlstate: "42000",
    pattern: /syntax error|check the manual that corresponds to your MariaDB|check the manual that corresponds to your MySQL/i,
    key: "err1064",
  },
  {
    code: 1146,
    sqlstate: "42S02",
    pattern: /table .* doesn't exist/i,
    key: "err1146",
  },
  {
    code: 1054,
    sqlstate: "42S22",
    pattern: /unknown column/i,
    key: "err1054",
  },
  {
    code: 1062,
    sqlstate: "23000",
    pattern: /duplicate entry .* for key/i,
    key: "err1062",
  },
  {
    code: 1452,
    sqlstate: "23000",
    pattern: /cannot add or update a child row: a foreign key constraint fails/i,
    key: "err1452",
  },
  {
    code: 1451,
    sqlstate: "23000",
    pattern: /cannot delete or update a parent row: a foreign key constraint fails/i,
    key: "err1451",
  },
  {
    code: 1205,
    sqlstate: "HY000",
    pattern: /lock wait timeout exceeded/i,
    key: "err1205",
  },
  {
    code: 1213,
    sqlstate: "40001",
    pattern: /deadlock found when trying to get lock/i,
    key: "err1213",
  },
  {
    code: 1045,
    sqlstate: "28000",
    pattern: /access denied for user/i,
    key: "err1045",
  },
  {
    code: 1114,
    sqlstate: "HY000",
    pattern: /the table .* is full/i,
    key: "err1114",
  },
  {
    code: 1364,
    sqlstate: "HY000",
    pattern: /doesn't have a default value/i,
    key: "err1364",
  },
  {
    code: 1317,
    sqlstate: "70100",
    pattern: /query execution was interrupted|operación cancelada|interrupted/i,
    key: "err1317",
  },
  {
    pattern: /timeout|timed out|tiempo de espera excedido/i,
    key: "timeout",
  },
  {
    pattern: /connection refused|failed to connect|broken pipe|connection reset|network error|error de red|canal cerrado/i,
    key: "network",
  },
];

/**
 * Parses raw error strings and server error objects to produce structured diagnostics.
 * NEVER obscures or modifies the original error message.
 */
export function diagnoseSqlError(rawError: unknown): SqlDiagnosticResult {
  const errorStr =
    typeof rawError === "string"
      ? rawError
      : (rawError as Error)?.message || JSON.stringify(rawError);

  // Extract error code if present (e.g., Error 1064, Code: 1064, (errno: 1064))
  const codeMatch = errorStr.match(/(?:error|errno|code)\s*[:=]?\s*(\d{4,5})/i);
  const errorCode = codeMatch ? parseInt(codeMatch[1], 10) : undefined;

  // Extract SQLSTATE if present (e.g. SQLSTATE[42000] or SQLSTATE: 42000)
  const sqlStateMatch = errorStr.match(/SQLSTATE(?:\[|:\s*)([A-Z0-9]{5})/i);
  const sqlstate = sqlStateMatch ? sqlStateMatch[1] : undefined;

  // Extract query position if present (e.g. at line 1, column 15)
  const posMatch = errorStr.match(/(?:at line|line)\s*(\d+)/i);
  const errorPosition = posMatch ? parseInt(posMatch[1], 10) : undefined;

  // Match with known diagnostic catalog
  let matchedPattern: ErrorDiagnosticPattern | undefined;

  if (errorCode) {
    matchedPattern = ERROR_PATTERNS.find((p) => p.code === errorCode);
  }

  if (!matchedPattern && sqlstate) {
    matchedPattern = ERROR_PATTERNS.find((p) => p.sqlstate === sqlstate);
  }

  if (!matchedPattern) {
    matchedPattern = ERROR_PATTERNS.find((p) => p.pattern && p.pattern.test(errorStr));
  }

  if (matchedPattern) {
    return {
      original_error: errorStr,
      error_code: errorCode || matchedPattern.code,
      sqlstate: sqlstate || matchedPattern.sqlstate,
      message: errorStr,
      error_position: errorPosition,
      category: i18n.t(`errors:sqlDiagnostics.${matchedPattern.key}.category` as never),
      suggested_action: i18n.t(`errors:sqlDiagnostics.${matchedPattern.key}.suggestedAction` as never),
      explanation: i18n.t(`errors:sqlDiagnostics.${matchedPattern.key}.explanation` as never),
      documentation_link: matchedPattern.docLink,
    };
  }

  // Fallback for unrecognized errors
  return {
    original_error: errorStr,
    error_code: errorCode,
    sqlstate,
    message: errorStr,
    error_position: errorPosition,
    category: i18n.t("errors:sqlDiagnostics.fallback.category"),
    suggested_action: i18n.t("errors:sqlDiagnostics.fallback.suggestedAction"),
    explanation: i18n.t("errors:sqlDiagnostics.fallback.explanation"),
  };
}
