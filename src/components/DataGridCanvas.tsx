import React, { useCallback, useMemo, useState, useEffect } from "react";
import DataEditor, {
  GridCell,
  GridCellKind,
  GridColumn,
  Item,
  EditableGridCell,
  GridSelection,
  Rectangle,
  type HeaderClickedEventArgs,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import {
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Zap,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Database,
  Edit3,
  Trash2,
  Settings,
  Copy,
  ChevronDown,
  Code2,
  Ban,
  Filter,
  X,
  ArrowUp,
  ArrowDown,
  Pin,
  PinOff,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import type {
  TableDataResult,
  PrimaryKeyCondition,
  ForeignKeyMetadata,
} from "../types/database";
import { dbService } from "../services/tauriDb";
import { useUIStore } from "../stores/uiStore";
import { usePreferenceStore } from "../stores/preferenceStore";
import { useStagedChangesStore, type StagedCellUpdate, areValuesEqual } from "../stores/stagedChangesStore";
import { EditRecordModal } from "./EditRecordModal";
import { StagedChangesActionBar } from "./StagedChangesActionBar";
import { PreviewStagedSqlModal } from "./PreviewStagedSqlModal";
import { CellInspectorDrawer } from "./CellInspectorDrawer";
import { FillSelectionModal } from "./FillSelectionModal";
import { PastePreviewModal } from "./PastePreviewModal";
import { parseClipboardMatrix, type PasteValidationResult } from "../utils/pasteParser";
import {
  exportToTsv,
  exportToSqlInsert,
  exportToJsonArray,
  exportToMarkdownTable,
  exportToPhpArray,
  exportToTsArray,
} from "../utils/formatCopy";

import type { StagedChange } from "../stores/stagedChangesStore";

export interface TableGridLayout {
  columnOrder?: string[];
  customWidths?: Record<string, number>;
  freezeColumns?: number;
}

export const getStoredLayout = (db: string, tbl: string): TableGridLayout => {
  try {
    const raw = localStorage.getItem(`pyro_grid_layout_${db}_${tbl}`);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return {};
};

export const saveStoredLayout = (db: string, tbl: string, layout: TableGridLayout) => {
  try {
    localStorage.setItem(`pyro_grid_layout_${db}_${tbl}`, JSON.stringify(layout));
  } catch {
    // ignore
  }
};

const EMPTY_STAGED_CHANGES: StagedChange[] = [];

interface DataGridCanvasProps {
  database: string;
  table: string;
  primaryKeyColumns?: string[];
  primaryKeyColumn?: string;
}

export const DataGridCanvas: React.FC<DataGridCanvasProps> = ({
  database,
  table,
  primaryKeyColumns,
  primaryKeyColumn,
}) => {
  const { defaultPageSize, noPrimaryKeyMode, theme, fontFamily } = usePreferenceStore();

  const activeFont =
    fontFamily === "system"
      ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
      : '"Maple Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

  const [dataResult, setDataResult] = useState<TableDataResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pageSize, setPageSize] = useState<number>(() => defaultPageSize || 100);
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"ASC" | "DESC" | null>(null);
  const [serverFilter, setServerFilter] = useState<string>("");
  const [isServerFilterActive, setIsServerFilterActive] = useState<boolean>(false);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ col: number; row: number } | null>(null);
  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(undefined);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPreviewSqlOpen, setIsPreviewSqlOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isCopyMenuOpen, setIsCopyMenuOpen] = useState(false);
  const [isFillModalOpen, setIsFillModalOpen] = useState(false);
  const [isApplyingStaged, setIsApplyingStaged] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);
  const [pendingPasteValidation, setPendingPasteValidation] =
    useState<PasteValidationResult | null>(null);
  const [cellContextMenu, setCellContextMenu] = useState<{
    x: number;
    y: number;
    col: number;
    row: number;
  } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{
    col: number;
    colName: string;
    x: number;
    y: number;
  } | null>(null);

  // Close context menus on outside click or scroll
  useEffect(() => {
    if (!cellContextMenu && !headerMenu) return;
    const closeMenu = () => {
      setCellContextMenu(null);
      setHeaderMenu(null);
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [cellContextMenu, headerMenu]);

  // Staged changes store subscription for this table with stable fallback reference
  const stagedChanges = useStagedChangesStore(
    (s) => s.changesByTable[`${database}.${table}`] ?? EMPTY_STAGED_CHANGES,
  );
  const {
    stageCellUpdate,
    stageBatchCellUpdates,
    stageRowDelete,
    clearTableChanges,
    generateSqlForTable,
  } = useStagedChangesStore();

  const stagedChangeCount = stagedChanges.length;

  // Staged maps for instant O(1) cell & row lookup
  const stagedUpdatesMap = useMemo(() => {
    const map = new Map<string, StagedCellUpdate>();
    for (const ch of stagedChanges) {
      if (ch.type === "cell_update") {
        map.set(`${ch.columnName}:${ch.rowIndex}`, ch);
      }
    }
    return map;
  }, [stagedChanges]);

  const stagedDeletedRows = useMemo(() => {
    const set = new Set<number>();
    for (const ch of stagedChanges) {
      if (ch.type === "row_delete") {
        set.add(ch.rowIndex);
      }
    }
    return set;
  }, [stagedChanges]);

  // Foreign keys for this table
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyMetadata[]>([]);
  useEffect(() => {
    let isMounted = true;
    dbService
      .getTableForeignKeys(database, table)
      .then((fks) => {
        if (isMounted && fks) {
          setForeignKeys(fks);
        }
      })
      .catch((err) => {
        console.warn("Could not retrieve foreign keys:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [database, table]);

  const fkByColumn = useMemo(() => {
    const map = new Map<string, ForeignKeyMetadata>();
    for (const fk of foreignKeys) {
      map.set(fk.column_name.toLowerCase(), fk);
    }
    return map;
  }, [foreignKeys]);

  // Sync pageSize when defaultPageSize changes in preferences
  useEffect(() => {
    if (defaultPageSize && defaultPageSize !== pageSize) {
      setPageSize(defaultPageSize);
      setPageOffset(0);
    }
  }, [defaultPageSize]);

  const [fetchedPkColumns, setFetchedPkColumns] = useState<string[]>([]);

  useEffect(() => {
    if (primaryKeyColumns && primaryKeyColumns.length > 0) {
      setFetchedPkColumns(primaryKeyColumns);
      return;
    }
    if (primaryKeyColumn) {
      setFetchedPkColumns([primaryKeyColumn]);
      return;
    }
    let isMounted = true;
    dbService
      .getTablePrimaryKey(database, table)
      .then((pk) => {
        if (isMounted && pk?.columns) {
          setFetchedPkColumns(pk.columns);
        }
      })
      .catch((err) => {
        console.warn("Could not retrieve primary key:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [database, table, primaryKeyColumns, primaryKeyColumn]);

  const activePkColumns = useMemo(() => {
    if (primaryKeyColumns && primaryKeyColumns.length > 0) return primaryKeyColumns;
    if (primaryKeyColumn) return [primaryKeyColumn];
    return fetchedPkColumns;
  }, [primaryKeyColumns, primaryKeyColumn, fetchedPkColumns]);

  const hasPrimaryKey = activePkColumns.length > 0;
  const isEditingAllowed = hasPrimaryKey || noPrimaryKeyMode === "use_all_columns";

  const loadData = useCallback(
    async (
      offset: number,
      limit: number,
      orderBy: string | null = sortColumn,
      orderDir: "ASC" | "DESC" | null = sortDirection,
      filterSql: string | null = isServerFilterActive ? serverFilter : null,
    ) => {
      setIsLoading(true);
      try {
        const result = await dbService.queryTableData(
          database,
          table,
          limit,
          offset,
          orderBy || undefined,
          orderDir || undefined,
          filterSql || undefined,
        );
        setDataResult(result);
      } catch (err: any) {
        console.error("Failed to load table data:", err);
        useUIStore.getState().showAlert({
          title: "Error al Cargar Datos",
          message:
            typeof err === "string"
              ? err
              : err?.message || "Error al consultar la tabla en MariaDB/MySQL",
          variant: "danger",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [database, table, sortColumn, sortDirection, isServerFilterActive, serverFilter],
  );

  const handleApplyServerFilter = useCallback(() => {
    const trimmed = serverFilter.trim();
    setIsServerFilterActive(Boolean(trimmed));
    setPageOffset(0);
    setSelectedRowIndex(null);
    setSelectedCell(null);
    loadData(0, pageSize, sortColumn, sortDirection, trimmed || null);
  }, [serverFilter, pageSize, sortColumn, sortDirection, loadData]);

  const handleClearServerFilter = useCallback(() => {
    setServerFilter("");
    setIsServerFilterActive(false);
    setPageOffset(0);
    setSelectedRowIndex(null);
    setSelectedCell(null);
    loadData(0, pageSize, sortColumn, sortDirection, null);
  }, [pageSize, sortColumn, sortDirection, loadData]);

  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [customWidths, setCustomWidths] = useState<Record<string, number>>({});
  const [freezeColumnsCount, setFreezeColumnsCount] = useState<number>(0);

  // Load layout from localStorage when table changes
  useEffect(() => {
    const saved = getStoredLayout(database, table);
    setCustomWidths(saved.customWidths || {});
    setFreezeColumnsCount(saved.freezeColumns ?? 0);
  }, [database, table]);

  // Synchronize column order when dataResult columns change
  useEffect(() => {
    if (!dataResult || !dataResult.columns) return;
    const saved = getStoredLayout(database, table);
    if (saved.columnOrder && saved.columnOrder.length > 0) {
      const existing = saved.columnOrder.filter((c) => dataResult.columns.includes(c));
      const missing = dataResult.columns.filter((c) => !existing.includes(c));
      setColumnOrder([...existing, ...missing]);
    } else {
      setColumnOrder([...dataResult.columns]);
    }
  }, [dataResult?.columns, database, table]);

  const effectiveColumnNames = useMemo(() => {
    if (!dataResult || !dataResult.columns) return [];
    if (columnOrder.length === 0) return dataResult.columns;
    const existing = columnOrder.filter((c) => dataResult.columns.includes(c));
    const missing = dataResult.columns.filter((c) => !existing.includes(c));
    return [...existing, ...missing];
  }, [dataResult, columnOrder]);

  const getRawColIndex = useCallback(
    (visualCol: number): number => {
      if (!dataResult || !dataResult.columns) return visualCol;
      const colName = effectiveColumnNames[visualCol];
      if (!colName) return visualCol;
      const idx = dataResult.columns.indexOf(colName);
      return idx !== -1 ? idx : visualCol;
    },
    [dataResult, effectiveColumnNames],
  );

  const handleColumnResize = useCallback(
    (column: GridColumn, newSize: number) => {
      if (column.id) {
        setCustomWidths((prev) => {
          const next = {
            ...prev,
            [column.id!]: Math.max(70, Math.round(newSize)),
          };
          saveStoredLayout(database, table, {
            columnOrder: effectiveColumnNames,
            customWidths: next,
            freezeColumns: freezeColumnsCount,
          });
          return next;
        });
      }
    },
    [database, table, effectiveColumnNames, freezeColumnsCount],
  );

  const handleColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      setColumnOrder((prev) => {
        const base = prev.length > 0 ? [...prev] : [...effectiveColumnNames];
        const [moved] = base.splice(startIndex, 1);
        base.splice(endIndex, 0, moved);
        saveStoredLayout(database, table, {
          columnOrder: base,
          customWidths,
          freezeColumns: freezeColumnsCount,
        });
        return base;
      });
    },
    [database, table, effectiveColumnNames, customWidths, freezeColumnsCount],
  );

  const handleHeaderClicked = useCallback(
    (colIndex: number) => {
      const colName = effectiveColumnNames[colIndex];
      if (!dataResult || !colName) return;

      let nextDir: "ASC" | "DESC" | null = "ASC";
      if (sortColumn === colName) {
        if (sortDirection === "ASC") {
          nextDir = "DESC";
        } else if (sortDirection === "DESC") {
          nextDir = null;
        }
      }

      setSortColumn(nextDir ? colName : null);
      setSortDirection(nextDir);
      setPageOffset(0);
      loadData(
        0,
        pageSize,
        nextDir ? colName : null,
        nextDir,
        isServerFilterActive ? serverFilter : null,
      );
    },
    [
      dataResult,
      effectiveColumnNames,
      sortColumn,
      sortDirection,
      pageSize,
      isServerFilterActive,
      serverFilter,
      loadData,
    ],
  );

  const handleSortFromMenu = useCallback(
    (colName: string, dir: "ASC" | "DESC" | null) => {
      setSortColumn(dir ? colName : null);
      setSortDirection(dir);
      setPageOffset(0);
      loadData(0, pageSize, dir ? colName : null, dir, isServerFilterActive ? serverFilter : null);
      setHeaderMenu(null);
    },
    [pageSize, isServerFilterActive, serverFilter, loadData],
  );

  const handleAutoSizeColumn = useCallback(
    (colName: string) => {
      if (!dataResult) return;
      const rawIdx = dataResult.columns.indexOf(colName);
      if (rawIdx === -1) return;
      const colType = dataResult.column_types?.[rawIdx] ? ` (${dataResult.column_types[rawIdx]})` : "";
      let calculatedWidth = (colName.length + colType.length) * 9 + 60;
      if (dataResult.rows && dataResult.rows.length > 0) {
        const sampleLimit = Math.min(100, dataResult.rows.length);
        for (let r = 0; r < sampleLimit; r++) {
          const val = dataResult.rows[r][rawIdx];
          if (val !== null && val !== undefined) {
            const strLen = String(val).length;
            calculatedWidth = Math.max(calculatedWidth, Math.min(650, strLen * 8.8 + 40));
          }
        }
      }
      const rounded = Math.max(90, Math.round(calculatedWidth));
      setCustomWidths((prev) => {
        const next = { ...prev, [colName]: rounded };
        saveStoredLayout(database, table, {
          columnOrder: effectiveColumnNames,
          customWidths: next,
          freezeColumns: freezeColumnsCount,
        });
        return next;
      });
      setHeaderMenu(null);
    },
    [dataResult, database, table, effectiveColumnNames, freezeColumnsCount],
  );

  const handleResetColumnWidths = useCallback(() => {
    setCustomWidths({});
    saveStoredLayout(database, table, {
      columnOrder: effectiveColumnNames,
      customWidths: {},
      freezeColumns: freezeColumnsCount,
    });
    setHeaderMenu(null);
  }, [database, table, effectiveColumnNames, freezeColumnsCount]);

  const handleToggleFreezeColumn = useCallback(
    (colIndex: number) => {
      const newCount = freezeColumnsCount === colIndex + 1 ? 0 : colIndex + 1;
      setFreezeColumnsCount(newCount);
      saveStoredLayout(database, table, {
        columnOrder: effectiveColumnNames,
        customWidths,
        freezeColumns: newCount,
      });
      setHeaderMenu(null);
    },
    [database, table, effectiveColumnNames, customWidths, freezeColumnsCount],
  );

  const handleFilterByColumn = useCallback((colName: string) => {
    setServerFilter(`\`${colName}\` = ''`);
    setIsServerFilterActive(false);
    setHeaderMenu(null);
  }, []);

  const handleCopyColumnName = useCallback((colName: string) => {
    navigator.clipboard.writeText(colName);
    setSaveStatus({
      success: true,
      message: `Nombre de columna '${colName}' copiado al portapapeles.`,
    });
    setTimeout(() => setSaveStatus(null), 2500);
    setHeaderMenu(null);
  }, []);

  const handleHeaderMenuClick = useCallback(
    (col: number, screenPosition: Rectangle) => {
      const colName = effectiveColumnNames[col];
      if (!colName) return;
      setHeaderMenu({
        col,
        colName,
        x: Math.min(screenPosition.x, window.innerWidth - 230),
        y: Math.min(screenPosition.y + screenPosition.height, window.innerHeight - 270),
      });
    },
    [effectiveColumnNames],
  );

  const handleHeaderContextMenu = useCallback(
    (colIndex: number, event: HeaderClickedEventArgs) => {
      event.preventDefault();
      const colName = effectiveColumnNames[colIndex];
      if (!colName) return;
      const mouseEvent = (event as any).rawEvent as MouseEvent | undefined;
      const x = mouseEvent ? mouseEvent.clientX : event.bounds.x;
      const y = mouseEvent ? mouseEvent.clientY : event.bounds.y + event.bounds.height;
      setHeaderMenu({
        col: colIndex,
        colName,
        x: Math.min(x, window.innerWidth - 230),
        y: Math.min(y, window.innerHeight - 270),
      });
    },
    [effectiveColumnNames],
  );

  useEffect(() => {
    setPageOffset(0);
    setSelectedRowIndex(null);
    setSelectedCell(null);
    setSortColumn(null);
    setSortDirection(null);
    setServerFilter("");
    setIsServerFilterActive(false);
    loadData(0, pageSize, null, null, null);
  }, [database, table, pageSize]);

  // Columns definition for Glide Data Grid with smart width calculation, sort indicators & FK indicators
  const columns: GridColumn[] = useMemo(() => {
    if (!dataResult || !dataResult.columns) return [];
    return effectiveColumnNames.map((col) => {
      const rawIdx = dataResult.columns.indexOf(col);
      const colType = rawIdx !== -1 && dataResult.column_types?.[rawIdx] ? ` (${dataResult.column_types[rawIdx]})` : "";
      const isPk = activePkColumns.includes(col);
      const fk = fkByColumn.get(col.toLowerCase());

      let prefix = "";
      if (isPk) prefix = "🔑 ";
      else if (fk) prefix = "🔗 ";

      let sortIndicator = "";
      if (sortColumn === col) {
        sortIndicator = sortDirection === "ASC" ? " ▲" : " ▼";
      }

      // Auto estimate width based on header title + sampled cell contents
      let estimatedWidth = Math.max(140, (col.length + colType.length) * 9 + 50);
      if (dataResult.rows && dataResult.rows.length > 0 && rawIdx !== -1) {
        const sampleLimit = Math.min(50, dataResult.rows.length);
        for (let r = 0; r < sampleLimit; r++) {
          const val = dataResult.rows[r][rawIdx];
          if (val !== null && val !== undefined) {
            const strLen = String(val).length;
            estimatedWidth = Math.max(estimatedWidth, Math.min(650, strLen * 8.8 + 40));
          }
        }
      }

      return {
        title: `${prefix}${col}${colType}${sortIndicator}`,
        id: col,
        width: customWidths[col] ?? Math.round(estimatedWidth),
        hasMenu: true,
      };
    });
  }, [dataResult, effectiveColumnNames, activePkColumns, fkByColumn, customWidths, sortColumn, sortDirection]);

  // Filtered rows for client-side search in current batch
  const displayRows = useMemo(() => {
    if (!dataResult) return [];
    if (!searchTerm.trim()) return dataResult.rows;

    const term = searchTerm.toLowerCase();
    return dataResult.rows.filter((row) =>
      row.some((val) =>
        val !== null && val !== undefined
          ? String(val).toLowerCase().includes(term)
          : false,
      ),
    );
  }, [dataResult, searchTerm]);

  const isLight =
    theme === "light" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches);

  // Glide Data Grid cell supplier callback with Staged Changes Visual Highlight
  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const rowData = displayRows[row];
      const rawColIdx = getRawColIndex(col);
      const colName = effectiveColumnNames[col] || dataResult?.columns[rawColIdx] || "";
      const originalVal = rowData && rawColIdx !== -1 ? rowData[rawColIdx] : null;

      // Check if this cell has a pending staged change
      const cellKey = `${colName}:${row}`;
      const stagedCell = stagedUpdatesMap.get(cellKey);
      const isRowDeleted = stagedDeletedRows.has(row);

      const value = stagedCell ? stagedCell.stagedValue : originalVal;
      const isReadonly = !isEditingAllowed || isRowDeleted;

      // Style overrides for Staged Changes
      let themeOverride: Record<string, any> | undefined;

      if (isRowDeleted) {
        themeOverride = {
          bgCell: isLight ? "rgba(239, 68, 68, 0.16)" : "rgba(239, 68, 68, 0.22)",
          textDark: isLight ? "#991b1b" : "#f87171",
          baseFontStyle: "line-through 11px monospace",
        };
      } else if (stagedCell) {
        themeOverride = {
          bgCell: isLight ? "rgba(245, 158, 11, 0.22)" : "rgba(245, 158, 11, 0.28)",
          textDark: isLight ? "#92400e" : "#fbbf24",
          baseFontStyle: "bold 11px monospace",
        };
      }

      const colType = (rawColIdx !== -1 ? dataResult?.column_types?.[rawColIdx] : "")?.toUpperCase() || "";
      const isBoolean =
        colType === "TINYINT(1)" ||
        colType === "BOOLEAN" ||
        colType.startsWith("TINYINT(1)");
      const isNumeric =
        !isBoolean &&
        (colType.includes("INT") ||
          colType.includes("DECIMAL") ||
          colType.includes("FLOAT") ||
          colType.includes("DOUBLE"));
      const isJson = colType.includes("JSON");

      if (value === null || value === undefined) {
        if (isBoolean && !isRowDeleted && !stagedCell) {
          return {
            kind: GridCellKind.Boolean,
            data: null,
            allowOverlay: false,
            readonly: isReadonly,
            themeOverride,
          };
        }
        return {
          kind: GridCellKind.Text,
          allowOverlay: !isReadonly,
          readonly: isReadonly,
          displayData: "NULL",
          data: "",
          themeOverride: themeOverride || {
            textDark: isLight ? "#94a3b8" : "#64748b",
            baseFontStyle: `italic 11px ${activeFont}`,
          },
        };
      }

      if (isBoolean && !isRowDeleted && !stagedCell) {
        const boolData =
          value === true ||
          value === 1 ||
          value === "1" ||
          String(value).toLowerCase() === "true";
        return {
          kind: GridCellKind.Boolean,
          data: boolData,
          allowOverlay: false,
          readonly: isReadonly,
          themeOverride,
        };
      }

      if (isNumeric && !isRowDeleted && !stagedCell) {
        const numVal = Number(value);
        if (!isNaN(numVal)) {
          return {
            kind: GridCellKind.Number,
            data: numVal,
            displayData: String(value),
            allowOverlay: !isReadonly,
            readonly: isReadonly,
            themeOverride,
          };
        }
      }

      if (value === "") {
        return {
          kind: GridCellKind.Text,
          allowOverlay: !isReadonly,
          readonly: isReadonly,
          displayData: "",
          data: "",
          themeOverride,
        };
      }

      if (value === "NULL") {
        return {
          kind: GridCellKind.Text,
          allowOverlay: !isReadonly,
          readonly: isReadonly,
          displayData: '"NULL"',
          data: "NULL",
          themeOverride: themeOverride || {
            textDark: isLight ? "#0f172a" : "#e2e8f0",
            baseFontStyle: `11px ${activeFont}`,
          },
        };
      }

      if (isJson) {
        const str =
          typeof value === "object" ? JSON.stringify(value) : String(value);
        return {
          kind: GridCellKind.Text,
          allowOverlay: !isReadonly,
          readonly: isReadonly,
          displayData: str.length > 50 ? `${str.slice(0, 47)}...` : str,
          data: str,
          themeOverride: themeOverride || {
            textDark: isLight ? "#0284c7" : "#38bdf8",
            baseFontStyle: `11px ${activeFont}`,
          },
        };
      }

      const str = typeof value === "object" ? JSON.stringify(value) : String(value);

      return {
        kind: GridCellKind.Text,
        allowOverlay: !isReadonly,
        readonly: isReadonly,
        displayData: str,
        data: str,
        themeOverride,
      };
    },
    [
      displayRows,
      dataResult,
      effectiveColumnNames,
      getRawColIndex,
      isEditingAllowed,
      stagedUpdatesMap,
      stagedDeletedRows,
      isLight,
      activeFont,
    ],
  );

  // In-place real-time cell editing feeding the Staged Changes Store
  const onCellEdited = useCallback(
    ([col, row]: Item, newValue: EditableGridCell) => {
      if (!dataResult) return;

      if (!hasPrimaryKey && noPrimaryKeyMode === "block") {
        setSaveStatus({
          success: false,
          message:
            "Esta tabla no tiene una clave primaria. La edición está deshabilitada en tu configuración.",
        });
        setTimeout(() => setSaveStatus(null), 5000);
        return;
      }

      const rawColIdx = getRawColIndex(col);
      const colName = effectiveColumnNames[col] || dataResult.columns[rawColIdx];
      const rowData = displayRows[row];

      // Build composite primary key conditions
      const primaryKeys: PrimaryKeyCondition[] = [];
      if (hasPrimaryKey) {
        const lowerCols = dataResult.columns.map((c) => c.toLowerCase());
        for (const pkCol of activePkColumns) {
          const pkIndex = lowerCols.indexOf(pkCol.toLowerCase());
          if (pkIndex === -1) {
            setSaveStatus({
              success: false,
              message: `Error: La columna de clave primaria '${pkCol}' no está presente en la vista.`,
            });
            setTimeout(() => setSaveStatus(null), 5000);
            return;
          }
          const pkVal = rowData[pkIndex];
          if (pkVal === undefined || pkVal === null) {
            setSaveStatus({
              success: false,
              message: `Error: El valor de la clave primaria '${pkCol}' es nulo en esta fila.`,
            });
            setTimeout(() => setSaveStatus(null), 5000);
            return;
          }
          primaryKeys.push({ column: pkCol, value: pkVal });
        }
      } else {
        // Full row mode: Treat all columns as composite identifier using row values
        for (let idx = 0; idx < dataResult.columns.length; idx++) {
          const cName = dataResult.columns[idx];
          const cVal = rowData[idx] ?? null;
          primaryKeys.push({ column: cName, value: cVal });
        }
      }

      let payloadValue: any;
      if (newValue.kind === GridCellKind.Boolean) {
        payloadValue =
          newValue.data === null || newValue.data === undefined
            ? null
            : Boolean(newValue.data);
      } else if (newValue.kind === GridCellKind.Number) {
        payloadValue = newValue.data === undefined ? null : newValue.data;
      } else if (newValue.kind === GridCellKind.Text) {
        const updatedValue = newValue.data;
        if (typeof updatedValue === "string") {
          const trimmed = updatedValue.trim();
          if (trimmed === "\\N" || trimmed.toUpperCase() === "NULL") {
            payloadValue = null;
          } else if (
            (trimmed.startsWith('"') &&
              trimmed.endsWith('"') &&
              trimmed.length >= 2) ||
            (trimmed.startsWith("'") &&
              trimmed.endsWith("'") &&
              trimmed.length >= 2)
          ) {
            payloadValue = trimmed.slice(1, -1);
          } else {
            payloadValue = updatedValue;
          }
        } else {
          payloadValue = updatedValue;
        }
      } else {
        return;
      }

      const originalVal = rawColIdx !== -1 ? rowData[rawColIdx] : null;

      // Stage change without executing UPDATE immediately
      stageCellUpdate({
        database,
        table,
        rowIndex: row,
        colIndex: rawColIdx,
        columnName: colName,
        originalValue: originalVal,
        stagedValue: payloadValue,
        primaryKeys,
      });

      // Update local view representation
      const rowIndexInData = dataResult.rows.indexOf(rowData);
      if (rowIndexInData !== -1 && rawColIdx !== -1) {
        const newRows = [...dataResult.rows];
        newRows[rowIndexInData] = [...newRows[rowIndexInData]];
        newRows[rowIndexInData][rawColIdx] = payloadValue;
        setDataResult((prev) => (prev ? { ...prev, rows: newRows } : prev));
      }
    },
    [
      dataResult,
      displayRows,
      effectiveColumnNames,
      getRawColIndex,
      hasPrimaryKey,
      activePkColumns,
      noPrimaryKeyMode,
      database,
      table,
      stageCellUpdate,
    ],
  );

  // Returns all cells currently selected (single cell, rectangle range, multi-range, or selected rows)
  const getSelectedCells = useCallback((): Item[] => {
    const cellSet = new Set<string>();
    const result: Item[] = [];

    const addCell = (c: number, r: number) => {
      const key = `${c}:${r}`;
      if (!cellSet.has(key)) {
        cellSet.add(key);
        result.push([c, r]);
      }
    };

    if (gridSelection?.current) {
      const { range, rangeStack } = gridSelection.current;
      const allRanges = [range, ...(rangeStack || [])];
      for (const rng of allRanges) {
        for (let r = rng.y; r < rng.y + rng.height; r++) {
          for (let c = rng.x; c < rng.x + rng.width; c++) {
            addCell(c, r);
          }
        }
      }
    }

    if (gridSelection?.rows && gridSelection.rows.length > 0 && dataResult) {
      for (const r of gridSelection.rows.toArray()) {
        for (let c = 0; c < dataResult.columns.length; c++) {
          addCell(c, r);
        }
      }
    }

    if (result.length > 0) return result;

    if (selectedCell) {
      return [[selectedCell.col, selectedCell.row]];
    }
    return [];
  }, [gridSelection, dataResult, selectedCell]);

  // Set value (or NULL) across all currently selected cells in the range
  const handleApplyValueToSelection = useCallback(
    (newVal: any, customCells?: Item[]) => {
      if (!dataResult) return;

      if (!isEditingAllowed) {
        useUIStore.getState().showAlert({
          title: "Edición Bloqueada",
          message:
            "Esta tabla no tiene una clave primaria y la configuración actual bloquea operaciones sin clave.",
          variant: "warning",
          icon: "alert",
        });
        return;
      }

      const targetCells = customCells && customCells.length > 0 ? customCells : getSelectedCells();
      if (targetCells.length === 0) return;

      const payloadValue =
        typeof newVal === "string" && newVal.trim().toUpperCase() === "NULL"
          ? null
          : newVal;

      const lowerCols = dataResult.columns.map((c) => c.toLowerCase());
      let modifiedCount = 0;
      const newRows = [...dataResult.rows];

      for (const [col, row] of targetCells) {
        if (row < 0 || col < 0 || row >= displayRows.length || col >= effectiveColumnNames.length) {
          continue;
        }
        const rowData = displayRows[row];
        if (!rowData) continue;

        const rawColIdx = getRawColIndex(col);
        const colName = effectiveColumnNames[col] || dataResult.columns[rawColIdx];
        const primaryKeys: PrimaryKeyCondition[] = [];

        if (hasPrimaryKey) {
          let validPk = true;
          for (const pkCol of activePkColumns) {
            const pkIndex = lowerCols.indexOf(pkCol.toLowerCase());
            if (pkIndex === -1) {
              validPk = false;
              break;
            }
            const pkVal = rowData[pkIndex];
            if (pkVal === undefined || pkVal === null) {
              validPk = false;
              break;
            }
            primaryKeys.push({ column: pkCol, value: pkVal });
          }
          if (!validPk) continue;
        } else {
          for (let idx = 0; idx < dataResult.columns.length; idx++) {
            primaryKeys.push({
              column: dataResult.columns[idx],
              value: rowData[idx] ?? null,
            });
          }
        }

        const originalVal = rawColIdx !== -1 ? rowData[rawColIdx] : null;

        stageCellUpdate({
          database,
          table,
          rowIndex: row,
          colIndex: rawColIdx,
          columnName: colName,
          originalValue: originalVal,
          stagedValue: payloadValue,
          primaryKeys,
        });

        const rowIndexInData = dataResult.rows.indexOf(rowData);
        if (rowIndexInData !== -1 && rawColIdx !== -1) {
          newRows[rowIndexInData] = [...newRows[rowIndexInData]];
          newRows[rowIndexInData][rawColIdx] = payloadValue;
        }

        modifiedCount++;
      }

      setDataResult((prev) => (prev ? { ...prev, rows: newRows } : prev));

      const valLabel = payloadValue === null ? "NULL" : `"${payloadValue}"`;
      setSaveStatus({
        success: true,
        message: `${modifiedCount} celda(s) establecidas en ${valLabel} (en cola).`,
      });
      setTimeout(() => setSaveStatus(null), 3000);
    },
    [
      dataResult,
      displayRows,
      effectiveColumnNames,
      getRawColIndex,
      getSelectedCells,
      isEditingAllowed,
      hasPrimaryKey,
      activePkColumns,
      stageCellUpdate,
      database,
      table,
    ],
  );

  // Set target cell or all selected cells in range to NULL
  const handleSetCellNull = useCallback(
    (targetCol?: number, targetRow?: number) => {
      if (targetCol !== undefined && targetRow !== undefined) {
        handleApplyValueToSelection(null, [[targetCol, targetRow]]);
      } else {
        handleApplyValueToSelection(null);
      }
    },
    [handleApplyValueToSelection],
  );

  // Native Glide Data Grid Clipboard Paste Handler
  const handlePaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]): boolean => {
      if (!dataResult) return false;

      if (!isEditingAllowed) {
        useUIStore.getState().showAlert({
          title: "Edición Bloqueada",
          message:
            "Esta tabla no tiene una clave primaria y la configuración actual bloquea operaciones sin clave.",
          variant: "warning",
          icon: "alert",
        });
        return false;
      }

      const [targetCol, targetRow] = target;
      const visualColumnTypes = effectiveColumnNames.map((colName) => {
        const rawIdx = dataResult.columns.indexOf(colName);
        return rawIdx !== -1 ? (dataResult.column_types?.[rawIdx] || "") : "";
      });

      const validation = parseClipboardMatrix({
        targetCol,
        targetRow,
        matrix: values,
        columns: effectiveColumnNames,
        columnTypes: visualColumnTypes,
        rawColumns: dataResult.columns,
        displayRows,
        activePkColumns,
        hasPrimaryKey,
        isEditingAllowed,
      });

      if (validation.errors.length > 0) {
        useUIStore.getState().showAlert({
          title: "Error al Pegar",
          message: validation.errors.join("\n"),
          variant: "danger",
          icon: "alert",
        });
        return false;
      }

      if (validation.totalCells === 0) {
        return false;
      }

      // Single cell paste without PK modification or type warnings: apply immediately
      if (
        values.length === 1 &&
        values[0].length === 1 &&
        validation.pkColumnsAffected.length === 0 &&
        validation.warnings.length === 0
      ) {
        const single = validation.changes[0];
        onCellEdited(
          [single.col, single.row],
          {
            kind: GridCellKind.Text,
            data:
              single.proposedValue === null
                ? "NULL"
                : String(single.proposedValue),
          } as EditableGridCell,
        );
        return false;
      }

      // For block paste or operations with warnings/PK changes: open preview modal
      setPendingPasteValidation(validation);
      return false;
    },
    [
      dataResult,
      effectiveColumnNames,
      isEditingAllowed,
      displayRows,
      activePkColumns,
      hasPrimaryKey,
      onCellEdited,
    ],
  );

  // Apply validated block paste into Staged Changes and local grid view
  const handleConfirmPaste = useCallback(() => {
    if (!pendingPasteValidation || !dataResult) return;

    const stagedUpdates = pendingPasteValidation.changes.map((ch) => ({
      database,
      table,
      rowIndex: ch.row,
      colIndex: ch.col,
      columnName: ch.columnName,
      originalValue: ch.originalValue,
      stagedValue: ch.proposedValue,
      primaryKeys: ch.primaryKeys,
    }));

    // Stage in batch in Zustand store
    stageBatchCellUpdates(stagedUpdates);

    // Apply immutable update to local rows state
    const newRows = dataResult.rows.map((r) => [...r]);
    for (const ch of pendingPasteValidation.changes) {
      const rowData = displayRows[ch.row];
      if (!rowData) continue;
      const rowIndexInData = dataResult.rows.indexOf(rowData);
      const rawIdx = dataResult.columns.indexOf(ch.columnName);
      if (rowIndexInData !== -1 && newRows[rowIndexInData] && rawIdx !== -1) {
        newRows[rowIndexInData][rawIdx] = ch.proposedValue;
      }
    }
    setDataResult((prev) => (prev ? { ...prev, rows: newRows } : prev));

    setSaveStatus({
      success: true,
      message: `${pendingPasteValidation.totalCells} celda(s) pegadas en cola (${pendingPasteValidation.affectedRowsCount} filas).`,
    });
    setTimeout(() => setSaveStatus(null), 4000);

    setPendingPasteValidation(null);
  }, [
    pendingPasteValidation,
    dataResult,
    database,
    table,
    displayRows,
    stageBatchCellUpdates,
  ]);

  // Native Glide Data Grid Delete Key Handler (Delete / Backspace on cells or rows)
  const handleDelete = useCallback(
    (selection: GridSelection): boolean => {
      if (!dataResult) return false;

      if (!isEditingAllowed) {
        useUIStore.getState().showAlert({
          title: "Operación Bloqueada",
          message:
            "Esta tabla no tiene una clave primaria y la configuración actual bloquea modificaciones sin clave.",
          variant: "warning",
          icon: "alert",
        });
        return false;
      }

      // 1. If full rows are selected (e.g. via row markers or row selections)
      if (selection.rows && selection.rows.length > 0) {
        const selectedIndices = selection.rows.toArray();
        let deletedCount = 0;
        const lowerCols = dataResult.columns.map((c) => c.toLowerCase());

        for (const rowIndex of selectedIndices) {
          const rowData = displayRows[rowIndex];
          if (!rowData) continue;

          const primaryKeys: PrimaryKeyCondition[] = [];
          if (hasPrimaryKey) {
            let validPk = true;
            for (const pkCol of activePkColumns) {
              const pkIdx = lowerCols.indexOf(pkCol.toLowerCase());
              if (
                pkIdx === -1 ||
                rowData[pkIdx] === undefined ||
                rowData[pkIdx] === null
              ) {
                validPk = false;
                break;
              }
              primaryKeys.push({ column: pkCol, value: rowData[pkIdx] });
            }
            if (!validPk) continue;
          } else {
            for (let idx = 0; idx < dataResult.columns.length; idx++) {
              primaryKeys.push({
                column: dataResult.columns[idx],
                value: rowData[idx] ?? null,
              });
            }
          }

          stageRowDelete({
            database,
            table,
            rowIndex,
            originalRow: rowData,
            primaryKeys,
          });
          deletedCount++;
        }

        if (deletedCount > 0) {
          setSaveStatus({
            success: true,
            message: `${deletedCount} fila(s) marcadas para borrado en cola.`,
          });
          setTimeout(() => setSaveStatus(null), 3000);
        }
        return false;
      }

      // 2. If range or cells are selected: set cells to NULL
      const cells = getSelectedCells();
      if (cells.length > 0) {
        handleApplyValueToSelection(null, cells);
      }

      return false;
    },
    [
      dataResult,
      isEditingAllowed,
      displayRows,
      hasPrimaryKey,
      activePkColumns,
      database,
      table,
      stageRowDelete,
      getSelectedCells,
      handleApplyValueToSelection,
    ],
  );

  // Right-click context menu on grid cells
  const handleCellContextMenu = useCallback(
    ([col, row]: Item, event: any) => {
      event.preventDefault();
      if (col < 0 || row < 0) return;

      // If the right-clicked cell is NOT inside the current multi-cell selection range, update selection to this single cell
      const currentRange = gridSelection?.current?.range;
      const isInsideCurrentRange =
        currentRange &&
        col >= currentRange.x &&
        col < currentRange.x + currentRange.width &&
        row >= currentRange.y &&
        row < currentRange.y + currentRange.height;

      if (!isInsideCurrentRange) {
        setSelectedCell({ col, row });
        setSelectedRowIndex(row);
      }

      const mouseEvent = (event as any).rawEvent as MouseEvent | undefined;
      const clientX = mouseEvent ? mouseEvent.clientX : window.innerWidth / 2;
      const clientY = mouseEvent ? mouseEvent.clientY : window.innerHeight / 2;

      const menuWidth = 240;
      const menuHeight = 260;
      const x = Math.min(clientX, window.innerWidth - menuWidth - 10);
      const y = Math.min(clientY, window.innerHeight - menuHeight - 10);

      setCellContextMenu({
        x: Math.max(10, x),
        y: Math.max(10, y),
        col,
        row,
      });
    },
    [gridSelection],
  );

  // Stage Row Deletion instead of deleting immediately
  const handleStageDeleteRow = () => {
    if (selectedRowIndex === null || !dataResult || !displayRows[selectedRowIndex]) return;

    if (!isEditingAllowed) {
      useUIStore.getState().showAlert({
        title: "Operación Bloqueada",
        message:
          "Esta tabla no tiene una clave primaria y la configuración actual bloquea modificaciones sin clave.",
        variant: "warning",
        icon: "alert",
      });
      return;
    }

    const currentRow = displayRows[selectedRowIndex];
    const primaryKeys: PrimaryKeyCondition[] = [];
    if (hasPrimaryKey) {
      for (const pkCol of activePkColumns) {
        const pkIdx = dataResult.columns.indexOf(pkCol);
        if (pkIdx === -1) {
          useUIStore.getState().showAlert({
            title: "Columna Faltante",
            message: `La columna de clave primaria '${pkCol}' no está presente en los resultados.`,
            variant: "danger",
            icon: "alert",
          });
          return;
        }
        const pkVal = currentRow[pkIdx];
        primaryKeys.push({ column: pkCol, value: pkVal });
      }
    } else {
      for (let idx = 0; idx < dataResult.columns.length; idx++) {
        primaryKeys.push({
          column: dataResult.columns[idx],
          value: currentRow[idx] ?? null,
        });
      }
    }

    stageRowDelete({
      database,
      table,
      rowIndex: selectedRowIndex,
      originalRow: currentRow,
      primaryKeys,
    });

    setSaveStatus({
      success: true,
      message: `Fila #${selectedRowIndex + 1} marcada para eliminación en cambios pendientes.`,
    });
    setTimeout(() => setSaveStatus(null), 3000);
  };

  // Save complete row from EditRecordModal
  const handleSaveRow = async (updatedRow: any[]) => {
    if (selectedRowIndex === null || !dataResult || !displayRows[selectedRowIndex]) return;

    for (let c = 0; c < dataResult.columns.length; c++) {
      const oldVal = displayRows[selectedRowIndex][c];
      const newVal = updatedRow[c];
      if (!areValuesEqual(oldVal, newVal)) {
        onCellEdited([c, selectedRowIndex], {
          kind: GridCellKind.Text,
          data: newVal === null ? "NULL" : String(newVal),
        } as EditableGridCell);
      }
    }
  };

  // Apply all staged changes transaccationally to MariaDB/MySQL
  const handleApplyStagedChanges = async () => {
    if (stagedChangeCount === 0) return;
    setIsApplyingStaged(true);
    const sqlStatements = generateSqlForTable(database, table);

    try {
      await dbService.executeTransaction(database, sqlStatements);
      clearTableChanges(database, table);
      setSaveStatus({
        success: true,
        message: `${sqlStatements.length} cambio(s) aplicados atómicamente a ${database}.${table}.`,
      });
      setTimeout(() => setSaveStatus(null), 4000);
      // Reload fresh data from table
      await loadData(pageOffset, pageSize);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al aplicar lote";
      setSaveStatus({
        success: false,
        message: `Error en transacción: ${msg}`,
      });
      setTimeout(() => setSaveStatus(null), 7000);
    } finally {
      setIsApplyingStaged(false);
    }
  };

  // Discard local staged changes and reload table
  const handleDiscardStagedChanges = () => {
    clearTableChanges(database, table);
    setSaveStatus({
      success: true,
      message: "Cambios pendientes descartados.",
    });
    setTimeout(() => setSaveStatus(null), 3000);
    loadData(pageOffset, pageSize);
  };

  // Foreign Key Quick-Jump handler
  const handleForeignKeyJump = (colIndex: number, rowIndex: number) => {
    if (!dataResult || !displayRows[rowIndex]) return;
    const rawColIdx = getRawColIndex(colIndex);
    const colName = effectiveColumnNames[colIndex] || dataResult.columns[rawColIdx];
    const fk = fkByColumn.get(colName.toLowerCase());
    if (!fk) return;

    const val = rawColIdx !== -1 ? displayRows[rowIndex][rawColIdx] : null;
    if (val === null || val === undefined) {
      useUIStore.getState().showAlert({
        title: "Clave Foránea Nula",
        message: `El valor de '${colName}' es NULL, no referencia ningún registro en '${fk.referenced_table}'.`,
        variant: "info",
        icon: "info",
      });
      return;
    }

    // Open referenced table tab
    useUIStore.getState().openTab({
      id: `tab_table_${database}_${fk.referenced_table}`,
      type: "table",
      title: fk.referenced_table,
      database,
      tableName: fk.referenced_table,
    });
  };

  // Smart Multi-Format Copy Actions
  const handleSmartCopy = (
    format: "tsv" | "sql" | "json" | "markdown" | "php" | "ts",
  ) => {
    if (!dataResult) return;
    setIsCopyMenuOpen(false);

    // Determine target rows to copy: selected row or all visible rows
    const targetRows =
      selectedRowIndex !== null && displayRows[selectedRowIndex]
        ? [displayRows[selectedRowIndex]]
        : displayRows;

    const exportRows = targetRows.map((r) =>
      effectiveColumnNames.map((colName) => {
        const rawIdx = dataResult.columns.indexOf(colName);
        return rawIdx !== -1 ? r[rawIdx] : null;
      }),
    );

    let output = "";
    switch (format) {
      case "tsv":
        output = exportToTsv(effectiveColumnNames, exportRows);
        break;
      case "sql":
        output = exportToSqlInsert(database, table, effectiveColumnNames, exportRows);
        break;
      case "json":
        output = exportToJsonArray(effectiveColumnNames, exportRows);
        break;
      case "markdown":
        output = exportToMarkdownTable(effectiveColumnNames, exportRows);
        break;
      case "php":
        output = exportToPhpArray(effectiveColumnNames, exportRows);
        break;
      case "ts":
        output = exportToTsArray(effectiveColumnNames, exportRows);
        break;
    }

    navigator.clipboard.writeText(output).then(() => {
      setSaveStatus({
        success: true,
        message: `Copiado al portapapeles (${format.toUpperCase()}) — ${targetRows.length} fila(s).`,
      });
      setTimeout(() => setSaveStatus(null), 3000);
    });
  };

  // Keyboard navigation & shortcuts on container
  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    // Si el usuario está escribiendo dentro de un input, textarea, editor overlay de GDG o modal, no interceptar teclas
    const target = e.target as HTMLElement | null;
    const isEditing =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        Boolean(target.closest("input")) ||
        Boolean(target.closest("textarea")) ||
        Boolean(target.closest(".gdg-overlay-editor")) ||
        Boolean(target.closest("[role='dialog']")));

    if (isEditing) {
      return;
    }

    // Ctrl+S / Cmd+S: Apply Staged Changes
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      if (stagedChangeCount > 0) {
        e.preventDefault();
        handleApplyStagedChanges();
      }
    }
    // Escape: Discard changes if pending
    else if (e.key === "Escape") {
      if (stagedChangeCount > 0) {
        e.preventDefault();
        handleDiscardStagedChanges();
      }
    }
    // Ctrl+Shift+C / Cmd+Shift+C: Smart Copy as TSV
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      handleSmartCopy("tsv");
    }
    // Space: Open Cell Inspector on selected cell (solo durante navegación en el grid, no mientras se escribe)
    else if (e.key === " " && selectedCell) {
      e.preventDefault();
      setIsInspectorOpen(true);
    }
    // Alt+N: Set selected cell or range to NULL
    else if (e.altKey && e.key.toLowerCase() === "n" && (selectedCell || (gridSelection?.current?.range && gridSelection.current.range.width > 0))) {
      e.preventDefault();
      handleSetCellNull();
    }
  };

  // Pyro Theme for Glide Data Grid Canvas (Light / Dark)
  const pyroTheme = useMemo(
    () => ({
      accentColor: "#ff5c16",
      accentLight: isLight ? "rgba(255, 92, 22, 0.12)" : "rgba(255, 92, 22, 0.15)",
      bgCell: isLight ? "#ffffff" : "#0d0f15",
      bgCellMedium: isLight ? "#f8fafc" : "#11141c",
      bgHeader: isLight ? "#f1f5f9" : "#131722",
      bgHeaderHasFocus: isLight ? "#e2e8f0" : "#1a202d",
      bgHeaderHovered: isLight ? "#e8edf5" : "#181d29",
      textDark: isLight ? "#0f172a" : "#e2e8f0",
      textMedium: isLight ? "#475569" : "#94a3b8",
      textLight: isLight ? "#94a3b8" : "#64748b",
      textHeader: isLight ? "#1e293b" : "#f1f5f9",
      textHeaderSelected: isLight ? "#0f172a" : "#ffffff",
      borderColor: isLight ? "#e2e8f0" : "#1e2434",
      drilldownBorder: isLight ? "#cbd5e1" : "#2a3246",
      lineHeight: 1.4,
      fontFamily: activeFont,
      baseFontStyle: `12px ${activeFont}`,
      headerFontStyle: `600 12px ${activeFont}`,
      editorFontSize: "12px",
    }),
    [isLight, activeFont],
  );

  const totalRowsCount = dataResult?.total_rows ?? displayRows.length;
  const currentStart = totalRowsCount > 0 ? pageOffset + 1 : 0;
  const currentEnd = Math.min(pageOffset + pageSize, totalRowsCount);
  const totalPages = Math.ceil(totalRowsCount / pageSize) || 1;
  const currentPage = Math.floor(pageOffset / pageSize) + 1;
  const lastPageOffset = Math.max(0, (totalPages - 1) * pageSize);

  const activeInspectorValue = useMemo(() => {
    if (!selectedCell || !dataResult || !displayRows[selectedCell.row]) return null;
    const rawColIdx = getRawColIndex(selectedCell.col);
    const colName = effectiveColumnNames[selectedCell.col] || dataResult.columns[rawColIdx];
    const cellKey = `${colName}:${selectedCell.row}`;
    const staged = stagedUpdatesMap.get(cellKey);
    return staged ? staged.stagedValue : (rawColIdx !== -1 ? displayRows[selectedCell.row][rawColIdx] : null);
  }, [selectedCell, dataResult, displayRows, effectiveColumnNames, getRawColIndex, stagedUpdatesMap]);

  return (
    <div
      className="flex flex-col h-full w-full bg-[#0d0f15] relative select-none"
      onKeyDown={handleContainerKeyDown}
      tabIndex={0}
    >
      {/* Top Toolbar */}
      <div
        className={`flex items-center justify-between px-3 py-1.5 border-b shrink-0 gap-2 ${
          isLight ? "bg-slate-100 border-slate-300" : "bg-[#11141c] border-[#1f2536]"
        }`}
      >
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          {/* Refresh button */}
          <button
            onClick={() => loadData(pageOffset, pageSize)}
            disabled={isLoading}
            title="Recargar datos de la tabla"
            className="p-1.5 rounded bg-[#171b26] hover:bg-[#202636] border border-[#252c3e] text-neutral-300 hover:text-white disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-orange-400" : ""}`} />
          </button>

          {/* Search Input (Local batch) */}
          <div className="relative flex-1 max-w-[190px]" title="Filtrado rápido en el lote de filas cargadas en memoria">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar en lote..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-[#0d0f15] border border-[#23293a] rounded text-neutral-200 placeholder-neutral-500 text-xs font-mono focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          {/* Server WHERE Filter */}
          <div className="relative flex-1 max-w-[230px]" title="Filtro global ejecutado en servidor (cláusula WHERE). Presiona Enter para aplicar.">
            <Filter
              className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${
                isServerFilterActive ? "text-orange-400" : "text-neutral-500"
              }`}
            />
            <input
              type="text"
              placeholder="WHERE servidor..."
              value={serverFilter}
              onChange={(e) => setServerFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleApplyServerFilter();
                }
              }}
              className={`w-full pl-8 pr-7 py-1 rounded text-xs font-mono border focus:outline-none transition-colors ${
                isServerFilterActive
                  ? "bg-orange-500/10 border-orange-500/50 text-orange-200"
                  : "bg-[#0d0f15] border-[#23293a] text-neutral-200 placeholder-neutral-500 focus:border-orange-500"
              }`}
            />
            {serverFilter && (
              <button
                type="button"
                onClick={handleClearServerFilter}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                title="Limpiar filtro de servidor"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Cell Inspector Button */}
          {selectedCell && (
            <button
              onClick={() => setIsInspectorOpen(true)}
              title="Abrir inspector de celdas para ver/editar JSON o texto largo (Espacio)"
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-xs font-medium transition-all ${
                isLight
                  ? "bg-white hover:bg-slate-100 border-slate-300 text-orange-600 hover:text-orange-700"
                  : "bg-[#171b26] hover:bg-[#202636] border-[#252c3e] text-orange-400 hover:text-orange-300"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Inspector</span>
            </button>
          )}

          {/* Edit Row Button */}
          {selectedRowIndex !== null && displayRows[selectedRowIndex] && (
            <button
              onClick={() => {
                if (!isEditingAllowed) {
                  useUIStore.getState().showAlert({
                    title: "Edición Bloqueada",
                    message:
                      "Esta tabla no tiene una clave primaria y la configuración actual bloquea operaciones sin clave.",
                    variant: "warning",
                    icon: "alert",
                  });
                  return;
                }
                setIsEditModalOpen(true);
              }}
              disabled={!isEditingAllowed}
              title={
                isEditingAllowed
                  ? "Abrir formulario para editar todos los campos de la fila seleccionada"
                  : "Deshabilitado: Esta tabla no tiene clave primaria."
              }
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all active:scale-95 ${
                isEditingAllowed
                  ? "bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/40"
                  : "bg-neutral-800/40 text-neutral-500 border border-neutral-700/30 cursor-not-allowed opacity-50"
              }`}
            >
              <Edit3 className="w-3.5 h-3.5 text-orange-400" />
              <span>Editar Fila #{selectedRowIndex + 1}</span>
            </button>
          )}

          {/* Delete Row Button (Staged) */}
          {selectedRowIndex !== null && displayRows[selectedRowIndex] && (
            <button
              onClick={handleStageDeleteRow}
              disabled={!isEditingAllowed}
              title="Marcar registro para eliminación transaccional (DELETE)"
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all active:scale-95 ${
                isEditingAllowed
                  ? "bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40"
                  : "bg-neutral-800/40 text-neutral-500 border border-neutral-700/30 cursor-not-allowed opacity-50"
              }`}
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span>Marcar Borrado</span>
            </button>
          )}

          {/* Smart Multi-Format Copy Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsCopyMenuOpen((prev) => !prev)}
              title="Copiar selección en múltiples formatos (TSV, SQL, JSON, Markdown, etc.) (Ctrl+Shift+C)"
              className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-[#171b26] hover:bg-[#202636] border border-[#252c3e] rounded text-neutral-300 hover:text-white transition-colors text-xs font-mono"
            >
              <Copy className="w-3 h-3 text-sky-400" />
              <span>Copiar</span>
              <ChevronDown className="w-3 h-3 text-neutral-400" />
            </button>

            {isCopyMenuOpen && (
              <div
                className={`absolute left-0 mt-1.5 w-52 rounded-xl border shadow-2xl z-50 py-1.5 text-xs animate-in fade-in duration-150 ${
                  isLight ? "bg-white border-slate-200" : "bg-[#141824] border-[#222a3d]"
                }`}
              >
                <div className="px-3 py-1 text-[10px] uppercase font-mono text-neutral-400 border-b border-neutral-800">
                  Exportar al Portapapeles
                </div>
                <button
                  type="button"
                  onClick={() => handleSmartCopy("tsv")}
                  className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-orange-500/10 hover:text-orange-400 text-neutral-200 transition-colors"
                >
                  <span>TSV (Excel / Sheets)</span>
                  <span className="text-[10px] text-neutral-500 font-mono">Ctrl+Shift+C</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSmartCopy("sql")}
                  className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-orange-500/10 hover:text-orange-400 text-neutral-200 transition-colors"
                >
                  <span>SQL INSERT INTO</span>
                  <span className="text-[10px] text-amber-500 font-mono">.sql</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSmartCopy("json")}
                  className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-orange-500/10 hover:text-orange-400 text-neutral-200 transition-colors"
                >
                  <span>JSON Array</span>
                  <span className="text-[10px] text-sky-400 font-mono">[&#123;&#125;]</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSmartCopy("markdown")}
                  className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-orange-500/10 hover:text-orange-400 text-neutral-200 transition-colors"
                >
                  <span>Markdown Table</span>
                  <span className="text-[10px] text-emerald-400 font-mono">|---|</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSmartCopy("php")}
                  className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-orange-500/10 hover:text-orange-400 text-neutral-200 transition-colors"
                >
                  <span>PHP Associative Array</span>
                  <span className="text-[10px] text-purple-400 font-mono">['=&gt;']</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSmartCopy("ts")}
                  className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-orange-500/10 hover:text-orange-400 text-neutral-200 transition-colors"
                >
                  <span>TypeScript Array</span>
                  <span className="text-[10px] text-blue-400 font-mono">Record&lt;&gt;</span>
                </button>
              </div>
            )}
          </div>

          {dataResult && (
            <div className="hidden sm:flex items-center space-x-2 text-neutral-400 font-mono text-[11px]">
              <span className="flex items-center space-x-1 text-emerald-400">
                <Zap className="w-3 h-3" />
                <span>{dataResult.execution_time_ms} ms</span>
              </span>
              <span>•</span>
              <span>
                {displayRows.length} de {totalRowsCount.toLocaleString()} filas
              </span>
              {searchTerm && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Lote filtrado
                </span>
              )}
              {isServerFilterActive && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-500/20 text-orange-300 border border-orange-500/30">
                  Filtro servidor activo
                </span>
              )}
              {freezeColumnsCount > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center space-x-1">
                  <Pin className="w-2.5 h-2.5" />
                  <span>{freezeColumnsCount} fijada(s)</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Live editing status banner */}
        {saveStatus && (
          <div
            title={saveStatus.message}
            onClick={() => {
              if (!saveStatus.success) {
                useUIStore.getState().showAlert({
                  title: "Detalle del error en base de datos",
                  message: saveStatus.message || "Error desconocido al ejecutar la operación.",
                  variant: "danger",
                });
              }
            }}
            className={`px-3 py-1 rounded text-xs flex items-center space-x-1.5 border font-mono animate-in fade-in duration-150 ${
              !saveStatus.success ? "cursor-pointer hover:brightness-110" : ""
            } ${
              saveStatus.success
                ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                : "bg-red-950/40 border-red-800/60 text-red-300"
            }`}
          >
            {saveStatus.success ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            )}
            <span className="truncate max-w-md">{saveStatus.message}</span>
            {!saveStatus.success && (
              <span className="text-[10px] underline ml-1 text-red-400 opacity-80 shrink-0">
                Ver detalle
              </span>
            )}
          </div>
        )}

        {/* Pagination controls */}
        <div className="flex items-center space-x-1.5">
          <select
            value={pageSize}
            onChange={(e) => {
              const newSize = parseInt(e.target.value, 10);
              setPageSize(newSize);
              setPageOffset(0);
              setSelectedRowIndex(null);
              loadData(0, newSize);
            }}
            className="px-2 py-1 bg-[#0d0f15] border border-[#23293a] rounded text-neutral-300 font-mono text-xs focus:outline-none"
          >
            <option value={50}>50 filas</option>
            <option value={100}>100 filas</option>
            <option value={250}>250 filas</option>
            <option value={500}>500 filas</option>
            <option value={1000}>1,000 filas</option>
            <option value={5000}>5,000 filas</option>
          </select>

          {/* First page button */}
          <button
            onClick={() => {
              setPageOffset(0);
              setSelectedRowIndex(null);
              loadData(0, pageSize);
            }}
            disabled={pageOffset === 0 || isLoading}
            title="Primera página"
            className="p-1 rounded bg-[#171b26] hover:bg-[#202636] border border-[#252c3e] text-neutral-300 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>

          {/* Prev page button */}
          <button
            onClick={() => {
              const next = Math.max(0, pageOffset - pageSize);
              setPageOffset(next);
              setSelectedRowIndex(null);
              loadData(next, pageSize);
            }}
            disabled={pageOffset === 0 || isLoading}
            title="Página anterior"
            className="p-1 rounded bg-[#171b26] hover:bg-[#202636] border border-[#252c3e] text-neutral-300 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="text-neutral-400 font-mono text-xs px-2 whitespace-nowrap">
            {currentStart}-{currentEnd} de {totalRowsCount.toLocaleString()} ({currentPage}/{totalPages})
          </span>

          {/* Next page button */}
          <button
            onClick={() => {
              const next = pageOffset + pageSize;
              setPageOffset(next);
              setSelectedRowIndex(null);
              loadData(next, pageSize);
            }}
            disabled={pageOffset + pageSize >= totalRowsCount || isLoading}
            title="Página siguiente"
            className="p-1 rounded bg-[#171b26] hover:bg-[#202636] border border-[#252c3e] text-neutral-300 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Last page button */}
          <button
            onClick={() => {
              setPageOffset(lastPageOffset);
              setSelectedRowIndex(null);
              loadData(lastPageOffset, pageSize);
            }}
            disabled={pageOffset >= lastPageOffset || isLoading}
            title="Última página"
            className="p-1 rounded bg-[#171b26] hover:bg-[#202636] border border-[#252c3e] text-neutral-300 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* No Primary Key Notice Banner */}
      {!hasPrimaryKey && !isLoading && dataResult && (
        <div className="px-4 py-1.5 bg-[#121622] border-b border-[#232b3e] text-xs flex items-center justify-between gap-3 shrink-0 animate-in fade-in duration-150">
          <div className="flex items-center space-x-2 min-w-0">
            <AlertTriangle
              className={`w-3.5 h-3.5 shrink-0 ${
                noPrimaryKeyMode === "use_all_columns" ? "text-amber-400" : "text-rose-400"
              }`}
            />
            <span className="text-neutral-300 text-[11px] truncate">
              <strong
                className={
                  noPrimaryKeyMode === "use_all_columns"
                    ? "text-amber-400 font-semibold"
                    : "text-rose-400 font-semibold"
                }
              >
                Tabla sin clave primaria:
              </strong>{" "}
              {noPrimaryKeyMode === "use_all_columns"
                ? "Identificación por fila completa activa para edición y borrado."
                : "Edición y borrado bloqueados por seguridad."}
            </span>
          </div>

          <button
            type="button"
            onClick={() => useUIStore.getState().openSettingsModal("database")}
            title="Cambiar comportamiento de tablas sin clave primaria en Configuración"
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded text-[11px] text-neutral-300 hover:text-white bg-[#171b26] hover:bg-[#202636] border border-[#273044] transition-colors shrink-0 font-medium"
          >
            <Settings className="w-3 h-3 text-orange-400" />
            <span>Configurar</span>
          </button>
        </div>
      )}

      {/* Canvas Data Grid Container */}
      <div className="flex-1 min-h-0 w-full relative overflow-hidden bg-[#0d0f15]">
        {isLoading && !dataResult && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 backdrop-blur-xs space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            <span className="text-xs text-neutral-300 font-mono">
              Cargando registros desde MariaDB...
            </span>
          </div>
        )}

        {columns.length > 0 ? (
          <DataEditor
            width="100%"
            height="100%"
            columns={columns}
            rows={displayRows.length}
            getCellContent={getCellContent}
            onCellEdited={onCellEdited}
            onColumnResize={handleColumnResize}
            onColumnMoved={handleColumnMoved}
            freezeColumns={freezeColumnsCount}
            onHeaderClicked={handleHeaderClicked}
            onHeaderMenuClick={handleHeaderMenuClick}
            onHeaderContextMenu={handleHeaderContextMenu}
            onCellContextMenu={handleCellContextMenu}
            onCellClicked={([col, row]: Item, event) => {
              if (row < 0 || col < 0) return;
              setSelectedRowIndex(row);
              setSelectedCell({ col, row });

              // If Alt + Click on a foreign key cell, trigger quick jump
              if ((event as any).altKey && dataResult) {
                const colName = effectiveColumnNames[col];
                if (colName && fkByColumn.has(colName.toLowerCase())) {
                  handleForeignKeyJump(col, row);
                }
              }
            }}
            gridSelection={gridSelection}
            onGridSelectionChange={setGridSelection}
            rangeSelect="multi-rect"
            rowSelect="multi"
            columnSelect="multi"
            onPaste={handlePaste}
            onDelete={handleDelete}
            cellActivationBehavior="double-click"
            editOnType={true}
            theme={pyroTheme}
            rowMarkers="both"
            smoothScrollX
            smoothScrollY
            getCellsForSelection
            verticalBorder
            fillHandle
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-xs">
            <Database className="w-8 h-8 mb-2 opacity-40 text-orange-400" />
            <span>Sin datos para mostrar en esta tabla.</span>
          </div>
        )}

        {/* Floating Action Bar for Staged Changes */}
        <StagedChangesActionBar
          changeCount={stagedChangeCount}
          onPreviewSql={() => setIsPreviewSqlOpen(true)}
          onApplyChanges={handleApplyStagedChanges}
          onDiscardChanges={handleDiscardStagedChanges}
          isApplying={isApplyingStaged}
        />
      </div>

      {/* Value Inspector Lateral Drawer */}
      {selectedCell && dataResult && (
        <CellInspectorDrawer
          isOpen={isInspectorOpen}
          onClose={() => setIsInspectorOpen(false)}
          database={database}
          table={table}
          columnName={effectiveColumnNames[selectedCell.col] || dataResult.columns[getRawColIndex(selectedCell.col)] || "Columna"}
          columnType={dataResult.column_types?.[getRawColIndex(selectedCell.col)]}
          initialValue={activeInspectorValue}
          onSaveToStaged={(newVal) => {
            onCellEdited([selectedCell.col, selectedCell.row], {
              kind: GridCellKind.Text,
              data: newVal === null ? "NULL" : String(newVal),
            } as EditableGridCell);
          }}
          isReadonly={!isEditingAllowed}
        />
      )}

      {/* Preview Staged SQL Modal */}
      <PreviewStagedSqlModal
        isOpen={isPreviewSqlOpen}
        onClose={() => setIsPreviewSqlOpen(false)}
        onApply={handleApplyStagedChanges}
        sqlStatements={generateSqlForTable(database, table)}
        database={database}
        table={table}
        isApplying={isApplyingStaged}
      />

      {/* Edit Record Modal */}
      {isEditModalOpen && selectedRowIndex !== null && displayRows[selectedRowIndex] && dataResult && (
        <EditRecordModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          database={database}
          tableName={table}
          pkColumns={activePkColumns}
          columns={dataResult.columns}
          rowData={displayRows[selectedRowIndex]}
          rowIndex={selectedRowIndex}
          onSave={handleSaveRow}
        />
      )}

      {/* Fill Selection Modal */}
      {isFillModalOpen && (
        <FillSelectionModal
          isOpen={isFillModalOpen}
          onClose={() => setIsFillModalOpen(false)}
          cellCount={Math.max(1, getSelectedCells().length)}
          onApply={(newVal) => handleApplyValueToSelection(newVal)}
        />
      )}

      {/* Paste Preview Modal */}
      {pendingPasteValidation && (
        <PastePreviewModal
          isOpen={Boolean(pendingPasteValidation)}
          onClose={() => setPendingPasteValidation(null)}
          onConfirm={handleConfirmPaste}
          validation={pendingPasteValidation}
          targetTableName={`${database}.${table}`}
        />
      )}

      {/* Floating Context Menu for Cells */}
      {cellContextMenu && (() => {
        const selectedCells = getSelectedCells();
        const count = selectedCells.length;
        const isMulti = count > 1;

        return (
          <div
            style={{ top: cellContextMenu.y, left: cellContextMenu.x }}
            className={`fixed z-[100] w-64 rounded-xl border shadow-2xl py-1.5 text-xs animate-in fade-in zoom-in-95 duration-100 select-none ${
              isLight
                ? "bg-white border-slate-200 text-slate-800 shadow-slate-300/60"
                : "bg-[#12151e] border-[#222a3d] text-neutral-200 shadow-black/80"
            }`}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              className={`px-3 py-1 text-[10px] uppercase font-mono border-b truncate ${
                isLight ? "text-slate-500 border-slate-100" : "text-neutral-400 border-neutral-800"
              }`}
            >
              {isMulti
                ? `Rango (${count} celdas seleccionadas)`
                : `${dataResult?.columns[cellContextMenu.col] || "Celda"} (Fila #${cellContextMenu.row + 1})`}
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
              className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors disabled:opacity-40 ${
                isLight
                  ? "hover:bg-amber-50 text-amber-800 hover:text-amber-950"
                  : "hover:bg-amber-500/10 text-amber-400 hover:text-amber-300"
              }`}
            >
              <span className="flex items-center space-x-2">
                <Ban className="w-3.5 h-3.5 text-amber-500" />
                <span className="font-semibold">
                  {isMulti ? `Poner selección en NULL (${count})` : "Poner en NULL"}
                </span>
              </span>
              <span className={`text-[10px] font-mono ${isLight ? "text-slate-400" : "text-neutral-500"}`}>
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
              className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors disabled:opacity-40 ${
                isLight
                  ? "hover:bg-sky-50 text-sky-800 hover:text-sky-950"
                  : "hover:bg-sky-500/10 text-sky-400 hover:text-sky-300"
              }`}
            >
              <span className="flex items-center space-x-2">
                <Edit3 className="w-3.5 h-3.5 text-sky-500" />
                <span>
                  {isMulti ? `Asignar valor a selección...` : "Asignar valor..."}
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
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors ${
                  isLight
                    ? "hover:bg-orange-50 hover:text-orange-700 text-slate-700"
                    : "hover:bg-orange-500/10 hover:text-orange-400 text-neutral-200"
                }`}
              >
                <span className="flex items-center space-x-2">
                  <Code2 className="w-3.5 h-3.5 text-orange-400" />
                  <span>Inspeccionar Celda</span>
                </span>
                <span className={`text-[10px] font-mono ${isLight ? "text-slate-400" : "text-neutral-500"}`}>
                  Espacio
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const { col, row } = cellContextMenu;
                setCellContextMenu(null);
                if (isMulti) {
                  handleSmartCopy("tsv");
                } else {
                  const rawColIdx = getRawColIndex(col);
                  const cellVal = rawColIdx !== -1 ? displayRows[row]?.[rawColIdx] : null;
                  const textToCopy = cellVal === null || cellVal === undefined ? "NULL" : String(cellVal);
                  navigator.clipboard.writeText(textToCopy);
                  setSaveStatus({ success: true, message: "Valor de celda copiado al portapapeles." });
                  setTimeout(() => setSaveStatus(null), 2500);
                }
              }}
              className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors ${
                isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-neutral-800 text-neutral-300"
              }`}
            >
              <span className="flex items-center space-x-2">
                <Copy className="w-3.5 h-3.5 text-sky-400" />
                <span>{isMulti ? `Copiar Selección (${count})` : "Copiar Valor"}</span>
              </span>
            </button>

            <div className={`my-1 border-t ${isLight ? "border-slate-100" : "border-neutral-800"}`} />

            <button
              type="button"
              onClick={() => {
                setCellContextMenu(null);
                setIsEditModalOpen(true);
              }}
              disabled={!isEditingAllowed}
              className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors disabled:opacity-40 ${
                isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-neutral-800 text-neutral-300"
              }`}
            >
              <span className="flex items-center space-x-2">
                <Edit3 className="w-3.5 h-3.5 text-orange-400" />
                <span>Editar Registro...</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCellContextMenu(null);
                handleStageDeleteRow();
              }}
              disabled={!isEditingAllowed}
              className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors disabled:opacity-40 ${
                isLight
                  ? "hover:bg-red-50 text-red-700 hover:text-red-900"
                  : "hover:bg-red-500/10 text-red-400 hover:text-red-300"
              }`}
            >
              <span className="flex items-center space-x-2">
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span>Marcar para Borrar</span>
              </span>
            </button>
          </div>
        );
      })()}

      {/* Header Context / Column Menu Dropdown */}
      {headerMenu && (
        <div
          style={{ top: headerMenu.y, left: headerMenu.x }}
          onClick={(e) => e.stopPropagation()}
          className={`fixed z-50 w-56 rounded-xl border shadow-2xl py-1.5 text-xs font-sans animate-in fade-in duration-100 ${
            isLight ? "bg-white border-slate-200 text-slate-800" : "bg-[#141824] border-[#222a3d] text-neutral-200"
          }`}
        >
          <div className="px-3 py-1 text-[11px] font-semibold text-neutral-400 border-b border-neutral-800/60 truncate">
            Columna: <span className="text-orange-400 font-mono">{headerMenu.colName}</span>
          </div>

          <button
            type="button"
            onClick={() => handleSortFromMenu(headerMenu.colName, "ASC")}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-orange-500/10 hover:text-orange-400 transition-colors"
          >
            <ArrowUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>Ordenar Ascendente (ASC)</span>
          </button>

          <button
            type="button"
            onClick={() => handleSortFromMenu(headerMenu.colName, "DESC")}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-orange-500/10 hover:text-orange-400 transition-colors"
          >
            <ArrowDown className="w-3.5 h-3.5 text-amber-400" />
            <span>Ordenar Descendente (DESC)</span>
          </button>

          {sortColumn === headerMenu.colName && (
            <button
              type="button"
              onClick={() => handleSortFromMenu(headerMenu.colName, null)}
              className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-orange-500/10 hover:text-orange-400 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
              <span>Quitar ordenamiento</span>
            </button>
          )}

          <div className="my-1 border-t border-neutral-800/60" />

          <button
            type="button"
            onClick={() => handleAutoSizeColumn(headerMenu.colName)}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-orange-500/10 hover:text-orange-400 transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5 text-sky-400" />
            <span>Autoajustar ancho</span>
          </button>

          {Object.keys(customWidths).length > 0 && (
            <button
              type="button"
              onClick={handleResetColumnWidths}
              className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-orange-500/10 hover:text-orange-400 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-neutral-400" />
              <span>Restablecer anchos</span>
            </button>
          )}

          <div className="my-1 border-t border-neutral-800/60" />

          <button
            type="button"
            onClick={() => handleToggleFreezeColumn(headerMenu.col)}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-orange-500/10 hover:text-orange-400 transition-colors"
          >
            {freezeColumnsCount === headerMenu.col + 1 ? (
              <>
                <PinOff className="w-3.5 h-3.5 text-neutral-400" />
                <span>Descongelar columnas</span>
              </>
            ) : (
              <>
                <Pin className="w-3.5 h-3.5 text-purple-400" />
                <span>Fijar columnas hasta aquí</span>
              </>
            )}
          </button>

          <div className="my-1 border-t border-neutral-800/60" />

          <button
            type="button"
            onClick={() => handleCopyColumnName(headerMenu.colName)}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-orange-500/10 hover:text-orange-400 transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-blue-400" />
            <span>Copiar nombre de columna</span>
          </button>

          <button
            type="button"
            onClick={() => handleFilterByColumn(headerMenu.colName)}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-orange-500/10 hover:text-orange-400 transition-colors"
          >
            <Filter className="w-3.5 h-3.5 text-orange-400" />
            <span>Filtrar por esta columna...</span>
          </button>
        </div>
      )}
    </div>
  );
};
