import { format, type ParamTypes } from "sql-formatter";
import type { SqlFormatOptions } from "../stores/preferenceStore";

/** `sql-formatter` grammar of each supported engine. */
export type SqlFormatLanguage = "mariadb" | "sqlite";

/**
 * Placeholders kept intact: `:name` SQL variables everywhere, plus SQLite's
 * own `?NNN`, `@name` and `$name` parameters.
 */
const PARAM_TYPES: Record<SqlFormatLanguage, ParamTypes> = {
  mariadb: { named: [":"] },
  sqlite: { positional: true, numbered: ["?"], named: [":", "@", "$"] },
};

/**
 * Formats SQL with the user's preferences. Throws if the text cannot be
 * parsed so the caller can leave the editor untouched.
 */
export function formatSql(
  sql: string,
  opts: SqlFormatOptions,
  language: SqlFormatLanguage = "mariadb",
): string {
  const formatted = format(sql, {
    language,
    keywordCase: opts.keywordCase,
    functionCase: opts.functionCase,
    dataTypeCase: opts.keywordCase,
    tabWidth: opts.indent === "4" ? 4 : 2,
    useTabs: opts.indent === "tab",
    logicalOperatorNewline: opts.logicalOperatorNewline,
    linesBetweenQueries: opts.linesBetweenQueries,
    denseOperators: opts.denseOperators,
    paramTypes: PARAM_TYPES[language],
  });
  const compact = opts.listStyle === "compact";
  let lines = outdentJoins(formatted.split("\n"));
  if (compact) lines = packLists(lines);
  // In compact mode packLists already decided which lists fit on their keyword line.
  return joinSingleLineClauses(lines, compact).join("\n");
}

/** Target line length when packing lists in compact mode. */
const LIST_LINE_WIDTH = 60;
// Clauses whose comma-separated items may be packed together.
const LIST_KEYWORDS = /^(select(?: distinct)?|from|group by|order by)$/i;
const HAS_COMMENT = /--|#|\/\*/;
// Body-level lines that close the previous multi-line item (`END AS c`, `) AS x`).
const ITEM_CLOSER = /^(end\b|\))/i;

// A line holding only clause keywords: `SELECT`, `GROUP BY`, `INSERT INTO`…
const CLAUSE_LINE = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
// Blocks whose body must stay on its own lines even when it is a single line.
const BLOCK_KEYWORDS = /^(case|begin)$/i;
// Clauses whose first condition stays on the keyword line: `WHERE a = 1`.
const CONDITION_KEYWORDS = /^(where|having)$/i;
const JOIN_LINE = /^(?:(?:natural|left|right|inner|outer|cross|full)\s+)*(?:join|straight_join)\b/i;
const LOGICAL_OPERATOR = /^(and|or|xor)\b/i;
const COMMENT_START = /^(--|#|\/\*)/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const isBlank = (line: string | undefined) => line === undefined || line.trim() === "";

/**
 * sql-formatter nests JOINs inside the FROM body, where extra ON conditions
 * look like siblings of the JOIN. Move every JOIN (with its own nested lines)
 * up to the FROM level so its `AND …` conditions read as indented under it.
 */
function outdentJoins(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    if (!/^from$/i.test(lines[i].trim())) continue;

    const clauseIndent = indentOf(lines[i]);
    const next = lines[i + 1];
    if (isBlank(next) || indentOf(next) <= clauseIndent) continue;
    const bodyIndent = indentOf(next);
    const unit = bodyIndent - clauseIndent;

    // Whether lines nested deeper than the body belong to a JOIN (and move with it).
    let inJoin = false;
    for (; i + 1 < lines.length; i++) {
      const line = lines[i + 1];
      if (isBlank(line) || indentOf(line) < bodyIndent) break;
      const text = line.trim();
      if (indentOf(line) === bodyIndent) {
        // A closing `) alias ON …` still belongs to the JOIN of a subquery.
        if (JOIN_LINE.test(text)) inJoin = true;
        else if (!(inJoin && text.startsWith(")"))) inJoin = false;
      }
      out.push(inJoin ? line.slice(unit) : line);
    }
  }
  return out;
}

/**
 * Packs the one-per-line items of SELECT/FROM/GROUP BY/ORDER BY lists into
 * lines of up to LIST_LINE_WIDTH, starting on the keyword line itself and
 * continuing on indented lines. Multi-line items (CASE, subqueries) and items
 * with comments keep their own lines.
 */
function packLists(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const next = lines[i + 1];
    if (!LIST_KEYWORDS.test(line.trim()) || isBlank(next) || indentOf(next) <= indentOf(line)) continue;

    // Group the body into items: a line at body indent plus its deeper lines.
    const bodyIndent = indentOf(next);
    const items: string[][] = [];
    while (i + 1 < lines.length && !isBlank(lines[i + 1]) && indentOf(lines[i + 1]) >= bodyIndent) {
      const startsItem = indentOf(lines[i + 1]) === bodyIndent && !ITEM_CLOSER.test(lines[i + 1].trim());
      if (startsItem || items.length === 0) items.push([]);
      items[items.length - 1].push(lines[++i]);
    }

    const isPackable = (item: string[]) => item.length === 1 && !HAS_COMMENT.test(item[0]);
    // Start filling on the keyword line itself: `SELECT a, b, c,`.
    let current: string | null = isPackable(items[0]) ? out.pop()! : null;
    for (const item of items) {
      if (!isPackable(item)) {
        if (current !== null) out.push(current);
        current = null;
        // Subqueries inside the item have their own lists to pack.
        out.push(...packLists(item));
      } else if (current !== null && `${current} ${item[0].trim()}`.length <= LIST_LINE_WIDTH) {
        current = `${current} ${item[0].trim()}`;
      } else {
        if (current !== null) out.push(current);
        current = item[0];
      }
    }
    if (current !== null) out.push(current);
  }
  return out;
}

/**
 * sql-formatter always puts a clause body on its own indented lines. When the
 * body is a single line (`SELECT *`, `FROM t`, `LIMIT 100`) keep it next to its
 * keyword; multi-line bodies are left untouched, except WHERE/HAVING, whose
 * first condition joins the keyword while the rest stay one per line.
 */
function joinSingleLineClauses(lines: string[], skipLists: boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const body = lines[i + 1];
    const after = lines[i + 2];
    const keyword = line.trim();
    const canJoin =
      !isBlank(body) &&
      CLAUSE_LINE.test(keyword) &&
      !BLOCK_KEYWORDS.test(keyword) &&
      !(skipLists && LIST_KEYWORDS.test(keyword)) &&
      indentOf(body) > indentOf(line) &&
      !COMMENT_START.test(body.trim());
    const isSingleLineBody = isBlank(after) || indentOf(after) <= indentOf(line);
    const isFirstCondition =
      CONDITION_KEYWORDS.test(keyword) &&
      !isBlank(after) &&
      indentOf(after) === indentOf(body) &&
      (LOGICAL_OPERATOR.test(after.trim()) || LOGICAL_OPERATOR.test(body.trim().split(/\s+/).pop() ?? ""));
    if (canJoin && (isSingleLineBody || isFirstCondition)) {
      out.push(`${line} ${body.trim()}`);
      i++;
    } else {
      out.push(line);
    }
  }
  return out;
}
