import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { ghostBtn } from "../ui/styles";

/** Copy with inline confirmation (no floating toast). Failures are reported by `copy`. */
export function CopyButton({ copy, label = "Copiar", title }: { copy: () => Promise<unknown>; label?: string; title?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={title ?? label}
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
      <span>{done ? "Copiado" : label}</span>
    </button>
  );
}
