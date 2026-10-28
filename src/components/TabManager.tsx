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
  Columns2,
  Pencil,
  ArrowRight,
  ArrowLeft,
  Layers,
  Trash2,
  Clipboard,
  Check,
  Pin,
  PinOff,
  RotateCcw,
} from "lucide-react";
import { useUIStore } from "../stores/uiStore";
import { ObjectIcon } from "./objectIcons";
import { useConnectionStore } from "../stores/connectionStore";
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
  /** Tab shown to the right of the active one (split view). */
  splitTabId?: string | null;
  /** Opens a tab in the right pane, or closes the split with `null`. Omit to disable split view. */
  onSplitTab?: (id: string | null) => void;
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
  const recentlyClosedTabs = store.recentlyClosedTabs;
  const onSelectTab = props.onSelectTab ?? store.setActiveTabId;
  const onCloseTab = props.onCloseTab ?? store.closeTab;
  const onCloseOtherTabs = props.onCloseOtherTabs ?? store.closeOtherTabs;
  const onCloseTabsToRight = props.onCloseTabsToRight ?? store.closeTabsToTheRight;
  const onCloseTabsToLeft = props.onCloseTabsToLeft ?? store.closeTabsToTheLeft;
  const onCloseAllTabs = props.onCloseAllTabs ?? store.clearTabs;
  const onReorderTabs = props.onReorderTabs ?? store.reorderTabs;
  const onDuplicateTab = props.onDuplicateTab ?? store.duplicateTab;
  const onRenameTab = props.onRenameTab ?? store.renameTab;
  const togglePinTab = store.togglePinTab;
  const reopenLastClosedTab = store.reopenLastClosedTab;
  const onNewQueryTab = props.onNewQueryTab;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [copiedTabId, setCopiedTabId] = useState<string | null>(null);

  // Drag and Drop state
  const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const dragSourceIndexRef = useRef<number | null>(null);
  const isDraggingActiveRef = useRef<boolean>(false);
  const justDroppedRef = useRef<boolean>(false);

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

  // Global Tab Shortcuts: Ctrl+Shift+T (Reopen closed tab), Ctrl+W (Close active tab)
  useEffect(() => {
    const handleTabShortcuts = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        reopenLastClosedTab();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        if (activeTabId) {
          e.preventDefault();
          onCloseTab(activeTabId);
        }
      }
    };

    window.addEventListener("keydown", handleTabShortcuts);
    return () => window.removeEventListener("keydown", handleTabShortcuts);
  }, [activeTabId, onCloseTab, reopenLastClosedTab]);

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

    const menuWidth = 220;
    const menuHeight = 340;
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

    const menuWidth = 220;
    const menuHeight = 140;
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
      // Fallback
    }
    setContextMenu(null);
  };

  // ─── Drag & Drop Handlers ──────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, index: number, tabId: string) => {
    if (editingTabId) {
      e.preventDefault();
      return;
    }
    dragSourceIndexRef.current = index;
    isDraggingActiveRef.current = true;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tabId);
    e.dataTransfer.setData("application/x-pyro-tab-index", String(index));

    // Defer visual state update so browser can initiate the native drag session
    // without being canceled by immediate synchronous DOM mutations / reflows
    setTimeout(() => {
      if (isDraggingActiveRef.current) {
        setDraggedTabIndex(index);
      }
    }, 0);
  };

  const handleDragOverTab = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    const sourceIndex = dragSourceIndexRef.current ?? draggedTabIndex;
    if (sourceIndex === null) return;

    if (sourceIndex === targetIndex) {
      setDropIndicator(null);
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const isAfter = mouseX > rect.width / 2;

    // Calculate real destination position
    let destIndex: number;
    if (sourceIndex < targetIndex) {
      destIndex = isAfter ? targetIndex : Math.max(0, targetIndex - 1);
    } else {
      destIndex = isAfter ? Math.min(tabs.length - 1, targetIndex + 1) : targetIndex;
    }

    if (destIndex === sourceIndex) {
      setDropIndicator(null);
      return;
    }

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

    let sourceIndex = dragSourceIndexRef.current ?? draggedTabIndex;
    if (sourceIndex === null) {
      const dataIdx = e.dataTransfer.getData("application/x-pyro-tab-index");
      if (dataIdx !== "") {
        sourceIndex = parseInt(dataIdx, 10);
      }
    }

    if (sourceIndex === null || isNaN(sourceIndex)) {
      handleDragEnd();
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const isAfter = mouseX > rect.width / 2;

    let destIndex: number;
    if (sourceIndex < targetIndex) {
      destIndex = isAfter ? targetIndex : Math.max(0, targetIndex - 1);
    } else {
      destIndex = isAfter ? Math.min(tabs.length - 1, targetIndex + 1) : targetIndex;
    }

    if (sourceIndex !== destIndex && destIndex >= 0 && destIndex < tabs.length) {
      onReorderTabs(sourceIndex, destIndex);
      justDroppedRef.current = true;
      setTimeout(() => {
        justDroppedRef.current = false;
      }, 120);
    }

    handleDragEnd();
  };

  const handleContainerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const sourceIndex = dragSourceIndexRef.current ?? draggedTabIndex;
    if (sourceIndex !== null && sourceIndex !== tabs.length - 1) {
      onReorderTabs(sourceIndex, tabs.length - 1);
      justDroppedRef.current = true;
      setTimeout(() => {
        justDroppedRef.current = false;
      }, 120);
    }
    handleDragEnd();
  };

  const handleDragEnd = () => {
    dragSourceIndexRef.current = null;
    isDraggingActiveRef.current = false;
    setDraggedTabIndex(null);
    setDropIndicator(null);
  };

  const getIcon = (tab: OpenTab) => {
    switch (tab.type) {
      case "table":
        return <TableIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />;
      case "routine":
        return tab.routineType === "FUNCTION" ? (
          <FunctionSquare className="w-3.5 h-3.5 shrink-0 opacity-70" />
        ) : (
          <Settings className="w-3.5 h-3.5 shrink-0 opacity-70" />
        );
      case "trigger":
        return <Zap className="w-3.5 h-3.5 shrink-0 opacity-70" />;
      case "tables_overview":
        return <TableIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />;
      case "dashboard":
        return <LayoutDashboard className="w-3.5 h-3.5 shrink-0 opacity-70" />;
      case "health":
        return <Activity className="w-3.5 h-3.5 shrink-0 opacity-70" />;
      case "slow_query":
        return <Flame className="w-3.5 h-3.5 shrink-0 opacity-70" />;
      case "advisor":
        return <Sparkles className="w-3.5 h-3.5 shrink-0 opacity-70" />;
      case "diff":
        return <GitCompare className="w-3.5 h-3.5 shrink-0 opacity-70" />;
      case "operations":
        return <Wrench className="w-3.5 h-3.5 shrink-0 opacity-70" />;
      case "agent":
        return <Bot className="w-3.5 h-3.5 shrink-0 opacity-70" />;
      case "reports":
        return <FileText className="w-3.5 h-3.5 shrink-0 opacity-70" />;
      case "objects":
        return <ObjectIcon kind={tab.objectKind ?? "tables"} />;
      case "query":
      default:
        return <Terminal className="w-3.5 h-3.5 shrink-0 opacity-70" />;
    }
  };

  const env = useConnectionStore((s) => s.connectionStatus.config?.environment);
  // Neutral active tab; only risky environments tint the indicator.
  const activeTabAccent = `bg-surface text-fg border-t-2 ${
    env === "production" ? "border-rose-500" : env === "staging" ? "border-amber-500" : "border-accent"
  }`;

  const getTooltip = (tab: OpenTab) => {
    const parts: string[] = [tab.title];
    if (tab.database) parts.push(`BD: ${tab.database}`);
    if (tab.tableName && tab.tableName !== tab.title) parts.push(`Tabla: ${tab.tableName}`);
    if (tab.isPinned) parts.push("Fijada");
    if (tab.isModified) parts.push("Modificado (sin guardar)");
    return parts.join(" • ");
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onContextMenu={handleBarContextMenu}
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
      className="h-9 border-b flex items-end px-2 gap-0.5 select-none overflow-x-auto scrollbar-none bg-canvas border-line"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isDragging = draggedTabIndex === index;
        const isEditing = editingTabId === tab.id;
        const isPinned = !!tab.isPinned;
        const isModified = !!tab.isModified;

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
              if (justDroppedRef.current) return;
              if (!isEditing) onSelectTab(tab.id);
            }}
            onAuxClick={(e) => handleAuxClick(e, tab.id)}
            onContextMenu={(e) => handleTabContextMenu(e, tab, index)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleStartRename(tab);
            }}
            title={getTooltip(tab)}
            className={`group relative flex items-center px-3 h-8 rounded-t-md text-xs transition-colors max-w-xs cursor-pointer shrink-0 ${
              isDragging
                ? "opacity-40 bg-raised"
                : isActive
                ? activeTabAccent
                : "border-t-2 border-transparent text-fg-muted hover:bg-hover hover:text-fg"
            }`}
          >
            {/* Visual Drop Insertion Line Before */}
            {showIndicatorBefore && (
              <div className="absolute -left-1 top-1 bottom-1 w-1 bg-accent rounded-full z-30 pointer-events-none" />
            )}

            <div className="flex items-center space-x-1.5">
              {isPinned ? (
                <Pin className="w-3 h-3 shrink-0 opacity-70" />
              ) : (
                getIcon(tab)
              )}

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
                  className="bg-elevated text-fg text-xs font-mono px-1 py-0.5 rounded border border-accent/70 outline-none w-28 pointer-events-auto"
                />
              ) : (
                <span className="truncate max-w-[130px]">{tab.title}</span>
              )}

              {tab.id === props.splitTabId && (
                <span title="Visible en el panel derecho">
                  <Columns2 className="w-3 h-3 shrink-0 text-fg-muted" />
                </span>
              )}

              {/* Dirty / Modified indicator dot */}
              {isModified && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                  title="Cambios pendientes"
                />
              )}

              {/* Close Button (hidden when pinned unless hovered or via right click) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                title={isPinned ? "Cerrar pestaña fijada" : "Cerrar pestaña (o botón central)"}
                className={`p-0.5 rounded transition-colors pointer-events-auto text-fg-muted hover:text-fg hover:bg-hover ${
                  isPinned || !isActive ? "opacity-0 group-hover:opacity-100" : ""
                }`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Visual Drop Insertion Line After */}
            {showIndicatorAfter && (
              <div className="absolute -right-1 top-1 bottom-1 w-1 bg-accent rounded-full z-30 pointer-events-none" />
            )}
          </div>
        );
      })}

      {/* New Query Tab Button */}
      {onNewQueryTab && (
        <button
          onClick={onNewQueryTab}
          title="Nueva pestaña de consulta SQL"
          className="p-1 mb-1 rounded transition-colors shrink-0 text-fg-muted hover:text-fg hover:bg-hover"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}

      {/* Context Menu Popup */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 min-w-[220px] bg-raised border border-line shadow-lg rounded-lg py-1 text-xs text-fg"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.tab ? (
            <>
              {/* Header Info */}
              <div className="px-3 py-1 text-[11px] font-medium text-fg-subtle border-b border-line mb-1 flex items-center justify-between">
                <span className="truncate max-w-[130px]">{contextMenu.tab.title}</span>
                <span className="text-accent-text font-normal lowercase">
                  {contextMenu.tab.type}
                </span>
              </div>

              {/* Pin / Unpin */}
              <button
                onClick={() => {
                  if (contextMenu.tab) togglePinTab(contextMenu.tab.id);
                  setContextMenu(null);
                }}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <span className="flex items-center space-x-2">
                  {contextMenu.tab.isPinned ? (
                    <>
                      <PinOff className="w-3.5 h-3.5 text-fg-muted" />
                      <span>Desfijar pestaña</span>
                    </>
                  ) : (
                    <>
                      <Pin className="w-3.5 h-3.5 text-fg-muted" />
                      <span>Fijar pestaña</span>
                    </>
                  )}
                </span>
              </button>

              <div className="my-1 border-t border-line" />

              {/* Close Current */}
              <button
                onClick={() => {
                  if (contextMenu.tab) onCloseTab(contextMenu.tab.id);
                  setContextMenu(null);
                }}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <span className="flex items-center space-x-2">
                  <X className="w-3.5 h-3.5 text-fg-muted" />
                  <span>Cerrar pestaña</span>
                </span>
                <span className="text-[11px] text-fg-subtle">Ctrl+W</span>
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
                    ? "opacity-30 cursor-not-allowed text-fg-subtle"
                    : "hover:bg-hover hover:text-fg"
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-fg-muted" />
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
                    ? "opacity-30 cursor-not-allowed text-fg-subtle"
                    : "hover:bg-hover hover:text-fg"
                }`}
              >
                <ArrowRight className="w-3.5 h-3.5 text-fg-muted" />
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
                    ? "opacity-30 cursor-not-allowed text-fg-subtle"
                    : "hover:bg-hover hover:text-fg"
                }`}
              >
                <ArrowLeft className="w-3.5 h-3.5 text-fg-muted" />
                <span>Cerrar pestañas a la izquierda</span>
              </button>

              {/* Reopen Closed Tab */}
              {recentlyClosedTabs.length > 0 && (
                <button
                  onClick={() => {
                    reopenLastClosedTab();
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                >
                  <span className="flex items-center space-x-2">
                    <RotateCcw className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Reabrir pestaña cerrada</span>
                  </span>
                  <span className="text-[11px] text-fg-subtle">Ctrl+Shift+T</span>
                </button>
              )}

              <div className="my-1 border-t border-line" />

              {/* Split view */}
              {props.onSplitTab && contextMenu.tab && (
                contextMenu.tab.id === props.splitTabId ? (
                  <button
                    onClick={() => {
                      props.onSplitTab?.(null);
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                  >
                    <Columns2 className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Cerrar vista dividida</span>
                  </button>
                ) : contextMenu.tab.id !== activeTabId ? (
                  <button
                    onClick={() => {
                      if (contextMenu.tab) props.onSplitTab?.(contextMenu.tab.id);
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                  >
                    <Columns2 className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Abrir a la derecha</span>
                  </button>
                ) : null
              )}

              {/* Duplicate Tab */}
              <button
                onClick={() => {
                  if (contextMenu.tab) onDuplicateTab(contextMenu.tab.id);
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <Copy className="w-3.5 h-3.5 text-fg-muted" />
                <span>Duplicar pestaña</span>
              </button>

              {/* Rename Tab */}
              <button
                onClick={() => {
                  if (contextMenu.tab) handleStartRename(contextMenu.tab);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <Pencil className="w-3.5 h-3.5 text-fg-muted" />
                <span>Renombrar pestaña</span>
              </button>

              {/* Copy Title */}
              <button
                onClick={() => {
                  if (contextMenu.tab) handleCopyTitle(contextMenu.tab.title, contextMenu.tab.id);
                }}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
              >
                <span className="flex items-center space-x-2">
                  {copiedTabId === contextMenu.tab.id ? (
                    <Check className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <Clipboard className="w-3.5 h-3.5 text-fg-muted" />
                  )}
                  <span>
                    {copiedTabId === contextMenu.tab.id ? "¡Copiado!" : "Copiar nombre"}
                  </span>
                </span>
              </button>

              <div className="my-1 border-t border-line" />

              {/* Close All */}
              <button
                onClick={() => {
                  onCloseAllTabs();
                  setContextMenu(null);
                }}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-red-950/40 text-danger hover:text-danger transition-colors text-left"
              >
                <Trash2 className="w-3.5 h-3.5 text-danger" />
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
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                >
                  <Plus className="w-3.5 h-3.5 text-fg-muted" />
                  <span>Nueva pestaña de consulta</span>
                </button>
              )}

              {recentlyClosedTabs.length > 0 && (
                <button
                  onClick={() => {
                    reopenLastClosedTab();
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left"
                >
                  <span className="flex items-center space-x-2">
                    <RotateCcw className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Reabrir pestaña cerrada</span>
                  </span>
                  <span className="text-[11px] text-fg-subtle">Ctrl+Shift+T</span>
                </button>
              )}

              {tabs.length > 0 && (
                <button
                  onClick={() => {
                    onCloseAllTabs();
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-red-950/40 text-danger hover:text-danger transition-colors text-left"
                >
                  <Trash2 className="w-3.5 h-3.5 text-danger" />
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

