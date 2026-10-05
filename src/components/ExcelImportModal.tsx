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

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  table?: string;
  dbColumns?: ColumnMetadata[];
  onImportComplete?: () => void;
}

type NavicatImportMode =
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

  // Step 4: Import Mode (Navicat 6 Modes)
  const [importMode, setImportMode] = useState<NavicatImportMode>("append");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-150 font-sans">
      <div className="w-full max-w-4xl bg-[#10131b] border border-[#242a3c] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#141824] border-b border-[#202638] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 border border-orange-500/30 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Asistente de Importación Excel (.xlsx / .xls)
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded bg-orange-950/40 text-orange-400 font-mono border border-orange-800/40">
                  {database}
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Compatible con opciones de importación de Navicat (Nueva tabla o tabla existente)
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              resetState();
              onClose();
            }}
            className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stepper Wizard Indicator */}
        <div className="px-6 py-3 bg-[#0d0f16] border-b border-[#1b2030] flex items-center justify-between text-xs select-none overflow-x-auto">
          {stepsList.map((item) => {
            const isActive = currentStep === item.step;
            const isCompleted = currentStep > item.step;

            return (
              <div
                key={item.step}
                className={`flex items-center space-x-2 font-medium shrink-0 ${
                  isActive
                    ? "text-orange-400 font-bold"
                    : isCompleted
                    ? "text-emerald-400"
                    : "text-neutral-500"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                    isActive
                      ? "bg-orange-500 text-black font-bold shadow-xs shadow-orange-500/50"
                      : isCompleted
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                      : "bg-[#161a25] text-neutral-500 border border-[#23293a]"
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
        <div className="flex-1 overflow-y-auto p-6 bg-[#0c0e14]">
          {/* STEP 1: FILE & PREVIEW */}
          {currentStep === 1 && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-3 sm:space-y-0 sm:space-x-3">
                <input
                  type="text"
                  placeholder="Ruta del archivo Excel (.xlsx / .xls)..."
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  className="flex-1 px-3 py-2 bg-[#12151f] border border-[#242b3e] rounded-lg text-white font-mono text-xs placeholder-neutral-500 focus:outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  onClick={handlePickFile}
                  className="flex items-center justify-center space-x-2 px-4 py-2 bg-[#1c2232] hover:bg-[#252c40] border border-[#2a344d] rounded-lg text-neutral-200 text-xs font-medium transition-colors"
                >
                  <FileUp className="w-4 h-4 text-orange-400" />
                  <span>Examinar...</span>
                </button>
                {filePath && !isLoadingPreview && (
                  <button
                    type="button"
                    onClick={() => loadPreview(filePath, selectedSheet)}
                    className="flex items-center justify-center space-x-1 px-3 py-2 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/40 rounded-lg text-orange-300 text-xs font-medium transition-colors"
                  >
                    <span>Cargar</span>
                  </button>
                )}
              </div>

              {previewError && (
                <div className="p-3 bg-red-950/30 border border-red-800/50 rounded-lg text-red-300 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{previewError}</span>
                </div>
              )}

              {isLoadingPreview && (
                <div className="flex flex-col items-center justify-center py-16 space-y-3 text-neutral-400 text-xs font-mono">
                  <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                  <span>Leyendo libro Excel con Calamine...</span>
                </div>
              )}

              {previewData && !isLoadingPreview && (
                <div className="space-y-4">
                  {/* Sheet switcher and metrics */}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="text-neutral-400">Hoja activa:</span>
                      <select
                        value={selectedSheet}
                        onChange={(e) => {
                          const sheet = e.target.value;
                          setSelectedSheet(sheet);
                          loadPreview(filePath, sheet);
                        }}
                        className="px-2.5 py-1 bg-[#131722] border border-[#252d40] rounded text-white font-mono text-xs focus:outline-none"
                      >
                        {previewData.sheets.map((sheet) => (
                          <option key={sheet} value={sheet}>
                            {sheet}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center space-x-3 text-neutral-400 font-mono text-[11px]">
                      <span>{previewData.headers.length} columnas detectadas</span>
                      <span>•</span>
                      <span className="text-emerald-400 font-semibold">
                        ~{previewData.total_rows.toLocaleString()} filas de datos
                      </span>
                    </div>
                  </div>

                  {/* 50-row preview table */}
                  <div className="border border-[#1f2536] rounded-lg overflow-x-auto max-h-72 bg-[#0e1017]">
                    <table className="w-full text-left text-xs border-collapse font-mono">
                      <thead>
                        <tr className="bg-[#151926] text-orange-300 font-semibold border-b border-[#232a3c] sticky top-0">
                          <th className="py-2 px-3 w-10 text-center text-neutral-500">
                            #
                          </th>
                          {previewData.headers.map((h, i) => (
                            <th key={i} className="py-2 px-3 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#181d2a]">
                        {previewData.preview_rows.map((row, rowIdx) => (
                          <tr key={rowIdx} className="hover:bg-[#131622]">
                            <td className="py-1.5 px-3 text-center text-neutral-600 text-[10px]">
                              {rowIdx + 1}
                            </td>
                            {row.map((cell, cellIdx) => (
                              <td
                                key={cellIdx}
                                className="py-1.5 px-3 text-neutral-300 whitespace-nowrap max-w-xs truncate"
                              >
                                {cell === null ? (
                                  <span className="text-neutral-600 italic">
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

                  <div className="text-[11px] text-neutral-500 italic">
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
                <label className="text-xs font-semibold text-neutral-300">
                  Elige dónde se importarán los datos en la base de datos:
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Option: Existing Table */}
                  <div
                    onClick={() => setTargetType("existing")}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      targetType === "existing"
                        ? "bg-orange-950/20 border-orange-500 shadow-md shadow-orange-950/40"
                        : "bg-[#11141d] border-[#1f2537] hover:border-neutral-600"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-xs text-white flex items-center space-x-2">
                        <Database className="w-4 h-4 text-orange-400" />
                        <span>Importar a una tabla existente</span>
                      </span>
                      <input
                        type="radio"
                        checked={targetType === "existing"}
                        onChange={() => setTargetType("existing")}
                        className="accent-orange-500"
                      />
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed">
                      Sincroniza o agrega los registros a una tabla ya creada en {database}.
                    </p>
                  </div>

                  {/* Option: New Table */}
                  <div
                    onClick={() => setTargetType("new")}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      targetType === "new"
                        ? "bg-orange-950/20 border-orange-500 shadow-md shadow-orange-950/40"
                        : "bg-[#11141d] border-[#1f2537] hover:border-neutral-600"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-xs text-white flex items-center space-x-2">
                        <Plus className="w-4 h-4 text-orange-400" />
                        <span>Crear como una NUEVA tabla</span>
                      </span>
                      <input
                        type="radio"
                        checked={targetType === "new"}
                        onChange={() => setTargetType("new")}
                        className="accent-orange-500"
                      />
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed">
                      Crea una nueva tabla automáticamente infiriendo los tipos de datos a partir del archivo Excel.
                    </p>
                  </div>
                </div>
              </div>

              {/* Target Type Specific Configuration */}
              {targetType === "existing" ? (
                <div className="p-4 rounded-xl bg-[#131622] border border-[#232a3c] space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <label className="text-xs font-semibold text-neutral-300">
                      Selecciona la tabla destino:
                    </label>
                    <select
                      value={selectedExistingTable}
                      onChange={(e) => setSelectedExistingTable(e.target.value)}
                      className="px-3 py-1.5 bg-[#0e1017] border border-[#252d42] rounded text-white font-mono text-xs focus:outline-none focus:border-orange-500 min-w-48"
                    >
                      {existingTables.map((tbl) => (
                        <option key={tbl.name} value={tbl.name}>
                          {tbl.name} ({tbl.rows_count ?? 0} filas)
                        </option>
                      ))}
                    </select>
                  </div>

                  {isLoadingExistingCols ? (
                    <div className="py-6 flex items-center justify-center space-x-2 text-xs text-neutral-400">
                      <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
                      <span>Inspeccionando columnas de '{selectedExistingTable}'...</span>
                    </div>
                  ) : (
                    <div className="text-xs text-neutral-400 font-mono flex items-center space-x-2">
                      <span className="text-emerald-400 font-semibold">
                        {targetColumns.length} columnas
                      </span>{" "}
                      <span>disponibles en la tabla '{selectedExistingTable}'.</span>
                    </div>
                  )}
                </div>
              ) : (
                /* New Table Designer */
                <div className="p-4 rounded-xl bg-[#131622] border border-[#232a3c] space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] text-neutral-400 block mb-1">
                        Nombre de la nueva tabla:
                      </label>
                      <input
                        type="text"
                        value={newTableName}
                        onChange={(e) => setNewTableName(e.target.value)}
                        placeholder="mi_nueva_tabla"
                        className="w-full px-3 py-1.5 bg-[#0e1017] border border-[#252d42] rounded text-white font-mono text-xs focus:outline-none focus:border-orange-500 font-semibold text-orange-300"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-neutral-400 block mb-1">
                        Motor de almacenamiento:
                      </label>
                      <select
                        value={newTableEngine}
                        onChange={(e) => setNewTableEngine(e.target.value)}
                        className="w-full px-3 py-1.5 bg-[#0e1017] border border-[#252d42] rounded text-white font-mono text-xs focus:outline-none"
                      >
                        <option value="InnoDB">InnoDB (Transaccional)</option>
                        <option value="Aria">Aria (Crash-safe)</option>
                        <option value="MyISAM">MyISAM</option>
                        <option value="MEMORY">MEMORY (En memoria RAM)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-neutral-400 block mb-1">
                        Cotejamiento (Collation):
                      </label>
                      <select
                        value={newTableCollation}
                        onChange={(e) => setNewTableCollation(e.target.value)}
                        className="w-full px-3 py-1.5 bg-[#0e1017] border border-[#252d42] rounded text-white font-mono text-xs focus:outline-none"
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
                    <div className="flex items-center justify-between text-xs text-neutral-400">
                      <span className="font-semibold text-neutral-300">
                        Estructura de columnas inferida desde Excel:
                      </span>
                    </div>

                    <div className="border border-[#1f2537] rounded-lg overflow-x-auto max-h-56 bg-[#0e1017]">
                      <table className="w-full text-left text-xs border-collapse font-mono">
                        <thead>
                          <tr className="bg-[#151926] text-neutral-300 border-b border-[#21283a] text-[11px]">
                            <th className="py-2 px-3">Nombre Columna</th>
                            <th className="py-2 px-3">Tipo de Dato</th>
                            <th className="py-2 px-3 text-center">Clave Primaria (PK)</th>
                            <th className="py-2 px-3 text-center">Permite NULL</th>
                            <th className="py-2 px-3 text-center">Auto Increment</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#171c29]">
                          {newTableColumns.map((col, idx) => (
                            <tr key={idx} className="hover:bg-[#131622]">
                              <td className="py-1.5 px-3">
                                <input
                                  type="text"
                                  value={col.name}
                                  onChange={(e) => {
                                    const updated = [...newTableColumns];
                                    updated[idx].name = e.target.value;
                                    setNewTableColumns(updated);
                                  }}
                                  className="w-full px-2 py-1 bg-[#121520] border border-[#232a3c] rounded text-white text-xs font-mono"
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
                                  className="w-full px-2 py-1 bg-[#121520] border border-[#232a3c] rounded text-orange-300 text-xs font-mono"
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
                                  className="accent-orange-500 cursor-pointer disabled:opacity-30"
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
                                  className="accent-orange-500 cursor-pointer disabled:opacity-30"
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
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <p>
                  Asigna las columnas del archivo Excel a las columnas de MariaDB (
                  <strong className="text-white font-mono">
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
                    className="text-orange-400 hover:underline"
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
                    className="text-neutral-500 hover:text-neutral-300"
                  >
                    Ignorar todas
                  </button>
                </div>
              </div>

              <div className="border border-[#1f2537] rounded-lg overflow-hidden bg-[#0e1017]">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead>
                    <tr className="bg-[#141824] text-neutral-300 border-b border-[#21283a]">
                      <th className="py-2.5 px-4 w-12 text-center">Importar</th>
                      <th className="py-2.5 px-4">Source Field (Excel)</th>
                      <th className="py-2.5 px-4 w-8 text-center text-neutral-500">
                        ➔
                      </th>
                      <th className="py-2.5 px-4">Target Field (MariaDB)</th>
                      <th className="py-2.5 px-4 w-28 text-center">Primary Key (🔑)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#171c29]">
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
                              ? "opacity-50 bg-[#0a0c10]"
                              : "hover:bg-[#131622]"
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
                              className="accent-orange-500 cursor-pointer"
                            />
                          </td>

                          <td className="py-2.5 px-4 font-semibold text-white">
                            {mapping.excel_column}
                          </td>

                          <td className="py-2.5 px-4 text-center text-orange-400">
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
                              className="w-full px-2.5 py-1.5 bg-[#121520] border border-[#232a3c] rounded text-neutral-200 text-xs focus:outline-none focus:border-orange-500 disabled:opacity-40 font-mono"
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
                                  ? "bg-amber-500/20 border border-amber-500/60 text-amber-300 shadow-xs shadow-amber-500/30 font-semibold"
                                  : "bg-[#141824] border border-[#232a3c] text-neutral-500 hover:text-amber-400 hover:border-amber-500/40"
                              } disabled:opacity-20`}
                            >
                              <Key className={`w-3.5 h-3.5 mr-1 ${mapping.is_key ? "text-amber-400 fill-amber-400/20" : ""}`} />
                              <span className="text-[11px]">{mapping.is_key ? "Key" : "—"}</span>
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

          {/* STEP 4: IMPORT MODE (NAVICAT 6 MODES) */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-xs font-semibold text-neutral-300 block">
                  Import Mode (Modos de Importación compatibles con Navicat):
                </label>

                <div className="space-y-2 bg-[#10131d] border border-[#1f2537] rounded-xl p-4">
                  {/* 1. Append */}
                  <label
                    onClick={() => setImportMode("append")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "append"
                        ? "bg-orange-950/30 text-white"
                        : "hover:bg-[#151926] text-neutral-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="navicat_mode"
                      checked={importMode === "append"}
                      onChange={() => setImportMode("append")}
                      className="accent-orange-500 mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-white block">
                        Append: add records to the destination table
                      </span>
                      <span className="text-[11px] text-neutral-400">
                        Inserta todas las filas del archivo Excel al final de la tabla de destino (<code className="text-orange-300">INSERT INTO</code>).
                      </span>
                    </div>
                  </label>

                  {/* 2. Update */}
                  <label
                    onClick={() => setImportMode("update")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "update"
                        ? "bg-orange-950/30 text-white"
                        : "hover:bg-[#151926] text-neutral-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="navicat_mode"
                      checked={importMode === "update"}
                      onChange={() => setImportMode("update")}
                      className="accent-orange-500 mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-white block">
                        Update: update records in the destination with matching records from source
                      </span>
                      <span className="text-[11px] text-neutral-400">
                        Actualiza únicamente los registros que ya existan coincidiendo por la clave primaria (<code className="text-orange-300">UPDATE ... WHERE pk = ?</code>).
                      </span>
                    </div>
                  </label>

                  {/* 3. Append / Update */}
                  <label
                    onClick={() => setImportMode("append_update")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "append_update"
                        ? "bg-orange-950/30 text-white"
                        : "hover:bg-[#151926] text-neutral-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="navicat_mode"
                      checked={importMode === "append_update"}
                      onChange={() => setImportMode("append_update")}
                      className="accent-orange-500 mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-white block">
                        Append/Update: if records exist in destination, update it. Otherwise, add it
                      </span>
                      <span className="text-[11px] text-neutral-400">
                        Si el registro existe por clave primaria lo actualiza; si no existe, lo inserta (<code className="text-orange-300">ON DUPLICATE KEY UPDATE</code>).
                      </span>
                    </div>
                  </label>

                  {/* 4. Append without update */}
                  <label
                    onClick={() => setImportMode("append_without_update")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "append_without_update"
                        ? "bg-orange-950/30 text-white"
                        : "hover:bg-[#151926] text-neutral-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="navicat_mode"
                      checked={importMode === "append_without_update"}
                      onChange={() => setImportMode("append_without_update")}
                      className="accent-orange-500 mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-white block">
                        Append without update: if records exist in destination, skip it. Otherwise, add it
                      </span>
                      <span className="text-[11px] text-neutral-400">
                        Inserta nuevos registros e ignora silenciosamente los que tengan clave duplicada (<code className="text-orange-300">INSERT IGNORE</code>).
                      </span>
                    </div>
                  </label>

                  {/* 5. Delete */}
                  <label
                    onClick={() => setImportMode("delete")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "delete"
                        ? "bg-orange-950/30 text-white"
                        : "hover:bg-[#151926] text-neutral-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="navicat_mode"
                      checked={importMode === "delete"}
                      onChange={() => setImportMode("delete")}
                      className="accent-orange-500 mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-white block">
                        Delete: delete records in destination that match records in source
                      </span>
                      <span className="text-[11px] text-neutral-400">
                        Elimina de la tabla de destino todos los registros cuyas claves coincidan con el Excel (<code className="text-red-300">DELETE WHERE pk IN (...)</code>).
                      </span>
                    </div>
                  </label>

                  {/* 6. Copy */}
                  <label
                    onClick={() => setImportMode("copy")}
                    className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      importMode === "copy"
                        ? "bg-red-950/30 text-white"
                        : "hover:bg-[#151926] text-neutral-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="navicat_mode"
                      checked={importMode === "copy"}
                      onChange={() => setImportMode("copy")}
                      className="accent-red-500 mt-0.5"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-white block">
                        Copy: delete all records in destination, repopulate from the source
                      </span>
                      <span className="text-[11px] text-neutral-400">
                        Vacía la tabla por completo (<code className="text-red-300">TRUNCATE TABLE</code>) y vuelve a poblarla con el contenido del Excel.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Matching Key(s) configuration from Step 3 */}
              {(importMode === "update" ||
                importMode === "append_update" ||
                importMode === "delete") && (
                <div className="p-4 rounded-xl bg-[#131622] border border-[#252c3f] space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-orange-400 flex items-center space-x-1.5">
                      <Key className="w-4 h-4 text-amber-400" />
                      <span>
                        Columnas Clave de Coincidencia (Llaves seleccionadas en Paso 3):
                      </span>
                    </h4>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(3)}
                      className="text-[11px] text-orange-400 hover:underline flex items-center space-x-1"
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
                              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono text-xs"
                            >
                              <Key className="w-3 h-3 text-amber-400" />
                              <span>
                                {k.excel_column} ➔ {k.db_column || k.excel_column}
                              </span>
                            </span>
                          ))}
                      </div>
                      <p className="text-[11px] text-neutral-400">
                        Se usarán estas {mappings.filter((m) => !m.ignored && m.is_key).length} columna(s) para identificar de forma unívoca cada registro durante la importación.
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-lg text-xs text-amber-300 flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>
                        No has marcado ninguna columna con el icono 🔑 en el Paso 3. Puedes hacer clic en <strong>Modificar en Paso 3</strong> para activar la(s) llave(s) deseadas.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Batch configuration */}
              <div className="flex items-center space-x-3 text-xs text-neutral-300">
                <span>Tamaño de lote:</span>
                <select
                  value={batchSize}
                  onChange={(e) => setBatchSize(parseInt(e.target.value, 10))}
                  className="px-2.5 py-1 bg-[#131622] border border-[#252c40] rounded text-white font-mono text-xs"
                >
                  <option value={200}>200 filas</option>
                  <option value={500}>500 filas</option>
                  <option value={1000}>1,000 filas (Recomendado)</option>
                </select>
                <span className="text-[11px] text-neutral-500">
                  (lote multi-fila, limitado para controlar memoria y packet size)
                </span>
              </div>

              <div className="grid gap-3 rounded-xl border border-[#222a3d] bg-[#10131d] p-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs text-neutral-200">
                  <span className="block font-semibold">Filas inválidas</span>
                  <select
                    value={errorStrategy}
                    onChange={(event) =>
                      setErrorStrategy(event.target.value as "strict" | "tolerant")
                    }
                    className="w-full rounded-md border border-[#252c40] bg-[#131622] px-2.5 py-2 text-xs text-white"
                  >
                    <option value="tolerant">Tolerante — omitirlas y continuar</option>
                    <option value="strict">Estricto — abortar y revertir el lote completo</option>
                  </select>
                  {errorStrategy === "strict" && (
                    <span className="block text-[11px] text-amber-300">
                      Requiere TCP o SSH, tabla InnoDB y no admite HTTP Tunnel.
                    </span>
                  )}
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-sky-800/40 bg-sky-950/20 p-3 text-xs text-sky-100">
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(event) => setDryRun(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-sky-700 bg-neutral-900 text-sky-500"
                  />
                  <span>
                    <strong className="block">Dry Run — validar sin modificar</strong>
                    <span className="mt-1 block text-[11px] text-sky-200/80">
                      Revisa mapeos, tipos, columnas requeridas y claves duplicadas antes de escribir.
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
                  <div className="w-14 h-14 rounded-2xl bg-orange-600/15 border border-orange-500/30 flex items-center justify-center mx-auto text-orange-400">
                    <Play className="w-7 h-7 fill-current ml-1" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      Listo para procesar ~{previewData?.total_rows.toLocaleString()} filas
                    </h3>
                    <p className="text-xs text-neutral-400 mt-1 max-w-md mx-auto">
                      Tabla destino:{" "}
                      <strong className="text-orange-400 font-mono">
                        {targetType === "new" ? newTableName : selectedExistingTable}
                      </strong>{" "}
                      ({targetType === "new" ? "Nueva tabla" : "Tabla existente"}). Modo:{" "}
                      <strong className="text-amber-400 uppercase font-mono">
                        {importMode}
                      </strong>.
                    </p>
                  </div>
                  <button
                    onClick={handleExecuteImport}
                    className="px-6 py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-lg font-bold text-xs shadow-lg shadow-orange-950/60 transition-all active:scale-95"
                  >
                    {dryRun ? "Ejecutar Dry Run" : "Iniciar Importación Masiva"}
                  </button>
                </div>
              )}

              {isExecuting && (
                <div className="py-8 px-6 space-y-5 bg-[#10131d] border border-[#1e2538] rounded-2xl max-w-xl mx-auto shadow-2xl animate-in fade-in">
                  {/* Status header */}
                  <div className="flex items-center space-x-3 text-left">
                    <div className="w-11 h-11 rounded-xl bg-orange-600/20 border border-orange-500/30 flex items-center justify-center shrink-0">
                      <Loader2 className="w-5 h-5 animate-spin text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-white font-mono truncate">
                        {progress?.stage || "Procesando importación..."}
                      </h3>
                      <p className="text-xs text-neutral-400 font-mono mt-0.5 truncate">
                        Destino:{" "}
                        <span className="text-orange-400 font-bold">
                          {targetType === "new" ? newTableName : selectedExistingTable}
                        </span>{" "}
                        • Modo:{" "}
                        <span className="text-amber-400 uppercase font-semibold">
                          {importMode}
                        </span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-2xl font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-300">
                        {progress ? `${progress.percentage.toFixed(1)}%` : "0.0%"}
                      </span>
                    </div>
                  </div>

                  {/* Visual Progress Bar Track */}
                  <div className="space-y-1.5">
                    <div className="w-full h-3.5 bg-[#090b10] rounded-full overflow-hidden border border-[#23293d] p-0.5 shadow-inner relative">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-600 via-amber-500 to-orange-400 transition-all duration-300 ease-out shadow-[0_0_12px_rgba(255,92,22,0.6)]"
                        style={{
                          width: `${Math.max(progress?.percentage || 0, progress ? 1 : 0)}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                      <span>
                        Procesadas:{" "}
                        <strong className="text-white">
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
                      <span className="text-amber-400/90 font-medium">
                        Lotes de {batchSize.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Live Counters */}
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#1a1f2e] text-left">
                    <div className="p-2.5 rounded-lg bg-emerald-950/25 border border-emerald-800/40 flex items-center justify-between">
                      <span className="text-[11px] text-emerald-400 font-mono">
                        Filas Exitosas:
                      </span>
                      <span className="text-xs font-bold font-mono text-emerald-300">
                        {(progress?.successful_rows || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-red-950/25 border border-red-800/40 flex items-center justify-between">
                      <span className="text-[11px] text-red-400 font-mono">
                        Filas con Error:
                      </span>
                      <span className="text-xs font-bold font-mono text-red-300">
                        {(progress?.failed_rows || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {executionError && (
                <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-red-200 text-xs font-mono space-y-2">
                  <div className="flex items-center space-x-2 font-bold text-red-400">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span>Error al ejecutar la importación:</span>
                  </div>
                  <p className="whitespace-pre-wrap">{executionError}</p>
                  <button
                    type="button"
                    onClick={handleExecuteImport}
                    className="mt-2 px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white rounded text-xs font-semibold"
                  >
                    Reintentar
                  </button>
                </div>
              )}

              {executionSummary && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  {/* Metric Summary Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-4 rounded-xl bg-[#131622] border border-[#202638]">
                      <span className="text-[11px] text-neutral-400 block mb-1">
                        Total Procesadas
                      </span>
                      <span className="text-lg font-bold font-mono text-white">
                        {executionSummary.total_processed.toLocaleString()}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-800/40">
                      <span className="text-[11px] text-emerald-400 block mb-1">
                        {dryRun ? "Filas válidas (estimadas)" : "Importadas"}
                      </span>
                      <span className="text-lg font-bold font-mono text-emerald-300">
                        {executionSummary.successful_rows.toLocaleString()}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-red-950/20 border border-red-800/40">
                      <span className="text-[11px] text-red-400 block mb-1">
                        Omitidas
                      </span>
                      <span className="text-lg font-bold font-mono text-red-300">
                        {(executionSummary.skipped_rows ?? executionSummary.failed_rows).toLocaleString()}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-[#131622] border border-[#202638]">
                      <span className="text-[11px] text-neutral-400 block mb-1">
                        Errores detectados
                      </span>
                      <span className="text-lg font-bold font-mono text-orange-400">
                        {(executionSummary.error_count ?? executionSummary.errors.length).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <p className="text-right text-[11px] text-neutral-500">
                    {dryRun ? "Validación" : "Importación"} completada en{" "}
                    {(executionSummary.execution_time_ms / 1000).toFixed(2)} s
                  </p>

                  {/* Errors table if any */}
                  {executionSummary.errors.length > 0 ? (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-red-400 flex items-center space-x-1.5">
                        <AlertCircle className="w-4 h-4" />
                        <span>
                          Registro de incidencias ({executionSummary.errors.length} mostradas):
                        </span>
                      </h4>
                      <div className="border border-red-900/40 rounded-lg overflow-hidden max-h-48 overflow-y-auto bg-[#130b0e]">
                        <table className="w-full text-left text-xs font-mono border-collapse">
                          <thead>
                            <tr className="bg-red-950/60 text-red-300 border-b border-red-900/50">
                              <th className="py-2 px-3 w-24">Fila Excel</th>
                              <th className="py-2 px-3">Columna</th>
                              <th className="py-2 px-3">Valor</th>
                              <th className="py-2 px-3">Causa</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-red-900/30 text-red-200">
                            {executionSummary.errors.map((err, i) => (
                              <tr key={i}>
                                <td className="py-1.5 px-3 font-bold text-red-400">
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
                    <div className="p-4 bg-emerald-950/30 border border-emerald-800/40 rounded-xl flex items-center space-x-3 text-xs text-emerald-300 font-mono">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
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
        <div className="px-6 py-4 bg-[#141824] border-t border-[#202638] flex items-center justify-between text-xs">
          <div>
            {currentStep > 1 && !isExecuting && (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => (prev - 1) as any)}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-[#1a1f2d] hover:bg-[#232a3d] text-neutral-300 font-medium transition-colors"
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
                className="flex items-center space-x-1.5 px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold shadow-md shadow-orange-950/50 transition-colors disabled:opacity-40"
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
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
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
