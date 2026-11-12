import React, { useState, useEffect } from "react";
import type {
  ColumnMetadata,
  ColumnMapping,
  ExcelPreviewData,
  ImportProgressEvent,
  ImportSummary,
  NewTableColumnDef,
  NewTableConfig,
  TableMetadata,
} from "../../types/database";
import { dbService } from "../../services/tauriDb";
import { errorText, reportError } from "../../utils/errors";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import {
  buildAutoMappings,
  buildImportMode,
  defaultTableName,
  inferColumnTypes,
  initialNewTableColumns,
  toggleGeneratedId,
  type AdvancedImportMode,
  type DisplacedKeys,
  type GeneratedIdState,
} from "./importInference";

export interface ImportWizardOptions {
  isOpen: boolean;
  database: string;
  initialTable?: string;
  initialDbColumns?: ColumnMetadata[];
  onImportComplete?: () => void;
}

/**
 * State and actions of the import wizard (file, target, mapping, mode, execution).
 * The steps are views over this object: each one receives only the fields it uses.
 */
export function useImportWizard({ isOpen, database, initialTable, initialDbColumns, onImportComplete }: ImportWizardOptions) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: File & Preview
  const [filePath, setFilePath] = useState<string>("");
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [previewData, setPreviewData] = useState<ExcelPreviewData | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    // The webview does not expose the dropped file's path, and Rust only accepts
    // paths chosen in its native dialog, so a drop opens the picker instead.
    if (e.dataTransfer.files?.length) {
      void handlePickFile();
    }
  };

  // Step 2: Target Selection (Existing vs New Table)
  const [targetType, setTargetType] = useState<"existing" | "new">(
    initialTable ? "existing" : "new",
  );
  const [existingTables, setExistingTables] = useState<TableMetadata[]>([]);
  const [selectedExistingTable, setSelectedExistingTable] = useState<string>(
    initialTable || "",
  );
  const [targetColumns, setTargetColumns] = useState<ColumnMetadata[]>(
    initialDbColumns || [],
  );
  const [isLoadingExistingCols, setIsLoadingExistingCols] = useState(false);

  // New Table Configuration
  const [newTableName, setNewTableName] = useState<string>("");
  const [newTableEngine, setNewTableEngine] = useState<string>("InnoDB");
  const [newTableCollation, setNewTableCollation] =
    useState<string>("utf8mb4_unicode_ci");
  const [newTableColumns, setNewTableColumns] = useState<NewTableColumnDef[]>(
    [],
  );
  const [autoAddIdPk, setAutoAddIdPk] = useState<boolean>(true);
  // Name of the generated id column, and the key flags it displaced, so turning
  // the option off restores the user's key instead of leaving the table keyless.
  const [generatedIdName, setGeneratedIdName] = useState<string | null>(null);
  const [displacedKeys, setDisplacedKeys] = useState<DisplacedKeys>({});

  // Step 3: Column Mapping
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);

  // Step 4: Import Mode (6 Modes)
  const [importMode, setImportMode] = useState<AdvancedImportMode>("append");
  const [primaryKeyDb, setPrimaryKeyDb] = useState<string>("");
  const [primaryKeyExcel, setPrimaryKeyExcel] = useState<string>("");
  const [batchSize, setBatchSize] = useState<number>(1000);
  const [errorStrategy, setErrorStrategy] =
    useState<"strict" | "tolerant">("tolerant");
  const [dryRun, setDryRun] = useState(false);

  // Step 5: Execution & Summary
  const [isExecuting, setIsExecuting] = useState(false);
  const [progress, setProgress] = useTauriEvent<ImportProgressEvent>("excel-import-progress");
  const [executionSummary, setExecutionSummary] =
    useState<ImportSummary | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);


  // Fetch list of tables in database for Step 2
  useEffect(() => {
    if (!isOpen || !database) return;
    const fetchTables = async () => {
      try {
        const tbls = await dbService.listTables(database);
        setExistingTables(tbls);
        if (!selectedExistingTable && tbls.length > 0) {
          setSelectedExistingTable(tbls[0].name);
        }
      } catch (err) {
        reportError("No se pudieron cargar las tablas", err);
      }
    };
    fetchTables();
  }, [isOpen, database]);

  // When selected existing table changes, fetch its columns
  useEffect(() => {
    if (!isOpen || !database || !selectedExistingTable) return;
    if (
      initialTable === selectedExistingTable &&
      initialDbColumns &&
      initialDbColumns.length > 0
    ) {
      setTargetColumns(initialDbColumns);
      return;
    }

    const fetchCols = async () => {
      setIsLoadingExistingCols(true);
      try {
        const cols = await dbService.getTableColumns(
          database,
          selectedExistingTable,
        );
        setTargetColumns(cols);
      } catch (err) {
        reportError("No se pudieron cargar las columnas de la tabla", err);
      } finally {
        setIsLoadingExistingCols(false);
      }
    };
    fetchCols();
  }, [isOpen, database, selectedExistingTable, initialTable, initialDbColumns]);

  // Set default PK candidate when targetColumns change
  useEffect(() => {
    if (targetType === "existing") {
      const pk = targetColumns.find((c) => c.column_key === "PRI");
      if (pk) {
        setPrimaryKeyDb(pk.name);
      } else if (targetColumns.length > 0) {
        setPrimaryKeyDb(targetColumns[0].name);
      }
    } else {
      const pk = newTableColumns.find((c) => c.is_primary_key);
      if (pk) {
        setPrimaryKeyDb(pk.name);
      } else if (newTableColumns.length > 0) {
        setPrimaryKeyDb(newTableColumns[0].name);
      }
    }
  }, [targetType, targetColumns, newTableColumns]);




  // Step 1: File picking
  const handlePickFile = async () => {
    try {
      const picked = await dbService.pickExcelFile();
      if (picked) {
        setFilePath(picked);
        await loadPreview(picked);
      }
    } catch (err: unknown) {
      setPreviewError(
        errorText(err, "Error al seleccionar archivo"),
      );
    }
  };

  const loadPreview = async (path: string, sheet?: string) => {
    setIsLoadingPreview(true);
    setPreviewError(null);
    try {
      const data = await dbService.previewExcelFile(path, sheet);
      setPreviewData(data);
      setSelectedSheet(data.selected_sheet);

      setNewTableName(defaultTableName(path, data.selected_sheet));

      const initial = initialNewTableColumns(inferColumnTypes(data.headers, data.preview_rows), autoAddIdPk);
      applyGeneratedId(initial);
      const finalCols = initial.columns;

      // Build mappings depending on targetType
      const activeTargetCols =
        targetType === "new"
          ? finalCols
          : targetColumns;

      const initialMappings = buildAutoMappings(data.headers, activeTargetCols);
      setMappings(initialMappings);

      if (data.headers.length > 0) {
        setPrimaryKeyExcel(data.headers[0]);
      }
    } catch (err: unknown) {
      const msg =
        errorText(err, "Error al previsualizar Excel");
      setPreviewError(msg);
      setPreviewData(null);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const applyGeneratedId = (state: GeneratedIdState) => {
    setNewTableColumns(state.columns);
    setGeneratedIdName(state.generatedIdName);
    setDisplacedKeys(state.displacedKeys);
  };

  const handleToggleAutoAddIdPk = (enabled: boolean) => {
    setAutoAddIdPk(enabled);
    applyGeneratedId(
      toggleGeneratedId({ columns: newTableColumns, generatedIdName, displacedKeys }, enabled),
    );
  };

  // Re-sync mappings when transitioning to Step 3
  const handleProceedToStep3 = () => {
    if (!previewData) return;
    const activeTargetCols =
      targetType === "new"
        ? newTableColumns
        : targetColumns;

    const updatedMappings = buildAutoMappings(
      previewData.headers,
      activeTargetCols,
    );
    setMappings(updatedMappings);
    setCurrentStep(3);
  };

  // Step 5: Execute Import
  const handleExecuteImport = async () => {
    if (!previewData) return;
    setIsExecuting(true);
    setExecutionError(null);
    setProgress({
      current_row: 0,
      total_rows: previewData.total_rows,
      percentage: 0,
      successful_rows: 0,
      failed_rows: 0,
      stage: "Iniciando proceso de importación...",
    });

    const effectiveTargetTable =
      targetType === "new" ? newTableName.trim() : selectedExistingTable.trim();

    if (!effectiveTargetTable) {
      setExecutionError("Por favor define el nombre de la tabla de destino.");
      setIsExecuting(false);
      return;
    }

    const modePayload = buildImportMode(importMode, primaryKeyDb, primaryKeyExcel);

    const newTableConfigPayload: NewTableConfig | undefined =
      targetType === "new"
        ? {
            table_name: effectiveTargetTable,
            engine: newTableEngine,
            collation: newTableCollation,
            columns: newTableColumns,
          }
        : undefined;

    try {
      const summary = await dbService.importExcelFile({
        file_path: filePath,
        sheet_name: selectedSheet,
        database,
        table: effectiveTargetTable,
        mappings,
        mode: modePayload,
        batch_size: batchSize,
        new_table_config: newTableConfigPayload,
        error_strategy: errorStrategy,
        dry_run: dryRun,
      });

      setExecutionSummary(summary);
      if (onImportComplete && !dryRun) {
        onImportComplete();
      }
    } catch (err: unknown) {
      const msg =
        errorText(err, "Fallo en la importación");
      setExecutionError(msg);
    } finally {
      setIsExecuting(false);
    }
  };

  const resetState = () => {
    setCurrentStep(1);
    setFilePath("");
    setPreviewData(null);
    setProgress(null);
    setExecutionSummary(null);
    setExecutionError(null);
    setPreviewError(null);
    setErrorStrategy("tolerant");
    setDryRun(false);
  };


  return {
    currentStep,
    setCurrentStep,
    filePath,
    setFilePath,
    selectedSheet,
    setSelectedSheet,
    previewData,
    setPreviewData,
    isLoadingPreview,
    setIsLoadingPreview,
    previewError,
    setPreviewError,
    isDraggingFile,
    setIsDraggingFile,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    targetType,
    setTargetType,
    existingTables,
    setExistingTables,
    selectedExistingTable,
    setSelectedExistingTable,
    targetColumns,
    setTargetColumns,
    isLoadingExistingCols,
    setIsLoadingExistingCols,
    newTableName,
    setNewTableName,
    newTableEngine,
    setNewTableEngine,
    newTableCollation,
    setNewTableCollation,
    newTableColumns,
    setNewTableColumns,
    autoAddIdPk,
    setAutoAddIdPk,
    generatedIdName,
    setGeneratedIdName,
    displacedKeys,
    setDisplacedKeys,
    mappings,
    setMappings,
    importMode,
    setImportMode,
    primaryKeyDb,
    setPrimaryKeyDb,
    primaryKeyExcel,
    setPrimaryKeyExcel,
    batchSize,
    setBatchSize,
    errorStrategy,
    setErrorStrategy,
    dryRun,
    setDryRun,
    isExecuting,
    setIsExecuting,
    progress,
    setProgress,
    executionSummary,
    setExecutionSummary,
    executionError,
    setExecutionError,
    handlePickFile,
    loadPreview,
    applyGeneratedId,
    handleToggleAutoAddIdPk,
    handleProceedToStep3,
    handleExecuteImport,
    resetState,
  };
}

export type ImportWizard = ReturnType<typeof useImportWizard>;
