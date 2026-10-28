import React, { useState, useEffect } from "react";
import {
  X,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  FileUp,
  Play,
  Check,
  Database,
  Loader2,
  Plus,
  Key,
  ArrowRight,
  ArrowLeft,
  Zap,
  XCircle,
} from "lucide-react";
import type {
  ColumnMetadata,
  ColumnMapping,
  ExcelPreviewData,
  ImportModeType,
  ImportProgressEvent,
  ImportSummary,
  NewTableColumnDef,
  NewTableConfig,
  TableMetadata,
} from "../types/database";
import { dbService } from "../services/tauriDb";
import { iconBtn, modalHeader, modalTitle, primaryBtn } from "./ui/styles";

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  table?: string;
  dbColumns?: ColumnMetadata[];
  onImportComplete?: () => void;
}

type AdvancedImportMode =
  | "append"
  | "update"
  | "append_update"
  | "append_without_update"
  | "delete"
  | "copy";

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  database,
  table: initialTable,
  dbColumns: initialDbColumns,
  onImportComplete,
}) => {
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
  const [progress, setProgress] = useState<ImportProgressEvent | null>(null);
  const [executionSummary, setExecutionSummary] =
    useState<ImportSummary | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // Listen for real-time import progress events from Rust backend
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenFn = await listen<ImportProgressEvent>(
          "excel-import-progress",
          (event) => {
            setProgress(event.payload);
          },
        );
      } catch (err) {
        console.error("Failed to setup import progress listener:", err);
      }
    };

    setupListener();
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

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
        console.error("Failed to load tables for database:", err);
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
        console.error("Failed to load table columns:", err);
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

  if (!isOpen) return null;

  // Infer data types for new table from preview data
  const inferColumnTypes = (
    headers: string[],
    rows: any[][],
  ): NewTableColumnDef[] => {
    return headers.map((header, colIdx) => {
      let hasString = false;
      let hasFloat = false;
      let hasInt = false;
      let hasDate = false;
      let hasBool = false;
      let maxLen = 0;

      for (const row of rows) {
        const val = row[colIdx];
        if (val === null || val === undefined || val === "") continue;

        const strVal = String(val).trim();
        maxLen = Math.max(maxLen, strVal.length);

        if (
          typeof val === "boolean" ||
          strVal.toLowerCase() === "true" ||
          strVal.toLowerCase() === "false"
        ) {
          hasBool = true;
        } else if (
          !isNaN(Number(strVal)) &&
          Number.isInteger(Number(strVal)) &&
          !strVal.includes(".")
        ) {
          hasInt = true;
        } else if (!isNaN(Number(strVal))) {
          hasFloat = true;
        } else if (
          /^\d{4}-\d{2}-\d{2}/.test(strVal) ||
          /^\d{2}\/\d{2}\/\d{4}/.test(strVal)
        ) {
          hasDate = true;
        } else {
          hasString = true;
        }
      }

      let dataType = "VARCHAR(255)";
      if (hasString) {
        dataType = maxLen > 255 ? "TEXT" : "VARCHAR(255)";
      } else if (hasDate) {
        dataType = "DATETIME";
      } else if (hasFloat) {
        dataType = "DOUBLE";
      } else if (hasInt) {
        dataType = maxLen > 9 ? "BIGINT" : "INT";
      } else if (hasBool) {
        dataType = "TINYINT(1)";
      }

      const cleanName =
        header.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase() ||
        `col_${colIdx + 1}`;
      const isPkCandidate =
        colIdx === 0 &&
        (cleanName.includes("id") || cleanName.includes("codigo"));

      return {
        name: cleanName,
        data_type: dataType,
        is_primary_key: isPkCandidate,
        is_nullable: !isPkCandidate,
        auto_increment:
          isPkCandidate && (dataType === "INT" || dataType === "BIGINT"),
      };
    });
  };

  // Helper to generate automatic column mappings
  const buildAutoMappings = (
    headers: string[],
    targetCols: { name: string; column_key?: string; is_primary_key?: boolean }[],
  ) => {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[\s_-]+/g, "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    return headers.map((excelCol) => {
      const normExcel = normalize(excelCol);
      const match = targetCols.find((c) => normalize(c.name) === normExcel);
      const isKeyCandidate =
        match?.column_key === "PRI" ||
        match?.is_primary_key ||
        normExcel === "id" ||
        normExcel === "codigo" ||
        normExcel === "matricula" ||
        normExcel === "noper";

      return {
        excel_column: excelCol,
        db_column: match ? match.name : targetCols.find((c) => c.name === excelCol)?.name || "",
        ignored: !match && !targetCols.some((c) => c.name === excelCol),
        is_key: Boolean(isKeyCandidate),
      };
    });
  };

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
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al seleccionar archivo",
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

      // Default new table name from sheet or filename
      const baseFilename = path.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, "") || "nueva_tabla";
      const sanitizedName = (data.selected_sheet || baseFilename)
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .toLowerCase();
      setNewTableName(sanitizedName);

      // Infer column definitions for new table
      const inferredCols = inferColumnTypes(data.headers, data.preview_rows);
      setNewTableColumns(inferredCols);

      // Build mappings depending on targetType
      const activeTargetCols =
        targetType === "new"
          ? inferredCols
          : targetColumns;

      const initialMappings = buildAutoMappings(data.headers, activeTargetCols);
      setMappings(initialMappings);

      if (data.headers.length > 0) {
        setPrimaryKeyExcel(data.headers[0]);
      }
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al previsualizar Excel";
      setPreviewError(msg);
      setPreviewData(null);
    } finally {
      setIsLoadingPreview(false);
    }
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

    let modePayload: ImportModeType;
    switch (importMode) {
      case "append":
        modePayload = { type: "Append" };
        break;
      case "update":
        modePayload = {
          type: "Update",
          config: {
            primary_key_db: primaryKeyDb,
            primary_key_excel: primaryKeyExcel,
          },
        };
        break;
      case "append_update":
        modePayload = {
          type: "AppendUpdate",
          config: {
            primary_key_db: primaryKeyDb,
            primary_key_excel: primaryKeyExcel,
          },
        };
        break;
      case "append_without_update":
        modePayload = { type: "AppendWithoutUpdate" };
        break;
      case "delete":
        modePayload = {
          type: "Delete",
          config: {
            primary_key_db: primaryKeyDb,
            primary_key_excel: primaryKeyExcel,
          },
        };
        break;
      case "copy":
        modePayload = { type: "Copy" };
        break;
      default:
        modePayload = { type: "Append" };
    }

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
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Fallo en la importación";
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

  const stepsList = [
    { step: 1, title: "1. Archivo y Previsualización" },
    { step: 2, title: "2. Destino y Esquema" },
    { step: 3, title: "3. Mapeo de Columnas" },
    { step: 4, title: "4. Modo de Importación" },
    { step: 5, title: "5. Ejecución" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
      <div className="w-full max-w-4xl bg-surface border border-line rounded-xl shadow-modal overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className={modalHeader}>
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-raised hover:bg-hover border border-accent/30 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-fg-muted" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className={modalTitle}>
                  Asistente de Importación Excel (.xlsx / .xls)
                </h2>
                <span className="text-[11px] px-2 py-0.5 rounded bg-accent-soft text-accent-text font-mono border border-accent/30">
                  {database}
                </span>
              </div>
              <p className="text-xs text-fg-muted">
                Opciones avanzadas de importación (Nueva tabla o tabla existente)
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              resetState();
              onClose();
            }}
            className={iconBtn}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stepper Wizard Indicator */}
        <div className="px-6 py-3 bg-surface border-b border-line flex items-center justify-between text-xs select-none overflow-x-auto">
          {stepsList.map((item) => {
            const isActive = currentStep === item.step;
            const isCompleted = currentStep > item.step;

            return (
              <div
                key={item.step}
                className={`flex items-center space-x-2 font-medium shrink-0 ${
                  isActive
                    ? "text-accent-text font-bold"
                    : isCompleted
                    ? "text-success"
                    : "text-fg-subtle"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
                    isActive
                      ? "bg-accent text-black font-bold shadow-sm"
                      : isCompleted
                      ? "text-success border border-line"
                      : "bg-raised text-fg-subtle border border-line"
                  }`}
                >
                  {isCompleted ? <Check className="w-3 h-3" /> : item.step}
                </div>
                <span className="hidden sm:inline">{item.title}</span>
              </div>
            );
          })}
        </div>

        {/* Step Body Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-canvas">
          {/* STEP 1: FILE & PREVIEW */}
          {currentStep === 1 && (
            <div className="space-y-5">
              {/* Drag and Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handlePickFile}
                className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer ${
                  isDraggingFile
                    ? "border-accent bg-accent-soft"
                    : "border-line hover:border-accent/50 bg-surface/60 hover:bg-hover"
                }`}
              >
                <div className="flex flex-col items-center justify-center space-y-2 pointer-events-none">
                  <div
                    className={`p-2.5 rounded-full ${
                      isDraggingFile
                        ? "bg-accent-soft text-accent-text"
                        : "bg-raised text-fg-muted"
                    }`}
                  >
                    <FileUp className="w-5 h-5 text-fg-muted" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-fg">
                      Arrastra y suelta tu archivo{" "}
                      <span className="text-accent-text font-mono">.xlsx</span>,{" "}
                      <span className="text-warning font-mono">.csv</span> o{" "}
                      <span className="text-fg-muted font-mono">.xls</span> aquí
                    </p>
                    <p className="text-[11px] text-fg-subtle mt-0.5">
                      o haz clic para examinar archivos en tu sistema
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-3 sm:space-y-0 sm:space-x-3">
                <input
                  type="text"
                  placeholder="Ruta del archivo Excel (.xlsx / .xls)..."
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  className="flex-1 px-3 py-2 bg-raised border border-line rounded-lg text-fg font-mono text-xs placeholder-neutral-500 focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={handlePickFile}
                  className="flex items-center justify-center space-x-2 px-4 py-2 bg-elevated hover:bg-hover border border-line-strong rounded-lg text-fg text-xs font-medium transition-colors"
                >
                  <FileUp className="w-4 h-4 text-fg-muted" />
                  <span>Examinar...</span>
                </button>
                {filePath && !isLoadingPreview && (
                  <button
                    type="button"
                    onClick={() => loadPreview(filePath, selectedSheet)}
                    className="flex items-center justify-center space-x-1 px-3 py-2 bg-accent-soft hover:bg-hover border border-accent/40 rounded-lg text-accent-text text-xs font-medium transition-colors"
                  >
                    <span>Cargar</span>
                  </button>
                )}
              </div>

              {previewError && (
                <div className="p-3 border border-line rounded-lg text-danger text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-danger" />
                  <span>{previewError}</span>
                </div>
              )}

              {isLoadingPreview && (
                <div className="flex flex-col items-center justify-center py-16 space-y-3 text-fg-muted text-xs font-mono">
                  <Loader2 className="w-8 h-8 animate-spin text-fg-muted" />
                  <span>Leyendo libro Excel con Calamine...</span>
                </div>
              )}

              {previewData && !isLoadingPreview && (
                <div className="space-y-4">
                  {/* Sheet switcher and metrics */}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="text-fg-muted">Hoja activa:</span>
                      <select
                        value={selectedSheet}
                        onChange={(e) => {
                          const sheet = e.target.value;
                          setSelectedSheet(sheet);
                          loadPreview(filePath, sheet);
                        }}
                        className="px-2.5 py-1 bg-raised border border-line rounded text-fg font-mono text-xs focus:outline-none"
                      >
                        {previewData.sheets.map((sheet) => (
                          <option key={sheet} value={sheet}>
                            {sheet}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center space-x-3 text-fg-muted font-mono text-[11px]">
                      <span>{previewData.headers.length} columnas detectadas</span>
                      <span>•</span>
                      <span className="text-success font-semibold">
                        ~{previewData.total_rows.toLocaleString()} filas de datos
                      </span>
                    </div>
                  </div>

                  {/* 50-row preview table */}
                  <div className="border border-line rounded-lg overflow-x-auto max-h-72 bg-surface">
                    <table className="w-full text-left text-xs border-collapse font-mono">
                      <thead>
                        <tr className="bg-raised text-accent-text font-semibold border-b border-line sticky top-0">
                          <th className="py-2 px-3 w-10 text-center text-fg-subtle">
                            #
                          </th>
                          {previewData.headers.map((h, i) => (
                            <th key={i} className="py-2 px-3 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {previewData.preview_rows.map((row, rowIdx) => (
                          <tr key={rowIdx} className="hover:bg-hover">
                            <td className="py-1.5 px-3 text-center text-fg-subtle text-[11px]">
                              {rowIdx + 1}
                            </td>
                            {row.map((cell, cellIdx) => (
                              <td
                                key={cellIdx}
                                className="py-1.5 px-3 text-fg whitespace-nowrap max-w-xs truncate"
                              >
                                {cell === null ? (
                                  <span className="text-fg-subtle italic">
                                    NULL
                                  </span>
                                ) : (
                                  String(cell)
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-[11px] text-fg-subtle italic">
                    * Mostrando muestra de las primeras 50 filas para verificar estructura y tipos antes de importar.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: DESTINATION (EXISTING TABLE VS NEW TABLE) */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-xs font-semibold text-fg">
                  Elige dónde se importarán los datos en la base de datos:
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Option: Existing Table */}
                  <div
                    onClick={() => setTargetType("existing")}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      targetType === "existing"
                        ? "bg-accent-soft border-accent shadow-sm"
                        : "bg-raised border-line hover:border-line-strong"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-xs text-fg flex items-center space-x-2">
                        <Database className="w-4 h-4 text-fg-muted" />
                        <span>Importar a una tabla existente</span>
                      </span>
                      <input
                        type="radio"
                        checked={targetType === "existing"}
                        onChange={() => setTargetType("existing")}
                        className="accent-accent"
                      />
                    </div>
                    <p className="text-[11px] text-fg-muted leading-relaxed">
                      Sincroniza o agrega los registros a una tabla ya creada en {database}.
                    </p>
                  </div>

                  {/* Option: New Table */}
                  <div
                    onClick={() => setTargetType("new")}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      targetType === "new"
                        ? "bg-accent-soft border-accent shadow-sm"
                        : "bg-raised border-line hover:border-line-strong"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-xs text-fg flex items-center space-x-2">
                        <Plus className="w-4 h-4 text-fg-muted" />
                        <span>Crear como una NUEVA tabla</span>
                      </span>
                      <input
                        type="radio"
                        checked={targetType === "new"}
                        onChange={() => setTargetType("new")}
                        className="accent-accent"
                      />
                    </div>
                    <p className="text-[11px] text-fg-muted leading-relaxed">
                      Crea una nueva tabla automáticamente infiriendo los tipos de datos a partir del archivo Excel.
                    </p>
                  </div>
                </div>
              </div>

              {/* Target Type Specific Configuration */}
              {targetType === "existing" ? (
                <div className="p-4 rounded-xl bg-raised border border-line space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <label className="text-xs font-semibold text-fg">
                      Selecciona la tabla destino:
                    </label>
                    <select
                      value={selectedExistingTable}
                      onChange={(e) => setSelectedExistingTable(e.target.value)}
                      className="px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none focus:border-accent min-w-48"
                    >
                      {existingTables.map((tbl) => (
                        <option key={tbl.name} value={tbl.name}>
                          {tbl.name} ({tbl.rows_count ?? 0} filas)
                        </option>
                      ))}
                    </select>
                  </div>

                  {isLoadingExistingCols ? (
                    <div className="py-6 flex items-center justify-center space-x-2 text-xs text-fg-muted">
                      <Loader2 className="w-4 h-4 animate-spin text-fg-muted" />
                      <span>Inspeccionando columnas de '{selectedExistingTable}'...</span>
                    </div>
                  ) : (
                    <div className="text-xs text-fg-muted font-mono flex items-center space-x-2">
                      <span className="text-success font-semibold">
                        {targetColumns.length} columnas
                      </span>{" "}
                      <span>disponibles en la tabla '{selectedExistingTable}'.</span>
                    </div>
                  )}
                </div>
              ) : (
                /* New Table Designer */
                <div className="p-4 rounded-xl bg-raised border border-line space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] text-fg-muted block mb-1">
                        Nombre de la nueva tabla:
                      </label>
                      <input
                        type="text"
                        value={newTableName}
                        onChange={(e) => setNewTableName(e.target.value)}
                        placeholder="mi_nueva_tabla"
                        className="w-full px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none focus:border-accent font-semibold text-accent-text"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-fg-muted block mb-1">
                        Motor de almacenamiento:
                      </label>
                      <select
                        value={newTableEngine}
                        onChange={(e) => setNewTableEngine(e.target.value)}
                        className="w-full px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none"
                      >
                        <option value="InnoDB">InnoDB (Transaccional)</option>
                        <option value="Aria">Aria (Crash-safe)</option>
                        <option value="MyISAM">MyISAM</option>
                        <option value="MEMORY">MEMORY (En memoria RAM)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-fg-muted block mb-1">
                        Cotejamiento (Collation):
                      </label>
                      <select
                        value={newTableCollation}
                        onChange={(e) => setNewTableCollation(e.target.value)}
                        className="w-full px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none"
                      >
                        <option value="utf8mb4_unicode_ci">utf8mb4_unicode_ci (Recomendado)</option>
                        <option value="utf8mb4_general_ci">utf8mb4_general_ci</option>
                        <option value="utf8_general_ci">utf8_general_ci</option>
                        <option value="latin1_swedish_ci">latin1_swedish_ci</option>
                      </select>
                    </div>
                  </div>

                  {/* Column Schema Definition */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-fg-muted">
                      <span className="font-semibold text-fg">
                        Estructura de columnas inferida desde Excel:
                      </span>
                    </div>

                    <div className="border border-line rounded-lg overflow-x-auto max-h-56 bg-surface">
                      <table className="w-full text-left text-xs border-collapse font-mono">
                        <thead>
                          <tr className="bg-raised text-fg border-b border-line text-[11px]">
                            <th className="py-2 px-3">Nombre Columna</th>
                            <th className="py-2 px-3">Tipo de Dato</th>
                            <th className="py-2 px-3 text-center">Clave Primaria (PK)</th>
                            <th className="py-2 px-3 text-center">Permite NULL</th>
                            <th className="py-2 px-3 text-center">Auto Increment</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {newTableColumns.map((col, idx) => (
                            <tr key={idx} className="hover:bg-hover">
                              <td className="py-1.5 px-3">
                                <input
                                  type="text"
                                  value={col.name}
                                  onChange={(e) => {
                                    const updated = [...newTableColumns];
                                    updated[idx].name = e.target.value;
                                    setNewTableColumns(updated);
                                  }}
                                  className="w-full px-2 py-1 bg-raised border border-line rounded text-fg text-xs font-mono"
                                />
                              </td>
                              <td className="py-1.5 px-3">
                                <select
                                  value={col.data_type}
                                  onChange={(e) => {
                                    const updated = [...newTableColumns];
                                    updated[idx].data_type = e.target.value;
                                    setNewTableColumns(updated);
                                  }}
                                  className="w-full px-2 py-1 bg-raised border border-line rounded text-accent-text text-xs font-mono"
                                >
                                  <option value="INT">INT</option>
                                  <option value="BIGINT">BIGINT</option>
                                  <option value="VARCHAR(255)">VARCHAR(255)</option>
                                  <option value="VARCHAR(100)">VARCHAR(100)</option>
                                  <option value="TEXT">TEXT</option>
                                  <option value="DOUBLE">DOUBLE</option>
                                  <option value="DECIMAL(12,2)">DECIMAL(12,2)</option>
                                  <option value="DATETIME">DATETIME</option>
                                  <option value="DATE">DATE</option>
                                  <option value="TINYINT(1)">TINYINT(1) (Boolean)</option>
                                </select>
                              </td>
                              <td className="py-1.5 px-3 text-center">
                                <input
                                  type="radio"
                                  name="pk_selection"
                                  checked={col.is_primary_key}
                                  onChange={() => {
                                    const updated = newTableColumns.map((c, i) => ({
                                      ...c,
                                      is_primary_key: i === idx,
                                      is_nullable: i === idx ? false : c.is_nullable,
                                    }));
                                    setNewTableColumns(updated);
                                  }}
                                  className="accent-amber-400 cursor-pointer"
                                />
                              </td>
                              <td className="py-1.5 px-3 text-center">
                                <input
                                  type="checkbox"
                                  disabled={col.is_primary_key}
                                  checked={col.is_nullable}
                                  onChange={(e) => {
                                    const updated = [...newTableColumns];
                                    updated[idx].is_nullable = e.target.checked;
                                    setNewTableColumns(updated);
                                  }}
                                  className="accent-accent cursor-pointer disabled:opacity-30"
                                />
                              </td>
                              <td className="py-1.5 px-3 text-center">
                                <input
                                  type="checkbox"
                                  disabled={!col.is_primary_key || (!col.data_type.includes("INT"))}
                                  checked={col.auto_increment}
                                  onChange={(e) => {
                                    const updated = [...newTableColumns];
                                    updated[idx].auto_increment = e.target.checked;
                                    setNewTableColumns(updated);
                                  }}
                                  className="accent-accent cursor-pointer disabled:opacity-30"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: COLUMN MAPPING */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <p>
                  Asigna las columnas del archivo Excel a las columnas de MariaDB (
                  <strong className="text-fg font-mono">
                    {targetType === "new" ? newTableName : selectedExistingTable}
                  </strong>).
                </p>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMappings((prev) =>
                        prev.map((m) => ({ ...m, ignored: false })),
                      );
                    }}
                    className="text-accent-text hover:underline"
                  >
                    Activar todas
                  </button>
                  <span>|</span>
                  <button
                    type="button"
                    onClick={() => {
                      setMappings((prev) =>
                        prev.map((m) => ({ ...m, ignored: true })),
                      );
                    }}
                    className="text-fg-subtle hover:text-fg"
                  >
                    Ignorar todas
                  </button>
                </div>
              </div>

              <div className="border border-line rounded-lg overflow-hidden bg-surface">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead>
                    <tr className="bg-raised text-fg border-b border-line">
                      <th className="py-2.5 px-4 w-12 text-center">Importar</th>
                      <th className="py-2.5 px-4">Campo de Origen (Excel)</th>
                      <th className="py-2.5 px-4 w-8 text-center text-fg-subtle">
                        ➔
                      </th>
                      <th className="py-2.5 px-4">Campo de Destino (MariaDB)</th>
                      <th className="py-2.5 px-4 w-28 text-center">Clave Primaria (🔑)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {mappings.map((mapping, idx) => {
                      const availableTargetCols =
                        targetType === "new"
                          ? newTableColumns.map((c) => ({
                              name: c.name,
                              type: c.data_type,
                              is_pk: c.is_primary_key,
                            }))
                          : targetColumns.map((c) => ({
                              name: c.name,
                              type: c.column_type,
                              is_pk: c.column_key === "PRI",
                            }));

                      return (
                        <tr
                          key={idx}
                          className={
                            mapping.ignored
                              ? "opacity-50 bg-canvas"
                              : "hover:bg-hover"
                          }
                        >
                          <td className="py-2.5 px-4 text-center">
                            <input
                              type="checkbox"
                              checked={!mapping.ignored}
                              onChange={(e) => {
                                const newMappings = [...mappings];
                                newMappings[idx].ignored = !e.target.checked;
                                setMappings(newMappings);
                              }}
                              className="accent-accent cursor-pointer"
                            />
                          </td>

                          <td className="py-2.5 px-4 font-semibold text-fg">
                            {mapping.excel_column}
                          </td>

                          <td className="py-2.5 px-4 text-center text-accent-text">
                            {mapping.ignored ? "—" : "➔"}
                          </td>

                          <td className="py-2.5 px-4">
                            <select
                              disabled={mapping.ignored}
                              value={mapping.db_column}
                              onChange={(e) => {
                                const newMappings = [...mappings];
                                newMappings[idx].db_column = e.target.value;
                                const matchedCol = availableTargetCols.find(
                                  (c) => c.name === e.target.value,
                                );
                                if (matchedCol?.is_pk) {
                                  newMappings[idx].is_key = true;
                                }
                                setMappings(newMappings);
                              }}
                              className="w-full px-2.5 py-1.5 bg-raised border border-line rounded text-fg text-xs focus:outline-none focus:border-accent disabled:opacity-40 font-mono"
                            >
                              <option value="">-- Seleccionar columna --</option>
                              {availableTargetCols.map((c) => (
                                <option key={c.name} value={c.name}>
                                  {c.is_pk ? "🔑 " : ""}
                                  {c.name} ({c.type})
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="py-2.5 px-4 text-center">
                            <button
                              type="button"
                              disabled={mapping.ignored}
                              onClick={() => {
                                const newMappings = [...mappings];
                                newMappings[idx].is_key = !newMappings[idx].is_key;
                                setMappings(newMappings);
                              }}
                              title="Haz clic para designar esta columna como clave de coincidencia (Llave Primaria o Clave Compuesta)"
                              className={`inline-flex items-center justify-center px-3 py-1 rounded-md transition-all ${
                                mapping.is_key
                                  ? "border border-line text-warning shadow-sm font-semibold"
                                  : "bg-raised border border-line text-fg-subtle hover:text-warning hover:border-amber-500/40"
                              } disabled:opacity-20`}
                            >
                              <Key className={`w-3.5 h-3.5 mr-1 ${mapping.is_key ? "text-warning fill-amber-400/20" : ""}`} />
                              <span className="text-[11px]">{mapping.is_key ? "Clave" : "—"}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STEP 4: IMPORT MODE (6 MODES) */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-xs font-semibold text-fg block">
                  Modo de Importación avanzado:
                </label>

                <div className="space-y-2 bg-surface border border-line rounded-xl p-4">
                  {/* 1. Append */}
                  <label
                    onClick={() => setImportMode("append")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "append"
                        ? "bg-accent-soft text-fg"
                        : "hover:bg-hover text-fg"
                    }`}
                  >
                    <input
                      type="radio"
                      name="excel_import_mode"
                      checked={importMode === "append"}
                      onChange={() => setImportMode("append")}
                      className="accent-accent mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-fg block">
                        Agregar (Append): añadir registros a la tabla de destino
                      </span>
                      <span className="text-[11px] text-fg-muted">
                        Inserta todas las filas del archivo Excel al final de la tabla de destino (<code className="text-accent-text">INSERT INTO</code>).
                      </span>
                    </div>
                  </label>

                  {/* 2. Update */}
                  <label
                    onClick={() => setImportMode("update")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "update"
                        ? "bg-accent-soft text-fg"
                        : "hover:bg-hover text-fg"
                    }`}
                  >
                    <input
                      type="radio"
                      name="excel_import_mode"
                      checked={importMode === "update"}
                      onChange={() => setImportMode("update")}
                      className="accent-accent mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-fg block">
                        Actualizar (Update): actualizar registros en destino que coincidan con el origen
                      </span>
                      <span className="text-[11px] text-fg-muted">
                        Actualiza únicamente los registros que ya existan coincidiendo por la clave primaria (<code className="text-accent-text">UPDATE ... WHERE pk = ?</code>).
                      </span>
                    </div>
                  </label>

                  {/* 3. Append / Update */}
                  <label
                    onClick={() => setImportMode("append_update")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "append_update"
                        ? "bg-accent-soft text-fg"
                        : "hover:bg-hover text-fg"
                    }`}
                  >
                    <input
                      type="radio"
                      name="excel_import_mode"
                      checked={importMode === "append_update"}
                      onChange={() => setImportMode("append_update")}
                      className="accent-accent mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-fg block">
                        Agregar / Actualizar: si existe en destino lo actualiza, de lo contrario lo añade
                      </span>
                      <span className="text-[11px] text-fg-muted">
                        Si el registro existe por clave primaria lo actualiza; si no existe, lo inserta (<code className="text-accent-text">ON DUPLICATE KEY UPDATE</code>).
                      </span>
                    </div>
                  </label>

                  {/* 4. Append without update */}
                  <label
                    onClick={() => setImportMode("append_without_update")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "append_without_update"
                        ? "bg-accent-soft text-fg"
                        : "hover:bg-hover text-fg"
                    }`}
                  >
                    <input
                      type="radio"
                      name="excel_import_mode"
                      checked={importMode === "append_without_update"}
                      onChange={() => setImportMode("append_without_update")}
                      className="accent-accent mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-fg block">
                        Agregar sin actualizar: si existe en destino lo omite, de lo contrario lo añade
                      </span>
                      <span className="text-[11px] text-fg-muted">
                        Inserta nuevos registros e ignora silenciosamente los que tengan clave duplicada (<code className="text-accent-text">INSERT IGNORE</code>).
                      </span>
                    </div>
                  </label>

                  {/* 5. Delete */}
                  <label
                    onClick={() => setImportMode("delete")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "delete"
                        ? "bg-accent-soft text-fg"
                        : "hover:bg-hover text-fg"
                    }`}
                  >
                    <input
                      type="radio"
                      name="excel_import_mode"
                      checked={importMode === "delete"}
                      onChange={() => setImportMode("delete")}
                      className="accent-accent mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-fg block">
                        Eliminar (Delete): eliminar registros en destino que coincidan con el origen
                      </span>
                      <span className="text-[11px] text-fg-muted">
                        Elimina de la tabla de destino todos los registros cuyas claves coincidan con el Excel (<code className="text-danger">DELETE WHERE pk IN (...)</code>).
                      </span>
                    </div>
                  </label>

                  {/* 6. Copy */}
                  <label
                    onClick={() => setImportMode("copy")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "copy"
                        ? "text-fg"
                        : "hover:bg-hover text-fg"
                    }`}
                  >
                    <input
                      type="radio"
                      name="excel_import_mode"
                      checked={importMode === "copy"}
                      onChange={() => setImportMode("copy")}
                      className="accent-red-500 mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-fg block">
                        Copiar (Copy): vaciar tabla de destino y repoblar desde el origen
                      </span>
                      <span className="text-[11px] text-fg-muted">
                        Vacía la tabla por completo (<code className="text-danger">TRUNCATE TABLE</code>) y vuelve a poblarla con el contenido del Excel.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Matching Key(s) configuration from Step 3 */}
              {(importMode === "update" ||
                importMode === "append_update" ||
                importMode === "delete") && (
                <div className="p-4 rounded-xl bg-raised border border-line space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-accent-text flex items-center space-x-1.5">
                      <Key className="w-4 h-4 text-warning" />
                      <span>
                        Columnas Clave de Coincidencia (Llaves seleccionadas en Paso 3):
                      </span>
                    </h4>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(3)}
                      className="text-[11px] text-accent-text hover:underline flex items-center space-x-1"
                    >
                      <span>Modificar en Paso 3</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  {mappings.filter((m) => !m.ignored && m.is_key).length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {mappings
                          .filter((m) => !m.ignored && m.is_key)
                          .map((k) => (
                            <span
                              key={k.excel_column}
                              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded border border-line text-warning font-mono text-xs"
                            >
                              <Key className="w-3 h-3 text-warning" />
                              <span>
                                {k.excel_column} ➔ {k.db_column || k.excel_column}
                              </span>
                            </span>
                          ))}
                      </div>
                      <p className="text-[11px] text-fg-muted">
                        Se usarán estas {mappings.filter((m) => !m.ignored && m.is_key).length} columna(s) para identificar de forma unívoca cada registro durante la importación.
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 border border-line rounded-lg text-xs text-warning flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-warning" />
                      <span>
                        No has marcado ninguna columna con el icono 🔑 en el Paso 3. Puedes hacer clic en <strong>Modificar en Paso 3</strong> para activar la(s) llave(s) deseadas.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Batch configuration */}
              <div className="flex items-center space-x-3 text-xs text-fg">
                <span>Tamaño de lote:</span>
                <select
                  value={batchSize}
                  onChange={(e) => setBatchSize(parseInt(e.target.value, 10))}
                  className="px-2.5 py-1 bg-raised border border-line rounded text-fg font-mono text-xs"
                >
                  <option value={200}>200 filas</option>
                  <option value={500}>500 filas</option>
                  <option value={1000}>1,000 filas (Recomendado)</option>
                </select>
                <span className="text-[11px] text-fg-subtle">
                  (lote multi-fila, limitado para controlar memoria y packet size)
                </span>
              </div>

              <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs text-fg">
                  <span className="block font-semibold">Filas inválidas</span>
                  <select
                    value={errorStrategy}
                    onChange={(event) =>
                      setErrorStrategy(event.target.value as "strict" | "tolerant")
                    }
                    className="w-full rounded-md border border-line bg-raised px-2.5 py-2 text-xs text-fg"
                  >
                    <option value="tolerant">Tolerante — omitirlas y continuar</option>
                    <option value="strict">Estricto — abortar y revertir el lote completo</option>
                  </select>
                  {errorStrategy === "strict" && (
                    <span className="block text-[11px] text-warning">
                      Requiere TCP o SSH, tabla InnoDB y no admite HTTP Tunnel.
                    </span>
                  )}
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-raised p-3 text-xs text-fg">
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(event) => setDryRun(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-line bg-surface text-fg-muted"
                  />
                  <span>
                    <strong className="block">Simulación (Dry Run) — validar sin modificar</strong>
                    <span className="mt-1 block text-[11px] text-fg">
                      Revisa mapeos, tipos, columnas requeridas y claves duplicadas sin escribir en la base de datos.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* STEP 5: EXECUTION & SUMMARY */}
          {currentStep === 5 && (
            <div className="space-y-6">
              {!executionSummary && !isExecuting && !executionError && (
                <div className="text-center py-10 space-y-4">
                  <div className="w-14 h-14 rounded-xl bg-accent-soft border border-accent/30 flex items-center justify-center mx-auto text-accent-text">
                    <Play className="w-7 h-7 fill-current ml-1" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-fg">
                      Listo para procesar ~{previewData?.total_rows.toLocaleString()} filas
                    </h3>
                    <p className="text-xs text-fg-muted mt-1 max-w-md mx-auto">
                      Tabla destino:{" "}
                      <strong className="text-accent-text font-mono">
                        {targetType === "new" ? newTableName : selectedExistingTable}
                      </strong>{" "}
                      ({targetType === "new" ? "Nueva tabla" : "Tabla existente"}). Modo:{" "}
                      <strong className="text-warning uppercase font-mono">
                        {importMode}
                      </strong>.
                    </p>
                  </div>
                  <button
                    onClick={handleExecuteImport}
                    className={primaryBtn}
                  >
                    {dryRun ? "Ejecutar Simulación (Dry Run)" : "Iniciar Importación Masiva"}
                  </button>
                </div>
              )}

              {isExecuting && (
                <div className="py-8 px-6 space-y-5 bg-surface border border-line rounded-xl max-w-xl mx-auto shadow-modal animate-in fade-in">
                  {/* Status header */}
                  <div className="flex items-center space-x-3 text-left">
                    <div className="w-11 h-11 rounded-xl bg-accent-soft border border-accent/30 flex items-center justify-center shrink-0">
                      <Loader2 className="w-5 h-5 animate-spin text-fg-muted" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-fg font-mono truncate">
                        {progress?.stage || "Procesando importación..."}
                      </h3>
                      <p className="text-xs text-fg-muted font-mono mt-0.5 truncate">
                        Destino:{" "}
                        <span className="text-accent-text font-bold">
                          {targetType === "new" ? newTableName : selectedExistingTable}
                        </span>{" "}
                        • Modo:{" "}
                        <span className="text-warning uppercase font-semibold">
                          {importMode}
                        </span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-2xl font-mono font-black text-accent">
                        {progress ? `${progress.percentage.toFixed(1)}%` : "0.0%"}
                      </span>
                    </div>
                  </div>

                  {/* Visual Progress Bar Track */}
                  <div className="space-y-1.5">
                    <div className="w-full h-3.5 bg-canvas rounded-full overflow-hidden border border-line p-0.5 shadow-inner relative">
                      <div
                        className="h-full rounded-full bg-accent hover:bg-accent-hover transition-all duration-300 ease-out"
                        style={{
                          width: `${Math.max(progress?.percentage || 0, progress ? 1 : 0)}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-fg-muted">
                      <span>
                        Procesadas:{" "}
                        <strong className="text-fg">
                          {(progress?.current_row || 0).toLocaleString()}
                        </strong>{" "}
                        /{" "}
                        {(
                          progress?.total_rows ||
                          previewData?.total_rows ||
                          0
                        ).toLocaleString()}{" "}
                        filas
                      </span>
                      <span className="text-warning/90 font-medium">
                        Lotes de {batchSize.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Live Counters & Speed */}
                  <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-line text-left">
                    <div className="p-2.5 rounded-lg border border-line flex items-center justify-between">
                      <span className="text-[11px] text-success font-mono">
                        Exitosas:
                      </span>
                      <span className="text-xs font-bold font-mono text-success">
                        {(progress?.successful_rows || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg border border-line flex items-center justify-between">
                      <span className="text-[11px] text-danger font-mono">
                        Errores:
                      </span>
                      <span className="text-xs font-bold font-mono text-danger">
                        {(progress?.failed_rows || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-accent-soft border border-accent/30 flex items-center justify-between">
                      <span className="text-[11px] text-accent-text font-mono flex items-center gap-1">
                        <Zap className="w-3 h-3 shrink-0 text-fg-muted" />
                        Velocidad:
                      </span>
                      <span className="text-xs font-bold font-mono text-accent-text">
                        {progress?.rows_per_sec
                          ? `${progress.rows_per_sec.toLocaleString()} f/s`
                          : "—"}
                      </span>
                    </div>
                  </div>

                  {/* Cancel / Abort operation button */}
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await dbService.cancelExcelOperation();
                        } catch (err) {
                          console.error("Error al cancelar importación:", err);
                        }
                      }}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg hover:bg-hover border border-line text-danger text-xs font-medium transition-colors cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5 text-danger" />
                      <span>Abortar Importación</span>
                    </button>
                  </div>
                </div>
              )}

              {executionError && (
                <div className="p-4 border border-line rounded-xl text-red-200 text-xs font-mono space-y-2">
                  <div className="flex items-center space-x-2 font-bold text-danger">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span>Error al ejecutar la importación:</span>
                  </div>
                  <p className="whitespace-pre-wrap">{executionError}</p>
                  <button
                    type="button"
                    onClick={handleExecuteImport}
                    className="mt-2 px-3 py-1.5 bg-red-800 hover:bg-red-700 text-accent-fg rounded text-xs font-semibold"
                  >
                    Reintentar
                  </button>
                </div>
              )}

              {executionSummary && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  {/* Metric Summary Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-4 rounded-xl bg-raised border border-line">
                      <span className="text-[11px] text-fg-muted block mb-1">
                        Total Procesadas
                      </span>
                      <span className="text-lg font-bold font-mono text-fg">
                        {executionSummary.total_processed.toLocaleString()}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl border border-line">
                      <span className="text-[11px] text-success block mb-1">
                        {dryRun ? "Filas válidas (estimadas)" : "Importadas"}
                      </span>
                      <span className="text-lg font-bold font-mono text-success">
                        {executionSummary.successful_rows.toLocaleString()}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl border border-line">
                      <span className="text-[11px] text-danger block mb-1">
                        Omitidas
                      </span>
                      <span className="text-lg font-bold font-mono text-danger">
                        {(executionSummary.skipped_rows ?? executionSummary.failed_rows).toLocaleString()}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-raised border border-line">
                      <span className="text-[11px] text-fg-muted block mb-1">
                        Errores detectados
                      </span>
                      <span className="text-lg font-bold font-mono text-accent-text">
                        {(executionSummary.error_count ?? executionSummary.errors.length).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <p className="text-right text-[11px] text-fg-subtle">
                    {dryRun ? "Validación" : "Importación"} completada en{" "}
                    {(executionSummary.execution_time_ms / 1000).toFixed(2)} s
                  </p>

                  {/* Errors table if any */}
                  {executionSummary.errors.length > 0 ? (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-danger flex items-center space-x-1.5">
                        <AlertCircle className="w-4 h-4" />
                        <span>
                          Registro de incidencias ({executionSummary.errors.length} mostradas):
                        </span>
                      </h4>
                      <div className="border border-red-900/40 rounded-lg overflow-hidden max-h-48 overflow-y-auto bg-canvas">
                        <table className="w-full text-left text-xs font-mono border-collapse">
                          <thead>
                            <tr className="text-danger border-b border-line">
                              <th className="py-2 px-3 w-24">Fila Excel</th>
                              <th className="py-2 px-3">Columna</th>
                              <th className="py-2 px-3">Valor</th>
                              <th className="py-2 px-3">Causa</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-red-900/30 text-red-200">
                            {executionSummary.errors.map((err, i) => (
                              <tr key={i}>
                                <td className="py-1.5 px-3 font-bold text-danger">
                                  #{err.row_index}
                                </td>
                                <td className="py-1.5 px-3">{err.column || "—"}</td>
                                <td className="py-1.5 px-3 max-w-48 truncate">
                                  {err.value ?? "—"}
                                </td>
                                <td className="py-1.5 px-3 text-[11px]">
                                  {err.error_message}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 border border-line rounded-xl flex items-center space-x-3 text-xs text-success font-mono">
                      <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                      <span>
                        {dryRun
                          ? `Dry Run correcto: ${executionSummary.successful_rows.toLocaleString()} filas listas para importar. No se modificó la base de datos.`
                          : "¡Importación 100% exitosa! Todas las filas se sincronizaron en MariaDB sin inconsistencias."}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Navigation Footer */}
        <div className="px-6 py-4 bg-raised border-t border-line flex items-center justify-between text-xs">
          <div>
            {currentStep > 1 && !isExecuting && (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => (prev - 1) as any)}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-elevated hover:bg-hover text-fg font-medium transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Anterior</span>
              </button>
            )}
          </div>

          <div className="flex items-center space-x-3">
            {currentStep < 5 && (
              <button
                type="button"
                disabled={
                  (currentStep === 1 && (!previewData || isLoadingPreview)) ||
                  (currentStep === 2 &&
                    targetType === "new" &&
                    !newTableName.trim())
                }
                onClick={() => {
                  if (currentStep === 2) {
                    handleProceedToStep3();
                  } else {
                    setCurrentStep((prev) => (prev + 1) as any);
                  }
                }}
                className="flex items-center space-x-1.5 px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg font-semibold shadow-sm transition-colors disabled:opacity-40"
              >
                <span>Siguiente</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {currentStep === 5 && executionSummary && (
              <button
                type="button"
                onClick={() => {
                  resetState();
                  onClose();
                }}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-accent-fg font-semibold transition-colors"
              >
                Finalizar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
