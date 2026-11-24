import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  Download,
  Copy,
  Loader2,
  Activity,
  Table,
  Eye,
  Code,
  Check,
} from "lucide-react";
import { useAiStore } from "../stores/aiStore";
import { useUIStore } from "../stores/uiStore";
import { AiNotice } from "./ai/AiNotice";
import { aiService } from "../services/aiService";
import type { GeneratedReport } from "../types/database";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { primaryBtn, secondaryBtn } from "./ui/styles";
import { Modal } from "./ui/Modal";
import { errorText } from "../utils/errors";

interface DatabaseReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
}

export const DatabaseReportsModal: React.FC<DatabaseReportsModalProps> = ({
  isOpen,
  onClose,
  database,
}) => {
  const { t } = useTranslation("diagnostics");
  const { config } = useAiStore();
  const [reportType, setReportType] = useState<"health" | "schema">("health");
  const [format, setFormat] = useState<"markdown" | "html" | "json">("markdown");
  const [viewMode, setViewMode] = useState<"rendered" | "raw">("rendered");
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const generateReport = async (type: "health" | "schema") => {
    setReportType(type);
    setIsLoading(true);
    try {
      const res = await aiService.generateDatabaseReportAi(
        database,
        type,
        config.enabled ? config : undefined,
      );
      setReport(res);
    } catch (err) {
      console.error("Report generation error:", err);
      useUIStore.getState().showAlert({
        title: t("reports.errorTitle"),
        message: errorText(err),
        variant: "warning",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      generateReport("health");
    }
  }, [isOpen, database]);

  if (!isOpen) return null;

  const handleCopyContent = () => {
    if (!report) return;
    const textToCopy =
      format === "markdown"
        ? report.markdown
        : format === "html"
        ? report.html
        : JSON.stringify(report.json_data, null, 2);
    navigator.clipboard.writeText(textToCopy);
    setCopyFeedback(t("reports.copiedFeedback", { format: format.toUpperCase() }));
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  const handleDownloadReport = () => {
    if (!report) return;
    const extension = format === "markdown" ? "md" : format === "html" ? "html" : "json";
    const mime =
      format === "markdown"
        ? "text/markdown"
        : format === "html"
        ? "text/html"
        : "application/json";
    const text =
      format === "markdown"
        ? report.markdown
        : format === "html"
        ? report.html
        : JSON.stringify(report.json_data, null, 2);

    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte_${database}_${reportType}_${Date.now()}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={<>{t("reports.title")}</>}
      subtitle={<>{t("reports.subtitle")}</>}
      icon={<FileText className="w-5 h-5" />}
      size="lg"
      className="max-h-[90vh]"
      bodyClassName="flex flex-col overflow-hidden"
      closeOnBackdrop={false}
      closeOnEscape={false}
    >
      <div className="px-4 sm:px-6 py-2.5 bg-surface border-b border-line flex flex-wrap items-center justify-between gap-3 text-xs select-none" data-database-reports-toolbar data-view-toolbar>
          <div className="flex flex-wrap items-center gap-2" data-database-reports-types>
            <button
              onClick={() => generateReport("health")}
              className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-colors ${
                reportType === "health"
                  ? "bg-accent/30 text-accent-text border border-accent/50 font-semibold"
                  : "bg-raised text-fg-muted hover:text-fg border border-line"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{t("reports.healthReport")}</span>
            </button>
            <button
              onClick={() => generateReport("schema")}
              className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-colors ${
                reportType === "schema"
                  ? "bg-accent/30 text-accent-text border border-accent/50 font-semibold"
                  : "bg-raised text-fg-muted hover:text-fg border border-line"
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>{t("reports.dataDictionary")}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2" data-database-reports-actions>
            {/* Format toggle */}
            <div className="flex items-center bg-raised border border-line rounded-md p-0.5 font-mono text-[11px]">
              {(["markdown", "html", "json"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setFormat(fmt)}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    format === fmt
                      ? "bg-accent text-accent-fg font-semibold"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            {/* View Mode Toggle (Rendered vs Code) for markdown */}
            {format === "markdown" && (
              <div className="flex items-center bg-raised border border-line rounded-md p-0.5 text-[11px]">
                <button
                  onClick={() => setViewMode("rendered")}
                  title={t("reports.viewFormattedTitle")}
                  className={`px-2 py-1 rounded flex items-center space-x-1 transition-colors ${
                    viewMode === "rendered"
                      ? "bg-elevated text-accent-text font-semibold shadow-xs"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>{t("reports.viewFormatted")}</span>
                </button>
                <button
                  onClick={() => setViewMode("raw")}
                  title={t("reports.viewCodeTitle")}
                  className={`px-2 py-1 rounded flex items-center space-x-1 transition-colors ${
                    viewMode === "raw"
                      ? "bg-elevated text-accent-text font-semibold shadow-xs"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  <Code className="w-3 h-3" />
                  <span>{t("reports.viewCode")}</span>
                </button>
              </div>
            )}

            <button
              onClick={handleCopyContent}
              disabled={!report || isLoading}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-raised hover:bg-hover text-fg border border-line-strong rounded-md font-medium transition-colors disabled:opacity-50"
            >
              {copyFeedback ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copyFeedback ? t("reports.copied") : t("reports.copy")}</span>
            </button>

            <button
              onClick={handleDownloadReport}
              disabled={!report || isLoading}
              className={primaryBtn}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t("reports.downloadFile")}</span>
            </button>
          </div>
        </div>
<div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 text-xs select-text" data-database-reports-content data-view-content>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3 text-fg-muted select-none">
              <Loader2 className="w-8 h-8 animate-spin text-fg-muted" />
              <p className="font-mono">{t("reports.generating")}</p>
            </div>
          ) : report ? (
            <>
            <AiNotice notice={report.ai_notice} className="mb-3" />
            {format === "markdown" && viewMode === "rendered" ? (
              <div className="p-4 sm:p-5 bg-canvas border border-line rounded-lg select-text min-h-[300px]" data-database-reports-rendered>
                <MarkdownRenderer content={report.markdown} />
              </div>
            ) : (
              <pre className="p-4 bg-canvas border border-line rounded-lg text-fg font-mono whitespace-pre-wrap overflow-x-auto select-text cursor-text max-h-[60vh]" data-database-reports-raw>
                {format === "markdown"
                  ? report.markdown
                  : format === "html"
                  ? report.html
                  : JSON.stringify(report.json_data, null, 2)}
              </pre>
            )}
            </>
          ) : null}

          {copyFeedback && (
            <div className="mt-3 p-3 rounded-lg border border-line text-success font-mono text-center select-none">
              {copyFeedback}
            </div>
          )}
        </div>
<div className="px-4 sm:px-6 py-3 bg-raised border-t border-line flex flex-wrap items-center justify-between gap-3 text-[11px] text-fg-subtle font-mono" data-database-reports-footer>
          <span>{t("reports.schemaLabel", { database })}</span>
          <button
            onClick={onClose}
            className={secondaryBtn}
          >
            {t("reports.close")}
          </button>
        </div>
    </Modal>
  );
};
