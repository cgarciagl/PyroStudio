import React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  AlertCircle,
  History as HistoryIcon,
  Trash2,
  RefreshCw,
} from "lucide-react";
import {
  secondaryBtn,
  dangerGhostBtn,
} from "../ui/styles";
import { EmptyState, Spinner } from "../ui/Modal";


import { formatBytes } from "./formatBytes";
import type { BackupRestoreState } from "./useBackupRestore";

export const HistoryTab: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const { t } = useTranslation("backup");
  const {
    handleClearHistory,
    historyRecords,
    isLoadingHistory,
    loadHistory,
  } = state;

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-fg">
              {t("historyTab.title", { count: historyRecords.length })}
            </h3>
            <p className="text-[11px] text-fg-muted">
              {t("historyTab.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadHistory}
              disabled={isLoadingHistory}
              className={secondaryBtn}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoadingHistory ? "animate-spin" : ""}`} />
              {t("historyTab.refresh")}
            </button>
            <button
              type="button"
              onClick={handleClearHistory}
              disabled={historyRecords.length === 0 || isLoadingHistory}
              className={dangerGhostBtn}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {t("historyTab.clearHistory")}
            </button>
          </div>
        </div>

        {isLoadingHistory ? (
          <div className="py-12 flex justify-center">
            <Spinner className="w-6 h-6" />
          </div>
        ) : historyRecords.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="w-8 h-8" />}
            title={t("historyTab.emptyTitle")}
            description={t("historyTab.emptyDesc")}
          />
        ) : (
          <div className="border border-line rounded-lg overflow-hidden bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="bg-raised border-b border-line text-[11px] text-fg-muted font-medium">
                <tr>
                  <th className="py-2.5 px-3">{t("historyTab.colStatus")}</th>
                  <th className="py-2.5 px-3">{t("historyTab.colDateTime")}</th>
                  <th className="py-2.5 px-3">{t("historyTab.colProfileSource")}</th>
                  <th className="py-2.5 px-3">{t("historyTab.colDatabase")}</th>
                  <th className="py-2.5 px-3">{t("historyTab.colFormat")}</th>
                  <th className="py-2.5 px-3 text-right">{t("historyTab.colRowsTables")}</th>
                  <th className="py-2.5 px-3 text-right">{t("historyTab.colSize")}</th>
                  <th className="py-2.5 px-3 text-right">{t("historyTab.colDuration")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono text-[11px]">
                {historyRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-hover transition-colors">
                    <td className="py-2 px-3">
                      {record.status === "success" ? (
                        <CheckCircle2 className="w-4 h-4 text-success" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-danger" />
                      )}
                    </td>
                    <td className="py-2 px-3 text-fg whitespace-nowrap">
                      {new Date(record.started_at).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 font-sans">
                      <span className="font-semibold text-fg text-xs block">
                        {record.profile_name || t("historyTab.manualFallback")}
                      </span>
                      <span className="text-[10px] text-fg-muted">
                        {record.profile_id ? t("historyTab.scheduled") : t("historyTab.manual")}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-fg font-medium">
                      {record.database}
                    </td>
                    <td className="py-2 px-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-canvas border border-line text-fg-muted">
                        {record.backup_format.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-fg">
                      {t("historyTab.rowsTablesShort", { rows: record.total_rows.toLocaleString(), tables: record.total_tables })}
                    </td>
                    <td className="py-2 px-3 text-right text-fg font-medium">
                      {formatBytes(record.total_bytes)}
                    </td>
                    <td className="py-2 px-3 text-right text-fg-muted">
                      {record.duration_ms} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
