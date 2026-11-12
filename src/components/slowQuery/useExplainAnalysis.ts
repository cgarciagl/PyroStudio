import { useState } from "react";
import type { SlowQueryAnalysis } from "../../types/database";
import { explainCache } from "../../services/explainCache";
import { errorText } from "../../utils/errors";

/** The query under analysis and its EXPLAIN result (cached for a minute by explainCache). */
export function useExplainAnalysis(database: string, initialSql: string) {
  const [query, setQuery] = useState(initialSql);
  const [analysis, setAnalysis] = useState<SlowQueryAnalysis | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async (sql?: string, forceRefresh = false) => {
    const target = (sql ?? query).trim();
    if (!target) return;
    if (sql !== undefined) setQuery(sql);
    setIsLoading(true);
    setError(null);
    try {
      const res = await explainCache.analyzeWithCache(target, database, { forceRefresh });
      setAnalysis(res.analysis);
      setFromCache(res.fromCache);
    } catch (err: unknown) {
      setError(errorText(err, "Error al analizar el plan de ejecución de la consulta"));
    } finally {
      setIsLoading(false);
    }
  };

  return { query, setQuery, analysis, fromCache, isLoading, error, analyze };
}

export type ExplainAnalysis = ReturnType<typeof useExplainAnalysis>;
