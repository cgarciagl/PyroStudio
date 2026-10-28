import { useEffect, useRef, useState } from "react";
import { ChevronDown, WrapText } from "lucide-react";
import { DEFAULT_SQL_FORMAT, usePreferenceStore, type SqlFormatOptions } from "../stores/preferenceStore";
import { ghostBtn, menuPanel, menuSeparator } from "./ui/styles";

interface Props {
  onFormat: () => void;
  disabled?: boolean;
}

type Choice<K extends keyof SqlFormatOptions> = { value: SqlFormatOptions[K]; label: string };

const segment = (active: boolean) =>
  `px-2 py-0.5 rounded text-[11px] ${active ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-hover hover:text-fg"}`;

const CASE_CHOICES: Choice<"keywordCase">[] = [
  { value: "upper", label: "MAYÚS" },
  { value: "lower", label: "minús" },
  { value: "preserve", label: "Conservar" },
];

/** "Formatear" ghost button with a dropdown to customize the formatter. */
export function SqlFormatButton({ onFormat, disabled }: Props) {
  const { sqlFormat, setSqlFormat } = usePreferenceStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const row = <K extends keyof SqlFormatOptions>(label: string, key: K, choices: Choice<K>[]) => (
    <div className="px-3 py-1">
      <div className="text-[11px] text-fg-muted mb-1">{label}</div>
      <div className="flex flex-wrap gap-1">
        {choices.map((c) => (
          <button
            key={String(c.value)}
            type="button"
            onClick={() => setSqlFormat({ [key]: c.value } as Partial<SqlFormatOptions>)}
            className={segment(sqlFormat[key] === c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="relative inline-flex items-stretch" ref={ref}>
      <button
        onClick={onFormat}
        disabled={disabled}
        title="Formatear SQL: selección o todo el script (Ctrl+Mayús+F)"
        className={`${ghostBtn} rounded-r-none pr-1.5`}
      >
        <WrapText className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">Formatear</span>
      </button>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        title="Opciones de formato"
        className={`${ghostBtn} rounded-l-none px-1`}
      >
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className={`${menuPanel} left-0 right-auto w-64`}>
          {row("Palabras clave", "keywordCase", CASE_CHOICES)}
          {row("Funciones", "functionCase", CASE_CHOICES)}
          {row("Sangría", "indent", [
            { value: "2", label: "2 espacios" },
            { value: "4", label: "4 espacios" },
            { value: "tab", label: "Tabulador" },
          ])}
          {row("AND / OR", "logicalOperatorNewline", [
            { value: "before", label: "Al inicio de línea" },
            { value: "after", label: "Al final de línea" },
          ])}
          {row("Líneas entre sentencias", "linesBetweenQueries", [
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" },
          ])}
          {row("Operadores", "denseOperators", [
            { value: false, label: "a = b" },
            { value: true, label: "a=b" },
          ])}
          <div className={menuSeparator} />
          <button
            type="button"
            onClick={() => setSqlFormat(DEFAULT_SQL_FORMAT)}
            className="w-full px-3 py-1 text-left text-[11px] text-fg-muted hover:text-fg"
          >
            Restablecer valores predeterminados
          </button>
        </div>
      )}
    </div>
  );
}
