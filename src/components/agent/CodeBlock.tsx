import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { ArrowUpRight } from "lucide-react";
import { useIsLightTheme } from "../../stores/preferenceStore";
import { ghostBtn } from "../ui/styles";
import { CopyButton } from "./CopyButton";

interface CodeBlockProps {
  code: string;
  /** "sql" gets highlighting and "open in editor". */
  language: string;
  copy: (text: string) => Promise<unknown>;
  onOpenQuery?: (sql: string) => void;
}

/** Code inside a message: language, copy and, for SQL, open it in a query tab. */
export function CodeBlock({ code, language, copy, onOpenQuery }: CodeBlockProps) {
  const isLight = useIsLightTheme();
  const isSql = language === "sql";
  return (
    <div className="my-2 rounded-md border border-line bg-canvas overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-line">
        <span className="px-1 text-[11px] font-mono text-fg-muted">{isSql ? "SQL" : language || "Código"}</span>
        <span className="flex items-center gap-0.5">
          <CopyButton copy={() => copy(code)} />
          {isSql && onOpenQuery && (
            <button type="button" onClick={() => onOpenQuery(code)} title="Abrir en una pestaña de consulta" className={`${ghostBtn} px-1.5 py-0.5 text-[11px]`}>
              <ArrowUpRight className="w-3 h-3" /> Abrir en el editor
            </button>
          )}
        </span>
      </div>
      {isSql ? (
        <CodeMirror
          value={code}
          editable={false}
          theme={isLight ? "light" : "dark"}
          extensions={[sql()]}
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
          className="text-xs font-mono select-text"
        />
      ) : (
        <pre className="m-0 p-3 text-xs font-mono text-fg overflow-x-auto leading-relaxed select-text">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
