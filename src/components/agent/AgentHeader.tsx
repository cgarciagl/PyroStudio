import { useEffect, useRef, useState } from "react";
import { FileText, MoreHorizontal, RotateCcw, Settings, ShieldCheck } from "lucide-react";
import { iconBtn, menuIcon, menuItem, menuPanel } from "../ui/styles";
import type { AiReadiness } from "../../services/aiReadiness";

interface AgentHeaderProps {
  database: string;
  tableCount: number;
  provider: string;
  model: string;
  readiness: AiReadiness;
  hasConversation: boolean;
  onExport: () => Promise<unknown>;
  onNewSession: () => void;
  onOpenSettings: () => void;
}

/** One line: what this is, on which schema, with which model; rare actions in a menu. */
export function AgentHeader(p: AgentHeaderProps) {
  const [open, setOpen] = useState(false);
  const [exported, setExported] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div data-view-toolbar data-agent-header className="px-4 py-2 border-b border-line bg-surface flex items-center gap-3 min-w-0">
      <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
        <h1 className="text-sm font-semibold text-fg">Agente de base de datos</h1>
        <span className="text-[11px] text-fg-muted truncate">
          <span className="font-mono text-fg">{p.database}</span>
          {p.tableCount > 0 && <span className="tabular-nums"> · {p.tableCount} tablas</span>}
          <span className="inline-flex items-center gap-1 ml-1.5" title="El agente solo lee: nunca ejecuta cambios">
            · <ShieldCheck className="w-3 h-3" /> solo lectura
          </span>
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={p.onOpenSettings}
          title={p.readiness.ready ? "Proveedor y modelo de IA" : p.readiness.title}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-fg-muted hover:text-fg hover:bg-hover"
        >
          <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${p.readiness.ready ? "bg-success" : "bg-warning"}`} />
          <span className="capitalize">{p.provider}</span>
          <span className="font-mono text-fg-subtle hidden md:inline">{p.model}</span>
          {!p.readiness.ready && <span className="sr-only">: {p.readiness.title}</span>}
        </button>
        {exported && <span role="status" className="text-[11px] text-fg-muted">Conversación copiada</span>}
        <div className="relative" ref={ref}>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Más acciones" aria-haspopup="menu" aria-expanded={open} className={iconBtn}>
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {open && (
            <div role="menu" className={menuPanel}>
              <button
                role="menuitem"
                className={menuItem}
                disabled={!p.hasConversation}
                onClick={act(() =>
                  p.onExport().then(() => {
                    setExported(true);
                    setTimeout(() => setExported(false), 2000);
                  }, () => {}),
                )}
              >
                <FileText className={menuIcon} /> Copiar conversación (Markdown)
              </button>
              <button role="menuitem" className={menuItem} disabled={!p.hasConversation} onClick={act(p.onNewSession)}>
                <RotateCcw className={menuIcon} /> Nueva sesión
              </button>
              <button role="menuitem" className={menuItem} onClick={act(p.onOpenSettings)}>
                <Settings className={menuIcon} /> Ajustes de IA
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
