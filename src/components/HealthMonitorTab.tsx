import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Zap,
  Sparkles,
  Wrench,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { exportHealthReportHtml, downloadFile } from "../services/diagnosticExport";
import type { HealthReport, HealthSeverity } from "../types/database";

interface HealthMonitorTabProps {
  database: string;
  onOpenSlowQuery?: () => void;
  onOpenAdvisor?: () => void;
  onOpenOperations?: () => void;
}

export const HealthMonitorTab: React.FC<HealthMonitorTabProps> = ({
  database,
  onOpenSlowQuery,
  onOpenAdvisor,
  onOpenOperations,
}) => {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<"ALL" | HealthSeverity>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  const loadHealthReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await dbService.getHealthReport(database);
      setReport(res);
    } catch (err: unknown) {
      console.error("Failed to load health report:", err);
      setError(
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al generar el diagnóstico de salud de la base de datos",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHealthReport();
  }, [database]);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-fg-muted bg-canvas">
        <Loader2 className="w-8 h-8 animate-spin text-success mb-3" />
        <span className="text-sm font-medium">Ejecutando diagnósticos de salud en '{database}'...</span>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-canvas text-center">
        <AlertTriangle className="w-10 h-10 text-danger mb-3" />
        <h3 className="text-base font-semibold text-fg mb-1">Error de Diagnóstico</h3>
        <p className="text-sm text-fg-muted max-w-md mb-4">{error || "No se pudo generar el informe."}</p>
        <button
          onClick={loadHealthReport}
          className="px-4 py-2 text-xs font-semibold text-accent-fg bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const categories = Array.from(new Set(report.issues.map((i) => i.category)));

  const filteredIssues = report.issues.filter((issue) => {
    if (severityFilter !== "ALL" && issue.severity !== severityFilter) return false;
    if (categoryFilter !== "ALL" && issue.category !== categoryFilter) return false;
    return true;
  });

  const getScoreColor = (score: number) => {
    if (score >= 85) return "text-success border-emerald-500";
    if (score >= 65) return "text-warning border-amber-500";
    return "text-danger border-rose-500";
  };

  return (
    <div className="flex-1 flex flex-col p-6 bg-canvas overflow-y-auto space-y-6 select-none min-h-0">
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center text-success">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-fg font-mono">{database}</h2>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-950/50 text-success border border-emerald-800/40">
                Health Monitor
              </span>
            </div>
            <p className="text-xs text-fg-muted">
              Evaluación preventiva de conexiones, memoria, fragmentación y bloqueos
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {onOpenSlowQuery && (
            <button
              onClick={onOpenSlowQuery}
              className="flex items-center space-x-1 px-2.5 py-1.5 text-xs font-medium text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
            >
              <Zap className="w-3.5 h-3.5 text-accent-text" />
              <span>Consultas Lentas</span>
            </button>
          )}
          {onOpenAdvisor && (
            <button
              onClick={onOpenAdvisor}
              className="flex items-center space-x-1 px-2.5 py-1.5 text-xs font-medium text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-warning" />
              <span>Asesor de Índices</span>
            </button>
          )}
          {onOpenOperations && (
            <button
              onClick={onOpenOperations}
              className="flex items-center space-x-1 px-2.5 py-1.5 text-xs font-medium text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
            >
              <Wrench className="w-3.5 h-3.5 text-cyan-400" />
              <span>Operaciones</span>
            </button>
          )}
          <button
            onClick={() => exportHealthReportHtml(report)}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-accent-fg bg-emerald-600/90 hover:bg-emerald-500 border border-emerald-500/40 rounded-md transition-colors shadow-xs"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Exportar Informe HTML</span>
          </button>
          <button
            onClick={() =>
              downloadFile(
                JSON.stringify(report, null, 2),
                `health_report_${database}_${Date.now()}.json`,
                "application/json",
              )
            }
            title="Exportar como JSON"
            className="p-1.5 text-fg-muted hover:text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={loadHealthReport}
            title="Re-ejecutar diagnósticos"
            className="p-1.5 text-fg-muted hover:text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-success" />
          </button>
        </div>
      </div>

      {/* Summary Score Card */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 shrink-0">
        <div className="p-4 rounded-xl bg-raised border border-line flex items-center justify-between sm:col-span-1">
          <div>
            <span className="text-xs font-medium text-fg-muted block">
              Puntuación de Salud
            </span>
            <span className="text-xs text-fg-subtle mt-1 block">
              Calculada sobre {report.issues.length} métricas
            </span>
          </div>
          <div
            className={`w-14 h-14 rounded-full border-4 flex items-center justify-center font-extrabold text-xl font-mono bg-canvas ${getScoreColor(
              report.overall_score,
            )}`}
          >
            {report.overall_score}
          </div>
        </div>

        <div
          onClick={() => setSeverityFilter(severityFilter === "Critical" ? "ALL" : "Critical")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            severityFilter === "Critical"
              ? "bg-rose-950/40 border-rose-600"
              : "bg-raised border-line hover:border-rose-900/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-danger">
              Problemas Críticos
            </span>
            <AlertCircle className="w-4 h-4 text-danger" />
          </div>
          <div className="text-2xl font-extrabold text-danger font-mono mt-2">
            {report.summary.critical_count}
          </div>
          <span className="text-[11px] text-fg-subtle">Requieren atención prioritaria</span>
        </div>

        <div
          onClick={() => setSeverityFilter(severityFilter === "Warning" ? "ALL" : "Warning")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            severityFilter === "Warning"
              ? "bg-amber-950/40 border-amber-600"
              : "bg-raised border-line hover:border-amber-900/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-warning">
              Advertencias
            </span>
            <AlertTriangle className="w-4 h-4 text-warning" />
          </div>
          <div className="text-2xl font-extrabold text-warning font-mono mt-2">
            {report.summary.warning_count}
          </div>
          <span className="text-[11px] text-fg-subtle">Oportunidades de optimización</span>
        </div>

        <div
          onClick={() => setSeverityFilter(severityFilter === "Information" ? "ALL" : "Information")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            severityFilter === "Information"
              ? "bg-sky-950/40 border-sky-600"
              : "bg-raised border-line hover:border-sky-900/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-info">
              Informativos
            </span>
            <Info className="w-4 h-4 text-info" />
          </div>
          <div className="text-2xl font-extrabold text-info font-mono mt-2">
            {report.summary.info_count}
          </div>
          <span className="text-[11px] text-fg-subtle">Métricas operativas normales</span>
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center space-x-2 overflow-x-auto py-1 shrink-0 text-xs scrollbar-thin">
        <span className="text-fg-muted font-medium text-[11px] shrink-0 mr-1 flex items-center">
          Filtrar:
        </span>
        <button
          type="button"
          onClick={() => setCategoryFilter("ALL")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0 whitespace-nowrap ${
            categoryFilter === "ALL"
              ? "bg-accent text-accent-fg font-semibold shadow-xs"
              : "bg-raised text-fg hover:text-fg hover:bg-hover border border-line"
          }`}
        >
          Todas las categorías ({report.issues.length})
        </button>
        {categories.map((cat) => (
          <button
            type="button"
            key={cat}
            onClick={() => setCategoryFilter(categoryFilter === cat ? "ALL" : cat)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0 whitespace-nowrap ${
              categoryFilter === cat
                ? "bg-accent text-accent-fg font-semibold shadow-xs"
                : "bg-raised text-fg hover:text-fg hover:bg-hover border border-line"
            }`}
          >
            {cat} ({report.issues.filter((i) => i.category === cat).length})
          </button>
        ))}
      </div>

      {/* Diagnosed Issues List */}
      <div className="space-y-3">
        {filteredIssues.length === 0 ? (
          <div className="p-8 text-center bg-raised rounded-xl border border-line text-fg-muted">
            <ShieldCheck className="w-8 h-8 text-success mx-auto mb-2" />
            <span className="text-sm">No se encontraron problemas en la categoría o severidad seleccionada.</span>
          </div>
        ) : (
          filteredIssues.map((issue) => {
            const isCrit = issue.severity === "Critical";
            const isWarn = issue.severity === "Warning";
            const borderCol = isCrit
              ? "border-l-rose-500"
              : isWarn
              ? "border-l-amber-500"
              : "border-l-sky-500";
            const badgeBg = isCrit
              ? "bg-rose-950/60 border-rose-800/60 text-danger"
              : isWarn
              ? "bg-amber-950/60 border-amber-800/60 text-warning"
              : "bg-sky-950/60 border-sky-800/60 text-info";

            return (
              <div
                key={issue.id}
                className={`p-4 rounded-xl bg-raised border border-line border-l-4 ${borderCol} space-y-2.5 shadow-md`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    {isCrit ? (
                      <AlertCircle className="w-4 h-4 text-danger shrink-0" />
                    ) : isWarn ? (
                      <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-info shrink-0" />
                    )}
                    <h3 className="text-sm font-bold text-fg">{issue.title}</h3>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-mono text-fg-subtle uppercase">{issue.category}</span>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${badgeBg}`}>
                      {issue.severity}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-fg leading-relaxed">{issue.description}</p>

                {issue.metric_name && (
                  <div className="flex items-center space-x-3 text-xs bg-canvas px-3 py-1.5 rounded-lg border border-line font-mono text-[11px]">
                    <span className="text-fg-muted">Métrica:</span>
                    <span className="text-fg">{issue.metric_name}</span>
                    <span className="text-fg-subtle">|</span>
                    <span className="text-fg-muted">Valor actual:</span>
                    <span className="text-accent-text font-bold">{issue.metric_value}</span>
                    {issue.threshold && (
                      <>
                        <span className="text-fg-subtle">|</span>
                        <span className="text-fg-muted">Umbral seguro:</span>
                        <span className="text-fg">{issue.threshold}</span>
                      </>
                    )}
                  </div>
                )}

                {issue.suggestion && (
                  <div className="p-2.5 rounded-lg bg-raised border border-line text-xs text-accent-text/90 leading-relaxed flex items-start space-x-2">
                    <Zap className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-accent-text">Recomendación técnica: </strong>
                      <span>{issue.suggestion}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
