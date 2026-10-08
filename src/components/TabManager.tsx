import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Table as TableIcon,
  Terminal,
  Plus,
  Settings,
  FunctionSquare,
  Zap,
  LayoutDashboard,
  Activity,
  Flame,
  Sparkles,
  GitCompare,
  Wrench,
  Bot,
  FileText,
  Copy,
  Pencil,
  ArrowRight,
  ArrowLeft,
  Layers,
  Trash2,
  Clipboard,
  Check,
} from "lucide-react";
import { useUIStore } from "../stores/uiStore";
import type { OpenTab } from "../types/database";

export interface TabManagerProps {
  tabs?: OpenTab[];
  activeTabId?: string | null;
  onSelectTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onCloseOtherTabs?: (id: string) => void;
  onCloseTabsToRight?: (id: string) => void;
  onCloseTabsToLeft?: (id: string) => void;
  onCloseAllTabs?: () => void;
  onReorderTabs?: (startIndex: number, endIndex: number) => void;
  onDuplicateTab?: (id: string) => void;
  onRenameTab?: (id: string, newTitle: string) => void;
  onNewQueryTab?: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  tab: OpenTab | null;
  tabIndex: number;
}

interface DropIndicator {
  index: number;
  position: "before" | "after";
}

export const TabManager: React.FC<TabManagerProps> = (props) => {
  const store = useUIStore();

  const tabs = props.tabs ?? store.tabs;
  const activeTabId = props.activeTabId ?? store.activeTabId;
  const onSelectTab = props.onSelectTab ?? store.setActiveTabId;
  const onCloseTab = props.onCloseTab ?? store.closeTab;
  const onCloseOtherTabs = props.onCloseOtherTabs ?? store.closeOtherTabs;
  const onCloseTabsToRight = props.onCloseTabsToRight ?? store.closeTabsToTheRight;
  const onCloseTabsToLeft = props.onCloseTabsToLeft ?? store.closeTabsToTheLeft;
  const onCloseAllTabs = props.onCloseAllTabs ?? store.clearTabs;
  const onReorderTabs = props.onReorderTabs ?? store.reorderTabs;
  const onDuplicateTab = props.onDuplicateTab ?? store.duplicateTab;
  const onRenameTab = props.onRenameTab ?? store.renameTab;
  const onNewQueryTab = props.onNewQueryTab;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [copiedTabId, setCopiedTabId] = useState<string | null>(null);

  // Drag and Drop state
  const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Focus inline edit input when editing starts
  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  // Close context menu on outside click or escape
  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  // Horizontal wheel scroll handler
  const handleWheel = (e: React.WheelEvent) => {
    if (containerRef.current) {
      containerRef.current.scrollLeft += e.deltaY;
    }
  };

  // Open context menu for a specific tab
  const handleTabContextMenu = (e: React.MouseEvent, tab: OpenTab, index: number) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 210;
    const menuHeight = 290;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenu({
      x: Math.max(10, x),
      y: Math.max(10, y),
      tab,
      tabIndex: index,
    });
  };

  // Open context menu on empty tab bar space
  const handleBarContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();

    const menuWidth = 210;
    const menuHeight = 110;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenu({
      x: Math.max(10, x),
      y: Math.max(10, y),
      tab: null,
      tabIndex: -1,
    });
  };

  // Handle Middle Click on tab to close
  const handleAuxClick = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      onCloseTab(tabId);
    }
  };

  // Start inline rename
  const handleStartRename = (tab: OpenTab) => {
    setEditingTabId(tab.id);
    setEditingTitle(tab.title);
    setContextMenu(null);
  };

  // Submit inline rename
  const handleFinishRename = (tabId: string) => {
    if (editingTitle.trim()) {
      onRenameTab(tabId, editingTitle.trim());
    }
    setEditingTabId(null);
  };

  // Cancel inline rename
  const handleCancelRename = () => {
    setEditingTabId(null);
  };

  // Copy title to clipboard
  const handleCopyTitle = async (title: string, tabId: string) => {
    try {
      await navigator.clipboard.writeText(title);
      setCopiedTabId(tabId);
      setTimeout(() => setCopiedTabId(null), 1500);
    } catch {
      // Fallback if clipboard API is restricted
    }
    setContextMenu(null);
  };

  // ─── Drag & Drop Handlers ──────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, index: number, tabId: string) => {
    if (editingTabId) {
      e.preventDefault();
      return;
    }
    setDraggedTabIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tabId);
    e.dataTransfer.setData("application/x-pyro-tab-index", String(index));
  };

  const handleDragOverTab = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    if (draggedTabIndex === null) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const isAfter = mouseX > rect.width / 2;

    setDropIndicator({
      index: targetIndex,
      position: isAfter ? "after" : "before",
    });
  };

  const handleDragLeaveTab = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (!containerRef.current?.contains(related)) {
      setDropIndicator(null);
    }
  };

  const handleDropOnTab = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    let sourceIndex = draggedTabIndex;
    if (sourceIndex === null) {
      const dataIdx = e.dataTransfer.getData("application/x-pyro-tab-index");
      if (dataIdx !== "") {
        sourceIndex = parseInt(dataIdx, 10);
      }
    }

    if (sourceIndex === null || isNaN(sourceIndex)) {
      setDropIndicator(null);
      setDraggedTabIndex(null);
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const isAfter = mouseX > rect.width / 2;

    let destinationIndex = isAfter ? targetIndex + 1 : targetIndex;

    // Adjust destination index if dragging from before destination
    if (sourceIndex < destinationIndex) {
      destinationIndex -= 1;
    }

    if (sourceIndex !== destinationIndex && destinationIndex >= 0 && destinationIndex < tabs.length) {
      onReorderTabs(sourceIndex, destinationIndex);
    }

    setDraggedTabIndex(null);
    setDropIndicator(null);
  };

  const handleContainerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedTabIndex !== null && draggedTabIndex !== tabs.length - 1) {
      onReorderTabs(draggedTabIndex, tabs.length - 1);
    }
    setDraggedTabIndex(null);
    setDropIndicator(null);
  };

  const handleDragEnd = () => {
    setDraggedTabIndex(null);
    setDropIndicator(null);
  };

  const getIcon = (tab: OpenTab) => {
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
      case "tables_overview":
        return <TableIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case "dashboard":
        return <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case "health":
        return <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case "slow_query":
        return <Flame className="w-3.5 h-3.5 text-orange-400 shrink-0" />;
      case "advisor":
        return <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case "diff":
        return <GitCompare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
      case "operations":
        return <Wrench className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
      case "agent":
        return <Bot className="w-3.5 h-3.5 text-violet-400 shrink-0" />;
      case "reports":
        return <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case "query":
      default:
        return <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    }
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onContextMenu={handleBarContextMenu}
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
      className="h-9 bg-[#0b0d12] border-b border-[#1b1f2c] flex items-center px-2 space-x-1 select-none overflow-x-auto scrollbar-none"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isDragging = draggedTabIndex === index;
        const isEditing = editingTabId === tab.id;

        const showIndicatorBefore =
          dropIndicator?.index === index &&
          dropIndicator.position === "before" &&
          draggedTabIndex !== index &&
          draggedTabIndex !== index - 1;

        const showIndicatorAfter =
          dropIndicator?.index === index &&
          dropIndicator.position === "after" &&
          draggedTabIndex !== index &&
          draggedTabIndex !== index + 1;

        return (
          <div
            key={tab.id}
            draggable={!isEditing}
            onDragStart={(e) => handleDragStart(e, index, tab.id)}
            onDragOver={(e) => handleDragOverTab(e, index)}
            onDragLeave={handleDragLeaveTab}
            onDrop={(e) => handleDropOnTab(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => {
              if (!isEditing) onSelectTab(tab.id);
            }}
            onAuxClick={(e) => handleAuxClick(e, tab.id)}
            onContextMenu={(e) => handleTabContextMenu(e, tab, index)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleStartRename(tab);
            }}
            title={tab.title}
            className={`group relative flex items-center space-x-2 px-3 py-1.5 rounded-t-md text-xs font-mono transition-all duration-150 max-w-xs cursor-pointer shrink-0 ${
              isDragging
                ? "opacity-30 scale-95 border border-dashed border-orange-500 bg-[#141824]"
                : isActive
                ? "bg-[#11141c] text-orange-300 border-t-2 border-orange-500 shadow-sm"
                : "bg-transparent text-neutral-400 hover:bg-[#131620] hover:text-neutral-200"
            }`}
          >
            {/* Visual Drop Insertion Line Before */}
            {showIndicatorBefore && (
              <div className="absolute -left-1 top-1 bottom-1 w-1 bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,1)] rounded-full z-30 pointer-events-none" />
            )}

            <div
              className={`flex items-center space-x-2 ${
                draggedTabIndex !== null ? "pointer-events-none" : ""
              }`}
            >
              {getIcon(tab)}

              {isEditing ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleFinishRename(tab.id);
                    if (e.key === "Escape") handleCancelRename();
                  }}
                  onBlur={() => handleFinishRename(tab.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-[#1c2230] text-neutral-100 text-xs font-mono px-1 py-0.5 rounded border border-orange-500/70 outline-none w-28 pointer-events-auto"
                />
              ) : (
                <span className="truncate max-w-[140px]">{tab.title}</span>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                title="Cerrar pestaña (o botón central)"
                className="p-0.5 rounded hover:bg-neutral-800/80 text-neutral-500 hover:text-white transition-colors pointer-events-auto"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Visual Drop Insertion Line After */}
            {showIndicatorAfter && (
              <div className="absolute -right-1 top-1 bottom-1 w-1 bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,1)] rounded-full z-30 pointer-events-none" />
            )}
          </div>
        );
      })}

      {/* New Query Tab Button */}
      {onNewQueryTab && (
        <button
          onClick={onNewQueryTab}
          title="Nueva pestaña de consulta SQL"
          className="p-1 rounded text-neutral-500 hover:text-neutral-200 hover:bg-[#151822] transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}

      {/* Context Menu Popup */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 min-w-[210px] bg-[#11141c] border border-[#232838] shadow-2xl rounded-lg py-1.5 text-xs font-mono text-neutral-300 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.tab ? (
            <>
              {/* Header Info */}
              <div className="px-3 py-1 text-[10px] uppercase font-bold text-neutral-500 tracking-wider border-b border-[#1c2230] mb-1 flex items-center justify-between">
                <span className="truncate max-w-[130px]">{contextMenu.tab.title}</span>
                <span className="text-orange-400 font-normal lowercase">
                  {contextMenu.tab.type}
                </span>
              </div>

              {/* Close Current */}
              <button
                onClick={() => {
                  if (contextMenu.tab) onCloseTab(contextMenu.tab.id);
                  setContextMenu(null);
                }}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
              >
                <span className="flex items-center space-x-2">
                  <X className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Cerrar pestaña</span>
                </span>
                <span className="text-[10px] text-neutral-500">Ctrl+W</span>
              </button>

              {/* Close Others */}
              <button
                disabled={tabs.length <= 1}
                onClick={() => {
                  if (contextMenu.tab) onCloseOtherTabs(contextMenu.tab.id);
                  setContextMenu(null);
                }}
                className={`w-full flex items-center space-x-2 px-3 py-1.5 transition-colors text-left ${
                  tabs.length <= 1
                    ? "opacity-30 cursor-not-allowed text-neutral-500"
                    : "hover:bg-[#1b202e] hover:text-white"
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-neutral-400" />
                <span>Cerrar las demás</span>
              </button>

              {/* Close Right */}
              <button
                disabled={contextMenu.tabIndex >= tabs.length - 1}
                onClick={() => {
                  if (contextMenu.tab) onCloseTabsToRight(contextMenu.tab.id);
                  setContextMenu(null);
                }}
                className={`w-full flex items-center space-x-2 px-3 py-1.5 transition-colors text-left ${
                  contextMenu.tabIndex >= tabs.length - 1
                    ? "opacity-30 cursor-not-allowed text-neutral-500"
                    : "hover:bg-[#1b202e] hover:text-white"
                }`}
              >
                <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
                <span>Cerrar pestañas a la derecha</span>
              </button>

              {/* Close Left */}
              <button
                disabled={contextMenu.tabIndex <= 0}
                onClick={() => {
                  if (contextMenu.tab) onCloseTabsToLeft(contextMenu.tab.id);
                  setContextMenu(null);
                }}
                className={`w-full flex items-center space-x-2 px-3 py-1.5 transition-colors text-left ${
                  contextMenu.tabIndex <= 0
                    ? "opacity-30 cursor-not-allowed text-neutral-500"
                    : "hover:bg-[#1b202e] hover:text-white"
                }`}
              >
                <ArrowLeft className="w-3.5 h-3.5 text-neutral-400" />
                <span>Cerrar pestañas a la izquierda</span>
              </button>

              <div className="my-1 border-t border-[#1c2230]" />

              {/* Duplicate Tab */}
              <button
                onClick={() => {
                  if (contextMenu.tab) onDuplicateTab(contextMenu.tab.id);
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
              >
                <Copy className="w-3.5 h-3.5 text-neutral-400" />
                <span>Duplicar pestaña</span>
              </button>

              {/* Rename Tab */}
              <button
                onClick={() => {
                  if (contextMenu.tab) handleStartRename(contextMenu.tab);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
              >
                <Pencil className="w-3.5 h-3.5 text-neutral-400" />
                <span>Renombrar pestaña</span>
              </button>

              {/* Copy Title */}
              <button
                onClick={() => {
                  if (contextMenu.tab) handleCopyTitle(contextMenu.tab.title, contextMenu.tab.id);
                }}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
              >
                <span className="flex items-center space-x-2">
                  {copiedTabId === contextMenu.tab.id ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Clipboard className="w-3.5 h-3.5 text-neutral-400" />
                  )}
                  <span>
                    {copiedTabId === contextMenu.tab.id ? "¡Copiado!" : "Copiar nombre"}
                  </span>
                </span>
              </button>

              <div className="my-1 border-t border-[#1c2230]" />

              {/* Close All */}
              <button
                onClick={() => {
                  onCloseAllTabs();
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-red-950/40 text-red-400 hover:text-red-300 transition-colors text-left"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span>Cerrar todas las pestañas</span>
              </button>
            </>
          ) : (
            <>
              {/* Empty bar context menu */}
              {onNewQueryTab && (
                <button
                  onClick={() => {
                    onNewQueryTab();
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[#1b202e] hover:text-white transition-colors text-left"
                >
                  <Plus className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Nueva pestaña de consulta</span>
                </button>
              )}

              {tabs.length > 0 && (
                <button
                  onClick={() => {
                    onCloseAllTabs();
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-red-950/40 text-red-400 hover:text-red-300 transition-colors text-left"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span>Cerrar todas las pestañas</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
