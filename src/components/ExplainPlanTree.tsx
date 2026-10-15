import React, { useState, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FileCode2,
  GitFork,
  Key,
  Layers,
  Maximize2,
  Minimize2,
  Search,
  Terminal,
} from "lucide-react";
import type { ExplainPlanTreeNode } from "../types/database";

interface ExplainPlanTreeProps {
  rootNode: ExplainPlanTreeNode;
  treePlanText?: string;
}

export const ExplainPlanTree: React.FC<ExplainPlanTreeProps> = ({
  rootNode,
  treePlanText,
}) => {
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [filterText, setFilterText] = useState("");
  const [viewMode, setViewMode] = useState<"tree" | "raw_tree">("tree");

  // Toggle collapse state for a specific node
  const toggleCollapse = (id: string) => {
    setCollapsedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const collapseAll = () => {
    const map: Record<string, boolean> = {};
    const traverse = (node: ExplainPlanTreeNode) => {
      if (node.children.length > 0) {
        map[node.id] = true;
        node.children.forEach(traverse);
      }
    };
    traverse(rootNode);
    setCollapsedMap(map);
  };

  const expandAll = () => {
    setCollapsedMap({});
  };

  // Node stats summary
  const summary = useMemo(() => {
    let scans = 0;
    let indexLookups = 0;
    let filesorts = 0;
    let temporaries = 0;

    const count = (n: ExplainPlanTreeNode) => {
      if (n.operationType === "table_scan" || n.accessType === "ALL") scans++;
      if (n.operationType === "index_scan" || n.accessType === "REF" || n.accessType === "EQ_REF") indexLookups++;
      if (n.flags.includes("Using filesort") || n.operationType === "ordering") filesorts++;
      if (n.flags.includes("Using temporary") || n.flags.includes("Using temporary table") || n.operationType === "temporary") temporaries++;
      n.children.forEach(count);
    };
    count(rootNode);
    return { scans, indexLookups, filesorts, temporaries };
  }, [rootNode]);

  return (
    <div className="flex flex-col h-full w-full bg-[#0a0c10] select-none text-xs">
      {/* Top Controls Toolbar */}
      <div className="px-4 py-2 bg-[#10131d] border-b border-[#1c2234] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center space-x-2">
          {treePlanText && (
            <div className="flex items-center bg-[#151926] p-0.5 rounded-lg border border-[#232a3d]">
              <button
                onClick={() => setViewMode("tree")}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                  viewMode === "tree"
                    ? "bg-orange-600 text-white shadow-sm"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                <GitFork className="w-3.5 h-3.5" />
                <span>Árbol Visual</span>
              </button>
              <button
                onClick={() => setViewMode("raw_tree")}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                  viewMode === "raw_tree"
                    ? "bg-orange-600 text-white shadow-sm"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                <FileCode2 className="w-3.5 h-3.5" />
                <span>Nativo (FORMAT=TREE)</span>
              </button>
            </div>
          )}

          {viewMode === "tree" && (
            <div className="flex items-center space-x-1">
              <button
                onClick={expandAll}
                className="px-2 py-1 rounded bg-[#161b28] hover:bg-[#20273a] text-neutral-300 hover:text-white border border-[#232b3f] transition-colors flex items-center space-x-1 text-[11px]"
                title="Expandir todas las ramas del árbol"
              >
                <Maximize2 className="w-3 h-3" />
                <span>Expandir todo</span>
              </button>
              <button
                onClick={collapseAll}
                className="px-2 py-1 rounded bg-[#161b28] hover:bg-[#20273a] text-neutral-300 hover:text-white border border-[#232b3f] transition-colors flex items-center space-x-1 text-[11px]"
                title="Colapsar ramas del árbol"
              >
                <Minimize2 className="w-3 h-3" />
                <span>Colapsar todo</span>
              </button>
            </div>
          )}
        </div>

        {/* Search & Badges Summary */}
        <div className="flex items-center space-x-2">
          {summary.scans > 0 && (
            <span className="px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800/60 text-rose-300 text-[10px] font-bold font-mono flex items-center space-x-1">
              <AlertTriangle className="w-3 h-3 text-rose-400" />
              <span>{summary.scans} Full Scan(s)</span>
            </span>
          )}
          {summary.filesorts > 0 && (
            <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/60 text-amber-300 text-[10px] font-bold font-mono">
              ⚡ {summary.filesorts} Filesort
            </span>
          )}

          {viewMode === "tree" && (
            <div className="relative">
              <Search className="w-3 h-3 text-neutral-500 absolute left-2 top-2" />
              <input
                type="text"
                placeholder="Filtrar por tabla o llave..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="pl-7 pr-2 py-1 bg-[#141824] border border-[#232a3c] rounded text-neutral-200 placeholder-neutral-500 text-[11px] focus:outline-none focus:border-orange-500 w-44"
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-5">
        {viewMode === "raw_tree" && treePlanText ? (
          <div className="bg-[#0e1118] border border-[#1e2436] rounded-xl p-4 font-mono text-xs text-emerald-300 overflow-x-auto whitespace-pre leading-relaxed shadow-inner">
            {treePlanText}
          </div>
        ) : (
          <div className="min-w-fit max-w-4xl space-y-1">
            <TreeNodeItem
              node={rootNode}
              collapsedMap={collapsedMap}
              onToggleCollapse={toggleCollapse}
              filterText={filterText.toLowerCase().trim()}
            />
          </div>
        )}
      </div>
    </div>
  );
};

interface TreeNodeItemProps {
  node: ExplainPlanTreeNode;
  collapsedMap: Record<string, boolean>;
  onToggleCollapse: (id: string) => void;
  filterText: string;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({
  node,
  collapsedMap,
  onToggleCollapse,
  filterText,
}) => {
  const isCollapsed = Boolean(collapsedMap[node.id]);
  const hasChildren = node.children.length > 0;

  // Filter highlighting
  const matchesFilter =
    !filterText ||
    node.name.toLowerCase().includes(filterText) ||
    node.tableName?.toLowerCase().includes(filterText) ||
    node.keyUsed?.toLowerCase().includes(filterText);

  // Operation badge metadata
  const config = getOperationConfig(node);
  const Icon = config.icon;

  return (
    <div className={`relative flex flex-col ${!matchesFilter ? "opacity-35" : ""}`}>
      {/* Node Card */}
      <div
        className={`relative z-10 flex items-start space-x-2.5 p-3 rounded-xl border transition-all ${config.cardBorder} ${config.cardBg} hover:shadow-lg`}
      >
        {/* Expand / Collapse toggle or connector bullet */}
        {hasChildren ? (
          <button
            onClick={() => onToggleCollapse(node.id)}
            className="mt-0.5 w-5 h-5 rounded flex items-center justify-center bg-[#1a2030] hover:bg-[#252e44] text-neutral-300 hover:text-white transition-colors shrink-0 border border-[#2e374f]"
            title={isCollapsed ? "Expandir rama" : "Colapsar rama"}
          >
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <div className="mt-1 w-5 flex items-center justify-center shrink-0">
            <div className={`w-2 h-2 rounded-full ${config.bulletBg}`} />
          </div>
        )}

        {/* Icon */}
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${config.iconBg} ${config.iconColor} ${config.iconBorder}`}
        >
          <Icon className="w-4 h-4" />
        </div>

        {/* Node Body */}
        <div className="flex-1 min-w-0 font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-sm text-white tracking-tight">
                {node.name}
              </span>
              {node.accessType && (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${config.badgeBg}`}
                >
                  {node.accessType}
                </span>
              )}
            </div>

            {/* Metrics Chips */}
            <div className="flex items-center space-x-2 text-[11px]">
              {node.rowsExamined !== undefined && (
                <span className="text-neutral-300 bg-[#161a26] border border-[#252c40] px-2 py-0.5 rounded">
                  ~{node.rowsExamined.toLocaleString()} filas
                </span>
              )}
              {node.filteredPercent !== undefined && (
                <span className="text-sky-300 bg-sky-950/40 border border-sky-800/40 px-2 py-0.5 rounded">
                  {node.filteredPercent}% filtrado
                </span>
              )}
              {node.cost && (
                <span className="text-amber-300 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded">
                  {node.cost}
                </span>
              )}
            </div>
          </div>

          {/* Table & Index details */}
          {(node.tableName || node.keyUsed || node.refColumns) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
              {node.tableName && (
                <div className="flex items-center space-x-1">
                  <Database className="w-3 h-3 text-neutral-500" />
                  <span>Tabla:</span>
                  <span className="text-neutral-200 font-semibold">{node.tableName}</span>
                </div>
              )}
              {node.keyUsed && (
                <div className="flex items-center space-x-1">
                  <Key className="w-3 h-3 text-orange-400" />
                  <span>Llave:</span>
                  <span className="text-orange-300 font-semibold">{node.keyUsed}</span>
                  {node.keyLen && <span className="text-neutral-500">({node.keyLen})</span>}
                </div>
              )}
              {node.refColumns && node.refColumns.length > 0 && (
                <div className="flex items-center space-x-1">
                  <span className="text-neutral-500">Ref:</span>
                  <span className="text-neutral-300">{node.refColumns.join(", ")}</span>
                </div>
              )}
            </div>
          )}

          {/* Flags */}
          {node.flags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {node.flags.map((flag, idx) => {
                const isDangerous =
                  flag.includes("filesort") || flag.includes("temporary");
                const isGood = flag.includes("Covering") || flag.includes("index");
                return (
                  <span
                    key={idx}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold font-mono border ${
                      isDangerous
                        ? "bg-rose-950/60 border-rose-800/70 text-rose-300"
                        : isGood
                        ? "bg-emerald-950/60 border-emerald-800/70 text-emerald-300"
                        : "bg-[#181d2c] border-[#29324a] text-neutral-400"
                    }`}
                  >
                    {flag}
                  </span>
                );
              })}
            </div>
          )}

          {/* Condition clause preview */}
          {node.condition && (
            <div className="mt-2 p-1.5 rounded bg-[#0b0e14] border border-[#1b2233] text-[10px] text-neutral-400 font-mono select-text">
              <span className="text-neutral-500 font-semibold">WHERE / Condición: </span>
              <span className="text-sky-300">{node.condition}</span>
            </div>
          )}

          {/* Collapsed children pill */}
          {hasChildren && isCollapsed && (
            <button
              onClick={() => onToggleCollapse(node.id)}
              className="mt-2 text-[10px] text-orange-400 hover:text-orange-300 bg-orange-950/30 border border-orange-800/40 px-2 py-0.5 rounded-full inline-flex items-center space-x-1"
            >
              <span>+{node.children.length} sub-operaciones colapsadas</span>
            </button>
          )}
        </div>
      </div>

      {/* Children branches with tree lines */}
      {hasChildren && !isCollapsed && (
        <div className="relative pl-6 ml-4 mt-2 space-y-2 border-l-2 border-[#1c2436]">
          {node.children.map((child) => (
            <div key={child.id} className="relative">
              {/* Horizontal line connector */}
              <div className="absolute -left-6 top-5 w-5 h-0.5 bg-[#1c2436]" />
              <TreeNodeItem
                node={child}
                collapsedMap={collapsedMap}
                onToggleCollapse={onToggleCollapse}
                filterText={filterText}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function getOperationConfig(node: ExplainPlanTreeNode) {
  const op = node.operationType;
  const access = (node.accessType || "").toUpperCase();

  if (op === "table_scan" || access === "ALL") {
    return {
      icon: AlertTriangle,
      cardBg: "bg-[#140e12]",
      cardBorder: "border-rose-900/50 hover:border-rose-700/70",
      iconBg: "bg-rose-950/40",
      iconColor: "text-rose-400",
      iconBorder: "border-rose-800/60",
      badgeBg: "bg-rose-950/60 border-rose-800 text-rose-300",
      bulletBg: "bg-rose-500",
    };
  }

  if (op === "range_scan" || access === "RANGE") {
    return {
      icon: Activity,
      cardBg: "bg-[#0e131d]",
      cardBorder: "border-sky-900/50 hover:border-sky-700/70",
      iconBg: "bg-sky-950/40",
      iconColor: "text-sky-400",
      iconBorder: "border-sky-800/60",
      badgeBg: "bg-sky-950/60 border-sky-800 text-sky-300",
      bulletBg: "bg-sky-500",
    };
  }

  if (op === "index_scan" || access === "REF" || access === "EQ_REF" || access === "CONST") {
    return {
      icon: CheckCircle2,
      cardBg: "bg-[#0d1614]",
      cardBorder: "border-emerald-900/50 hover:border-emerald-700/70",
      iconBg: "bg-emerald-950/40",
      iconColor: "text-emerald-400",
      iconBorder: "border-emerald-800/60",
      badgeBg: "bg-emerald-950/60 border-emerald-800 text-emerald-300",
      bulletBg: "bg-emerald-500",
    };
  }

  if (op === "nested_loop") {
    return {
      icon: GitFork,
      cardBg: "bg-[#111320]",
      cardBorder: "border-indigo-900/50 hover:border-indigo-700/70",
      iconBg: "bg-indigo-950/40",
      iconColor: "text-indigo-400",
      iconBorder: "border-indigo-800/60",
      badgeBg: "bg-indigo-950/60 border-indigo-800 text-indigo-300",
      bulletBg: "bg-indigo-500",
    };
  }

  if (op === "ordering" || op === "filesort") {
    return {
      icon: ArrowUpDown,
      cardBg: "bg-[#16120e]",
      cardBorder: "border-amber-900/50 hover:border-amber-700/70",
      iconBg: "bg-amber-950/40",
      iconColor: "text-amber-400",
      iconBorder: "border-amber-800/60",
      badgeBg: "bg-amber-950/60 border-amber-800 text-amber-300",
      bulletBg: "bg-amber-500",
    };
  }

  if (op === "grouping" || op === "temporary") {
    return {
      icon: Layers,
      cardBg: "bg-[#161317]",
      cardBorder: "border-purple-900/50 hover:border-purple-700/70",
      iconBg: "bg-purple-950/40",
      iconColor: "text-purple-400",
      iconBorder: "border-purple-800/60",
      badgeBg: "bg-purple-950/60 border-purple-800 text-purple-300",
      bulletBg: "bg-purple-500",
    };
  }

  // Default / Query Block
  return {
    icon: Terminal,
    cardBg: "bg-[#11141c]",
    cardBorder: "border-[#212739] hover:border-[#303850]",
    iconBg: "bg-orange-950/30",
    iconColor: "text-orange-400",
    iconBorder: "border-orange-800/50",
    badgeBg: "bg-[#181e2b] border-[#293247] text-neutral-300",
    bulletBg: "bg-orange-500",
  };
}
