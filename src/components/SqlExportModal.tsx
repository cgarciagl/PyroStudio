import React, { useState, useEffect } from "react";
import {
  X,
  FileCode2,
  Database,
  Table as TableIcon,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Loader2,
  Settings2,
  Layers,
  Sparkles,
  ShieldCheck,
  FileDown,
} from "lucide-react";
import type {
  SqlDumpRequest,
  SqlDumpSummary,
} from "../types/database";
import { dbService } from "../services/tauriDb";
import { useSchemaStore } from "../stores/schemaStore";

interface SqlExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  table?: string;
}

type ExportContentMode = "structure_and_data" | "structure_only" | "data_only";

export const SqlExportModal: React.FC<SqlExportModalProps> = ({
  isOpen,
  onClose,
  database,
  table: initialTable,
}) => {
  const { tables, loadSchemaObjects } = useSchemaStore();

  // Target Configuration
  const [targetScope, setTargetScope] = useState<"database" | "table">(
    initialTable ? "table" : "database"
  );
  const [selectedTable, setSelectedTable] = useState<string>(initialTable || "");

  // Content Mode
  const [contentMode, setContentMode] = useState<ExportContentMode>(
    "structure_and_data"
  );

  // Advanced Options
  const [addDropTable, setAddDropTable] = useState<boolean>(true);
  const [includeViews, setIncludeViews] = useState<boolean>(true);
  const [includeRoutines, setIncludeRoutines] = useState<boolean>(true);
  const [includeTriggers, setIncludeTriggers] = useState<boolean>(true);
  const [disableForeignKeys, setDisableForeignKeys] = useState<boolean>(true);
  const [useTransaction, setUseTransaction] = useState<boolean>(true);
  const [useExtendedInserts, setUseExtendedInserts] = useState<boolean>(true);
  const [insertBatchSize, setInsertBatchSize] = useState<number>(250);

  // Execution state
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SqlDumpSummary | null>(null);
  const [copiedPreview, setCopiedPreview] = useState<boolean>(false);

  // Initialize or update tables when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSummary(null);
      setCopiedPreview(false);
      if (initialTable) {
        setTargetScope("table");
        setSelectedTable(initialTable);
      } else {
        setTargetScope("database");
      }
      if (!tables[database] || tables[database].length === 0) {
        void loadSchemaObjects(database);
      }
    }
  }, [isOpen, database, initialTable]);

  if (!isOpen) return null;

  const dbTables = tables[database] || [];

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getSuggestedFilename = () => {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "_")
      .slice(0, 15);
    if (targetScope === "table" && selectedTable) {
      return `${database}_${selectedTable}_dump_${timestamp}.sql`;
    }
    return `${database}_dump_${timestamp}.sql`;
  };

  const handleExportToFile = async () => {
    setError(null);
    setSummary(null);
    try {
      const defaultName = getSuggestedFilename();
      const savePath = await dbService.saveSqlDialog(defaultName);
      if (!savePath) {
        return; // User canceled native file save dialog
      }

      setIsExporting(true);

      const request: SqlDumpRequest = {
        database,
        tables: targetScope === "table" && selectedTable ? [selectedTable] : undefined,
        export_mode: contentMode,
        include_drop_table: addDropTable,
        include_views: includeViews && targetScope === "database",
        include_routines: includeRoutines && targetScope === "database",
        include_triggers: includeTriggers,
        insert_batch_size: insertBatchSize,
        output_file_path: savePath,
      };

      const result = await dbService.exportSqlDump(request);
      setSummary(result);
    } catch (err: unknown) {
      console.error("SQL Dump export error:", err);
      setError(
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al exportar script SQL"
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleGeneratePreviewAndCopy = async () => {
    setError(null);
    setSummary(null);
    try {
      setIsExporting(true);

      const request: SqlDumpRequest = {
        database,
        tables: targetScope === "table" && selectedTable ? [selectedTable] : undefined,
        export_mode: contentMode,
        include_drop_table: addDropTable,
        include_views: includeViews && targetScope === "database",
        include_routines: includeRoutines && targetScope === "database",
        include_triggers: includeTriggers,
        insert_batch_size: insertBatchSize,
        output_file_path: undefined, // in-memory
      };

      const result = await dbService.exportSqlDump(request);
      setSummary(result);

      if (result.sql_preview) {
        await navigator.clipboard.writeText(result.sql_preview);
        setCopiedPreview(true);
        setTimeout(() => setCopiedPreview(false), 3000);
      }
    } catch (err: unknown) {
      console.error("SQL Dump preview error:", err);
      setError(
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al generar SQL para portapapeles"
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-[#0f1219] border border-[#202738] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col text-neutral-200 my-auto">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#141824] border-b border-[#202738] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-orange-950/50 border border-orange-500/30 flex items-center justify-center text-orange-400">
              <FileCode2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Exportar a SQL (.sql Dump)</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-orange-950/70 text-orange-400 border border-orange-800/40">
                  Optimizado
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Genera scripts SQL compatibles con MariaDB y MySQL con multi-row INSERTs de alta velocidad.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isExporting}
            className="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-[#202738] transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[calc(85vh-130px)] overflow-y-auto">
          {/* Error Message */}
          {error && (
            <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-200 text-xs flex items-start space-x-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block mb-0.5">Error en la exportación</span>
                <span className="font-mono text-[11px] break-all">{error}</span>
              </div>
            </div>
          )}

          {/* Success Summary */}
          {summary && (
            <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-700/40 text-emerald-200 text-xs space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between border-b border-emerald-800/30 pb-2">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-emerald-300 text-sm">
                    {summary.file_path ? "¡Exportación completada exitosamente!" : "¡Script SQL generado y copiado!"}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-emerald-400/80">
                  {summary.duration_ms} ms
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                <div className="bg-[#0b121c] p-2 rounded border border-emerald-900/40">
                  <span className="text-neutral-400 text-[10px] block">Tablas</span>
                  <span className="font-bold text-white text-sm">{summary.total_tables}</span>
                </div>
                <div className="bg-[#0b121c] p-2 rounded border border-emerald-900/40">
                  <span className="text-neutral-400 text-[10px] block">Filas Insertadas</span>
                  <span className="font-bold text-white text-sm">{summary.total_rows_exported.toLocaleString()}</span>
                </div>
                <div className="bg-[#0b121c] p-2 rounded border border-emerald-900/40">
                  <span className="text-neutral-400 text-[10px] block">Tamaño del Script</span>
                  <span className="font-bold text-white text-sm">{formatBytes(summary.file_size_bytes)}</span>
                </div>
              </div>

              {summary.file_path && (
                <div className="text-[11px] text-neutral-300 font-mono break-all pt-1 bg-[#0b121c] p-2 rounded border border-emerald-900/30">
                  <span className="text-neutral-400 block text-[10px]">Guardado en:</span>
                  <span className="text-emerald-300 select-all">{summary.file_path}</span>
                </div>
              )}
            </div>
          )}

          {/* Target Scope Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
              <span>Objetivo de Exportación</span>
              <span className="text-[11px] font-mono text-orange-400 font-normal">
                Base de datos: <span className="font-bold">{database}</span>
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTargetScope("database")}
                disabled={isExporting}
                className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                  targetScope === "database"
                    ? "bg-orange-950/30 border-orange-500/60 text-white shadow-sm ring-1 ring-orange-500/30"
                    : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                }`}
              >
                <Database className={`w-5 h-5 shrink-0 mt-0.5 ${targetScope === "database" ? "text-orange-400" : "text-neutral-500"}`} />
                <div>
                  <div className="font-semibold text-xs text-white">Toda la Base de Datos</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">
                    Exporta todas las tablas ({dbTables.length}), vistas, rutinas y triggers.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTargetScope("table");
                  if (!selectedTable && dbTables.length > 0) {
                    setSelectedTable(dbTables[0].name);
                  }
                }}
                disabled={isExporting}
                className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                  targetScope === "table"
                    ? "bg-orange-950/30 border-orange-500/60 text-white shadow-sm ring-1 ring-orange-500/30"
                    : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                }`}
              >
                <TableIcon className={`w-5 h-5 shrink-0 mt-0.5 ${targetScope === "table" ? "text-orange-400" : "text-neutral-500"}`} />
                <div>
                  <div className="font-semibold text-xs text-white">Tabla Específica</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">
                    Exporta el DDL y los registros de una única tabla seleccionada.
                  </div>
                </div>
              </button>
            </div>

            {targetScope === "table" && (
              <div className="pt-2 animate-in fade-in">
                <label className="text-[11px] font-semibold text-neutral-400 block mb-1">
                  Selecciona la tabla a exportar:
                </label>
                <select
                  value={selectedTable}
                  onChange={(e) => setSelectedTable(e.target.value)}
                  disabled={isExporting}
                  aria-label="Selecciona la tabla a exportar"
                  className="w-full bg-[#121622] border border-[#242c40] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-orange-500 transition-colors"
                >
                  {dbTables.length === 0 ? (
                    <option value="">(Sin tablas disponibles)</option>
                  ) : (
                    dbTables.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name} {t.rows_count !== null && t.rows_count !== undefined ? `(${t.rows_count.toLocaleString()} filas)` : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}
          </div>

          {/* Content Mode Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-neutral-300">
              Contenido a Incluir
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setContentMode("structure_and_data")}
                disabled={isExporting}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  contentMode === "structure_and_data"
                    ? "bg-orange-600/20 border-orange-500/60 text-white shadow-sm ring-1 ring-orange-500/30"
                    : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                }`}
              >
                <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-orange-400" />
                  <span>Estructura y Datos</span>
                </div>
                <div className="text-[10px] text-neutral-400 mt-1">
                  CREATE TABLE + INSERTs de datos optimizados.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setContentMode("structure_only")}
                disabled={isExporting}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  contentMode === "structure_only"
                    ? "bg-orange-600/20 border-orange-500/60 text-white shadow-sm ring-1 ring-orange-500/30"
                    : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                }`}
              >
                <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>Solo Estructura</span>
                </div>
                <div className="text-[10px] text-neutral-400 mt-1">
                  Solo DDL (tablas, índices, claves, rutinas) sin filas.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setContentMode("data_only")}
                disabled={isExporting}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  contentMode === "data_only"
                    ? "bg-orange-600/20 border-orange-500/60 text-white shadow-sm ring-1 ring-orange-500/30"
                    : "bg-[#141824] border-[#22293b] text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                }`}
              >
                <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Solo Datos</span>
                </div>
                <div className="text-[10px] text-neutral-400 mt-1">
                  Solo sentencias INSERT optimizadas sin DDL.
                </div>
              </button>
            </div>
          </div>

          {/* Advanced SQL Dump Options */}
          <div className="space-y-3 bg-[#121622] p-4 rounded-xl border border-[#202738]">
            <div className="flex items-center space-x-2 text-xs font-semibold text-neutral-200 pb-2 border-b border-[#1f2638]">
              <ShieldCheck className="w-4 h-4 text-orange-400" />
              <span>Opciones de Optimización y Compatibilidad</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {contentMode !== "data_only" && (
                <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={addDropTable}
                    onChange={(e) => setAddDropTable(e.target.checked)}
                    disabled={isExporting}
                    className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500 cursor-pointer"
                  />
                  <span>Agregar <code className="text-orange-400 text-[11px]">DROP TABLE IF EXISTS</code></span>
                </label>
              )}

              {targetScope === "database" && contentMode !== "data_only" && (
                <>
                  <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={includeViews}
                      onChange={(e) => setIncludeViews(e.target.checked)}
                      disabled={isExporting}
                      className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500 cursor-pointer"
                    />
                    <span>Incluir Vistas (<code className="text-sky-400 text-[11px]">VIEW</code>)</span>
                  </label>

                  <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={includeRoutines}
                      onChange={(e) => setIncludeRoutines(e.target.checked)}
                      disabled={isExporting}
                      className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500 cursor-pointer"
                    />
                    <span>Incluir Procedimientos y Funciones</span>
                  </label>
                </>
              )}

              {contentMode !== "data_only" && (
                <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={includeTriggers}
                    onChange={(e) => setIncludeTriggers(e.target.checked)}
                    disabled={isExporting}
                    className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500 cursor-pointer"
                  />
                  <span>Incluir Triggers</span>
                </label>
              )}

              <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={disableForeignKeys}
                  onChange={(e) => setDisableForeignKeys(e.target.checked)}
                  disabled={isExporting}
                  className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500 cursor-pointer"
                />
                <span>Desactivar Foreign Keys temporalmente</span>
              </label>

              {contentMode !== "structure_only" && (
                <>
                  <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={useTransaction}
                      onChange={(e) => setUseTransaction(e.target.checked)}
                      disabled={isExporting}
                      className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500 cursor-pointer"
                    />
                    <span>Envolver en Transacción (<code className="text-emerald-400 text-[11px]">START TRANSACTION</code>)</span>
                  </label>

                  <label className="flex items-center space-x-2.5 cursor-pointer text-neutral-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={useExtendedInserts}
                      onChange={(e) => setUseExtendedInserts(e.target.checked)}
                      disabled={isExporting}
                      className="w-4 h-4 rounded bg-[#0d0f15] border-neutral-700 text-orange-600 focus:ring-orange-500 cursor-pointer"
                    />
                    <span>Multi-row INSERTs optimizados</span>
                  </label>
                </>
              )}
            </div>

            {contentMode !== "structure_only" && useExtendedInserts && (
              <div className="pt-2 border-t border-[#1f2638] flex items-center justify-between text-xs">
                <span className="text-neutral-400">Filas por cada sentencia INSERT múltiple:</span>
                <select
                  value={insertBatchSize}
                  onChange={(e) => setInsertBatchSize(Number(e.target.value))}
                  disabled={isExporting}
                  aria-label="Filas por cada sentencia INSERT múltiple"
                  className="bg-[#0e111a] border border-[#252c40] rounded px-2.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-orange-500"
                >
                  <option value={100}>100 filas / INSERT</option>
                  <option value={250}>250 filas / INSERT (Recomendado)</option>
                  <option value={500}>500 filas / INSERT (Alta densidad)</option>
                  <option value={1000}>1,000 filas / INSERT (Máxima velocidad)</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-[#141824] border-t border-[#202738] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 text-xs font-semibold text-neutral-400 hover:text-white hover:bg-[#202738] rounded-lg transition-colors disabled:opacity-50"
          >
            Cerrar
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleGeneratePreviewAndCopy}
              disabled={isExporting || (targetScope === "table" && !selectedTable)}
              className="flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-300 bg-[#191e2e] hover:bg-[#22293e] border border-[#2b344e] rounded-lg transition-colors disabled:opacity-50"
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
              ) : copiedPreview ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-neutral-400" />
              )}
              <span>{copiedPreview ? "¡Copiado al Portapapeles!" : "Copiar SQL"}</span>
            </button>

            <button
              type="button"
              onClick={handleExportToFile}
              disabled={isExporting || (targetScope === "table" && !selectedTable)}
              className="flex items-center space-x-2 px-5 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-500 rounded-lg transition-all shadow-md hover:shadow-orange-600/20 disabled:opacity-50"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Exportando SQL...</span>
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  <span>Guardar Archivo .sql</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
