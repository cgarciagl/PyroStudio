import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { AtSign, Lightbulb, Send, Square, Target, X } from "lucide-react";
import { useIsLightTheme } from "../../stores/preferenceStore";
import { ghostBtn, menuItem, menuPanel, primaryBtn, secondaryBtn } from "../ui/styles";
import { SUGGESTED_PROMPTS } from "./agentText";
import { TablePicker } from "./TablePicker";
import type { DatabaseAgent } from "./useDatabaseAgent";

type ComposerProps = Pick<
  DatabaseAgent,
  | "inputQuery"
  | "setInputQuery"
  | "pinnedTables"
  | "togglePin"
  | "clearPinned"
  | "pinAll"
  | "mentionTable"
  | "insertExplain"
  | "isRunning"
  | "send"
  | "stop"
  | "availableTables"
> & { database: string; ready: boolean; hasConversation: boolean };

/**
 * Where the question is written. The tables the agent focuses on live here, next to the
 * question they affect; the only primary action is Send (or Stop while it works).
 */
export function AgentComposer(p: ComposerProps) {
  const isLight = useIsLightTheme();
  const [picker, setPicker] = useState<"focus" | "mention" | "suggest" | null>(null);
  const canSend = p.ready && !!p.inputQuery.trim();

  return (
    <div data-agent-composer className="px-4 pb-3 pt-2 bg-surface border-t border-line shrink-0">
      <div className="rounded-lg border border-line bg-canvas focus-within:border-accent transition-colors">
        {p.pinnedTables.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-2 pt-2 text-[11px]" aria-label="Tablas en las que se enfoca">
            <span className="text-fg-muted mr-0.5">Enfocado en</span>
            {p.pinnedTables.map((t) => (
              <span key={t} className="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded border border-line font-mono text-fg">
                {t}
                <button type="button" onClick={() => p.togglePin(t)} aria-label={`Quitar ${t}`} className="p-0.5 rounded text-fg-subtle hover:text-fg">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
            <button type="button" onClick={p.clearPinned} className="px-1 text-fg-subtle hover:text-fg">
              Quitar todas
            </button>
          </div>
        )}

        <div
          className="px-1.5 py-1 max-h-48 overflow-y-auto"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              if (canSend) p.send();
            }
          }}
        >
          <CodeMirror
            value={p.inputQuery}
            onChange={p.setInputQuery}
            extensions={[sql()]}
            theme={isLight ? "light" : "dark"}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
            placeholder={`Pregunte sobre ${p.database} o pegue una consulta SQL`}
            aria-label="Pregunta para el agente"
            className="text-xs font-mono"
            minHeight="44px"
          />
        </div>

        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          {p.availableTables.length > 0 && (
            <>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPicker(picker === "focus" ? null : "focus")}
                  title="Que el agente priorice estas tablas"
                  className={`${ghostBtn} px-2 py-0.5 text-[11px] ${p.pinnedTables.length ? "text-fg" : ""}`}
                >
                  <Target className="w-3 h-3" /> Enfocar
                  {p.pinnedTables.length > 0 && <span className="tabular-nums">({p.pinnedTables.length})</span>}
                </button>
                {picker === "focus" && (
                  <TablePicker
                    up
                    tables={p.availableTables}
                    selected={p.pinnedTables}
                    placeholder="Filtrar tablas"
                    onPick={p.togglePin}
                    onSelectAll={p.pinAll}
                    onClear={p.clearPinned}
                    onClose={() => setPicker(null)}
                  />
                )}
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPicker(picker === "mention" ? null : "mention")}
                  title="Insertar el nombre de una tabla en la pregunta"
                  className={`${ghostBtn} px-2 py-0.5 text-[11px]`}
                >
                  <AtSign className="w-3 h-3" /> Mencionar
                </button>
                {picker === "mention" && (
                  <TablePicker
                    up
                    tables={p.availableTables}
                    placeholder="Buscar tabla"
                    onPick={(t) => {
                      p.mentionTable(t);
                      setPicker(null);
                    }}
                    onClose={() => setPicker(null)}
                  />
                )}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={p.insertExplain}
            title="Agregar una plantilla EXPLAIN para que el agente analice el plan"
            className={`${ghostBtn} px-2 py-0.5 text-[11px] hidden sm:inline-flex`}
          >
            EXPLAIN
          </button>
          {p.hasConversation && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPicker(picker === "suggest" ? null : "suggest")}
                className={`${ghostBtn} px-2 py-0.5 text-[11px]`}
              >
                <Lightbulb className="w-3 h-3" /> Sugerencias
              </button>
              {picker === "suggest" && (
                <div role="menu" className={`${menuPanel} left-0 right-auto bottom-full mb-1 mt-0 w-80`} onMouseLeave={() => setPicker(null)}>
                  {SUGGESTED_PROMPTS.map((q) => (
                    <button
                      key={q}
                      role="menuitem"
                      className={menuItem}
                      disabled={!p.ready || p.isRunning}
                      onClick={() => {
                        setPicker(null);
                        p.send(q);
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <span className="ml-auto text-[11px] text-fg-subtle hidden md:inline">Ctrl+Enter para enviar</span>
          {p.isRunning ? (
            <button type="button" onClick={p.stop} className={secondaryBtn}>
              <Square className="w-3 h-3 fill-current" /> Detener
            </button>
          ) : (
            <button
              type="button"
              onClick={() => p.send()}
              disabled={!canSend}
              title={p.ready ? "Enviar (Ctrl+Enter)" : "Revise los ajustes de IA"}
              className={primaryBtn}
            >
              <Send className="w-3.5 h-3.5" /> Enviar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
