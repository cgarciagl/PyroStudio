import { useTranslation } from "react-i18next";
import { Terminal, Sparkles } from "lucide-react";
import { ghostBtn } from "../ui/styles";
/** Results area before the first run. */
export function EmptyResults({ onAskAi }: { onAskAi: () => void }) {
  const { t } = useTranslation("queryEditor");

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-fg-subtle text-xs font-mono space-y-2 select-none">
      <Terminal className="w-8 h-8 opacity-30 text-fg-muted" />
      <span>{t("emptyResults.prompt")}</span>
      <button
        onClick={onAskAi}
        className={`${ghostBtn} font-sans`}
      >
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span>{t("emptyResults.askAi")}</span>
      </button>
      <span className="text-[11px] text-fg-subtle">
        {t("emptyResults.shortcuts")}
      </span>
    </div>
  );
}
