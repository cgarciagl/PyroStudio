import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Table,
  Trash2,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { exportIndexAdvisorCsv, downloadFile } from "../services/diagnosticExport";
import type { IndexAdvisorReport } from "../types/database";
import { useUIStore } from "../stores/uiStore";

interface IndexAdvisorTabProps {
  database: string;
  onOpenQueryWithSql?: (sql: string) => void;
}

export const IndexAdvisorTab: React.FC<IndexAdvisorTabProps> = ({
  database,
  onOpenQueryWithSql,
}) => {
  const [report, setReport] = useState<IndexAdvisorReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "REDUNDANT" | "MISSING">("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedSql, setCopiedSql] = useState<string | null>(null);
  const { openTab } = useUIStore();

  const loadReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await dbService.analyzeDatabaseIndexes(database);
      setReport(res);
    } catch (err: unknown) {
      console.error("Failed to analyze indexes:", err);
      setError(
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al analizar los índices de la base de datos",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [database]);

  const handleCopySql = (sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedSql(sql);
    setTimeout(() => setCopiedSql(null), 2000);
  };

  const handleOpenInEditor = (sql: string) => {
    const querySql = `-- Propuesta generada por Index Advisor\n${sql}\n`;
    if (onOpenQueryWithSql) {
      onOpenQueryWithSql(querySql);
    } else {
      openTab({
        id: `query-${Date.now()}`,
        title: "Optimización de Índice",
        type: "query",
        database,
        queryContent: querySql,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-neutral-400 bg-[#0a0c10]">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500 mb-3" />
        <span className="text-sm font-medium">Analizando índices y restricciones de '{database}'...</span>
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
          onClick={loadReport}
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

        <div className="flex items-center space-x-2">
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
            onClick={loadReport}
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

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 shrink-0">
        <div
          onClick={() => setTypeFilter(typeFilter === "REDUNDANT" ? "ALL" : "REDUNDANT")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            typeFilter === "REDUNDANT"
              ? "bg-amber-950/40 border-amber-600"
              : "bg-[#11141e] border-[#1f2638] hover:border-amber-900/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
              Índices Redundantes
            </span>
            <Trash2 className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-extrabold text-amber-300 font-mono mt-2">
            {report.redundant_indexes_count}
          </div>
          <span className="text-[11px] text-neutral-500">Cubiertos por prefijo en otro índice compuesto</span>
        </div>

        <div
          onClick={() => setTypeFilter(typeFilter === "MISSING" ? "ALL" : "MISSING")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            typeFilter === "MISSING"
              ? "bg-sky-950/40 border-sky-600"
              : "bg-[#11141e] border-[#1f2638] hover:border-sky-900/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-sky-400 uppercase tracking-wider">
              Foreign Keys Sin Índice
            </span>
            <Plus className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-extrabold text-sky-300 font-mono mt-2">
            {report.missing_indexes_count}
          </div>
          <span className="text-[11px] text-neutral-500">Pueden causar bloqueos de tabla en DELETE/JOIN</span>
        </div>

        <div className="p-4 rounded-xl bg-[#11141e] border border-[#1f2638]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              Tablas Analizadas
            </span>
            <Table className="w-4 h-4 text-neutral-400" />
          </div>
          <div className="text-2xl font-extrabold text-white font-mono mt-2">
            {report.analyzed_tables_count}
          </div>
          <span className="text-[11px] text-neutral-500">Esquema completamente inspeccionado</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shrink-0">
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <button
            onClick={() => setTypeFilter("ALL")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              typeFilter === "ALL"
                ? "bg-orange-600 text-white font-semibold"
                : "bg-[#121520] text-neutral-400 hover:text-white border border-[#202535]"
            }`}
          >
            Todas ({report.recommendations.length})
          </button>
          <button
            onClick={() => setTypeFilter("REDUNDANT")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              typeFilter === "REDUNDANT"
                ? "bg-orange-600 text-white font-semibold"
                : "bg-[#121520] text-neutral-400 hover:text-white border border-[#202535]"
            }`}
          >
            Redundantes ({report.redundant_indexes_count})
          </button>
          <button
            onClick={() => setTypeFilter("MISSING")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              typeFilter === "MISSING"
                ? "bg-orange-600 text-white font-semibold"
                : "bg-[#121520] text-neutral-400 hover:text-white border border-[#202535]"
            }`}
          >
            Faltantes en FK ({report.missing_indexes_count})
          </button>
        </div>

        <input
          type="text"
          placeholder="Buscar por tabla o nombre de índice..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full sm:w-64 px-3 py-1.5 bg-[#11141e] border border-[#202538] rounded-lg text-xs text-white placeholder-neutral-500 focus:outline-hidden focus:border-orange-500"
        />
      </div>

      {/* Recommendations Cards List */}
      <div className="space-y-3">
        {filteredRecs.length === 0 ? (
          <div className="p-8 text-center bg-[#11141e] rounded-xl border border-[#1f2638] text-neutral-400">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <span className="text-sm font-medium text-white block">
              ¡Estructura de Índices Óptima!
            </span>
            <span className="text-xs text-neutral-500 mt-1 block">
              No se detectaron redundancias por prefijo ni claves foráneas sin indexar.
            </span>
          </div>
        ) : (
          filteredRecs.map((rec, idx) => (
            <div
              key={idx}
              className={`p-4 rounded-xl bg-[#11141e] border border-[#1f2538] space-y-3 shadow-md border-l-4 ${
                rec.is_redundant ? "border-l-amber-500" : "border-l-sky-500"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center space-x-2.5">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[#181d2c] border border-[#262f44] text-white">
                    {rec.table_name}
                  </span>
                  <h3 className="text-sm font-bold text-white">{rec.recommendation}</h3>
                </div>

                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border self-start sm:self-auto ${
                    rec.is_redundant
                      ? "bg-amber-950/50 border-amber-800 text-amber-300"
                      : "bg-sky-950/50 border-sky-800 text-sky-300"
                  }`}
                >
                  {rec.is_redundant ? "Índice Redundante" : "Índice Recomendado"}
                </span>
              </div>

              <p className="text-xs text-neutral-300 leading-relaxed">{rec.reason}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-[#0e111a] border border-[#1b2130]">
                  <strong className="text-emerald-400 font-semibold block text-[11px] mb-0.5">
                    Beneficio Estimado:
                  </strong>
                  <span className="text-neutral-300">{rec.estimated_benefit}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0e111a] border border-[#1b2130]">
                  <strong className="text-neutral-400 font-semibold block text-[11px] mb-0.5">
                    Impacto / Costo:
                  </strong>
                  <span className="text-neutral-300">{rec.potential_cost}</span>
                </div>
              </div>

              {/* SQL Proposal Box */}
              <div className="p-3 rounded-lg bg-[#0a0c10] border border-[#1a1f2e] flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-xs">
                <code className="text-orange-300 break-all">{rec.sql_proposal}</code>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={() => handleCopySql(rec.sql_proposal)}
                    className="flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold text-neutral-300 bg-[#161a26] hover:bg-[#202738] border border-[#252d40] rounded-md transition-colors"
                  >
                    <Copy className="w-3 h-3 text-neutral-400" />
                    <span>{copiedSql === rec.sql_proposal ? "Copiado!" : "Copiar SQL"}</span>
                  </button>
                  <button
                    onClick={() => handleOpenInEditor(rec.sql_proposal)}
                    className="flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-md transition-colors"
                  >
                    <Play className="w-3 h-3 fill-white" />
                    <span>Abrir en Editor</span>
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
