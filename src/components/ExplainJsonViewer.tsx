import React, { useState, useMemo } from "react";
import { Check, Copy, Download, FileJson, Search, Sparkles } from "lucide-react";

interface ExplainJsonViewerProps {
  jsonPlan: any;
  querySql?: string;
}

export const ExplainJsonViewer: React.FC<ExplainJsonViewerProps> = ({
  jsonPlan,
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const formattedJson = useMemo(() => {
    try {
      return JSON.stringify(jsonPlan, null, 2);
    } catch {
      return String(jsonPlan);
    }
  }, [jsonPlan]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedJson);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("No se pudo copiar el JSON:", err);
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([formattedJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `explain_plan_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("No se pudo descargar el JSON:", err);
    }
  };

  // Extract high-level optimizer stats if present
  const optimizerCost = jsonPlan?.query_block?.cost_info?.query_cost;

  return (
    <div className="flex flex-col h-full w-full bg-canvas select-none text-xs">
      {/* Action Header */}
      <div className="px-4 py-2.5 bg-surface border-b border-line flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 text-fg font-semibold">
            <FileJson className="w-4 h-4 text-info" />
            <span>EXPLAIN FORMAT=JSON</span>
          </div>

          {optimizerCost && (
            <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-sky-950/40 border border-sky-800/40 text-info text-[11px] font-mono">
              <Sparkles className="w-3 h-3 text-info" />
              <span>Costo de la consulta: {optimizerCost}</span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* Search box */}
          <div className="relative">
            <Search className="w-3 h-3 text-fg-subtle absolute left-2 top-2" />
            <input
              type="text"
              placeholder="Buscar en JSON..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-7 pr-2 py-1 bg-raised border border-line rounded text-fg placeholder-neutral-500 text-[11px] focus:outline-none focus:border-sky-500 w-44"
            />
          </div>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-raised hover:bg-hover text-fg hover:text-fg border border-line transition-colors text-[11px] font-medium"
            title="Copiar JSON del plan al portapapeles"
          >
            {isCopied ? (
              <>
                <Check className="w-3.5 h-3.5 text-success" />
                <span className="text-success">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-fg-muted" />
                <span>Copiar JSON</span>
              </>
            )}
          </button>

          {/* Download Button */}
          <button
            onClick={handleDownload}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-raised hover:bg-hover text-fg hover:text-fg border border-line transition-colors text-[11px] font-medium"
            title="Descargar archivo .json"
          >
            <Download className="w-3.5 h-3.5 text-fg-muted" />
            <span>Descargar</span>
          </button>
        </div>
      </div>

      {/* JSON Viewer with highlighted lines */}
      <div className="flex-1 overflow-auto p-4">
        <pre className="font-mono text-xs leading-relaxed text-fg bg-surface border border-line rounded-xl p-4 overflow-x-auto select-text shadow-inner">
          {searchTerm
            ? formattedJson.split("\n").map((line, idx) => {
                const isMatch = line.toLowerCase().includes(searchTerm.toLowerCase());
                return (
                  <div
                    key={idx}
                    className={isMatch ? "bg-sky-500/20 text-sky-200 px-1 rounded" : ""}
                  >
                    {line}
                  </div>
                );
              })
            : formattedJson}
        </pre>
      </div>
    </div>
  );
};
