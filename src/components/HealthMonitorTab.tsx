import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Info,
  RefreshCw,
  ShieldCheck,
  Zap,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { exportHealthReportHtml, downloadFile } from "../services/diagnosticExport";
import type { DatabaseHealthSummaryResult, HealthReport, HealthSeverity } from "../types/database";
import { EmptyState, Spinner } from "./ui/Modal";
import { ghostBtn, iconBtn, secondaryBtn, sectionLabel } from "./ui/styles";
import { useAiStore } from "../stores/aiStore";
import { aiService } from "../services/aiService";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { AiNotice } from "./ai/AiNotice";
import { DatabaseScopeBar } from "./ui/DatabaseScopeBar";
import { errorText } from "../utils/errors";

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
  const { t } = useTranslation("diagnostics");
  const categoryLabel = (cat: string) => t(`health.categories.${cat}` as any, { defaultValue: cat });
  const severityLabel = (sev: string) => t(`health.severity.${sev}` as any, { defaultValue: sev });

  const [report, setReport] = useState<HealthReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<"ALL" | HealthSeverity>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const aiConfig = useAiStore((s) => s.config);
  const [aiSummary, setAiSummary] = useState<DatabaseHealthSummaryResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isInterpreting, setIsInterpreting] = useState(false);

  const interpretWithAi = async () => {
    setIsInterpreting(true);
    setAiError(null);
    try {
      setAiSummary(await aiService.getDatabaseHealthSummaryAi(database, aiConfig));
    } catch (err: unknown) {
      setAiError(errorText(err));
    } finally {
      setIsInterpreting(false);
    }
  };

  const loadHealthReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await dbService.getHealthReport(database);
      setReport(res);
    } catch (err: unknown) {
      console.error("Failed to load health report:", err);
      setError(
        errorText(err, t("health.loadError")),
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHealthReport();
    setAiSummary(null);
    setAiError(null);
  }, [database]);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col p-6 gap-4 bg-canvas">
        <DatabaseScopeBar database={database} tool={t("health.tool")} />
        <EmptyState icon={<Spinner className="w-6 h-6" />} title={t("health.loadingTitle")} />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex-1 flex flex-col p-6 gap-4 bg-canvas">
        <DatabaseScopeBar database={database} tool={t("health.tool")} />
        <EmptyState
          icon={<AlertTriangle className="w-6 h-6 text-danger" />}
          title={t("health.errorTitle")}
          description={error || t("health.loadError")}
          action={
            <button onClick={loadHealthReport} className={secondaryBtn}>
              {t("health.retry")}
            </button>
          }
        />
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
    <div className="pyro-view pyro-diagnostic-workspace pyro-health-workspace flex-1 flex flex-col p-6 bg-canvas overflow-y-auto space-y-6 min-h-0" data-health-view>
      {/* Header Toolbar */}
      <DatabaseScopeBar data-health-header database={database} tool={t("health.tool")}>

        <div className="flex items-center space-x-2">
          {onOpenSlowQuery && (
            <button
              onClick={onOpenSlowQuery}
              className="flex items-center space-x-1 px-2.5 py-1.5 text-xs font-medium text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
            >
              <Zap className="w-3.5 h-3.5 text-accent-text" />
              <span>{t("health.actions.slowQueries")}</span>
            </button>
          )}
          {onOpenAdvisor && (
            <button
              onClick={onOpenAdvisor}
              className="flex items-center space-x-1 px-2.5 py-1.5 text-xs font-medium text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-warning" />
              <span>{t("health.actions.indexAdvisor")}</span>
            </button>
          )}
          {onOpenOperations && (
            <button
              onClick={onOpenOperations}
              className="flex items-center space-x-1 px-2.5 py-1.5 text-xs font-medium text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
            >
              <Wrench className="w-3.5 h-3.5 text-cyan-400" />
              <span>{t("health.actions.operations")}</span>
            </button>
          )}
          {aiConfig.enabled && (
            <button
              type="button"
              onClick={interpretWithAi}
              disabled={isInterpreting}
              className={ghostBtn}
              title={t("health.actions.interpretAi")}
            >
              {isInterpreting ? <Spinner className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>{t("health.actions.interpretAi")}</span>
            </button>
          )}
          <button
            onClick={() => exportHealthReportHtml(report)}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-accent-fg bg-emerald-600/90 hover:bg-emerald-500 border border-emerald-500/40 rounded-md transition-colors shadow-xs"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{t("health.actions.exportHtml")}</span>
          </button>
          <button
            onClick={() =>
              downloadFile(
                JSON.stringify(report, null, 2),
                `health_report_${database}_${Date.now()}.json`,
                "application/json",
              )
            }
            title={t("health.actions.exportJson")}
            className="p-1.5 text-fg-muted hover:text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={loadHealthReport}
            title={t("health.actions.rerun")}
            className="p-1.5 text-fg-muted hover:text-fg bg-raised hover:bg-hover border border-line rounded-md transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-success" />
          </button>
        </div>
      </DatabaseScopeBar>

      {/* Summary Score Card */}
      <div data-health-summary className="grid grid-cols-1 sm:grid-cols-4 gap-4 shrink-0">
        <div className="p-4 rounded-xl bg-raised border border-line flex items-center justify-between sm:col-span-1">
          <div>
            <span className="text-xs font-medium text-fg-muted block">
              {t("health.summary.score")}
            </span>
            <span className="text-xs text-fg-subtle mt-1 block">
              {report.issues.length}
            </span>
          </div>
          <div
            data-health-score={report.overall_score >= 85 ? "healthy" : report.overall_score >= 65 ? "warning" : "critical"}
            className={`w-14 h-14 rounded-full border-4 flex items-center justify-center font-semibold text-base font-mono bg-canvas ${getScoreColor(
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
              {t("health.summary.critical")}
            </span>
            <AlertCircle className="w-4 h-4 text-danger" />
          </div>
          <div className="text-lg font-semibold text-danger font-mono mt-2">
            {report.summary.critical_count}
          </div>
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
              {t("health.summary.warnings")}
            </span>
            <AlertTriangle className="w-4 h-4 text-warning" />
          </div>
          <div className="text-lg font-semibold text-warning font-mono mt-2">
            {report.summary.warning_count}
          </div>
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
              {t("health.summary.info")}
            </span>
            <Info className="w-4 h-4 text-info" />
          </div>
          <div className="text-lg font-semibold text-info font-mono mt-2">
            {report.summary.info_count}
          </div>
        </div>
      </div>

      {/* Category Filter Tabs */}
      {(aiSummary || aiError || isInterpreting) && (
        <section data-health-ai className="rounded-lg border border-line bg-surface p-4 shrink-0 space-y-3" aria-label={t("health.ai.title")}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-fg-muted" />
            <h3 className={sectionLabel}>{t("health.ai.title")}</h3>
            <span className="text-[11px] text-fg-subtle">{t("health.ai.verifyNotice")}</span>
            {!isInterpreting && (
              <button
                type="button"
                onClick={() => {
                  setAiSummary(null);
                  setAiError(null);
                }}
                className={`${iconBtn} ml-auto`}
                aria-label={t("reports.close")}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {isInterpreting ? (
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              <Spinner className="w-3.5 h-3.5" /> {t("health.ai.analyzing")}
            </div>
          ) : aiError ? (
            <p className="text-xs text-danger break-words">{aiError}</p>
          ) : aiSummary ? (
            <>
              <AiNotice notice={aiSummary.ai_notice} />
              <div className="text-xs select-text">
                <MarkdownRenderer content={aiSummary.ai_interpretation} />
              </div>
            </>
          ) : null}
        </section>
      )}

      <div data-health-filters className="flex items-center space-x-2 overflow-x-auto py-1 shrink-0 text-xs scrollbar-thin">
        <span className="text-fg-muted font-medium text-[11px] shrink-0 mr-1 flex items-center">
          {t("health.filters.label")}
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
          {t("health.filters.allCategories")} ({report.issues.length})
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
            {categoryLabel(cat)} ({report.issues.filter((i) => i.category === cat).length})
          </button>
        ))}
      </div>

      {/* Diagnosed Issues List */}
      <div data-health-issues className="space-y-3">
        {filteredIssues.length === 0 ? (
          <div className="p-8 text-center bg-raised rounded-xl border border-line text-fg-muted">
            <ShieldCheck className="w-8 h-8 text-success mx-auto mb-2" />
            <span className="text-sm font-medium block">{t("health.emptyTitle")}</span>
            <span className="text-xs text-fg-subtle mt-1 block">
              {report.issues.length === 0 ? t("health.emptyAll") : t("health.emptyFiltered")}
            </span>
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
                data-health-severity={issue.severity.toLowerCase()}
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
                    <span className="text-[11px] text-fg-subtle">{categoryLabel(issue.category)}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${badgeBg}`}>
                      {severityLabel(issue.severity)}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-fg leading-relaxed">{issue.description}</p>

                {issue.metric_name && (
                  <div className="flex items-center space-x-3 text-xs bg-canvas px-3 py-1.5 rounded-lg border border-line font-mono text-[11px]">
                    <span className="text-fg-muted">{t("health.issue.metric")}</span>
                    <span className="text-fg">{issue.metric_name}</span>
                    <span className="text-fg-subtle">|</span>
                    <span className="text-fg-muted">{t("health.issue.currentValue")}</span>
                    <span className="text-accent-text font-bold">{issue.metric_value}</span>
                    {issue.threshold && (
                      <>
                        <span className="text-fg-subtle">|</span>
                        <span className="text-fg-muted">{t("health.issue.safeThreshold")}</span>
                        <span className="text-fg">{issue.threshold}</span>
                      </>
                    )}
                  </div>
                )}

                {issue.suggestion && (
                  <div className="p-2.5 rounded-lg bg-raised border border-line text-xs text-accent-text/90 leading-relaxed flex items-start space-x-2">
                    <Zap className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-accent-text">{t("health.issue.recommendation")} </strong>
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
