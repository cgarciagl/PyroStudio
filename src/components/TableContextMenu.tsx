import React, { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CopyPlus, Copy, Edit3, Eraser, FileCode2, FileSpreadsheet, History, Layers, Table as TableIcon, Trash2, Zap } from "lucide-react";
import { useCapabilitiesStore } from "../stores/capabilitiesStore";

/** Actions offered for a table, shared by the explorer and the object browser. */
export interface TableMenuActions {
  onOpen: (dbName: string, tableName: string) => void;
  onNewQuery?: (sql: string, dbName: string) => void;
  onCreateTrigger?: (dbName: string, tableName: string) => void;
  onImport?: (dbName: string, tableName: string) => void;
  onExport?: (dbName: string, tableName: string) => void;
  onRename?: (dbName: string, tableName: string) => void;
  onDuplicate?: (dbName: string, tableName: string) => void;
  /** Must ask for confirmation itself before emptying the table. */
  onTruncate?: (dbName: string, tableName: string) => void;
  /** Asks for confirmation itself before dropping. */
  onDrop?: (dbName: string, tableName: string) => void;
}

interface TableContextMenuProps extends TableMenuActions {
  x: number;
  y: number;
  dbName: string;
  tableName: string;
  /** Views only get the actions that make sense for them. */
  isView?: boolean;
  onClose: () => void;
}

/** Minimum gap between the menu and the window edges, in px. */
const MARGIN = 10;
const itemClass = "w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-hover hover:text-fg transition-colors text-left";

export const TableContextMenu: React.FC<TableContextMenuProps> = ({
  x,
  y,
  dbName,
  tableName,
  isView = false,
  onClose,
  onOpen,
  onNewQuery,
  onCreateTrigger,
  onImport,
  onExport,
  onRename,
  onDuplicate,
  onTruncate,
  onDrop,
}) => {
  const { t } = useTranslation("tableViewer");
  const ref = useRef<HTMLDivElement>(null);
  const { isSupported, supportsFeature } = useCapabilitiesStore();

  // Keep the whole menu on screen (it opens upward when there is no room below).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const top = y + height + MARGIN <= window.innerHeight ? y : y - height;
    el.style.left = `${Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN))}px`;
    el.style.top = `${Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN))}px`;
    el.style.visibility = "visible";
  }, [x, y]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const run = (action?: (db: string, table: string) => void) => () => {
    action?.(dbName, tableName);
    onClose();
  };
  const query = (sql: string) => () => {
    onNewQuery?.(sql, dbName);
    onClose();
  };
  const ref_ = `\`${dbName}\`.\`${tableName}\``;

  return (
    <div
      ref={ref}
      data-table-context-menu
      style={{ top: y, left: x, visibility: "hidden", maxHeight: `calc(100vh - ${MARGIN * 2}px)` }}
      className="fixed z-50 min-w-[200px] overflow-y-auto bg-surface border border-line shadow-modal rounded-lg py-1.5 text-xs font-mono text-fg select-none"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1 text-[11px] font-medium text-fg-subtle border-b border-line mb-1 flex items-center justify-between gap-3">
        <span className="truncate max-w-[160px]">{tableName}</span>
        <span className="text-fg-muted font-normal lowercase">{isView ? t("contextMenu.view") : t("contextMenu.table")}</span>
      </div>

      <button onClick={run(onOpen)} className={`${itemClass} font-medium`}>
        <TableIcon className="w-3.5 h-3.5 text-fg-muted" />
        <span>{isView ? t("contextMenu.openView") : t("contextMenu.openTable")}</span>
      </button>

      {!isView && onCreateTrigger && (
        <button onClick={run(onCreateTrigger)} className={itemClass}>
          <Zap className="w-3.5 h-3.5 text-fg-muted" />
          <span>{t("contextMenu.newTrigger")}</span>
        </button>
      )}

      {!isView && onImport && (
        <button onClick={run(onImport)} className={itemClass}>
          <FileSpreadsheet className="w-3.5 h-3.5 text-fg-muted" />
          <span>{t("contextMenu.importData")}</span>
        </button>
      )}

      {onExport && (
        <button onClick={run(onExport)} className={itemClass}>
          <FileCode2 className="w-3.5 h-3.5 text-fg-muted" />
          <span>{t("contextMenu.exportSql")}</span>
        </button>
      )}

      <button onClick={run((_db, table) => void navigator.clipboard.writeText(table))} className={itemClass}>
        <Copy className="w-3.5 h-3.5 text-fg-muted" />
        <span>{t("contextMenu.copyName")}</span>
      </button>

      {!isView && onNewQuery && isSupported("systemVersioning") && (
        <>
          <div className="my-1 border-t border-line" />
          <button
            onClick={query(`SELECT * FROM ${ref_} FOR SYSTEM_TIME ALL LIMIT 100;`)}
            title={t("contextMenu.systemTimeAllTitle")}
            className={itemClass}
          >
            <History className="w-3.5 h-3.5 text-fg-muted" />
            <span>{t("contextMenu.systemTimeAll")}</span>
          </button>
          <button
            onClick={query(`SELECT * FROM ${ref_} FOR SYSTEM_TIME AS OF NOW();`)}
            title={t("contextMenu.systemTimeNowTitle")}
            className={itemClass}
          >
            <History className="w-3.5 h-3.5 text-fg-muted" />
            <span>{t("contextMenu.systemTimeNow")}</span>
          </button>
        </>
      )}

      {!isView && onNewQuery && supportsFeature("partitions") && (
        <button
          onClick={query(
            `SELECT PARTITION_NAME, PARTITION_METHOD, PARTITION_EXPRESSION, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH\nFROM information_schema.PARTITIONS\nWHERE TABLE_SCHEMA = '${dbName}' AND TABLE_NAME = '${tableName}'\nORDER BY PARTITION_ORDINAL_POSITION;`,
          )}
          title={t("contextMenu.partitionsTitle")}
          className={itemClass}
        >
          <Layers className="w-3.5 h-3.5 text-fg-muted" />
          <span>{t("contextMenu.partitions")}</span>
        </button>
      )}

      {!isView && onDuplicate && (
        <button onClick={run(onDuplicate)} title={t("contextMenu.duplicateTitle")} className={itemClass}>
          <CopyPlus className="w-3.5 h-3.5 text-fg-muted" />
          <span>{t("contextMenu.duplicate")}</span>
        </button>
      )}

      {!isView && onRename && (
        <button onClick={run(onRename)} className={itemClass}>
          <Edit3 className="w-3.5 h-3.5 text-fg-muted" />
          <span>{t("contextMenu.rename")}</span>
        </button>
      )}

      {!isView && (onTruncate || onDrop) && <div className="my-1 border-t border-line" />}

      {!isView && onTruncate && (
        <button onClick={run(onTruncate)} className={`${itemClass} text-danger hover:text-danger`}>
          <Eraser className="w-3.5 h-3.5 text-danger" />
          <span>{t("contextMenu.truncate")}</span>
        </button>
      )}

      {!isView && onDrop && (
        <>
          <button onClick={run(onDrop)} className={`${itemClass} text-danger hover:text-danger`}>
            <Trash2 className="w-3.5 h-3.5 text-danger" />
            <span>{t("contextMenu.drop")}</span>
          </button>
        </>
      )}
    </div>
  );
};
