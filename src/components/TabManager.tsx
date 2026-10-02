import React from "react";
import {
  X,
  Table as TableIcon,
  Terminal,
  Plus,
  Settings,
  FunctionSquare,
  Zap,
} from "lucide-react";
import type { OpenTab } from "../types/database";

interface TabManagerProps {
  tabs: OpenTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewQueryTab?: () => void;
}

export const TabManager: React.FC<TabManagerProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewQueryTab,
}) => {
  return (
    <div className="h-9 bg-[#0b0d12] border-b border-[#1b1f2c] flex items-center px-2 space-x-1 select-none overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        const getIcon = () => {
          switch (tab.type) {
            case "table":
              return <TableIcon className="w-3.5 h-3.5 text-orange-400 shrink-0" />;
            case "routine":
              return tab.routineType === "FUNCTION" ? (
                <FunctionSquare className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              ) : (
                <Settings className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              );
            case "trigger":
              return <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
            case "query":
            default:
              return <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
          }
        };

        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`group flex items-center space-x-2 px-3 py-1.5 rounded-t-md text-xs font-mono cursor-pointer transition-colors max-w-xs ${
              isActive
                ? "bg-[#11141c] text-orange-300 border-t-2 border-orange-500 shadow-sm"
                : "bg-transparent text-neutral-400 hover:bg-[#131620] hover:text-neutral-200"
            }`}
          >
            {getIcon()}

            <span className="truncate">{tab.title}</span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="p-0.5 rounded hover:bg-neutral-800 text-neutral-500 hover:text-white transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}

      {onNewQueryTab && (
        <button
          onClick={onNewQueryTab}
          title="Nueva pestaña de consulta SQL"
          className="p-1 rounded text-neutral-500 hover:text-neutral-200 hover:bg-[#151822] transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
