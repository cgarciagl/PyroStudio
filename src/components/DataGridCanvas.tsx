import React, { useCallback, useContext, useMemo, useState, useEffect, useRef } from "react";
import { FirstTimeHint } from "./ui/FirstTimeHint";
import DataEditor, {
  GridCell,
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
  PanelRight,
  RotateCcw,
  Plus,
  CheckSquare,
  ArrowUpRight,
  CornerDownRight,
} from "lucide-react";
import type {
  TableDataResult,
  QueryExecutionResult,
  PrimaryKeyCondition,
  ErRelation,
  ForeignKeyMetadata,
} from "../types/database";
import { dbService } from "../services/tauriDb";
import { useUIStore } from "../stores/uiStore";
import { TabIdContext, usePendingChangesStore } from "../stores/pendingChangesStore";
import { useConnectionStore } from "../stores/connectionStore";
import { GRID_DENSITY_METRICS, usePreferenceStore } from "../stores/preferenceStore";
import {
  useStagedChangesStore,
  type StagedCellUpdate,
  type StagedRowDelete,
  areValuesEqual,
} from "../stores/stagedChangesStore";
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
  parseClipboardMatrix,
  standardizeNumericString,
  type PasteValidationResult,
} from "../utils/pasteParser";
import {
  exportToTsv,
  exportToCommaSeparated,
  exportToSqlInsert,
  exportToJsonArray,
  exportToMarkdownTable,
  exportToPhpArray,
  exportToTsArray,
  formatCellForSql,
} from "../utils/formatCopy";

import type { StagedChange } from "../stores/stagedChangesStore";
import { qualifiedTable, useSqlLiteralRules } from "../services/sqlLiterals";
import {
  VisualFilterBuilder,
  type FilterRule,
  type SortRule,
  evaluateFilterRuleClient,
} from "./VisualFilterBuilder";

export interface TableGridLayout {
  columnOrder?: string[];
  customWidths?: Record<string, number>;
  freezeColumns?: number;
}

export const getStoredLayout = (db: string, tbl?: string): TableGridLayout => {
  try {
    const key = tbl ? `pyro_grid_layout_${db}_${tbl}` : `pyro_grid_layout_${db}_query_results`;
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return {};
};

export const saveStoredLayout = (db: string, tbl: string | undefined, layout: TableGridLayout) => {
  try {
    const key = tbl ? `pyro_grid_layout_${db}_${tbl}` : `pyro_grid_layout_${db}_query_results`;
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // ignore
  }
};

const EMPTY_STAGED_CHANGES: StagedChange[] = [];

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
  const { defaultPageSize, noPrimaryKeyMode, theme, fontFamily, gridDensity } = usePreferenceStore();
  const densityMetrics = GRID_DENSITY_METRICS[gridDensity];

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
  const [serverFilter, setServerFilter] = useState<string>(initialServerFilter ?? "");
  const [isServerFilterActive, setIsServerFilterActive] = useState<boolean>(
    Boolean(initialServerFilter),
  );
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

  // Staged changes store subscription for this table with stable fallback reference
  const tableKey = table ? `${database}.${table}` : "";
  const stagedChanges = useStagedChangesStore(
    (s) => (tableKey ? s.changesByTable[tableKey] ?? EMPTY_STAGED_CHANGES : EMPTY_STAGED_CHANGES),
  );
  const {
    stageCellUpdate,
    stageBatchCellUpdates,
    stageBatchRowDeletes,
    clearTableChanges,
    generateSqlForTable,
  } = useStagedChangesStore();
  const dialect = useSqlLiteralRules();

  const stagedChangeCount = stagedChanges.length;

  // Tell the tab bar how many staged edits this tab would lose if closed.
  const tabId = useContext(TabIdContext);
  useEffect(() => {
    if (tabId && table) {
      usePendingChangesStore.getState().setStaged(tabId, { count: stagedChangeCount, database, table });
    }
  }, [tabId, database, table, stagedChangeCount]);
  useEffect(() => {
    if (!tabId) return;
    return () => usePendingChangesStore.getState().clear(tabId);
  }, [tabId]);

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
    if (!database || !table) {
      setForeignKeys([]);
      return;
    }
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

  // Foreign keys elsewhere that point at this table ("rows referencing this one")
  const [referencingFks, setReferencingFks] = useState<ErRelation[]>([]);
  useEffect(() => {
    if (!database || !table) {
      setReferencingFks([]);
      return;
    }
    let isMounted = true;
    dbService
      .getReferencingForeignKeys(database, table)
      .then((relations) => {
        if (isMounted) setReferencingFks(relations);
      })
      .catch((err) => {
        console.warn("Could not retrieve referencing foreign keys:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [database, table]);

  /** One entry per constraint (composite keys span several column rows). */
  const referencingConstraints = useMemo(() => {
    const groups = new Map<string, ErRelation[]>();
    for (const r of referencingFks) {
      const key = `${r.table}\u0000${r.foreign_key.name}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.values()];
  }, [referencingFks]);

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
    if (primaryKeyColumns !== undefined) {
      setFetchedPkColumns(primaryKeyColumns);
      return;
    }
    if (primaryKeyColumn) {
      setFetchedPkColumns([primaryKeyColumn]);
      return;
    }
    if (!database || !table) {
      setFetchedPkColumns([]);
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
  // Read-only connections are enforced by the backend; the grid mirrors it.
  const connectionReadOnly = useConnectionStore((s) =>
    Boolean(s.connectionStatus.config?.read_only),
  );
  const isEditingAllowed =
    !isReadonly &&
    !connectionReadOnly &&
    (Boolean(table) && (hasPrimaryKey || noPrimaryKeyMode === "use_all_columns"));

  const loadData = useCallback(
    async (
      offset: number,
      limit: number,
      orderBy: string | null = sortColumn,
      orderDir: "ASC" | "DESC" | null = sortDirection,
      filterSql: string | null = isServerFilterActive ? serverFilter : null,
    ) => {
      if (externalData) {
        onRefresh?.();
        return;
      }
      if (!table) return;
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
    [externalData, onRefresh, database, table, sortColumn, sortDirection, isServerFilterActive, serverFilter],
  );

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
          pageSize,
          nextDir ? colName : null,
          nextDir,
          isServerFilterActive ? serverFilter : null,
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
      loadData,
    ],
  );

  const handleSortFromMenu = useCallback(
    (colName: string, dir: "ASC" | "DESC" | null) => {
      setSortColumn(dir ? colName : null);
      setSortDirection(dir);
      setPageOffset(0);
      if (!externalData) {
        loadData(0, pageSize, dir ? colName : null, dir, isServerFilterActive ? serverFilter : null);
      }
      setHeaderMenu(null);
    },
    [externalData, pageSize, isServerFilterActive, serverFilter, loadData],
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
      loadData(0, pageSize, null, null, null);
    }
  }, [database, table, pageSize, externalData]);

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

  // Client-side sorting for external data
  const sortedRows = useMemo(() => {
    if (!dataResult) return [];
    if (!externalData) return dataResult.rows;
    if (!sortColumn || !sortDirection) return dataResult.rows;

    const rawIdx = dataResult.columns.indexOf(sortColumn);
    if (rawIdx === -1) return dataResult.rows;

    return [...dataResult.rows].sort((a, b) => {
      const valA = a[rawIdx];
      const valB = b[rawIdx];
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      let cmp = 0;
      if (typeof valA === "number" && typeof valB === "number") {
        cmp = valA - valB;
      } else {
        cmp = String(valA).localeCompare(String(valB), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }
      return sortDirection === "ASC" ? cmp : -cmp;
    });
  }, [dataResult, externalData, sortColumn, sortDirection]);

  // Filtered rows for client-side search in current batch and externalData filter rules
  const displayRows = useMemo(() => {
    if (!dataResult) return [];
    let baseRows = sortedRows;

    // In externalData mode (query results), evaluate visual filter rules in memory
    if (externalData && isServerFilterActive && filterRules.length > 0) {
      const activeRules = filterRules.filter((r) => r.enabled && r.column.trim());
      if (activeRules.length > 0 && dataResult.columns) {
        baseRows = baseRows.filter((row) => {
          return activeRules.every((rule) => {
            const colIdx = dataResult.columns.indexOf(rule.column);
            if (colIdx === -1) return true;
            return evaluateFilterRuleClient(row[colIdx], rule);
          });
        });
      }
    }

    if (!searchTerm.trim()) return baseRows;

    const term = searchTerm.toLowerCase();
    return baseRows.filter((row) =>
      row.some((val) =>
        val !== null && val !== undefined
          ? String(val).toLowerCase().includes(term)
          : false,
      ),
    );
  }, [dataResult, sortedRows, searchTerm, externalData, isServerFilterActive, filterRules]);

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
          colType.includes("DOUBLE") ||
          colType.includes("NUMERIC") ||
          colType.includes("REAL") ||
          typeof originalVal === "number");
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

      if (isNumeric && !isRowDeleted) {
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
        let strVal = typeof value === "string" ? value.trim() : String(value);
        if (/^-?\d+,\d+$/.test(strVal)) {
          strVal = strVal.replace(",", ".");
        } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(strVal)) {
          strVal = strVal.replace(/,/g, "");
        } else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(strVal)) {
          strVal = strVal.replace(/\./g, "").replace(",", ".");
        }

        const numVal = Number(strVal);
        if (!isNaN(numVal)) {
          return {
            kind: GridCellKind.Number,
            data: numVal,
            displayData: strVal,
            thousandSeparator: false,
            decimalSeparator: ".",
            allowNegative: true,
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
    async ([col, row]: Item, newValue: EditableGridCell) => {
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

      const colType = (rawColIdx !== -1 ? dataResult?.column_types?.[rawColIdx] : "")?.toUpperCase() || "";
      const isColNumeric =
        colType.includes("INT") ||
        colType.includes("DECIMAL") ||
        colType.includes("FLOAT") ||
        colType.includes("DOUBLE") ||
        colType.includes("NUMERIC") ||
        colType.includes("REAL") ||
        typeof rowData[rawColIdx] === "number";

      if (isColNumeric && typeof payloadValue === "string") {
        const trimmed = payloadValue.trim();
        if (trimmed !== "") {
          if (/^-?\d+,\d+$/.test(trimmed)) {
            payloadValue = trimmed.replace(",", ".");
          } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) {
            payloadValue = trimmed.replace(/,/g, "");
          } else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)) {
            payloadValue = trimmed.replace(/\./g, "").replace(",", ".");
          }
        }
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

  // Returns all cells currently selected (single cell, rectangle range, multi-range, selected columns, or selected rows)
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

    if (gridSelection?.columns && gridSelection.columns.length > 0) {
      for (const c of gridSelection.columns.toArray()) {
        for (let r = 0; r < displayRows.length; r++) {
          addCell(c, r);
        }
      }
    }

    if (gridSelection?.rows && gridSelection.rows.length > 0 && dataResult) {
      for (const r of gridSelection.rows.toArray()) {
        for (let c = 0; c < effectiveColumnNames.length; c++) {
          addCell(c, r);
        }
      }
    }

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

    if (result.length > 0) return result;

    if (selectedCell) {
      return [[selectedCell.col, selectedCell.row]];
    }
    return [];
  }, [gridSelection, dataResult, displayRows.length, effectiveColumnNames.length, selectedCell]);

  // Extracts rectangular data matrix for active selection (single cell, range, columns, or rows)
  const getSelectedDataMatrix = useCallback((): { columns: string[]; rows: any[][] } => {
    if (!dataResult) return { columns: [], rows: [] };

    // 1. Column selection: full columns
    if (gridSelection?.columns && gridSelection.columns.length > 0) {
      const selectedColIndices = gridSelection.columns.toArray();
      const cols = selectedColIndices.map((ci) => effectiveColumnNames[ci] || dataResult.columns[ci]);
      const rows = displayRows.map((r) =>
        selectedColIndices.map((ci) => {
          const rawIdx = getRawColIndex(ci);
          return rawIdx !== -1 ? r[rawIdx] : null;
        }),
      );
      return { columns: cols, rows };
    }

    // 2. Row selection: full rows
    if (gridSelection?.rows && gridSelection.rows.length > 0) {
      const selectedRowIndices = gridSelection.rows.toArray();
      const cols = effectiveColumnNames;
      const rows = selectedRowIndices
        .filter((ri) => ri >= 0 && ri < displayRows.length)
        .map((ri) => {
          const r = displayRows[ri];
          return cols.map((colName) => {
            const rawIdx = dataResult.columns.indexOf(colName);
            return rawIdx !== -1 ? r[rawIdx] : null;
          });
        });
      return { columns: cols, rows };
    }

    // 3. Rectangular cell range selection
    if (gridSelection?.current?.range) {
      const { x, y, width, height } = gridSelection.current.range;
      if (width > 0 && height > 0) {
        const selectedColNames = effectiveColumnNames.slice(x, x + width);
        const rows: any[][] = [];
        const endRow = Math.min(y + height, displayRows.length);
        for (let r = y; r < endRow; r++) {
          const rowData = displayRows[r];
          if (!rowData) continue;
          const rowVals: any[] = [];
          for (let c = x; c < x + width; c++) {
            const rawIdx = getRawColIndex(c);
            rowVals.push(rawIdx !== -1 ? rowData[rawIdx] : null);
          }
          rows.push(rowVals);
        }
        return { columns: selectedColNames, rows };
      }
    }

    // 4. Single selected cell
    if (selectedCell) {
      const rawIdx = getRawColIndex(selectedCell.col);
      const colName = effectiveColumnNames[selectedCell.col] || dataResult.columns[rawIdx] || "";
      const rowData = displayRows[selectedCell.row];
      const val = rowData && rawIdx !== -1 ? rowData[rawIdx] : null;
      return { columns: [colName], rows: [[val]] };
    }

    // 5. Fallback single row index
    if (selectedRowIndex !== null && displayRows[selectedRowIndex]) {
      const rowData = displayRows[selectedRowIndex];
      const cols = effectiveColumnNames;
      const rowVals = cols.map((colName) => {
        const rawIdx = dataResult.columns.indexOf(colName);
        return rawIdx !== -1 ? rowData[rawIdx] : null;
      });
      return { columns: cols, rows: [rowVals] };
    }

    return { columns: [], rows: [] };
  }, [
    dataResult,
    gridSelection,
    effectiveColumnNames,
    displayRows,
    getRawColIndex,
    selectedCell,
    selectedRowIndex,
  ]);

  // True if a multi-cell range, row selection, or column selection is active
  const hasSelectionRange = useMemo(() => {
    if (!gridSelection) return false;
    if (gridSelection.rows && gridSelection.rows.length > 0) return true;
    if (gridSelection.columns && gridSelection.columns.length > 0) return true;
    if (gridSelection.current?.range) {
      const { width, height } = gridSelection.current.range;
      if (width > 1 || height > 1) return true;
      if (gridSelection.current.rangeStack && gridSelection.current.rangeStack.length > 0) return true;
    }
    return false;
  }, [gridSelection]);

  // Set value (or NULL) across all currently selected cells in the range
  const handleApplyValueToSelection = useCallback(
    async (newVal: any, customCells?: Item[]) => {
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

        let cellPayloadValue = payloadValue;
        const colType = (rawColIdx !== -1 ? dataResult?.column_types?.[rawColIdx] : "")?.toUpperCase() || "";
        const isColNumeric =
          colType.includes("INT") ||
          colType.includes("DECIMAL") ||
          colType.includes("FLOAT") ||
          colType.includes("DOUBLE") ||
          colType.includes("NUMERIC") ||
          colType.includes("REAL") ||
          typeof rowData[rawColIdx] === "number";

        if (isColNumeric && typeof cellPayloadValue === "string") {
          cellPayloadValue = standardizeNumericString(cellPayloadValue);
        }

        stageCellUpdate({
          database,
          table,
          rowIndex: row,
          colIndex: rawColIdx,
          columnName: colName,
          originalValue: originalVal,
          stagedValue: cellPayloadValue,
          primaryKeys,
        });

        const rowIndexInData = dataResult.rows.indexOf(rowData);
        if (rowIndexInData !== -1 && rawColIdx !== -1) {
          newRows[rowIndexInData] = [...newRows[rowIndexInData]];
          newRows[rowIndexInData][rawColIdx] = cellPayloadValue;
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
        const lowerCols = dataResult.columns.map((c) => c.toLowerCase());
        const changesToStage: Omit<StagedRowDelete, "type">[] = [];

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

          changesToStage.push({
            database,
            table,
            rowIndex,
            originalRow: rowData,
            primaryKeys,
          });
        }

        if (changesToStage.length > 0) {
          stageBatchRowDeletes(changesToStage);
          setSaveStatus({
            success: true,
            message: `${changesToStage.length} fila(s) marcadas para borrado en cola.`,
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
      stageBatchRowDeletes,
      getSelectedCells,
      handleApplyValueToSelection,
    ],
  );

  // Right-click context menu on grid cells
  const handleCellContextMenu = useCallback(
    ([col, row]: Item, event: any) => {
      event.preventDefault();
      if (col < 0 || row < 0) return;

      // If the right-clicked cell is NOT inside the current multi-cell selection range or selected column/row, update selection to this single cell
      const currentRange = gridSelection?.current?.range;
      const isInsideCurrentRange =
        currentRange &&
        col >= currentRange.x &&
        col < currentRange.x + currentRange.width &&
        row >= currentRange.y &&
        row < currentRange.y + currentRange.height;

      const isColSelected = Boolean(gridSelection?.columns?.hasIndex(col));
      const isRowSelected = Boolean(gridSelection?.rows?.hasIndex(row));

      if (!isInsideCurrentRange && !isColSelected && !isRowSelected) {
        setSelectedCell({ col, row });
        setSelectedRowIndex(row);
        setGridSelection({
          current: {
            cell: [col, row],
            range: { x: col, y: row, width: 1, height: 1 },
            rangeStack: [],
          },
          columns: CompactSelection.empty(),
          rows: CompactSelection.empty(),
        });
      }

      const clientX = lastMousePosRef.current.x;
      const clientY = lastMousePosRef.current.y;

      const menuWidth = 260;
      const menuHeight = 320;
      const x = Math.min(clientX, window.innerWidth - menuWidth - 10);
      const y = Math.min(clientY, window.innerHeight - menuHeight - 10);

      setIsCopySubmenuOpen(false);
      setCellContextMenu({
        x: Math.max(10, x),
        y: Math.max(10, y),
        col,
        row,
      });
    },
    [gridSelection],
  );

  // Resolves the list of row indices targeted by an action (from row selection, cell range, or single context row)
  const getSelectedRowIndices = useCallback(
    (contextRow?: number | null): number[] => {
      const target = contextRow !== undefined ? contextRow : selectedRowIndex;

      // 1. Explicit row selection via checkboxes or row headers
      if (gridSelection?.rows && gridSelection.rows.length > 0) {
        const rowArray = gridSelection.rows.toArray();
        if (target === null || target === undefined || gridSelection.rows.hasIndex(target)) {
          return Array.from(new Set(rowArray)).filter(
            (r) => r >= 0 && r < displayRows.length,
          );
        }
        return [target].filter((r) => r >= 0 && r < displayRows.length);
      }

      // 2. Rectangular selection spanning rows
      if (gridSelection?.current?.range) {
        const allRanges = [
          gridSelection.current.range,
          ...(gridSelection.current.rangeStack || []),
        ];
        const isTargetInsideAnyRange =
          target !== null &&
          target !== undefined &&
          allRanges.some(
            (rng) => target >= rng.y && target < rng.y + rng.height,
          );

        if (target === null || target === undefined || isTargetInsideAnyRange) {
          const rowSet = new Set<number>();
          for (const rng of allRanges) {
            for (let r = rng.y; r < rng.y + rng.height; r++) {
              if (r >= 0 && r < displayRows.length) {
                rowSet.add(r);
              }
            }
          }
          if (rowSet.size > 0) {
            return Array.from(rowSet);
          }
        }
      }

      // 3. Fallback to target row
      if (
        target !== null &&
        target !== undefined &&
        target >= 0 &&
        target < displayRows.length
      ) {
        return [target];
      }

      return [];
    },
    [gridSelection, selectedRowIndex, displayRows.length],
  );

  // Stage Row Deletion for all selected rows instead of deleting immediately
  const handleStageDeleteRow = (contextRow?: number | null) => {
    if (!dataResult) return;

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

    const rowIndices = getSelectedRowIndices(contextRow);
    if (rowIndices.length === 0) return;

    const lowerCols = dataResult.columns.map((c) => c.toLowerCase());

    if (hasPrimaryKey) {
      for (const pkCol of activePkColumns) {
        const pkIdx = lowerCols.indexOf(pkCol.toLowerCase());
        if (pkIdx === -1) {
          useUIStore.getState().showAlert({
            title: "Columna Faltante",
            message: `La columna de clave primaria '${pkCol}' no está presente en los resultados.`,
            variant: "danger",
            icon: "alert",
          });
          return;
        }
      }
    }

    const changesToStage: Omit<StagedRowDelete, "type">[] = [];

    for (const rIdx of rowIndices) {
      const currentRow = displayRows[rIdx];
      if (!currentRow) continue;

      const primaryKeys: PrimaryKeyCondition[] = [];
      if (hasPrimaryKey) {
        for (const pkCol of activePkColumns) {
          const pkIdx = lowerCols.indexOf(pkCol.toLowerCase());
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

      changesToStage.push({
        database,
        table,
        rowIndex: rIdx,
        originalRow: currentRow,
        primaryKeys,
      });
    }

    if (changesToStage.length > 0) {
      stageBatchRowDeletes(changesToStage);

      setSaveStatus({
        success: true,
        message:
          changesToStage.length === 1
            ? `Fila #${rowIndices[0] + 1} marcada para eliminación en cambios pendientes.`
            : `${changesToStage.length} filas marcadas para eliminación en cambios pendientes.`,
      });
      setTimeout(() => setSaveStatus(null), 3000);
    }
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

  // Create new record
  const handleCreateRecord = async (newRowValues: any[]) => {
    if (!database || !table) {
      throw new Error("No se ha especificado la tabla destino para insertar el registro.");
    }

    const rawCols = dataResult?.columns || [];
    const colsToInsert: string[] = [];
    const valsToInsert: string[] = [];

    for (let i = 0; i < rawCols.length; i++) {
      const colName = rawCols[i];
      let val = newRowValues[i];

      const isPk = activePkColumns.includes(colName);
      if (isPk && (val === null || val === undefined || val === "")) {
        continue;
      }

      const colType = (dataResult?.column_types?.[i] || "").toUpperCase();
      const isColNumeric =
        colType.includes("INT") ||
        colType.includes("DECIMAL") ||
        colType.includes("FLOAT") ||
        colType.includes("DOUBLE") ||
        colType.includes("NUMERIC") ||
        colType.includes("REAL");
      if (isColNumeric && typeof val === "string") {
        val = standardizeNumericString(val);
      }

      colsToInsert.push(dialect.quoteIdentifier(colName));
      valsToInsert.push(formatCellForSql(val, dialect));
    }

    if (colsToInsert.length === 0) {
      throw new Error("No se proporcionó ningún valor para insertar.");
    }

    const insertSql = `INSERT INTO ${qualifiedTable(dialect, database, table)} (${colsToInsert.join(", ")}) VALUES (${valsToInsert.join(", ")});`;

    try {
      await dbService.executeConfirmedQuery(insertSql, database);
      setSaveStatus({
        success: true,
        message: `Registro insertado exitosamente en \`${table}\`.`,
      });
      setTimeout(() => setSaveStatus(null), 3500);
      setIsNewRecordModalOpen(false);

      if (onRefresh) {
        onRefresh();
      } else {
        await loadData(pageOffset, pageSize);
      }
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al insertar registro";
      throw new Error(msg);
    }
  };

  // Apply all staged changes transaccationally to MariaDB/MySQL
  const handleApplyStagedChanges = async () => {
    if (stagedChangeCount === 0) return;
    setIsApplyingStaged(true);
    const sqlStatements = generateSqlForTable(database, table, dialect);

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
    format: "tsv" | "comma" | "sql" | "json" | "markdown" | "php" | "ts",
  ) => {
    if (!dataResult) return;
    setIsCopyMenuOpen(false);

    const { columns: targetCols, rows: targetRows } = getSelectedDataMatrix();
    if (targetRows.length === 0 || targetCols.length === 0) return;

    const targetTable = table || "query_result";

    let output = "";
    switch (format) {
      case "tsv":
        output = exportToTsv(targetCols, targetRows, true);
        break;
      case "comma":
        output = exportToCommaSeparated(targetRows, dialect);
        break;
      case "sql":
        output = exportToSqlInsert(database, targetTable, targetCols, targetRows, dialect);
        break;
      case "json":
        output = exportToJsonArray(targetCols, targetRows);
        break;
      case "markdown":
        output = exportToMarkdownTable(targetCols, targetRows);
        break;
      case "php":
        output = exportToPhpArray(targetCols, targetRows);
        break;
      case "ts":
        output = exportToTsArray(targetCols, targetRows);
        break;
    }

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
      className="flex flex-col h-full w-full bg-surface relative select-none"
      style={isDockOpen ? { paddingRight: inspectorWidth } : undefined}
      onKeyDown={handleContainerKeyDown}
      tabIndex={0}
    >
      {/* Top Toolbar */}
      <div
      className={`flex items-center justify-between px-3 py-1.5 border-b shrink-0 gap-2 bg-surface border-line`}
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
                {displayRows.length} de {totalRowsCount.toLocaleString()} filas
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

        {/* Pagination controls or External row count */}
        {!externalData ? (
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
                loadData(0, pageSize);
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
                loadData(next, pageSize);
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
                loadData(next, pageSize);
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
                loadData(lastPageOffset, pageSize);
              }}
              disabled={pageOffset >= lastPageOffset || isLoading}
              title="Última página"
              className="p-1 rounded text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
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
                pageSize,
                sortSql || sortColumn,
                sortSql ? null : sortDirection,
                whereSql || null,
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
      {cellContextMenu && (() => {
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
              className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors disabled:opacity-40 hover:bg-hover text-warning hover:text-warning`}
            >
              <span className="flex items-center space-x-2">
                <Ban className="w-3.5 h-3.5 text-warning" />
                <span className="font-semibold">
                  {isMulti ? `Poner selección en NULL (${count})` : "Poner en NULL"}
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
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg`}
              >
                <span className="flex items-center space-x-2">
                  <Code2 className="w-3.5 h-3.5 text-fg-muted" />
                  <span>Inspeccionar Celda</span>
                </span>
                <span className={`text-[11px] font-mono text-fg-subtle`}>
                  Espacio
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
                        <span className="truncate">Ir a fila referenciada ({fk.referenced_table})</span>
                      </span>
                      <span className="text-[11px] font-mono text-fg-subtle">Alt+Clic</span>
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
                            Filas de {r.table} que la referencian{ambiguous ? ` (${columns})` : ""}
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
                    message: `Selección (${targetRows.length} fila(s), ${targetCols.length} col(s)) copiada al portapapeles.`,
                  });
                  setTimeout(() => setSaveStatus(null), 2500);
                } else {
                  const rawColIdx = getRawColIndex(col);
                  const cellVal = rawColIdx !== -1 ? displayRows[row]?.[rawColIdx] : null;
                  const textToCopy = cellVal === null || cellVal === undefined ? "NULL" : String(cellVal);
                  navigator.clipboard.writeText(textToCopy);
                  setSaveStatus({ success: true, message: "Valor de celda copiado al portapapeles." });
                  setTimeout(() => setSaveStatus(null), 2500);
                }
              }}
              className={`w-full px-3 py-1.5 text-left flex items-center justify-between transition-colors hover:bg-hover text-fg`}
            >
              <span className="flex items-center space-x-2">
                <Copy className="w-3.5 h-3.5 text-fg-muted" />
                <span>{isMulti ? `Copiar Selección (${count})` : "Copiar Valor"}</span>
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
                  <span>{isMulti ? "Copiar Selección como..." : "Copiar como..."}</span>
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
                    <span>Separados por comas</span>
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
                    <span>TSV (Excel / Sheets)</span>
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
                    <span>SQL INSERT INTO</span>
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
                    <span>JSON Array</span>
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
                    <span>Markdown Table</span>
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
                    <span>PHP Array</span>
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
                    <span>TypeScript Array</span>
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
              <span>Seleccionar columna completa</span>
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
                <span className="font-semibold">Nuevo Registro...</span>
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
                <span>Editar Registro...</span>
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
                      {count > 1 ? `Marcar para Borrar (${count})` : "Marcar para Borrar"}
                    </span>
                  </span>
                </button>
              );
            })()}
          </div>
        );
      })()}

      {/* Header Context / Column Menu Dropdown */}
      {headerMenu && (
        <div
          style={{ top: headerMenu.y, left: headerMenu.x }}
          onClick={(e) => e.stopPropagation()}
          className={`fixed z-50 w-56 rounded-xl border shadow-2xl py-1.5 text-xs font-sans animate-in fade-in duration-100 bg-raised border-line text-fg`}
        >
          <div className="px-3 py-1 text-[11px] font-semibold text-fg-muted border-b border-line/60 truncate">
            Columna: <span className="text-accent-text font-mono">{headerMenu.colName}</span>
          </div>

          <button
            type="button"
            onClick={() => {
              handleSelectColumn(headerMenu.col);
              setHeaderMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
          >
            <CheckSquare className="w-3.5 h-3.5 text-fg-muted" />
            <span>Seleccionar toda la columna</span>
          </button>

          <button
            type="button"
            onClick={() => handleSortFromMenu(headerMenu.colName, "ASC")}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
          >
            <ArrowUp className="w-3.5 h-3.5 text-fg-muted" />
            <span>Ordenar Ascendente (ASC)</span>
          </button>

          <button
            type="button"
            onClick={() => handleSortFromMenu(headerMenu.colName, "DESC")}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
          >
            <ArrowDown className="w-3.5 h-3.5 text-fg-muted" />
            <span>Ordenar Descendente (DESC)</span>
          </button>

          {sortColumn === headerMenu.colName && (
            <button
              type="button"
              onClick={() => handleSortFromMenu(headerMenu.colName, null)}
              className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-fg-muted" />
              <span>Quitar ordenamiento</span>
            </button>
          )}

          <div className="my-1 border-t border-line/60" />

          <button
            type="button"
            onClick={() => handleAutoSizeColumn(headerMenu.colName)}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5 text-fg-muted" />
            <span>Autoajustar ancho</span>
          </button>

          {Object.keys(customWidths).length > 0 && (
            <button
              type="button"
              onClick={handleResetColumnWidths}
              className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-fg-muted" />
              <span>Restablecer anchos</span>
            </button>
          )}

          <div className="my-1 border-t border-line/60" />

          <button
            type="button"
            onClick={() => handleToggleFreezeColumn(headerMenu.col)}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
          >
            {freezeColumnsCount === headerMenu.col + 1 ? (
              <>
                <PinOff className="w-3.5 h-3.5 text-fg-muted" />
                <span>Descongelar columnas</span>
              </>
            ) : (
              <>
                <Pin className="w-3.5 h-3.5 text-fg-muted" />
                <span>Fijar columnas hasta aquí</span>
              </>
            )}
          </button>

          <div className="my-1 border-t border-line/60" />

          <button
            type="button"
            onClick={() => handleCopyColumnName(headerMenu.colName)}
            className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-fg-muted" />
            <span>Copiar nombre de columna</span>
          </button>

          {!externalData && (
            <button
              type="button"
              onClick={() => handleFilterByColumn(headerMenu.colName)}
              className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-hover hover:text-accent-text transition-colors"
            >
              <Filter className="w-3.5 h-3.5 text-fg-muted" />
              <span>Filtrar por esta columna...</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
