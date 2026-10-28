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
import { useIsLightTheme } from "../stores/preferenceStore";

interface ExplainPlanTreeProps {
  rootNode: ExplainPlanTreeNode;
  treePlanText?: string;
}

export const ExplainPlanTree: React.FC<ExplainPlanTreeProps> = ({
  rootNode,
  treePlanText,
}) => {
  const isLight = useIsLightTheme();
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
    <div className={`flex flex-col h-full w-full select-none text-xs bg-canvas text-fg`}>
      {/* Top Controls Toolbar */}
      <div className={`px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 shrink-0 bg-surface border-line`}>
        <div className="flex items-center space-x-2">
          {treePlanText && (
            <div className={`flex items-center p-0.5 rounded-lg border bg-raised border-line`}>
              <button
                onClick={() => setViewMode("tree")}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                  viewMode === "tree"
                  ? "bg-accent text-accent-fg shadow-sm"
                  : "text-fg-muted hover:text-fg"
                }`}
              >
                <GitFork className="w-3.5 h-3.5" />
                <span>Árbol Visual</span>
              </button>
              <button
                onClick={() => setViewMode("raw_tree")}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                  viewMode === "raw_tree"
                  ? "bg-accent text-accent-fg shadow-sm"
                  : "text-fg-muted hover:text-fg"
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
                className={`px-2 py-1 rounded border transition-colors flex items-center space-x-1 text-[11px] font-medium shadow-xs bg-raised hover:bg-hover text-fg hover:text-fg border-line`}
                title="Expandir todas las ramas del árbol"
              >
                <Maximize2 className="w-3 h-3" />
                <span>Expandir todo</span>
              </button>
              <button
                onClick={collapseAll}
                className={`px-2 py-1 rounded border transition-colors flex items-center space-x-1 text-[11px] font-medium shadow-xs bg-raised hover:bg-hover text-fg hover:text-fg border-line`}
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
            <span className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono flex items-center space-x-1 border ${
              isLight
                ? "bg-rose-50 border-rose-200 text-rose-700"
                : "bg-rose-950/60 border-rose-800/60 text-danger"
            }`}>
              <AlertTriangle className={`w-3 h-3 text-danger`} />
              <span>{summary.scans} Full Scan(s)</span>
            </span>
          )}
          {summary.filesorts > 0 && (
            <span className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono border ${
              isLight
                ? "bg-amber-50 border-amber-200 text-amber-700"
                : "bg-amber-950/60 border-amber-800/60 text-warning"
            }`}>
              ⚡ {summary.filesorts} Filesort
            </span>
          )}

          {viewMode === "tree" && (
            <div className="relative">
              <Search className={`w-3 h-3 absolute left-2 top-2 text-fg-subtle`} />
              <input
                type="text"
                placeholder="Filtrar por tabla o llave..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className={`pl-7 pr-2 py-1 border rounded text-[11px] focus:outline-none focus:border-accent w-44 transition-colors ${
                  isLight
                    ? "bg-white border-slate-300 text-fg placeholder-slate-400"
                    : "bg-raised border-line text-fg placeholder-neutral-500"
                }`}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-5">
        {viewMode === "raw_tree" && treePlanText ? (
          <div className={`border rounded-xl p-4 font-mono text-xs overflow-x-auto whitespace-pre leading-relaxed shadow-inner bg-surface border-line text-success`}>
            {treePlanText}
          </div>
        ) : (
          <div className="min-w-fit max-w-4xl 2xl:max-w-none space-y-1">
            <TreeNodeItem
              node={rootNode}
              collapsedMap={collapsedMap}
              onToggleCollapse={toggleCollapse}
              filterText={filterText.toLowerCase().trim()}
              isLight={isLight}
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
  isLight: boolean;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({
  node,
  collapsedMap,
  onToggleCollapse,
  filterText,
  isLight,
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
  const config = getOperationConfig(node, isLight);
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
            className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center transition-colors shrink-0 border bg-elevated hover:bg-hover text-fg hover:text-fg border-line-strong`}
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
              <span className={`font-bold text-sm tracking-tight text-fg`}>
                {node.name}
              </span>
              {node.accessType && (
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-medium border ${config.badgeBg}`}
                >
                  {node.accessType}
                </span>
              )}
            </div>

            {/* Metrics Chips */}
            <div className="flex items-center space-x-2 text-[11px]">
              {node.rowsExamined !== undefined && (
                <span className={`px-2 py-0.5 rounded border text-fg bg-raised border-line`}>
                  ~{node.rowsExamined.toLocaleString()} filas
                </span>
              )}
              {node.filteredPercent !== undefined && (
                <span className={`px-2 py-0.5 rounded border ${
                  isLight
                    ? "text-sky-700 bg-sky-50 border-sky-200 font-semibold"
                    : "text-info bg-sky-950/40 border-sky-800/40"
                }`}>
                  {node.filteredPercent}% filtrado
                </span>
              )}
              {node.cost && (
                <span className={`px-2 py-0.5 rounded border ${
                  isLight
                    ? "text-amber-700 bg-amber-50 border-amber-200 font-semibold"
                    : "text-warning bg-amber-950/40 border-amber-800/40"
                }`}>
                  {node.cost}
                </span>
              )}
            </div>
          </div>

          {/* Table & Index details */}
          {(node.tableName || node.keyUsed || node.refColumns) && (
            <div className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted`}>
              {node.tableName && (
                <div className="flex items-center space-x-1">
                  <Database className={`w-3 h-3 text-fg-subtle`} />
                  <span>Tabla:</span>
                  <span className={`font-semibold text-fg`}>{node.tableName}</span>
                </div>
              )}
              {node.keyUsed && (
                <div className="flex items-center space-x-1">
                  <Key className={`w-3 h-3 text-accent-text`} />
                  <span>Llave:</span>
                  <span className={`font-semibold text-accent-text`}>{node.keyUsed}</span>
                  {node.keyLen && <span className={"text-fg-subtle"}>({node.keyLen})</span>}
                </div>
              )}
              {node.refColumns && node.refColumns.length > 0 && (
                <div className="flex items-center space-x-1">
                  <span className={"text-fg-subtle"}>Ref:</span>
                  <span className={"text-fg"}>{node.refColumns.join(", ")}</span>
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
                    className={`px-1.5 py-0.5 rounded text-[11px] font-semibold font-mono border ${
                      isDangerous
                        ? isLight
                          ? "bg-rose-50 border-rose-200 text-rose-700"
                          : "bg-rose-950/60 border-rose-800/70 text-danger"
                        : isGood
                        ? isLight
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-emerald-950/60 border-emerald-800/70 text-success"
                          : "bg-elevated border-line-strong text-fg-muted"
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
            <div className={`mt-2 p-1.5 rounded text-[11px] font-mono select-text border bg-canvas border-line text-fg-muted`}>
              <span className={`font-semibold text-fg-subtle`}>WHERE / Condición: </span>
              <span className={"text-info"}>{node.condition}</span>
            </div>
          )}

          {/* Collapsed children pill */}
          {hasChildren && isCollapsed && (
            <button
              onClick={() => onToggleCollapse(node.id)}
              className={`mt-2 text-[11px] px-2 py-0.5 rounded-full inline-flex items-center space-x-1 border font-medium transition-colors ${
                isLight
                  ? "text-accent-text bg-accent-soft border-accent/30"
                  : "text-accent-text hover:text-accent-text bg-accent-soft border-accent/30"
              }`}
            >
              <span>+{node.children.length} sub-operaciones colapsadas</span>
            </button>
          )}
        </div>
      </div>

      {/* Children branches with tree lines */}
      {hasChildren && !isCollapsed && (
        <div className={`relative pl-6 ml-4 mt-2 space-y-2 border-l-2 border-line`}>
          {node.children.map((child) => (
            <div key={child.id} className="relative">
              {/* Horizontal line connector */}
              <div className={`absolute -left-6 top-5 w-5 h-0.5 bg-elevated`} />
              <TreeNodeItem
                node={child}
                collapsedMap={collapsedMap}
                onToggleCollapse={onToggleCollapse}
                filterText={filterText}
                isLight={isLight}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function getOperationConfig(node: ExplainPlanTreeNode, isLight: boolean) {
  const op = node.operationType;
  const access = (node.accessType || "").toUpperCase();

  if (op === "table_scan" || access === "ALL") {
    return isLight
      ? {
          icon: AlertTriangle,
          cardBg: "bg-rose-50/80",
          cardBorder: "border-rose-200 hover:border-rose-300 shadow-xs",
          iconBg: "bg-rose-100",
          iconColor: "text-rose-600",
          iconBorder: "border-rose-200",
          badgeBg: "bg-rose-100 border-rose-300 text-rose-700",
          bulletBg: "bg-rose-500",
        }
      : {
          icon: AlertTriangle,
          cardBg: "bg-surface",
          cardBorder: "border-rose-900/50 hover:border-rose-700/70",
          iconBg: "bg-rose-950/40",
          iconColor: "text-danger",
          iconBorder: "border-rose-800/60",
          badgeBg: "bg-rose-950/60 border-rose-800 text-danger",
          bulletBg: "bg-rose-500",
        };
  }

  if (op === "range_scan" || access === "RANGE") {
    return isLight
      ? {
          icon: Activity,
          cardBg: "bg-sky-50/80",
          cardBorder: "border-sky-200 hover:border-sky-300 shadow-xs",
          iconBg: "bg-sky-100",
          iconColor: "text-sky-600",
          iconBorder: "border-sky-200",
          badgeBg: "bg-sky-100 border-sky-300 text-sky-700",
          bulletBg: "bg-sky-500",
        }
      : {
          icon: Activity,
          cardBg: "bg-surface",
          cardBorder: "border-sky-900/50 hover:border-sky-700/70",
          iconBg: "bg-sky-950/40",
          iconColor: "text-info",
          iconBorder: "border-sky-800/60",
          badgeBg: "bg-sky-950/60 border-sky-800 text-info",
          bulletBg: "bg-sky-500",
        };
  }

  if (op === "index_scan" || access === "REF" || access === "EQ_REF" || access === "CONST") {
    return isLight
      ? {
          icon: CheckCircle2,
          cardBg: "bg-emerald-50/80",
          cardBorder: "border-emerald-200 hover:border-emerald-300 shadow-xs",
          iconBg: "bg-emerald-100",
          iconColor: "text-emerald-600",
          iconBorder: "border-emerald-200",
          badgeBg: "bg-emerald-100 border-emerald-300 text-emerald-700",
          bulletBg: "bg-emerald-500",
        }
      : {
          icon: CheckCircle2,
          cardBg: "bg-surface",
          cardBorder: "border-emerald-900/50 hover:border-emerald-700/70",
          iconBg: "bg-emerald-950/40",
          iconColor: "text-success",
          iconBorder: "border-emerald-800/60",
          badgeBg: "bg-emerald-950/60 border-emerald-800 text-success",
          bulletBg: "bg-emerald-500",
        };
  }

  if (op === "nested_loop") {
    return isLight
      ? {
          icon: GitFork,
          cardBg: "bg-indigo-50/80",
          cardBorder: "border-indigo-200 hover:border-indigo-300 shadow-xs",
          iconBg: "bg-indigo-100",
          iconColor: "text-indigo-600",
          iconBorder: "border-indigo-200",
          badgeBg: "bg-indigo-100 border-indigo-300 text-indigo-700",
          bulletBg: "bg-indigo-500",
        }
      : {
          icon: GitFork,
          cardBg: "bg-raised",
          cardBorder: "border-indigo-900/50 hover:border-indigo-700/70",
          iconBg: "bg-indigo-950/40",
          iconColor: "text-indigo-400",
          iconBorder: "border-indigo-800/60",
          badgeBg: "bg-indigo-950/60 border-indigo-800 text-indigo-300",
          bulletBg: "bg-indigo-500",
        };
  }

  if (op === "ordering" || op === "filesort") {
    return isLight
      ? {
          icon: ArrowUpDown,
          cardBg: "bg-amber-50/80",
          cardBorder: "border-amber-200 hover:border-amber-300 shadow-xs",
          iconBg: "bg-amber-100",
          iconColor: "text-amber-600",
          iconBorder: "border-amber-200",
          badgeBg: "bg-amber-100 border-amber-300 text-amber-700",
          bulletBg: "bg-amber-500",
        }
      : {
          icon: ArrowUpDown,
          cardBg: "bg-surface",
          cardBorder: "border-amber-900/50 hover:border-amber-700/70",
          iconBg: "bg-amber-950/40",
          iconColor: "text-warning",
          iconBorder: "border-amber-800/60",
          badgeBg: "bg-amber-950/60 border-amber-800 text-warning",
          bulletBg: "bg-amber-500",
        };
  }

  if (op === "grouping" || op === "temporary") {
    return isLight
      ? {
          icon: Layers,
          cardBg: "bg-purple-50/80",
          cardBorder: "border-purple-200 hover:border-purple-300 shadow-xs",
          iconBg: "bg-purple-100",
          iconColor: "text-purple-600",
          iconBorder: "border-purple-200",
          badgeBg: "bg-purple-100 border-purple-300 text-purple-700",
          bulletBg: "bg-purple-500",
        }
      : {
          icon: Layers,
          cardBg: "bg-surface",
          cardBorder: "border-purple-900/50 hover:border-purple-700/70",
          iconBg: "bg-purple-950/40",
          iconColor: "text-purple-400",
          iconBorder: "border-purple-800/60",
          badgeBg: "bg-purple-950/60 border-purple-800 text-purple-300",
          bulletBg: "bg-purple-500",
        };
  }

  // Default / Query Block
  return isLight
    ? {
        icon: Terminal,
        cardBg: "bg-white",
        cardBorder: "border-slate-200 hover:border-slate-300 shadow-xs",
        iconBg: "bg-slate-100",
        iconColor: "text-accent-text",
        iconBorder: "border-slate-200",
        badgeBg: "bg-slate-100 border-slate-300 text-fg",
        bulletBg: "bg-accent",
      }
    : {
        icon: Terminal,
        cardBg: "bg-surface",
        cardBorder: "border-line hover:border-line-strong",
        iconBg: "bg-accent-soft",
        iconColor: "text-accent-text",
        iconBorder: "border-accent/30",
        badgeBg: "bg-elevated border-line-strong text-fg",
        bulletBg: "bg-accent",
      };
}
