import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { ghostBtn } from "../ui/styles";

/** Copy with inline confirmation (no floating toast). Failures are reported by `copy`. */
export function CopyButton({ copy, label, title }: { copy: () => Promise<unknown>; label?: string; title?: string }) {
  const { t } = useTranslation("ai");
  const [done, setDone] = useState(false);
  const effectiveLabel = label ?? t("agent.copyButton.copy");
  return (
    <button
      type="button"
      title={title ?? effectiveLabel}
      onClick={() =>
        copy().then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1800);
          },
          () => {},
        )
      }
      className={`${ghostBtn} px-1.5 py-0.5 text-[11px]`}
    >
      {done ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
      <span>{done ? t("agent.copyButton.copied") : effectiveLabel}</span>
    </button>
  );
}
