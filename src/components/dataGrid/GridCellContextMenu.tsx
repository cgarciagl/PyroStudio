import React from "react";
import { useTranslation } from "react-i18next";
import type { Item } from "@glideapps/glide-data-grid";
import {
  ArrowUpRight,
  Ban,
  CheckSquare,
  ChevronRight,
  Code2,
  Copy,
  CornerDownRight,
  Edit3,
  Plus,
  Trash2,
} from "lucide-react";
import type { ErRelation, ForeignKeyMetadata, TableDataResult } from "../../types/database";
import { exportToTsv } from "../../utils/formatCopy";
import type { SmartCopyFormat } from "./copyFormats";

export interface CellContextMenuState {
  x: number;
  y: number;
  col: number;
  row: number;
}

export interface GridCellContextMenuProps {
  cellContextMenu: CellContextMenuState;
  setCellContextMenu: (menu: CellContextMenuState | null) => void;
  getSelectedCells: () => Item[];
  dataResult: TableDataResult | null;
  handleSetCellNull: (col?: number, row?: number) => void;
  isEditingAllowed: boolean;
  setIsFillModalOpen: (open: boolean) => void;
  setIsInspectorOpen: (open: boolean) => void;
  effectiveColumnNames: string[];
  fkByColumn: Map<string, ForeignKeyMetadata>;
  referencingConstraints: ErRelation[][];
  getRowValueByName: (rowIndex: number, colName: string) => any;
  handleForeignKeyJump: (colIndex: number, rowIndex: number) => void;
  handleReferencingJump: (constraint: ErRelation[], rowIndex: number) => void;
  getSelectedDataMatrix: () => { columns: string[]; rows: any[][] };
  setSaveStatus: (status: { success?: boolean; message?: string } | null) => void;
  getRawColIndex: (visualCol: number) => number;
  displayRows: any[][];
  isCopySubmenuOpen: boolean;
  setIsCopySubmenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleSmartCopy: (format: SmartCopyFormat) => void;
  handleSelectColumn: (colIndex: number) => void;
  setIsNewRecordModalOpen: (open: boolean) => void;
  setIsEditModalOpen: (open: boolean) => void;
  getSelectedRowIndices: (contextRow?: number | null) => number[];
  handleStageDeleteRow: (contextRow?: number | null) => void;
}

/** Floating context menu for grid cells (shared by table and query modes). */
export const GridCellContextMenu: React.FC<GridCellContextMenuProps> = ({
  cellContextMenu,
  setCellContextMenu,
  getSelectedCells,
  dataResult,
  handleSetCellNull,
  isEditingAllowed,
  setIsFillModalOpen,
  setIsInspectorOpen,
  effectiveColumnNames,
  fkByColumn,
  referencingConstraints,
  getRowValueByName,
  handleForeignKeyJump,
  handleReferencingJump,
  getSelectedDataMatrix,
  setSaveStatus,
  getRawColIndex,
  displayRows,
  isCopySubmenuOpen,
  setIsCopySubmenuOpen,
  handleSmartCopy,
  handleSelectColumn,
  setIsNewRecordModalOpen,
  setIsEditModalOpen,
  getSelectedRowIndices,
  handleStageDeleteRow,
}) => {
    const { t } = useTranslation("dataGrid");
    const selectedCells = getSelectedCells();
    const count = selectedCells.length;
    const isMulti = count > 1;

    return (
      <div
        style={{ top: cellContextMenu.y, left: cellContextMenu.x }}
        className={`fixed z-[100] w-64 rounded-xl border shadow-2xl py-1.5 text-xs animate-in fade-in zoom-in-95 duration-100 select-none bg-raised border-line text-fg shadow-black/80`}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
        className={`px-3 py-1 text-[11px] font-mono border-b truncate text-fg-muted border-line`}
        >
          {isMulti
            ? t("cellMenu.multiHeader", { count })
            : t("cellMenu.singleHeader", {
                col: dataResult?.columns[cellContextMenu.col] || t("cellMenu.cellFallback"),
                row: cellContextMenu.row + 1,
              })}
        </div>

        <button
          type="button"
          onClick={() => {
            const { col, row } = cellContextMenu;
            setCellContextMenu(null);
            if (isMulti) {
              handleSetCellNull();
            } else {
              handleSetCellNull(col, row);
            }
          }}
          disabled={!isEditingAllowed}
          className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors disabled:opacity-40 hover:bg-hover text-warning hover:text-warning`}
        >
          <span className="flex items-center space-x-2">
            <Ban className="w-3.5 h-3.5 text-warning" />
            <span className="font-semibold">
              {isMulti ? t("cellMenu.setNullMulti", { count }) : t("cellMenu.setNullSingle")}
            </span>
          </span>
          <span className={`text-[11px] font-mono text-fg-subtle`}>
            Alt+N
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setCellContextMenu(null);
            setIsFillModalOpen(true);
          }}
          disabled={!isEditingAllowed}
          className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors disabled:opacity-40 hover:bg-hover text-fg-muted hover:text-fg`}
        >
          <span className="flex items-center space-x-2">
            <Edit3 className="w-3.5 h-3.5 text-fg-muted" />
            <span>
              {isMulti ? t("cellMenu.fillMulti") : t("cellMenu.fillSingle")}
            </span>
          </span>
        </button>

        {!isMulti && (
          <button
            type="button"
            onClick={() => {
              setCellContextMenu(null);
              setIsInspectorOpen(true);
            }}
            className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg`}
          >
            <span className="flex items-center space-x-2">
              <Code2 className="w-3.5 h-3.5 text-fg-muted" />
              <span>{t("cellMenu.inspectCell")}</span>
            </span>
            <span className={`text-[11px] font-mono text-fg-subtle`}>
              {t("cellMenu.spaceKey")}
            </span>
          </button>
        )}

        {!isMulti && (() => {
          const colName = effectiveColumnNames[cellContextMenu.col];
          const fk = colName ? fkByColumn.get(colName.toLowerCase()) : undefined;
          const reachable = referencingConstraints.filter((c) =>
            c.every(
              (r) => getRowValueByName(cellContextMenu.row, r.foreign_key.referenced_column) !== undefined,
            ),
          );
          if (!fk && reachable.length === 0) return null;
          return (
            <>
              <div className="my-1 h-px bg-line" />
              {fk && (
                <button
                  type="button"
                  onClick={() => {
                    const { col, row } = cellContextMenu;
                    setCellContextMenu(null);
                    handleForeignKeyJump(col, row);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg"
                >
                  <span className="flex items-center space-x-2 min-w-0">
                    <ArrowUpRight className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                    <span className="truncate">{t("cellMenu.jumpFk", { table: fk.referenced_table })}</span>
                  </span>
                  <span className="text-[11px] font-mono text-fg-subtle">{t("cellMenu.altClick")}</span>
                </button>
              )}
              {reachable.map((constraint) => {
                const r = constraint[0];
                const columns = constraint.map((c) => c.foreign_key.column_name).join(", ");
                const ambiguous = referencingConstraints.filter((c) => c[0].table === r.table).length > 1;
                return (
                  <button
                    key={`${r.table}.${r.foreign_key.name}`}
                    type="button"
                    onClick={() => {
                      const { row } = cellContextMenu;
                      setCellContextMenu(null);
                      handleReferencingJump(constraint, row);
                    }}
                    title={`${r.table}.${columns}`}
                    className="w-full px-3 py-1.5 text-left flex items-center transition-colors hover:bg-hover text-fg"
                  >
                    <span className="flex items-center space-x-2 min-w-0">
                      <CornerDownRight className="w-3.5 h-3.5 text-fg-muted shrink-0" />
                      <span className="truncate">
                        {t("cellMenu.referencingRows", { table: r.table })}{ambiguous ? ` (${columns})` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </>
          );
        })()}

        <button
          type="button"
          onClick={() => {
            const { col, row } = cellContextMenu;
            setCellContextMenu(null);
            if (isMulti) {
              const { columns: targetCols, rows: targetRows } = getSelectedDataMatrix();
              const textToCopy = exportToTsv(targetCols, targetRows, false);
              navigator.clipboard.writeText(textToCopy);
              setSaveStatus({
                success: true,
                message: t("cellMenu.copiedMulti", { rows: targetRows.length, cols: targetCols.length }),
              });
              setTimeout(() => setSaveStatus(null), 2500);
            } else {
              const rawColIdx = getRawColIndex(col);
              const cellVal = rawColIdx !== -1 ? displayRows[row]?.[rawColIdx] : null;
              const textToCopy = cellVal === null || cellVal === undefined ? "NULL" : String(cellVal);
              navigator.clipboard.writeText(textToCopy);
              setSaveStatus({ success: true, message: t("cellMenu.copiedSingle") });
              setTimeout(() => setSaveStatus(null), 2500);
            }
          }}
          className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg`}
        >
          <span className="flex items-center space-x-2">
            <Copy className="w-3.5 h-3.5 text-fg-muted" />
            <span>{isMulti ? t("cellMenu.copyMulti", { count }) : t("cellMenu.copySingle")}</span>
          </span>
        </button>

        {/* Expandable Submenu for Multi-Format Copy */}
        <div
          className="relative"
          onMouseEnter={() => setIsCopySubmenuOpen(true)}
          onMouseLeave={() => setIsCopySubmenuOpen(false)}
        >
          <button
            type="button"
            onClick={() => setIsCopySubmenuOpen((prev) => !prev)}
            className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg ${isCopySubmenuOpen ? ("bg-raised") : ""}`}
          >
            <span className="flex items-center space-x-2">
              <Copy className="w-3.5 h-3.5 text-fg-muted" />
              <span>{isMulti ? t("cellMenu.copyAsMulti") : t("cellMenu.copyAsSingle")}</span>
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-fg-muted" />
          </button>

          {isCopySubmenuOpen && (
            // Padding (not margin) bridges the gap so the pointer never leaves the hover area
            <div
              className={`absolute top-0 z-50 ${
                cellContextMenu.x > (typeof window !== "undefined" ? window.innerWidth - 480 : 600)
                  ? "right-full pr-1"
                  : "left-full pl-1"
              }`}
              onClick={(e) => e.stopPropagation()}
            >
            <div
            className={`w-56 rounded-xl border shadow-2xl py-1.5 text-xs animate-in fade-in duration-100 bg-raised border-line text-fg shadow-black/80`}
            >
              <button
                type="button"
                onClick={() => {
                  setCellContextMenu(null);
                  setIsCopySubmenuOpen(false);
                  handleSmartCopy("comma");
                }}
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg`}
              >
                <span>{t("cellMenu.formatComma")}</span>
                <span className="text-[11px] text-fg-subtle font-mono">'a', 1</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCellContextMenu(null);
                  setIsCopySubmenuOpen(false);
                  handleSmartCopy("tsv");
                }}
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg`}
              >
                <span>{t("cellMenu.formatTsv")}</span>
                <span className="text-[11px] text-fg-subtle font-mono">.tsv</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCellContextMenu(null);
                  setIsCopySubmenuOpen(false);
                  handleSmartCopy("sql");
                }}
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg`}
              >
                <span>{t("cellMenu.formatSql")}</span>
                <span className="text-[11px] text-fg-subtle font-mono">.sql</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCellContextMenu(null);
                  setIsCopySubmenuOpen(false);
                  handleSmartCopy("json");
                }}
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg`}
              >
                <span>{t("cellMenu.formatJson")}</span>
                <span className="text-[11px] text-fg-subtle font-mono">[&#123;&#125;]</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCellContextMenu(null);
                  setIsCopySubmenuOpen(false);
                  handleSmartCopy("markdown");
                }}
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg`}
              >
                <span>{t("cellMenu.formatMarkdown")}</span>
                <span className="text-[11px] text-fg-subtle font-mono">|---|</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCellContextMenu(null);
                  setIsCopySubmenuOpen(false);
                  handleSmartCopy("php");
                }}
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg`}
              >
                <span>{t("cellMenu.formatPhp")}</span>
                <span className="text-[11px] text-fg-subtle font-mono">['=&gt;']</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCellContextMenu(null);
                  setIsCopySubmenuOpen(false);
                  handleSmartCopy("ts");
                }}
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg`}
              >
                <span>{t("cellMenu.formatTs")}</span>
                <span className="text-[11px] text-fg-subtle font-mono">Record&lt;&gt;</span>
              </button>
            </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            const { col } = cellContextMenu;
            setCellContextMenu(null);
            handleSelectColumn(col);
          }}
          className={`w-full px-3 py-1.5 text-left flex items-center space-x-2 transition-colors hover:bg-hover text-fg`}
        >
          <CheckSquare className="w-3.5 h-3.5 text-fg-muted" />
          <span>{t("cellMenu.selectColumn")}</span>
        </button>

        <div className={`my-1 border-t border-line`} />

        {isEditingAllowed && (
          <button
            type="button"
            onClick={() => {
              setCellContextMenu(null);
              setIsNewRecordModalOpen(true);
            }}
            className={`w-full px-3 py-1.5 text-left flex items-center space-x-2 transition-colors hover:bg-hover text-success hover:text-success`}
          >
            <Plus className="w-3.5 h-3.5 text-fg-muted" />
            <span className="font-semibold">{t("cellMenu.newRecord")}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setCellContextMenu(null);
            setIsEditModalOpen(true);
          }}
          disabled={!isEditingAllowed}
          className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors disabled:opacity-40 hover:bg-hover text-fg`}
        >
          <span className="flex items-center space-x-2">
            <Edit3 className="w-3.5 h-3.5 text-fg-muted" />
            <span>{t("cellMenu.editRecord")}</span>
          </span>
        </button>

        {(() => {
          const targetIndices = getSelectedRowIndices(cellContextMenu.row);
          const count = targetIndices.length;
          return (
            <button
              type="button"
              onClick={() => {
                const targetRow = cellContextMenu.row;
                setCellContextMenu(null);
                handleStageDeleteRow(targetRow);
              }}
              disabled={!isEditingAllowed}
              className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors disabled:opacity-40 hover:bg-hover text-danger hover:text-danger`}
            >
              <span className="flex items-center space-x-2">
                <Trash2 className="w-3.5 h-3.5 text-danger" />
                <span>
                  {count > 1 ? t("cellMenu.deleteMulti", { count }) : t("cellMenu.deleteSingle")}
                </span>
              </span>
            </button>
          );
        })()}
      </div>
    );
};
