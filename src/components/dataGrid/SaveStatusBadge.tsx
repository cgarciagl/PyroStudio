import React from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useUIStore } from "../../stores/uiStore";

export interface SaveStatus {
  success?: boolean;
  message?: string;
}

/** Live editing status in the toolbar; errors open their full detail on click. */
export const SaveStatusBadge: React.FC<{ saveStatus: SaveStatus }> = ({ saveStatus }) => {
  const { t } = useTranslation("dataGrid");

  return (
  <div
    title={saveStatus.message}
    onClick={() => {
      if (!saveStatus.success) {
        useUIStore.getState().showAlert({
          title: t("saveStatus.errorTitle"),
          message: saveStatus.message || t("saveStatus.unknownError"),
          variant: "danger",
        });
      }
    }}
    className={`px-3 py-1 rounded text-xs flex items-center space-x-1.5 border font-mono animate-in fade-in duration-150 ${
      !saveStatus.success ? "cursor-pointer hover:brightness-110" : ""
    } ${
      saveStatus.success ? "bg-surface border-line text-fg" : "bg-surface border-line text-danger"
    }`}
  >
    {saveStatus.success ? (
      <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
    ) : (
      <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" />
    )}
    <span className="truncate max-w-md">{saveStatus.message}</span>
    {!saveStatus.success && (
      <span className="text-[11px] underline ml-1 text-danger opacity-80 shrink-0">
        {t("saveStatus.viewDetail")}
      </span>
    )}
  </div>
  );
};
