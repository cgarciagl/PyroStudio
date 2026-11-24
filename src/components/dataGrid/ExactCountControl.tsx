import React from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

/** "contar exacto" link, or a spinner while the exact COUNT(*) runs. */
export const ExactCountControl: React.FC<{ isCounting: boolean; onCount: () => void }> = ({
  isCounting,
  onCount,
}) => {
  const { t } = useTranslation("dataGrid");
  return isCounting ? (
    <span className="flex items-center gap-1 text-fg-subtle text-[11px]">
      <Loader2 className="w-3 h-3 animate-spin" />
      <span>{t("exactCount.counting")}</span>
    </span>
  ) : (
    <button
      type="button"
      onClick={onCount}
      title={t("exactCount.tooltip")}
      className="text-[11px] text-fg-muted hover:text-fg underline underline-offset-2"
    >
      {t("exactCount.label")}
    </button>
  );
};
