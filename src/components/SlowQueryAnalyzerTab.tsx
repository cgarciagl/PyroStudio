import React, { useState } from "react";
import { DatabaseScopeBar } from "./ui/DatabaseScopeBar";
import { tabClass } from "./ui/styles";
import { ExplainAnalyzer } from "./slowQuery/ExplainAnalyzer";
import { ServerActivity } from "./slowQuery/ServerActivity";
import { useExplainAnalysis } from "./slowQuery/useExplainAnalysis";

interface SlowQueryAnalyzerTabProps {
  database: string;
  initialQuery?: string;
  initialSql?: string;
  initialView?: "custom" | "server_log";
}

/** Slow queries: analyze one statement with EXPLAIN, or find them in the server's activity. */
export const SlowQueryAnalyzerTab: React.FC<SlowQueryAnalyzerTabProps> = ({ database, initialQuery, initialSql, initialView }) => {
  const [view, setView] = useState<"custom" | "server_log">(initialView || "custom");
  const explain = useExplainAnalysis(
    database,
    initialSql ||
      initialQuery ||
      `SELECT * FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${(database || "test").replace(/'/g, "''")}' ORDER BY DATA_LENGTH DESC LIMIT 50;`,
  );

  // A statement picked from the server activity opens in the analyzer, already analyzed.
  const explainFromServer = (sql: string) => {
    setView("custom");
    void explain.analyze(sql);
  };

  return (
    <div
      className="pyro-view pyro-diagnostic-workspace pyro-slow-query-workspace flex-1 flex flex-col p-5 bg-canvas overflow-y-auto gap-4 min-h-0"
      data-slow-query-view
    >
      <DatabaseScopeBar data-slow-query-header database={database} tool="Consultas lentas y EXPLAIN" />

      <div role="tablist" data-slow-query-switcher className="flex items-center gap-1 border-b border-line -mt-1">
        <button type="button" role="tab" aria-selected={view === "custom"} onClick={() => setView("custom")} className={tabClass(view === "custom")}>
          Analizar una consulta
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "server_log"}
          onClick={() => setView("server_log")}
          className={tabClass(view === "server_log")}
        >
          Actividad del servidor
        </button>
      </div>

      {view === "custom" ? <ExplainAnalyzer {...explain} /> : <ServerActivity database={database} onExplain={explainFromServer} />}
    </div>
  );
};
