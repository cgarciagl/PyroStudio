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
import { ghostBtn, inputClass } from "./ui/styles";

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
    <div className="flex flex-col h-full w-full select-none text-xs bg-canvas text-fg">
      {/* Top Controls Toolbar */}
      <div className="px-3 py-1.5 border-b flex flex-wrap items-center justify-between gap-2 shrink-0 bg-surface border-line">
        <div className="flex items-center gap-1">
          {treePlanText && (
            <div className="flex items-center p-0.5 rounded-md border bg-raised border-line mr-1">
              <button
                onClick={() => setViewMode("tree")}
                className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1.5 ${
                  viewMode === "tree" ? "bg-surface text-fg font-medium" : "text-fg-muted hover:text-fg"
                }`}
              >
                <GitFork className="w-3.5 h-3.5" />
                <span>Árbol visual</span>
              </button>
              <button
                onClick={() => setViewMode("raw_tree")}
                className={`px-2 py-0.5 rounded text-xs transition-colors flex items-center gap-1.5 ${
                  viewMode === "raw_tree" ? "bg-surface text-fg font-medium" : "text-fg-muted hover:text-fg"
                }`}
              >
                <FileCode2 className="w-3.5 h-3.5" />
                <span>Nativo (FORMAT=TREE)</span>
              </button>
            </div>
          )}

          {viewMode === "tree" && (
            <>
              <button onClick={expandAll} className={ghostBtn} title="Expandir todas las ramas del árbol">
                <Maximize2 className="w-3 h-3" />
                <span>Expandir todo</span>
              </button>
              <button onClick={collapseAll} className={ghostBtn} title="Colapsar ramas del árbol">
                <Minimize2 className="w-3 h-3" />
                <span>Colapsar todo</span>
              </button>
            </>
          )}
        </div>

        {/* Search & Summary */}
        <div className="flex items-center gap-3 text-[11px] text-fg-muted">
          {summary.scans > 0 && (
            <span className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-danger" />
              {summary.scans} full scan{summary.scans !== 1 ? "s" : ""}
            </span>
          )}
          {summary.filesorts > 0 && (
            <span className="flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-warning" />
              {summary.filesorts} filesort
            </span>
          )}
          {summary.temporaries > 0 && (
            <span className="flex items-center gap-1">
              <Layers className="w-3 h-3 text-warning" />
              {summary.temporaries} temporal{summary.temporaries !== 1 ? "es" : ""}
            </span>
          )}
          {summary.indexLookups > 0 && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-success" />
              {summary.indexLookups} por índice
            </span>
          )}

          {viewMode === "tree" && (
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2 top-2 text-fg-subtle" />
              <input
                type="text"
                placeholder="Filtrar por tabla o llave..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className={`${inputClass} !w-44 !py-1 pl-7 text-[11px]`}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-3">
        {viewMode === "raw_tree" && treePlanText ? (
          <div className="border rounded-lg p-3 font-mono text-[11px] overflow-x-auto whitespace-pre leading-relaxed select-text bg-surface border-line text-fg">
            {treePlanText}
          </div>
        ) : (
          <div className="min-w-fit max-w-4xl 2xl:max-w-none">
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

  const { icon: Icon, color } = getOperationConfig(node);

  return (
    <div className={`relative flex flex-col ${!matchesFilter ? "opacity-35" : ""}`}>
      {/* Node Row */}
      <div className="relative flex items-start gap-1.5 px-1.5 py-1 rounded-md hover:bg-hover transition-colors">
        {/* Expand / Collapse toggle */}
        {hasChildren ? (
          <button
            onClick={() => onToggleCollapse(node.id)}
            className="mt-px w-4 h-4 rounded flex items-center justify-center shrink-0 text-fg-muted hover:text-fg"
            title={isCollapsed ? "Expandir rama" : "Colapsar rama"}
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <Icon className={`mt-0.5 w-3.5 h-3.5 shrink-0 ${color}`} />

        {/* Node Body */}
        <div className="flex-1 min-w-0 font-mono">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-semibold text-xs text-fg">{node.name}</span>
            {node.accessType && <span className={`text-[11px] ${color}`}>{node.accessType}</span>}
            {node.tableName && (
              <span className="flex items-center gap-1 text-[11px] text-fg-muted">
                <Database className="w-3 h-3 text-fg-subtle" />
                <span className="text-fg">{node.tableName}</span>
              </span>
            )}
            {node.keyUsed && (
              <span className="flex items-center gap-1 text-[11px] text-fg-muted">
                <Key className="w-3 h-3 text-fg-subtle" />
                <span className="text-fg">{node.keyUsed}</span>
                {node.keyLen && <span className="text-fg-subtle">({node.keyLen})</span>}
              </span>
            )}
            {node.refColumns && node.refColumns.length > 0 && (
              <span className="text-[11px] text-fg-muted">ref: {node.refColumns.join(", ")}</span>
            )}

            {/* Metrics */}
            <span className="ml-auto flex items-center gap-2.5 text-[11px] text-fg-muted">
              {node.rowsExamined !== undefined && <span>~{node.rowsExamined.toLocaleString()} filas</span>}
              {node.filteredPercent !== undefined && <span>{node.filteredPercent}% filtrado</span>}
              {node.cost && <span>{node.cost}</span>}
            </span>
          </div>

          {/* Flags */}
          {node.flags.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-fg-muted">
              {node.flags.map((flag, idx) => {
                const isDangerous = flag.includes("filesort") || flag.includes("temporary");
                const isGood = flag.includes("Covering") || flag.includes("index");
                return (
                  <span key={idx} className="flex items-center gap-1">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isDangerous ? "bg-danger" : isGood ? "bg-success" : "bg-fg-subtle"
                      }`}
                    />
                    {flag}
                  </span>
                );
              })}
            </div>
          )}

          {/* Condition clause preview */}
          {node.condition && (
            <div className="mt-0.5 text-[11px] select-text text-fg-muted break-all">
              <span className="text-fg-subtle">WHERE </span>
              <span className="text-fg">{node.condition}</span>
            </div>
          )}

          {/* Collapsed children hint */}
          {hasChildren && isCollapsed && (
            <button
              onClick={() => onToggleCollapse(node.id)}
              className="mt-0.5 text-[11px] text-fg-subtle hover:text-fg transition-colors"
            >
              +{node.children.length} sub-operaciones colapsadas
            </button>
          )}
        </div>
      </div>

      {/* Children branches with tree lines */}
      {hasChildren && !isCollapsed && (
        <div className="relative pl-3 ml-3.5 border-l border-line">
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              collapsedMap={collapsedMap}
              onToggleCollapse={onToggleCollapse}
              filterText={filterText}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Color encodes the operation cost (data), so it goes only on the icon and access type.
function getOperationConfig(node: ExplainPlanTreeNode) {
  const op = node.operationType;
  const access = (node.accessType || "").toUpperCase();

  if (op === "table_scan" || access === "ALL") return { icon: AlertTriangle, color: "text-danger" };
  if (op === "range_scan" || access === "RANGE") return { icon: Activity, color: "text-info" };
  if (op === "index_scan" || access === "REF" || access === "EQ_REF" || access === "CONST")
    return { icon: CheckCircle2, color: "text-success" };
  if (op === "nested_loop") return { icon: GitFork, color: "text-fg-muted" };
  if (op === "ordering" || op === "filesort") return { icon: ArrowUpDown, color: "text-warning" };
  if (op === "grouping" || op === "temporary") return { icon: Layers, color: "text-warning" };
  return { icon: Terminal, color: "text-accent-text" };
}
