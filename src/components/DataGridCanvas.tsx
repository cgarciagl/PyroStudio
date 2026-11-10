import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { FirstTimeHint } from "./ui/FirstTimeHint";
import DataEditor, {
  GridCellKind,
  GridColumn,
  Item,
  EditableGridCell,
  GridSelection,
  CompactSelection,
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
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Database,
  Settings,
  Copy,
  ChevronDown,
  Filter,
  X,
  Pin,
  PanelRight,
  Plus,
} from "lucide-react";
import type {
  TableDataResult,
  QueryExecutionResult,
  ErRelation,
} from "../types/database";
import { useUIStore } from "../stores/uiStore";
import { useConnectionStore } from "../stores/connectionStore";
import { GRID_DENSITY_METRICS, usePreferenceStore } from "../stores/preferenceStore";
import { EditRecordModal } from "./EditRecordModal";
import { StagedChangesActionBar } from "./StagedChangesActionBar";
import { PreviewStagedSqlModal } from "./PreviewStagedSqlModal";
import { CellInspectorDrawer } from "./CellInspectorDrawer";
import { RecordDetailPanel } from "./RecordDetailPanel";
import { iconBtn } from "./ui/styles";
import { RightDock, useDockWidth, useIsWideLayout } from "./ui/RightDock";
import { FillSelectionModal } from "./FillSelectionModal";
import { PastePreviewModal } from "./PastePreviewModal";
import {
  type PasteValidationResult,
} from "../utils/pasteParser";
import {
  formatCellForSql,
} from "../utils/formatCopy";

import { buildSmartCopyOutput, type SmartCopyFormat } from "./dataGrid/copyFormats";
import { useTableKeys } from "./dataGrid/useTableKeys";
import { useColumnLayout } from "./dataGrid/useColumnLayout";
import { GridCellContextMenu } from "./dataGrid/GridCellContextMenu";
import { GridHeaderMenu } from "./dataGrid/GridHeaderMenu";
import { useGridEditing } from "./dataGrid/useGridEditing";
import { useCellContent } from "./dataGrid/useCellContent";
import { buildGridColumns, filterRowsByRules, searchRows, sortRowsClient } from "./dataGrid/gridRows";
import { useStagedTableChanges } from "./dataGrid/useStagedTableChanges";
import { useTableDataLoader } from "./dataGrid/useTableDataLoader";
import { useSqlLiteralRules } from "../services/sqlLiterals";
import {
  VisualFilterBuilder,
  type FilterRule,
  type SortRule,
} from "./VisualFilterBuilder";

export { getStoredLayout, saveStoredLayout, type TableGridLayout } from "./dataGrid/layout";
export { formatCellDisplay, MAX_CANVAS_TEXT_LENGTH } from "./dataGrid/cellFormat";


export interface DataGridCanvasProps {
  database: string;
  table?: string;
  primaryKeyColumns?: string[];
  primaryKeyColumn?: string;

  // External data mode (e.g. for QueryEditorTab)
  externalData?: TableDataResult | QueryExecutionResult | null;
  onRefresh?: () => void;
  isReadonly?: boolean;
  extraToolbarActions?: React.ReactNode;
  /** WHERE condition active on the first load (foreign key jumps). */
  initialServerFilter?: string;
}

export const DataGridCanvas: React.FC<DataGridCanvasProps> = ({
  database,
  table = "",
  primaryKeyColumns,
  primaryKeyColumn,
  externalData,
  onRefresh,
  isReadonly = false,
  extraToolbarActions,
  initialServerFilter,
}) => {
  const {
    defaultPageSize,
    noPrimaryKeyMode,
    theme,
    fontFamily,
    gridDensity,
    infiniteScroll,
    setInfiniteScroll,
  } = usePreferenceStore();
  const densityMetrics = GRID_DENSITY_METRICS[gridDensity];

  const activeFont =
    fontFamily === "system"
      ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
      : '"Maple Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

  const [pageSize, setPageSize] = useState<number>(() => defaultPageSize || 100);
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"ASC" | "DESC" | null>(null);
  const [serverFilter, setServerFilter] = useState<string>(initialServerFilter ?? "");
  const [isServerFilterActive, setIsServerFilterActive] = useState<boolean>(
    Boolean(initialServerFilter),
  );
  const {
    dataResult,
    setDataResult,
    isCountingRows,
    isLoading,
    hasMore,
    isLoadingMore,
    countExactRows,
    loadData,
    handleVisibleRegionChanged,
  } = useTableDataLoader({
    database,
    table,
    externalData,
    onRefresh,
    infiniteScroll,
    sortColumn,
    sortDirection,
    serverFilter,
    isServerFilterActive,
  });
  const [isFilterBuilderOpen, setIsFilterBuilderOpen] = useState<boolean>(false);
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [sortRules, setSortRules] = useState<SortRule[]>([]);

  // Initialize a default rule when the visual filter builder is opened if none exists
  useEffect(() => {
    if (
      isFilterBuilderOpen &&
      filterRules.length === 0 &&
      dataResult?.columns &&
      dataResult.columns.length > 0
    ) {
      setFilterRules([
        {
          id: `rule_${Date.now()}`,
          enabled: true,
          column: dataResult.columns[0],
          operator: "=",
          value: "",
          connector: "AND",
        },
      ]);
    }
  }, [isFilterBuilderOpen, filterRules.length, dataResult?.columns]);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ col: number; row: number } | null>(null);
  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(undefined);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isNewRecordModalOpen, setIsNewRecordModalOpen] = useState(false);
  const [isPreviewSqlOpen, setIsPreviewSqlOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const isWideLayout = useIsWideLayout();
  const [inspectorWidth, setInspectorWidth] = useDockWidth("pyro_inspector_width", 460);
  const [isRecordPanelOpen, setIsRecordPanelOpen] = useState(false);
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
  const [isCopySubmenuOpen, setIsCopySubmenuOpen] = useState(false);
  const lastMousePosRef = useRef<{ x: number; y: number }>({
    x: typeof window !== "undefined" ? Math.round(window.innerWidth / 2) : 400,
    y: typeof window !== "undefined" ? Math.round(window.innerHeight / 2) : 300,
  });

  // Track global mouse position to place context menus precisely where user clicked
  useEffect(() => {
    const handlePointer = (e: MouseEvent | PointerEvent) => {
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("contextmenu", handlePointer, true);
    window.addEventListener("pointerdown", handlePointer, true);
    return () => {
      window.removeEventListener("contextmenu", handlePointer, true);
      window.removeEventListener("pointerdown", handlePointer, true);
    };
  }, []);

  const [headerMenu, setHeaderMenu] = useState<{
    col: number;
    colName: string;
    x: number;
    y: number;
  } | null>(null);

  // Synchronize external data (e.g. from QueryEditorTab)
  useEffect(() => {
    if (externalData) {
      const ext = externalData as any;
      setDataResult({
        columns: ext.columns || [],
        column_types: ext.column_types || [],
        rows: ext.rows || [],
        total_rows: ext.total_rows ?? (ext.rows ? ext.rows.length : 0),
        limit: ext.limit ?? (ext.rows ? ext.rows.length : 100),
        offset: ext.offset ?? 0,
        execution_time_ms: ext.execution_time_ms || 0,
      });
      setPageOffset(0);
      setSelectedRowIndex(null);
      setSelectedCell(null);
    }
  }, [externalData]);

  // Close context menus on outside click or scroll
  useEffect(() => {
    if (!cellContextMenu && !headerMenu) return;
    const closeMenu = () => {
      setCellContextMenu(null);
      setIsCopySubmenuOpen(false);
      setHeaderMenu(null);
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [cellContextMenu, headerMenu]);

  const {
    stagedChangeCount,
    stagedUpdatesMap,
    stagedDeletedRows,
    stageCellUpdate,
    stageBatchCellUpdates,
    stageBatchRowDeletes,
    clearTableChanges,
    generateSqlForTable,
  } = useStagedTableChanges(database, table);
  const dialect = useSqlLiteralRules();

  // Sync pageSize when defaultPageSize changes in preferences
  useEffect(() => {
    if (defaultPageSize && defaultPageSize !== pageSize) {
      setPageSize(defaultPageSize);
      setPageOffset(0);
    }
  }, [defaultPageSize]);

  const { foreignKeys, referencingConstraints, fkByColumn, activePkColumns } = useTableKeys(
    database,
    table,
    primaryKeyColumns,
    primaryKeyColumn,
  );

  const hasPrimaryKey = activePkColumns.length > 0;
  // Read-only connections are enforced by the backend; the grid mirrors it.
  const connectionReadOnly = useConnectionStore((s) =>
    Boolean(s.connectionStatus.config?.read_only),
  );
  const isEditingAllowed =
    !isReadonly &&
    !connectionReadOnly &&
    (Boolean(table) && (hasPrimaryKey || noPrimaryKeyMode === "use_all_columns"));


  const handleClearServerFilter = useCallback(() => {
    setServerFilter("");
    setIsServerFilterActive(false);
    setFilterRules([]);
    setSortRules([]);
    setPageOffset(0);
    setSelectedRowIndex(null);
    setSelectedCell(null);
    loadData(0, pageSize, sortColumn, sortDirection, null);
  }, [pageSize, sortColumn, sortDirection, loadData]);

  const {
    effectiveColumnNames,
    getRawColIndex,
    customWidths,
    freezeColumnsCount,
    handleColumnResize,
    handleColumnMoved,
    autoSizeColumn,
    resetColumnWidths,
    toggleFreezeColumn,
  } = useColumnLayout(database, table, dataResult);

  const handleSelectColumn = useCallback(
    (colIndex: number) => {
      if (colIndex < 0 || colIndex >= effectiveColumnNames.length) return;
      const rowCount = dataResult?.rows?.length ?? 0;
      if (rowCount === 0) return;

      setGridSelection({
        columns: CompactSelection.fromSingleSelection(colIndex),
        rows: CompactSelection.empty(),
        current: {
          cell: [colIndex, 0],
          range: {
            x: colIndex,
            y: 0,
            width: 1,
            height: rowCount,
          },
          rangeStack: [],
        },
      });
      setSelectedCell({ col: colIndex, row: 0 });
      setSelectedRowIndex(0);
      setHeaderMenu(null);
      setCellContextMenu(null);
    },
    [effectiveColumnNames.length, dataResult?.rows?.length],
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

      if (!externalData) {
        loadData(
          0,
          infiniteScroll ? 500 : pageSize,
          nextDir ? colName : null,
          nextDir,
          isServerFilterActive ? serverFilter : null,
          true,
        );
      }
    },
    [
      dataResult,
      effectiveColumnNames,
      sortColumn,
      sortDirection,
      externalData,
      pageSize,
      isServerFilterActive,
      serverFilter,
      infiniteScroll,
      loadData,
    ],
  );

  const handleSortFromMenu = useCallback(
    (colName: string, dir: "ASC" | "DESC" | null) => {
      setSortColumn(dir ? colName : null);
      setSortDirection(dir);
      setPageOffset(0);
      if (!externalData) {
        loadData(
          0,
          infiniteScroll ? 500 : pageSize,
          dir ? colName : null,
          dir,
          isServerFilterActive ? serverFilter : null,
          true,
        );
      }
      setHeaderMenu(null);
    },
    [externalData, pageSize, isServerFilterActive, serverFilter, infiniteScroll, loadData],
  );

  const handleAutoSizeColumn = useCallback(
    (colName: string) => {
      autoSizeColumn(colName);
      setHeaderMenu(null);
    },
    [autoSizeColumn],
  );

  const handleResetColumnWidths = useCallback(() => {
    resetColumnWidths();
    setHeaderMenu(null);
  }, [resetColumnWidths]);

  const handleToggleFreezeColumn = useCallback(
    (colIndex: number) => {
      toggleFreezeColumn(colIndex);
      setHeaderMenu(null);
    },
    [toggleFreezeColumn],
  );

  const handleFilterByColumn = useCallback((colName: string) => {
    setFilterRules((prev) => {
      const exists = prev.find((r) => r.column === colName);
      if (exists) return prev;
      return [
        ...prev,
        {
          id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          enabled: true,
          column: colName,
          operator: "=",
          value: "",
          connector: "AND",
        },
      ];
    });
    setIsFilterBuilderOpen(true);
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
      const x = lastMousePosRef.current.x;
      const y = lastMousePosRef.current.y;
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
    if (externalData) return;
    setPageOffset(0);
    setSelectedRowIndex(null);
    setSelectedCell(null);
    setSortColumn(null);
    setSortDirection(null);
    setServerFilter("");
    setIsServerFilterActive(false);
    if (table) {
      loadData(0, infiniteScroll ? 500 : pageSize, null, null, null, true);
    }
  }, [database, table, pageSize, externalData, infiniteScroll]);

  // Columns definition for Glide Data Grid with smart width calculation, sort indicators & FK indicators
  const columns: GridColumn[] = useMemo(
    () =>
      buildGridColumns({
        dataResult,
        effectiveColumnNames,
        activePkColumns,
        fkByColumn,
        customWidths,
        sortColumn,
        sortDirection,
      }),
    [dataResult, effectiveColumnNames, activePkColumns, fkByColumn, customWidths, sortColumn, sortDirection],
  );

  // Client-side sorting for external data
  const sortedRows = useMemo(() => {
    if (!dataResult) return [];
    if (!externalData) return dataResult.rows;
    if (!sortColumn || !sortDirection) return dataResult.rows;

    const rawIdx = dataResult.columns.indexOf(sortColumn);
    if (rawIdx === -1) return dataResult.rows;
    return sortRowsClient(dataResult.rows, rawIdx, sortDirection);
  }, [dataResult, externalData, sortColumn, sortDirection]);

  // Filtered rows for client-side search in current batch and externalData filter rules
  const displayRows = useMemo(() => {
    if (!dataResult) return [];
    let baseRows = sortedRows;

    // In externalData mode (query results), evaluate visual filter rules in memory
    if (externalData && isServerFilterActive && filterRules.length > 0 && dataResult.columns) {
      baseRows = filterRowsByRules(baseRows, dataResult.columns, filterRules);
    }
    return searchRows(baseRows, searchTerm);
  }, [dataResult, sortedRows, searchTerm, externalData, isServerFilterActive, filterRules]);

  const isLight =
    theme === "light" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches);

  // Glide Data Grid cell supplier callback with Staged Changes Visual Highlight
  const getCellContent = useCellContent({
    activeFont,
    dataResult,
    displayRows,
    effectiveColumnNames,
    getRawColIndex,
    isEditingAllowed,
    isLight,
    stagedDeletedRows,
    stagedUpdatesMap,
  });

  const {
    onCellEdited,
    getSelectedCells,
    getSelectedDataMatrix,
    hasSelectionRange,
    handleApplyValueToSelection,
    handleSetCellNull,
    handlePaste,
    handleConfirmPaste,
    handleDelete,
    handleCellContextMenu,
    getSelectedRowIndices,
    handleStageDeleteRow,
    handleSaveRow,
    handleCreateRecord,
    handleApplyStagedChanges,
    handleDiscardStagedChanges,
  } = useGridEditing({
    database,
    table,
    dataResult,
    setDataResult,
    displayRows,
    effectiveColumnNames,
    getRawColIndex,
    activePkColumns,
    hasPrimaryKey,
    isEditingAllowed,
    noPrimaryKeyMode,
    dialect,
    gridSelection,
    setGridSelection,
    selectedCell,
    setSelectedCell,
    selectedRowIndex,
    setSelectedRowIndex,
    pendingPasteValidation,
    setPendingPasteValidation,
    setCellContextMenu,
    setIsApplyingStaged,
    setIsCopySubmenuOpen,
    setIsNewRecordModalOpen,
    setSaveStatus,
    lastMousePosRef,
    loadData,
    onRefresh,
    pageOffset,
    pageSize,
    stagedChangeCount,
    stageCellUpdate,
    stageBatchCellUpdates,
    stageBatchRowDeletes,
    clearTableChanges,
    generateSqlForTable,
  });
  /** Value of a column (by name) in a displayed row; undefined when the result lacks it. */
  const getRowValueByName = (rowIndex: number, colName: string): any => {
    if (!dataResult || !displayRows[rowIndex]) return undefined;
    const idx = dataResult.columns.findIndex((c) => c.toLowerCase() === colName.toLowerCase());
    return idx === -1 ? undefined : displayRows[rowIndex][idx];
  };

  /**
   * Opens `targetTable` filtered by `pairs` (column in the target → value). Each
   * distinct filter gets its own tab so earlier jumps stay available.
   */
  const openFilteredTable = (targetTable: string, pairs: [string, any][]) => {
    const where = pairs
      .map(([col, val]) => `${dialect.quoteIdentifier(col)} = ${formatCellForSql(val, dialect)}`)
      .join(" AND ");
    const label = pairs.map(([col, val]) => `${col} = ${val}`).join(", ");
    useUIStore.getState().openTab({
      id: `tab_table_${database}_${targetTable}_where_${where}`,
      type: "table",
      title: `${targetTable} (${label})`,
      database,
      tableName: targetTable,
      initialFilter: where,
    });
  };

  const showNullKeyAlert = (columns: string[], targetTable: string) => {
    useUIStore.getState().showAlert({
      title: "Clave sin valor",
      message: `'${columns.join(", ")}' no tiene valor en esta fila, así que no hay registros relacionados en '${targetTable}'.`,
      variant: "info",
      icon: "info",
    });
  };

  // Foreign Key Quick-Jump: opens the referenced row (all columns of composite keys)
  const handleForeignKeyJump = (colIndex: number, rowIndex: number) => {
    if (!dataResult || !displayRows[rowIndex]) return;
    const rawColIdx = getRawColIndex(colIndex);
    const colName = effectiveColumnNames[colIndex] || dataResult.columns[rawColIdx];
    const fk = fkByColumn.get(colName.toLowerCase());
    if (!fk) return;

    const constraint = foreignKeys.filter(
      (f) => f.name === fk.name && f.referenced_table === fk.referenced_table,
    );
    const pairs = constraint.map(
      (f) => [f.referenced_column, getRowValueByName(rowIndex, f.column_name)] as [string, any],
    );
    if (pairs.some(([, val]) => val === null || val === undefined)) {
      showNullKeyAlert(constraint.map((f) => f.column_name), fk.referenced_table);
      return;
    }
    openFilteredTable(fk.referenced_table, pairs);
  };

  // Reverse navigation: rows of another table whose foreign key points at this row
  const handleReferencingJump = (constraint: ErRelation[], rowIndex: number) => {
    const childTable = constraint[0].table;
    const pairs = constraint.map(
      (r) =>
        [r.foreign_key.column_name, getRowValueByName(rowIndex, r.foreign_key.referenced_column)] as [
          string,
          any,
        ],
    );
    if (pairs.some(([, val]) => val === null || val === undefined)) {
      showNullKeyAlert(constraint.map((r) => r.foreign_key.referenced_column), childTable);
      return;
    }
    openFilteredTable(childTable, pairs);
  };

  // Smart Multi-Format Copy Actions
  const handleSmartCopy = (
    format: SmartCopyFormat,
  ) => {
    if (!dataResult) return;
    setIsCopyMenuOpen(false);

    const { columns: targetCols, rows: targetRows } = getSelectedDataMatrix();
    if (targetRows.length === 0 || targetCols.length === 0) return;

    const output = buildSmartCopyOutput(format, targetCols, targetRows, {
      database,
      table: table || "query_result",
      dialect,
    });

    navigator.clipboard.writeText(output).then(() => {
      setSaveStatus({
        success: true,
        message: `Copiado (${format.toUpperCase()}): ${targetRows.length} fila(s), ${targetCols.length} col(s).`,
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
      // Faint cool tint so the grid reads as its own surface in both themes
      bgCell: isLight ? "#f6f8fc" : "#0e131c",
      bgCellMedium: isLight ? "#eef2f8" : "#121824",
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
      cellVerticalPadding: densityMetrics.padY,
      cellHorizontalPadding: 8,
    }),
    [isLight, activeFont, densityMetrics],
  );

  const totalRowsCount = dataResult?.total_rows ?? displayRows.length;
  const isTotalEstimated = Boolean(dataResult?.total_rows_estimated);
  const isTotalUnknown = dataResult?.total_rows === undefined && hasMore;
  const totalRowsLabel = isTotalUnknown
    ? "?"
    : `${isTotalEstimated ? "≈" : ""}${totalRowsCount.toLocaleString()}`;
  const exactCountControl =
    !externalData && table && (isTotalEstimated || isTotalUnknown) ? (
      isCountingRows ? (
        <span className="flex items-center gap-1 text-fg-subtle text-[11px]">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>contando…</span>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => void countExactRows(isServerFilterActive ? serverFilter : null)}
          title="Ejecutar SELECT COUNT(*) para obtener el total exacto (puede tardar en tablas grandes)"
          className="text-[11px] text-fg-muted hover:text-fg underline underline-offset-2"
        >
          contar exacto
        </button>
      )
    ) : null;
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

  const showInspector = Boolean(isInspectorOpen && selectedCell && dataResult);
  const isInspectorDocked = showInspector && isWideLayout;
  // The record panel shares the dock with the inspector, which takes precedence.
  const isRecordPanelDocked = isRecordPanelOpen && isWideLayout && !isInspectorDocked && Boolean(dataResult);
  const isDockOpen = isInspectorDocked || isRecordPanelDocked;

  const inspector = selectedCell && dataResult && (
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
      docked={isInspectorDocked}
    />
  );

  return (
    <div
      className="pyro-data-grid flex flex-col h-full w-full bg-surface relative select-none"
      style={isDockOpen ? { paddingRight: inspectorWidth } : undefined}
      onKeyDown={handleContainerKeyDown}
      tabIndex={0}
    >
      {/* Top Toolbar */}
      <div
      data-grid-toolbar className={`flex items-center justify-between px-3 py-1.5 border-b shrink-0 gap-2 bg-surface border-line`}
      >
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          {/* Refresh button */}
          <button
            onClick={() => loadData(pageOffset, pageSize)}
            disabled={isLoading}
            title="Recargar datos de la tabla"
            className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-accent-text" : ""}`} />
          </button>

          {/* Search Input (Local batch) */}
          <div className="relative flex-1 max-w-[190px] 2xl:max-w-xs" title="Filtrado rápido en el lote de filas cargadas en memoria">
            <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar en lote..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-surface border border-line rounded text-fg placeholder:text-fg-subtle text-xs font-mono focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Visual Filter Button */}
          <button
            type="button"
            onClick={() => setIsFilterBuilderOpen((prev) => !prev)}
            title="Abrir constructor visual de filtros (condiciones múltiples, operadores y ordenación)"
            className={`flex items-center space-x-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all border ${
              isFilterBuilderOpen
                ? "bg-accent/25 text-accent-text border-accent/60 font-semibold shadow-xs"
                : isServerFilterActive
                ? "text-accent-text border-accent/40"
                : "border-transparent text-fg-muted hover:text-fg hover:bg-hover"
            }`}
          >
            <Filter className={`w-3.5 h-3.5 ${isServerFilterActive ? "text-accent-text" : "text-fg-muted"}`} />
            <span>Filtro</span>
            {isServerFilterActive && (
              <span className="px-1.5 py-0.2 rounded-full text-[11px] font-mono font-bold bg-accent text-accent-fg">
                {filterRules.filter((r) => r.enabled).length || 1}
              </span>
            )}
          </button>

          {/* Quick Active Filter Pill */}
          {isServerFilterActive && serverFilter && (
            <div
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono border max-w-[200px] 2xl:max-w-sm truncate bg-accent-soft border-accent/30 text-accent-text`}
              title={`Filtro activo: WHERE ${serverFilter}`}
            >
              <span className="truncate cursor-pointer" onClick={() => setIsFilterBuilderOpen(true)}>
                {serverFilter}
              </span>
              <button
                type="button"
                onClick={handleClearServerFilter}
                className="text-fg-muted hover:text-danger transition-colors"
                title="Quitar filtro"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Create New Record Button */}
          {isEditingAllowed && (
            <button
              onClick={() => setIsNewRecordModalOpen(true)}
              title="Registrar un nuevo registro"
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs text-fg hover:text-fg hover:bg-hover transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-fg-muted" />
              <span>Nuevo</span>
            </button>
          )}

          {/* Smart Multi-Format Copy Dropdown (Only visible when a range of cells, rows, or columns is selected) */}
          {hasSelectionRange && (
            <div className="relative">
              <button
                onClick={() => setIsCopyMenuOpen((prev) => !prev)}
                title="Copiar celdas seleccionadas en múltiples formatos (TSV, SQL, JSON, Markdown, etc.) (Ctrl+Shift+C)"
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded text-fg hover:text-fg hover:bg-hover transition-colors text-xs animate-in fade-in duration-150"
              >
                <Copy className="w-3 h-3" />
                <span>Copiar</span>
                <ChevronDown className="w-3 h-3 text-fg-muted" />
              </button>

              {isCopyMenuOpen && (
                <div
                className={`absolute left-0 mt-1.5 w-52 rounded-xl border shadow-2xl z-50 py-1.5 text-xs animate-in fade-in duration-150 bg-raised border-line`}
                >
                  <div className="px-3 py-1 text-[11px] font-mono text-fg-muted border-b border-line">
                    Exportar Selección ({getSelectedDataMatrix().rows.length} filas)
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSmartCopy("tsv")}
                    className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-hover text-fg transition-colors"
                  >
                    <span>TSV (Excel / Sheets)</span>
                    <span className="text-[11px] text-fg-subtle font-mono">Ctrl+Shift+C</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSmartCopy("comma")}
                    className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-hover text-fg transition-colors"
                  >
                    <span>Valores separados por comas</span>
                    <span className="text-[11px] text-fg-subtle font-mono">'a', 1</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSmartCopy("sql")}
                    className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-hover text-fg transition-colors"
                  >
                    <span>SQL INSERT INTO</span>
                    <span className="text-[11px] text-fg-subtle font-mono">.sql</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSmartCopy("json")}
                    className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-hover text-fg transition-colors"
                  >
                    <span>JSON Array</span>
                    <span className="text-[11px] text-fg-subtle font-mono">[&#123;&#125;]</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSmartCopy("markdown")}
                    className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-hover text-fg transition-colors"
                  >
                    <span>Markdown Table</span>
                    <span className="text-[11px] text-fg-subtle font-mono">|---|</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSmartCopy("php")}
                    className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-hover text-fg transition-colors"
                  >
                    <span>PHP Associative Array</span>
                    <span className="text-[11px] text-fg-subtle font-mono">['=&gt;']</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSmartCopy("ts")}
                    className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-hover text-fg transition-colors"
                  >
                    <span>TypeScript Array</span>
                    <span className="text-[11px] text-fg-subtle font-mono">Record&lt;&gt;</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Extra toolbar actions */}
          {extraToolbarActions}

          {isWideLayout && dataResult && (
            <button
              onClick={() => setIsRecordPanelOpen((v) => !v)}
              className={`${iconBtn} ${isRecordPanelOpen ? "text-accent-text" : ""}`}
              title={isRecordPanelOpen ? "Ocultar detalle del registro" : "Mostrar detalle del registro junto al grid"}
            >
              <PanelRight className="w-3.5 h-3.5" />
            </button>
          )}

          {dataResult && (
            <div className="hidden sm:flex items-center space-x-2 text-fg-muted font-mono text-[11px]">
              <span>{dataResult.execution_time_ms} ms</span>
              <span>•</span>
              <span>
                {displayRows.length} de {totalRowsLabel} filas
              </span>
              {searchTerm && (
                <span className="text-warning/80">· lote filtrado</span>
              )}
              {isServerFilterActive && (
                <span className="text-accent-text/80">· filtro activo</span>
              )}
              {freezeColumnsCount > 0 && (
                <span className="flex items-center gap-1">
                  · <Pin className="w-2.5 h-2.5" /> {freezeColumnsCount}
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
              saveStatus.success ? "bg-surface border-line text-fg" : "bg-surface border-line text-danger"
            }`}
          >
            {saveStatus.success ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" />
            )}
            <span className="truncate max-w-md">{saveStatus.message}</span>
            {!saveStatus.success && (
              <span className="text-[11px] underline ml-1 text-danger opacity-80 shrink-0">
                Ver detalle
              </span>
            )}
          </div>
        )}

        {/* Pagination controls or Continuous scroll info or External row count */}
        {!externalData ? (
          infiniteScroll ? (
            <div className="flex items-center space-x-2 font-mono text-xs">
              <span className="text-fg-muted px-1.5 whitespace-nowrap">
                Cargadas {displayRows.length.toLocaleString()} de {totalRowsLabel} filas
              </span>
              {exactCountControl}
              {isLoadingMore && (
                <span className="flex items-center text-accent-text gap-1 text-[11px]">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Cargando más filas...</span>
                </span>
              )}
              {!hasMore && displayRows.length > 0 && !isLoadingMore && (
                <span className="text-fg-subtle text-[11px] hidden sm:inline">
                  · Todas cargadas
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setInfiniteScroll(false);
                  setPageOffset(0);
                  loadData(
                    0,
                    pageSize,
                    sortColumn,
                    sortDirection,
                    isServerFilterActive ? serverFilter : null,
                    false,
                  );
                }}
                title="Cambiar a paginación tradicional por páginas"
                className="px-2 py-0.5 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover border border-line transition-colors ml-1"
              >
                Páginas
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5">
              <select
                value={pageSize}
                onChange={(e) => {
                  const newSize = parseInt(e.target.value, 10);
                  setPageSize(newSize);
                  setPageOffset(0);
                  setSelectedRowIndex(null);
                  loadData(
                    0,
                    newSize,
                    sortColumn,
                    sortDirection,
                    isServerFilterActive ? serverFilter : null,
                    false,
                  );
                }}
                title="Filas por página"
                className="px-1.5 py-1 bg-transparent rounded text-fg-muted hover:bg-hover font-mono text-xs focus:outline-none"
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
                  loadData(
                    0,
                    pageSize,
                    sortColumn,
                    sortDirection,
                    isServerFilterActive ? serverFilter : null,
                    false,
                  );
                }}
                disabled={pageOffset === 0 || isLoading}
                title="Primera página"
                className="p-1 rounded text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>

              {/* Prev page button */}
              <button
                onClick={() => {
                  const next = Math.max(0, pageOffset - pageSize);
                  setPageOffset(next);
                  setSelectedRowIndex(null);
                  loadData(
                    next,
                    pageSize,
                    sortColumn,
                    sortDirection,
                    isServerFilterActive ? serverFilter : null,
                    false,
                  );
                }}
                disabled={pageOffset === 0 || isLoading}
                title="Página anterior"
                className="p-1 rounded text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="text-fg-muted font-mono text-xs px-2 whitespace-nowrap">
                {currentStart}-{currentEnd} de {totalRowsCount.toLocaleString()} ({currentPage}/{totalPages})
              </span>

              {/* Next page button */}
              <button
                onClick={() => {
                  const next = pageOffset + pageSize;
                  setPageOffset(next);
                  setSelectedRowIndex(null);
                  loadData(
                    next,
                    pageSize,
                    sortColumn,
                    sortDirection,
                    isServerFilterActive ? serverFilter : null,
                    false,
                  );
                }}
                disabled={pageOffset + pageSize >= totalRowsCount || isLoading}
                title="Página siguiente"
                className="p-1 rounded text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* Last page button */}
              <button
                onClick={() => {
                  setPageOffset(lastPageOffset);
                  setSelectedRowIndex(null);
                  loadData(
                    lastPageOffset,
                    pageSize,
                    sortColumn,
                    sortDirection,
                    isServerFilterActive ? serverFilter : null,
                    false,
                  );
                }}
                disabled={pageOffset >= lastPageOffset || isLoading}
                title="Última página"
                className="p-1 rounded text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setInfiniteScroll(true);
                  setPageOffset(0);
                  loadData(
                    0,
                    500,
                    sortColumn,
                    sortDirection,
                    isServerFilterActive ? serverFilter : null,
                    true,
                  );
                }}
                title="Activar desplazamiento continuo con scroll infinito"
                className="px-2 py-0.5 rounded text-[11px] text-fg-muted hover:text-fg hover:bg-hover border border-line transition-colors ml-1"
              >
                Scroll Continuo
              </button>
            </div>
          )
        ) : (
          <div className="flex items-center space-x-2 text-fg-muted font-mono text-xs px-2">
            <span>{displayRows.length} fila(s) cargada(s)</span>
          </div>
        )}
      </div>

      {/* Visual Filter Builder Panel */}
      {isFilterBuilderOpen && (
        <VisualFilterBuilder
          columns={dataResult?.columns ?? []}
          rules={filterRules}
          onChangeRules={setFilterRules}
          sortRules={sortRules}
          onChangeSortRules={setSortRules}
          onApply={(whereSql, sortSql) => {
            setServerFilter(whereSql);
            setIsServerFilterActive(Boolean(whereSql));
            setPageOffset(0);
            setSelectedRowIndex(null);
            setSelectedCell(null);
            if (!externalData) {
              loadData(
                0,
                infiniteScroll ? 500 : pageSize,
                sortSql || sortColumn,
                sortSql ? null : sortDirection,
                whereSql || null,
                true,
              );
            }
          }}
          onReset={() => {
            handleClearServerFilter();
          }}
          onClose={() => setIsFilterBuilderOpen(false)}
        />
      )}

      {/* No Primary Key Notice Banner (only shown if a table is selected) */}
      {!hasPrimaryKey && Boolean(table) && !isLoading && dataResult && (
        <div className="px-4 py-1.5 bg-raised border-b border-line text-xs flex items-center justify-between gap-3 shrink-0 animate-in fade-in duration-150">
          <div className="flex items-center space-x-2 min-w-0">
            <AlertTriangle
              className={`w-3.5 h-3.5 shrink-0 ${
                noPrimaryKeyMode === "use_all_columns" ? "text-warning" : "text-danger"
              }`}
            />
            <span className="text-fg text-[11px] truncate">
              <strong
                className={
                  noPrimaryKeyMode === "use_all_columns"
                    ? "text-warning font-semibold"
                    : "text-danger font-semibold"
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
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded text-[11px] text-fg hover:text-fg bg-raised hover:bg-hover border border-line-strong transition-colors shrink-0 font-medium"
          >
            <Settings className="w-3 h-3 text-fg-muted" />
            <span>Configurar</span>
          </button>
        </div>
      )}

      {/* Canvas Data Grid Container */}
      <div className={`flex-1 min-h-0 w-full relative overflow-hidden bg-surface`}>
        {isLoading && !dataResult && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-fg-muted" />
            <span className="text-xs text-fg font-mono">
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
            onVisibleRegionChanged={handleVisibleRegionChanged}
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
            rowHeight={densityMetrics.row}
            headerHeight={densityMetrics.header}
            rowMarkers="both"
            smoothScrollX
            smoothScrollY
            getCellsForSelection
            verticalBorder
            fillHandle
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-fg-subtle text-xs">
            <Database className="w-8 h-8 mb-2 opacity-40 text-fg-muted" />
            <span>Sin datos para mostrar en esta tabla.</span>
          </div>
        )}

        {/* Empty Result Set Overlay */}
        {!isLoading && columns.length > 0 && displayRows.length === 0 && (
          <div className="absolute inset-x-0 top-[37px] bottom-0 z-10 flex items-center justify-center p-6 pointer-events-none select-none">
            <div
            className={`max-w-md w-full rounded-xl border p-6 flex flex-col items-center text-center shadow-pop pointer-events-auto transition-all animate-in fade-in zoom-in-95 duration-150 bg-raised border-line text-fg`}
            >
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 border bg-raised border-line text-fg-muted`}
              >
                <Database className="w-6 h-6" />
              </div>

              <h3 className={`text-sm font-bold font-sans text-fg`}>
                {searchTerm ? "Sin Resultados Coincidentes" : "0 Registros Devueltos"}
              </h3>

              <p className={`text-xs mt-1.5 max-w-xs leading-relaxed text-fg-muted`}>
                {searchTerm
                  ? `Ningún registro coincide con el filtro "${searchTerm}".`
                  : externalData
                  ? "La consulta se ejecutó exitosamente en MariaDB, pero no produjo filas coincidentes."
                  : "Esta tabla se encuentra vacía o no contiene registros en la página seleccionada."}
              </p>

              {/* Status & Timing Metadata Badges */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono border bg-elevated border-line-strong text-fg`}
                >
                  {columns.length} columna{columns.length !== 1 ? "s" : ""}
                </span>

                {externalData && externalData.execution_time_ms !== undefined && (
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono border border-line text-fg-muted`}
                  >
                    ⚡ {externalData.execution_time_ms} ms
                  </span>
                )}
              </div>

              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="mt-4 px-3 py-1 rounded-lg text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg transition-colors cursor-pointer"
                >
                  Limpiar filtro de búsqueda
                </button>
              )}
            </div>
          </div>
        )}

        {stagedChangeCount === 0 && (dataResult?.rows?.length ?? 0) > 0 && (
          <FirstTimeHint id="grid" className="absolute bottom-4 right-4 z-20 max-w-xs">
            Doble clic en una celda para editarla. Los cambios quedan pendientes hasta que pulses «Aplicar». Clic
            derecho para copiar, borrar filas o navegar por claves foráneas.
          </FirstTimeHint>
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
      {isInspectorDocked ? (
        <RightDock width={inspectorWidth} onResize={setInspectorWidth}>
          {inspector}
        </RightDock>
      ) : (
        inspector
      )}

      {/* Record detail (master-detail) panel */}
      {isRecordPanelDocked && dataResult && (
        <RightDock width={inspectorWidth} onResize={setInspectorWidth}>
          <RecordDetailPanel
            columns={dataResult.columns}
            columnTypes={dataResult.column_types}
            row={selectedRowIndex !== null ? displayRows[selectedRowIndex] ?? null : null}
            rowNumber={selectedRowIndex}
            onClose={() => setIsRecordPanelOpen(false)}
            onEdit={isEditingAllowed ? () => setIsEditModalOpen(true) : undefined}
            onInspect={(rawCol) => {
              if (selectedRowIndex === null) return;
              const visualCol = effectiveColumnNames.findIndex((_, i) => getRawColIndex(i) === rawCol);
              if (visualCol === -1) return;
              setSelectedCell({ col: visualCol, row: selectedRowIndex });
              setIsInspectorOpen(true);
            }}
          />
        </RightDock>
      )}

      {/* Preview Staged SQL Modal */}
      <PreviewStagedSqlModal
        isOpen={isPreviewSqlOpen}
        onClose={() => setIsPreviewSqlOpen(false)}
        onApply={handleApplyStagedChanges}
        sqlStatements={generateSqlForTable(database, table, dialect)}
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
          columnTypes={dataResult.column_types}
          rowData={displayRows[selectedRowIndex]}
          rowIndex={selectedRowIndex}
          onSave={handleSaveRow}
        />
      )}

      {/* Create New Record Modal */}
      {isNewRecordModalOpen && dataResult && (
        <EditRecordModal
          isOpen={isNewRecordModalOpen}
          onClose={() => setIsNewRecordModalOpen(false)}
          database={database}
          tableName={table}
          pkColumns={activePkColumns}
          columns={dataResult.columns}
          columnTypes={dataResult.column_types}
          isNewRecord={true}
          onSave={handleCreateRecord}
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
      {cellContextMenu && (
        <GridCellContextMenu
          cellContextMenu={cellContextMenu}
          setCellContextMenu={setCellContextMenu}
          getSelectedCells={getSelectedCells}
          dataResult={dataResult}
          handleSetCellNull={handleSetCellNull}
          isEditingAllowed={isEditingAllowed}
          setIsFillModalOpen={setIsFillModalOpen}
          setIsInspectorOpen={setIsInspectorOpen}
          effectiveColumnNames={effectiveColumnNames}
          fkByColumn={fkByColumn}
          referencingConstraints={referencingConstraints}
          getRowValueByName={getRowValueByName}
          handleForeignKeyJump={handleForeignKeyJump}
          handleReferencingJump={handleReferencingJump}
          getSelectedDataMatrix={getSelectedDataMatrix}
          setSaveStatus={setSaveStatus}
          getRawColIndex={getRawColIndex}
          displayRows={displayRows}
          isCopySubmenuOpen={isCopySubmenuOpen}
          setIsCopySubmenuOpen={setIsCopySubmenuOpen}
          handleSmartCopy={handleSmartCopy}
          handleSelectColumn={handleSelectColumn}
          setIsNewRecordModalOpen={setIsNewRecordModalOpen}
          setIsEditModalOpen={setIsEditModalOpen}
          getSelectedRowIndices={getSelectedRowIndices}
          handleStageDeleteRow={handleStageDeleteRow}
        />
      )}

      {/* Header Context / Column Menu Dropdown */}
      {headerMenu && (
        <GridHeaderMenu
          headerMenu={headerMenu}
          setHeaderMenu={setHeaderMenu}
          handleSelectColumn={handleSelectColumn}
          handleSortFromMenu={handleSortFromMenu}
          sortColumn={sortColumn}
          handleAutoSizeColumn={handleAutoSizeColumn}
          customWidths={customWidths}
          handleResetColumnWidths={handleResetColumnWidths}
          handleToggleFreezeColumn={handleToggleFreezeColumn}
          freezeColumnsCount={freezeColumnsCount}
          handleCopyColumnName={handleCopyColumnName}
          externalData={externalData}
          handleFilterByColumn={handleFilterByColumn}
        />
      )}
    </div>
  );
};
