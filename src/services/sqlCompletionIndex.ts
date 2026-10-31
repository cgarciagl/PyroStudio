import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { RoutineMetadata } from "../types/database";

/**
 * Standard and extended SQL functions, allocated once at module scope.
 */
export const SQL_STATIC_COMPLETIONS: readonly Completion[] = [
  { label: "COUNT", type: "function", detail: "COUNT(expr)", boost: 1 },
  { label: "SUM", type: "function", detail: "SUM(expr)", boost: 1 },
  { label: "AVG", type: "function", detail: "AVG(expr)", boost: 1 },
  { label: "MIN", type: "function", detail: "MIN(expr)", boost: 1 },
  { label: "MAX", type: "function", detail: "MAX(expr)", boost: 1 },
  { label: "COALESCE", type: "function", detail: "COALESCE(val, fallback)", boost: 1 },
  { label: "IFNULL", type: "function", detail: "IFNULL(expr1, expr2)", boost: 1 },
  { label: "CONCAT", type: "function", detail: "CONCAT(s1, s2, ...)", boost: 1 },
  { label: "GROUP_CONCAT", type: "function", detail: "GROUP_CONCAT(expr)", boost: 1 },
  { label: "DATE_FORMAT", type: "function", detail: "DATE_FORMAT(date, format)", boost: 1 },
  { label: "DATEDIFF", type: "function", detail: "DATEDIFF(d1, d2)", boost: 1 },
  { label: "NOW", type: "function", detail: "NOW()", boost: 1 },
  { label: "CURDATE", type: "function", detail: "CURDATE()", boost: 1 },
  { label: "UNIX_TIMESTAMP", type: "function", detail: "UNIX_TIMESTAMP()", boost: 1 },
  { label: "JSON_EXTRACT", type: "function", detail: "JSON_EXTRACT(doc, path)", boost: 1 },
  { label: "JSON_UNQUOTE", type: "function", detail: "JSON_UNQUOTE(val)", boost: 1 },
  { label: "LAST_INSERT_ID", type: "function", detail: "LAST_INSERT_ID()", boost: 1 },
  { label: "UUID", type: "function", detail: "UUID()", boost: 1 },
  // MariaDB Vector functions (11.7+ / 11.8+)
  { label: "VEC_FromText", type: "function", detail: "VEC_FromText('[1.0, 2.0, ...]') (MariaDB Vector)", boost: 1 },
  { label: "VEC_ToText", type: "function", detail: "VEC_ToText(vector_column) (MariaDB Vector)", boost: 1 },
  { label: "VEC_DISTANCE", type: "function", detail: "VEC_DISTANCE(vec1, vec2) (MariaDB Vector)", boost: 1 },
  { label: "VEC_DISTANCE_COSINE", type: "function", detail: "VEC_DISTANCE_COSINE(vec1, vec2) (MariaDB Vector)", boost: 1 },
  { label: "VEC_DISTANCE_EUCLIDEAN", type: "function", detail: "VEC_DISTANCE_EUCLIDEAN(vec1, vec2) (MariaDB Vector)", boost: 1 },
  // MariaDB Temporal keywords
  { label: "FOR SYSTEM_TIME ALL", type: "keyword", detail: "Historial completo (MariaDB Temporal)", boost: 1 },
  { label: "FOR SYSTEM_TIME AS OF", type: "keyword", detail: "Estado exacto en fecha (MariaDB Temporal)", boost: 1 },
  { label: "FOR SYSTEM_TIME BETWEEN", type: "keyword", detail: "Intervalo temporal (MariaDB Temporal)", boost: 1 },
  // MariaDB Sequences keywords
  { label: "NEXT VALUE FOR", type: "keyword", detail: "NEXT VALUE FOR sequence_name", boost: 1 },
  { label: "PREVIOUS VALUE FOR", type: "keyword", detail: "PREVIOUS VALUE FOR sequence_name", boost: 1 },
];

const MAX_CANDIDATES = 100;

/**
 * Fast prefix index for SQL completions.
 * Indexes tables, columns, routines, snippets, and functions into prefix buckets
 * for sub-millisecond retrieval on large databases with thousands of objects.
 */
export class SqlCompletionIndex {
  private schemaMap: Map<string, Completion[]> = new Map();
  private prefixMap: Map<string, Completion[]> = new Map();
  private allGeneralItems: Completion[] = [];

  /**
   * Builds the completion index from database schema, routines, and user snippets.
   */
  public buildIndex(
    schema: Record<string, string[]>,
    routines: RoutineMetadata[] = [],
    snippets: Completion[] = [],
  ): void {
    this.schemaMap.clear();
    this.prefixMap.clear();

    const generalItems: Completion[] = [];

    // 1. Snippets (highest boost for quick expansion)
    for (const s of snippets) {
      generalItems.push(s);
    }

    // 2. Tables and columns from schema
    for (const [tbl, columns] of Object.entries(schema)) {
      generalItems.push({
        label: tbl,
        type: "type",
        detail: "Tabla",
        boost: 5,
      });

      const colCompletions: Completion[] = [];
      for (const col of columns) {
        const colItem: Completion = {
          label: col,
          type: "property",
          detail: `Columna (${tbl})`,
          boost: 3,
        };
        colCompletions.push(colItem);
        // Also add columns to general completions for unqualified SELECTs
        generalItems.push(colItem);
      }
      this.schemaMap.set(tbl.toLowerCase(), colCompletions);
    }

    // 3. Routines (Functions & Procedures)
    for (const r of routines) {
      generalItems.push({
        label: r.name,
        type: "function",
        detail: r.routine_type === "FUNCTION" ? "Función" : "Procedimiento",
        boost: 2,
      });
    }

    // 4. Static SQL functions
    for (const fn of SQL_STATIC_COMPLETIONS) {
      generalItems.push(fn);
    }

    this.allGeneralItems = generalItems;

    // 5. Index into 1-character and 2-character prefix buckets
    for (const item of generalItems) {
      const lower = item.label.toLowerCase();
      if (lower.length >= 1) {
        const p1 = lower.slice(0, 1);
        let b1 = this.prefixMap.get(p1);
        if (!b1) {
          b1 = [];
          this.prefixMap.set(p1, b1);
        }
        b1.push(item);
      }

      if (lower.length >= 2) {
        const p2 = lower.slice(0, 2);
        let b2 = this.prefixMap.get(p2);
        if (!b2) {
          b2 = [];
          this.prefixMap.set(p2, b2);
        }
        b2.push(item);
      }
    }
  }

  /**
   * Resolves completions for the active CodeMirror context.
   */
  public getCompletions(context: CompletionContext): CompletionResult | null {
    // 1. Check for table dot access: `table.` or `table.col_prefix`
    const dotMatch = context.matchBefore(/`?([a-zA-Z0-9_$]+)`?\.\s*([\w$]*)$/);
    if (dotMatch) {
      const fullText = dotMatch.text;
      const dotIndex = fullText.lastIndexOf(".");
      const tableName = fullText.slice(0, dotIndex).replace(/[`\s]/g, "").toLowerCase();
      const colPrefix = fullText.slice(dotIndex + 1).trim().toLowerCase();

      const tableColumns = this.schemaMap.get(tableName);
      if (tableColumns && tableColumns.length > 0) {
        const filtered = colPrefix
          ? tableColumns.filter((c) => c.label.toLowerCase().startsWith(colPrefix))
          : tableColumns;

        return {
          from: dotMatch.from + dotIndex + 1,
          options: filtered.slice(0, MAX_CANDIDATES),
          filter: true,
        };
      }
    }

    // 2. Check for general word token
    const word = context.matchBefore(/[\w$]+/);
    if (!word && !context.explicit) {
      return null;
    }

    if (!word || word.text.length === 0) {
      // Explicit trigger (Ctrl+Space) with no typed characters
      return {
        from: context.pos,
        options: this.allGeneralItems.slice(0, MAX_CANDIDATES),
        filter: true,
      };
    }

    const prefix = word.text.toLowerCase();
    let candidates: Completion[];

    if (prefix.length >= 2) {
      candidates = this.prefixMap.get(prefix.slice(0, 2)) || [];
    } else if (prefix.length === 1) {
      candidates = this.prefixMap.get(prefix.slice(0, 1)) || [];
    } else {
      candidates = this.allGeneralItems;
    }

    // Filter candidate bucket by prefix
    const matches: Completion[] = [];
    for (const item of candidates) {
      if (item.label.toLowerCase().includes(prefix)) {
        matches.push(item);
        if (matches.length >= MAX_CANDIDATES) break;
      }
    }

    return {
      from: word.from,
      options: matches,
      filter: true,
    };
  }
}
