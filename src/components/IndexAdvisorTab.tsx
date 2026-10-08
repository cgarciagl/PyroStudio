import React, { useEffect, useState, useRef } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Table,
  Zap,
  Link as LinkIcon,
  Check,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { exportIndexAdvisorCsv, downloadFile } from "../services/diagnosticExport";
import type { IndexAdvisorReport } from "../types/database";
import { useUIStore } from "../stores/uiStore";
import { useSchemaStore } from "../stores/schemaStore";

interface IndexAdvisorTabProps {
  database: string;
  initialTableName?: string;
  onOpenQueryWithSql?: (sql: string) => void;
}

export const IndexAdvisorTab: React.FC<IndexAdvisorTabProps> = ({
  database,
  initialTableName,
  onOpenQueryWithSql,
}) => {
  const [report, setReport] = useState<IndexAdvisorReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "REDUNDANT" | "MISSING">("ALL");
  const [selectedTable, setSelectedTable] = useState<string>(initialTableName || "ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedSql, setCopiedSql] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const { openTab } = useUIStore();
  const { tables, loadSchemaObjects } = useSchemaStore();
  const dbTables = tables[database] || [];

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const stepTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load table list if not loaded
  useEffect(() => {
    if (dbTables.length === 0) {
      loadSchemaObjects(database);
    }
  }, [database, dbTables.length, loadSchemaObjects]);

  // Loading animation timer and step progression
  useEffect(() => {
    if (isLoading) {
      setElapsedSeconds(0);
      setLoadingStep(0);

      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => +(prev + 0.1).toFixed(1));
      }, 100);

      stepTimerRef.current = setInterval(() => {
        setLoadingStep((prev) => (prev < 2 ? prev + 1 : prev));
      }, 600);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    };
  }, [isLoading]);

  const loadReport = async (tableToAnalyze?: string) => {
    setIsLoading(true);
    setError(null);
    const targetTable = tableToAnalyze !== undefined ? tableToAnalyze : selectedTable;

    try {
      let res: IndexAdvisorReport;
      if (targetTable && targetTable !== "ALL") {
        res = await dbService.analyzeTableIndexes(database, targetTable);
      } else {
        res = await dbService.analyzeDatabaseIndexes(database);
      }
      setReport(res);
    } catch (err: unknown) {
      console.error("Failed to analyze indexes:", err);
      setError(
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al analizar los índices",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReport(selectedTable);
  }, [database, selectedTable]);

  const handleCopySql = (sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedSql(sql);
    setTimeout(() => setCopiedSql(null), 2000);
  };

  const handleOpenInEditor = (sql: string, tableName: string) => {
    const querySql = `-- Propuesta generada por Index Advisor para '${tableName}'\n${sql}\n`;
    if (onOpenQueryWithSql) {
      onOpenQueryWithSql(querySql);
    } else {
      openTab({
        id: `query-${Date.now()}`,
        title: `Optimizar ${tableName}`,
        type: "query",
        database,
        queryContent: querySql,
      });
    }
  };

  if (isLoading) {
    const steps = [
      "Consultando catálogo e índices (information_schema.STATISTICS)...",
      "Evaluando prefijos compuestos y cardinalidad redundante...",
      "Verificando restricciones de Foreign Keys sin índice líder...",
    ];

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#0a0c10] text-center select-none">
        <div className="max-w-md w-full p-6 rounded-2xl bg-[#11141c] border border-[#232a3e] shadow-2xl space-y-5">
          <div className="relative mx-auto w-16 h-16 rounded-2xl bg-orange-950/40 border border-orange-500/40 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-orange-400 animate-pulse" />
            <div className="absolute -inset-1 rounded-2xl bg-orange-500/10 animate-ping pointer-events-none" />
          </div>

          <div className="space-y-1">
            <h3 className="text-base font-bold text-white font-mono">
              Analizando Esquema de Índices
            </h3>
            <p className="text-xs text-neutral-400 font-mono">
              {selectedTable === "ALL"
                ? `Base de datos '${database}'`
                : `Tabla '${database}.${selectedTable}'`}
            </p>
          </div>

          {/* Dynamic Step Progress Indicator */}
          <div className="space-y-2 text-left">
            {steps.map((step, idx) => {
              const isDone = loadingStep > idx;
              const isCurrent = loadingStep === idx;
              return (
                <div
                  key={idx}
                  className={`flex items-center space-x-2.5 text-xs font-mono p-2 rounded-lg transition-all duration-300 ${
                    isCurrent
                      ? "bg-orange-950/30 text-orange-300 border border-orange-500/30"
                      : isDone
                      ? "text-emerald-400 bg-emerald-950/20"
                      : "text-neutral-600"
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : isCurrent ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400 shrink-0" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-neutral-700 shrink-0" />
                  )}
                  <span className="truncate">{step}</span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-neutral-500 pt-2 border-t border-[#1c2230]">
            <span>Análisis en curso...</span>
            <span className="text-orange-400 font-semibold">{elapsedSeconds}s</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#0a0c10] text-center">
        <AlertTriangle className="w-10 h-10 text-rose-500 mb-3" />
        <h3 className="text-base font-semibold text-white mb-1">Error de Análisis</h3>
        <p className="text-sm text-neutral-400 max-w-md mb-4">{error || "No se pudieron analizar los índices."}</p>
        <button
          onClick={() => loadReport(selectedTable)}
          className="px-4 py-2 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-md transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const filteredRecs = report.recommendations.filter((rec) => {
    if (typeFilter === "REDUNDANT" && !rec.is_redundant) return false;
    if (typeFilter === "MISSING" && rec.is_redundant) return false;
    if (
      searchTerm &&
      !rec.table_name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !rec.recommendation.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !rec.index_name.toLowerCase().includes(searchTerm.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col p-6 bg-[#0a0c10] overflow-y-auto space-y-6 select-none min-h-0">
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#1c2233] shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-orange-950/40 border border-orange-500/30 flex items-center justify-center text-orange-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-white font-mono">{database}</h2>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-orange-950/50 text-orange-400 border border-orange-800/40">
                Index Advisor
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Detección de índices redundantes por prefijo izquierdo y claves foráneas sin indexar
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Table Scope Selector */}
          <div className="flex items-center space-x-1.5 bg-[#141824] border border-[#232a3e] rounded-md px-2 py-1 text-xs">
            <Table className="w-3.5 h-3.5 text-neutral-400" />
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              className="bg-transparent text-neutral-200 font-mono text-xs focus:outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-[#11141c] text-white">
                Todas las tablas ({report.analyzed_tables_count})
              </option>
              {dbTables.map((t) => (
                <option key={t.name} value={t.name} className="bg-[#11141c] text-white">
                  Tabla: {t.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => exportIndexAdvisorCsv(report)}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-600/90 hover:bg-orange-500 border border-orange-500/40 rounded-md transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>

          <button
            onClick={() =>
              downloadFile(
                JSON.stringify(report, null, 2),
                `index_advisor_${database}_${Date.now()}.json`,
                "application/json",
              )
            }
            title="Exportar como JSON"
            className="p-1.5 text-neutral-400 hover:text-white bg-[#141824] hover:bg-[#1f2535] border border-[#232a3e] rounded-md transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={() => loadReport(selectedTable)}
            title="Re-analizar índices"
            className="p-1.5 text-neutral-400 hover:text-white bg-[#141824] hover:bg-[#1f2535] border border-[#232a3e] rounded-md transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-orange-400" />
          </button>
        </div>
      </div>

      {/* Advisor Disclaimer Banner */}
      <div className="p-3.5 rounded-xl bg-[#141824] border border-[#232a3e] flex items-center justify-between text-xs text-neutral-300 shrink-0">
        <div className="flex items-center space-x-2.5">
          <AlertCircle className="w-4 h-4 text-orange-400 shrink-0" />
          <span>
            <strong>Nota de Seguridad:</strong> Index Advisor presenta recomendaciones no invasivas. NUNCA se ejecutan sentencias <code className="px-1 py-0.5 rounded bg-[#1f2638] font-mono text-orange-300">ALTER TABLE</code> de forma automática.
          </span>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 shrink-0">
        <div className="p-4 rounded-xl bg-[#11141c] border border-[#1f2535] flex items-center justify-between">
          <div>
            <span className="text-xs text-neutral-400 font-medium">Tablas Analizadas</span>
            <h3 className="text-2xl font-bold text-white font-mono mt-1">
              {report.analyzed_tables_count}
            </h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-indigo-950/40 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Table className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141c] border border-[#1f2535] flex items-center justify-between">
          <div>
            <span className="text-xs text-neutral-400 font-medium">Índices Redundantes</span>
            <h3 className={`text-2xl font-bold font-mono mt-1 ${
              report.redundant_indexes_count > 0 ? "text-amber-400" : "text-emerald-400"
            }`}>
              {report.redundant_indexes_count}
            </h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-950/40 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Zap className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141c] border border-[#1f2535] flex items-center justify-between">
          <div>
            <span className="text-xs text-neutral-400 font-medium">FKs sin Indexar</span>
            <h3 className={`text-2xl font-bold font-mono mt-1 ${
              report.missing_indexes_count > 0 ? "text-orange-400" : "text-emerald-400"
            }`}>
              {report.missing_indexes_count}
            </h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-orange-950/40 border border-orange-500/30 flex items-center justify-center text-orange-400">
            <LinkIcon className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#11141c] border border-[#1f2535] flex items-center justify-between">
          <div>
            <span className="text-xs text-neutral-400 font-medium">Total Recomendaciones</span>
            <h3 className="text-2xl font-bold text-white font-mono mt-1">
              {report.recommendations.length}
            </h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setTypeFilter("ALL")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-colors ${
              typeFilter === "ALL"
                ? "bg-orange-600 text-white"
                : "bg-[#141824] text-neutral-400 hover:text-white"
            }`}
          >
            Todas ({report.recommendations.length})
          </button>
          <button
            onClick={() => setTypeFilter("REDUNDANT")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-colors ${
              typeFilter === "REDUNDANT"
                ? "bg-amber-600 text-white"
                : "bg-[#141824] text-neutral-400 hover:text-white"
            }`}
          >
            Redundantes ({report.redundant_indexes_count})
          </button>
          <button
            onClick={() => setTypeFilter("MISSING")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-colors ${
              typeFilter === "MISSING"
                ? "bg-sky-600 text-white"
                : "bg-[#141824] text-neutral-400 hover:text-white"
            }`}
          >
            FK sin Indexar ({report.missing_indexes_count})
          </button>
        </div>

        <input
          type="text"
          placeholder="Filtrar por tabla o índice..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-1.5 bg-[#141824] border border-[#232a3e] rounded-lg text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-orange-500/50 w-64"
        />
      </div>

      {/* Recommendations Cards List */}
      {filteredRecs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 bg-[#11141c] border border-emerald-900/30 rounded-2xl text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-emerald-400" />
          <h3 className="text-base font-bold text-white">¡No se encontraron problemas de índices!</h3>
          <p className="text-xs text-neutral-400 max-w-md">
            {report.recommendations.length === 0
              ? "Todas las tablas y claves foráneas analizadas tienen una cobertura de índices óptima."
              : "No hay recomendaciones que coincidan con los filtros de búsqueda aplicados."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRecs.map((rec, idx) => (
            <div
              key={idx}
              className="p-5 rounded-xl bg-[#11141c] border border-[#1f2535] space-y-4 shadow-lg hover:border-[#2a3449] transition-all"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2.5">
                  <span
                    className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono ${
                      rec.is_redundant
                        ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                        : "bg-sky-500/15 text-sky-300 border border-sky-500/30"
                    }`}
                  >
                    {rec.is_redundant ? "Índice Redundante" : "Falta Índice en FK"}
                  </span>
                  <span className="font-mono text-sm font-bold text-white">
                    {rec.table_name}.{rec.index_name}
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleCopySql(rec.sql_proposal)}
                    className="flex items-center space-x-1.5 px-3 py-1 bg-[#171b26] hover:bg-[#202738] border border-[#252c3e] rounded text-neutral-300 hover:text-white transition-colors text-xs font-mono"
                  >
                    {copiedSql === rec.sql_proposal ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">¡Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar SQL</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleOpenInEditor(rec.sql_proposal, rec.table_name)}
                    className="flex items-center space-x-1.5 px-3 py-1 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/40 rounded text-orange-300 font-semibold transition-colors text-xs font-mono"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Abrir en Consulta</span>
                  </button>
                </div>
              </div>

              <div className="text-xs text-neutral-300 space-y-1">
                <p className="font-semibold text-white">{rec.recommendation}</p>
                <p className="text-neutral-400 leading-relaxed">{rec.reason}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-[#0d0f15] border border-[#1c2230]">
                  <strong className="text-emerald-400">Beneficio estimado:</strong>{" "}
                  <span className="text-neutral-300">{rec.estimated_benefit}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0d0f15] border border-[#1c2230]">
                  <strong className="text-amber-400">Costo potencial:</strong>{" "}
                  <span className="text-neutral-300">{rec.potential_cost}</span>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-neutral-500 font-mono">
                  Propuesta SQL:
                </span>
                <div className="p-3 bg-[#0a0c10] border border-[#1c2230] rounded-lg font-mono text-xs text-orange-300 overflow-x-auto">
                  <code>{rec.sql_proposal}</code>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
