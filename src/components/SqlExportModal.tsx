import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
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
import { ghostBtn, primaryBtn, secondaryBtn } from "./ui/styles";
import { useUIStore } from "../stores/uiStore";
import { Modal } from "./ui/Modal";
import { errorText } from "../utils/errors";

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
  const { t } = useTranslation("transfer");
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
  const [includeReplicationCoords, setIncludeReplicationCoords] = useState<boolean>(false);

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
      setIncludeReplicationCoords(false);
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

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isExporting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isExporting, onClose]);

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
        include_replication_coordinates: includeReplicationCoords,
      };

      const result = await dbService.exportSqlDump(request);
      setSummary(result);
    } catch (err: unknown) {
      console.error("SQL Dump export error:", err);
      setError(
        errorText(err, t("sqlExport.exportError"))
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
        include_replication_coordinates: includeReplicationCoords,
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
        errorText(err, t("sqlExport.clipboardError"))
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={<><span>{t("sqlExport.title")}</span> <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-accent-soft text-accent-text border border-accent/30"> {t("sqlExport.optimizedBadge")} </span></>}
      subtitle={<>{t("sqlExport.subtitle")}</>}
      icon={<FileCode2 className="w-5 h-5" />}
      size="md"
      bodyClassName="pyro-operation-modal flex flex-col overflow-hidden"
    >
      <div className="p-6 space-y-5 max-h-[calc(85vh-130px)] overflow-y-auto">
          {/* Error Message */}
          {error && (
            <div className="p-3.5 rounded-lg border border-line text-danger text-xs flex items-start space-x-2.5">
              <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block mb-0.5">{t("sqlExport.errorHeader")}</span>
                <span className="font-mono text-[11px] break-all">{error}</span>
              </div>
            </div>
          )}

          {/* Success Summary */}
          {summary && (
            <div className="p-4 rounded-xl border border-line text-success text-xs space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-success" />
                  <span className="font-bold text-success text-sm">
                    {summary.file_path ? t("sqlExport.successFile") : t("sqlExport.successClipboard")}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-success/80">
                  {summary.duration_ms} ms
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                <div className="bg-canvas p-2 rounded border border-line">
                  <span className="text-fg-muted text-[11px] block">{t("sqlExport.tables")}</span>
                  <span className="font-bold text-fg text-sm">{summary.total_tables}</span>
                </div>
                <div className="bg-canvas p-2 rounded border border-line">
                  <span className="text-fg-muted text-[11px] block">{t("sqlExport.insertedRows")}</span>
                  <span className="font-bold text-fg text-sm">{summary.total_rows_exported.toLocaleString()}</span>
                </div>
                <div className="bg-canvas p-2 rounded border border-line">
                  <span className="text-fg-muted text-[11px] block">{t("sqlExport.scriptSize")}</span>
                  <span className="font-bold text-fg text-sm">{formatBytes(summary.file_size_bytes)}</span>
                </div>
              </div>

              {summary.file_path && (
                <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2 rounded border border-line">
                  <span className="text-fg-muted block text-[11px]">{t("sqlExport.savedTo")}</span>
                  <span className="text-success select-all">{summary.file_path}</span>
                </div>
              )}

              {/* Snapshot status and Binlog coordinates */}
              {summary.consistent_snapshot && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium bg-accent-soft text-accent-text border border-accent/20">
                    <ShieldCheck className="w-3 h-3 text-accent-text" />
                    {t("sqlExport.consistentSnapshot")}
                  </span>
                  {summary.binlog_coordinates && (
                    <span className="font-mono text-fg-muted truncate max-w-full" title={summary.binlog_coordinates}>
                      Binlog: {summary.binlog_coordinates}
                    </span>
                  )}
                </div>
              )}

              {/* Non-transactional tables warning */}
              {summary.non_transactional_tables && summary.non_transactional_tables.length > 0 && (
                <div className="p-2.5 rounded-lg border border-line bg-surface text-warning text-xs flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold block mb-0.5">{t("sqlExport.nonTransactionalTitle")}</span>
                    <span className="text-[11px] text-fg-muted block">
                      {t("sqlExport.nonTransactionalDesc", { tables: summary.non_transactional_tables.join(", ") })}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Target Scope Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-fg flex items-center justify-between">
              <span>{t("sqlExport.exportTarget")}</span>
              <span className="text-[11px] font-mono text-accent-text font-normal">
                {t("sqlExport.databaseLabel")} <span className="font-bold">{database}</span>
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTargetScope("database")}
                disabled={isExporting}
                className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                  targetScope === "database"
                    ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                    : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                }`}
              >
                <Database className={`w-5 h-5 shrink-0 mt-0.5 ${targetScope === "database" ? "text-accent-text" : "text-fg-subtle"}`} />
                <div>
                  <div className="font-semibold text-xs text-fg">{t("sqlExport.wholeDb")}</div>
                  <div className="text-[11px] text-fg-muted mt-0.5">
                    {t("sqlExport.wholeDbDesc", { count: dbTables.length })}
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
                    ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                    : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                }`}
              >
                <TableIcon className={`w-5 h-5 shrink-0 mt-0.5 ${targetScope === "table" ? "text-accent-text" : "text-fg-subtle"}`} />
                <div>
                  <div className="font-semibold text-xs text-fg">{t("sqlExport.specificTable")}</div>
                  <div className="text-[11px] text-fg-muted mt-0.5">
                    {t("sqlExport.specificTableDesc")}
                  </div>
                </div>
              </button>
            </div>

            {targetScope === "table" && (
              <div className="pt-2 animate-in fade-in">
                <label className="text-[11px] font-semibold text-fg-muted block mb-1">
                  {t("sqlExport.selectTableLabel")}
                </label>
                <select
                  value={selectedTable}
                  onChange={(e) => setSelectedTable(e.target.value)}
                  disabled={isExporting}
                  aria-label={t("sqlExport.selectTableAria")}
                  className="w-full bg-raised border border-line rounded-lg px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-accent transition-colors"
                >
                  {dbTables.length === 0 ? (
                    <option value="">{t("sqlExport.noTablesAvailable")}</option>
                  ) : (
                    dbTables.map((tbl) => (
                      <option key={tbl.name} value={tbl.name}>
                        {tbl.name} {tbl.rows_count !== null && tbl.rows_count !== undefined ? t("sqlExport.rowsSuffix", { count: tbl.rows_count.toLocaleString() }) : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}
          </div>

          {/* Content Mode Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-fg">
              {t("sqlExport.contentToInclude")}
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setContentMode("structure_and_data")}
                disabled={isExporting}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  contentMode === "structure_and_data"
                    ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                    : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                }`}
              >
                <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-fg-muted" />
                  <span>{t("sqlExport.structureAndData")}</span>
                </div>
                <div className="text-[11px] text-fg-muted mt-1">
                  {t("sqlExport.structureAndDataDesc")}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setContentMode("structure_only")}
                disabled={isExporting}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  contentMode === "structure_only"
                    ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                    : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                }`}
              >
                <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5 text-fg-muted" />
                  <span>{t("sqlExport.structureOnly")}</span>
                </div>
                <div className="text-[11px] text-fg-muted mt-1">
                  {t("sqlExport.structureOnlyDesc")}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setContentMode("data_only")}
                disabled={isExporting}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  contentMode === "data_only"
                    ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                    : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                }`}
              >
                <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-fg-muted" />
                  <span>{t("sqlExport.dataOnly")}</span>
                </div>
                <div className="text-[11px] text-fg-muted mt-1">
                  {t("sqlExport.dataOnlyDesc")}
                </div>
              </button>
            </div>
          </div>

          {/* Advanced SQL Dump Options */}
          <div className="space-y-3 bg-raised p-4 rounded-xl border border-line">
            <div className="flex items-center space-x-2 text-xs font-semibold text-fg pb-2 border-b border-line">
              <ShieldCheck className="w-4 h-4 text-accent-text" />
              <span>{t("sqlExport.optionsHeader")}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {contentMode !== "data_only" && (
                <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                  <input
                    type="checkbox"
                    checked={addDropTable}
                    onChange={(e) => setAddDropTable(e.target.checked)}
                    disabled={isExporting}
                    className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent cursor-pointer"
                  />
                  <span>{t("sqlExport.addDropTable")} <code className="text-accent-text text-[11px]">DROP TABLE IF EXISTS</code></span>
                </label>
              )}

              {targetScope === "database" && contentMode !== "data_only" && (
                <>
                  <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                    <input
                      type="checkbox"
                      checked={includeViews}
                      onChange={(e) => setIncludeViews(e.target.checked)}
                      disabled={isExporting}
                      className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent cursor-pointer"
                    />
                    <span>{t("sqlExport.includeViews")}<code className="text-fg-muted text-[11px]">VIEW</code>)</span>
                  </label>

                  <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                    <input
                      type="checkbox"
                      checked={includeRoutines}
                      onChange={(e) => setIncludeRoutines(e.target.checked)}
                      disabled={isExporting}
                      className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent cursor-pointer"
                    />
                    <span>{t("sqlExport.includeRoutines")}</span>
                  </label>
                </>
              )}

              {contentMode !== "data_only" && (
                <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                  <input
                    type="checkbox"
                    checked={includeTriggers}
                    onChange={(e) => setIncludeTriggers(e.target.checked)}
                    disabled={isExporting}
                    className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent cursor-pointer"
                  />
                  <span>{t("sqlExport.includeTriggers")}</span>
                </label>
              )}

              <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                <input
                  type="checkbox"
                  checked={disableForeignKeys}
                  onChange={(e) => setDisableForeignKeys(e.target.checked)}
                  disabled={isExporting}
                  className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent cursor-pointer"
                />
                <span>{t("sqlExport.disableFk")}</span>
              </label>

              {contentMode !== "structure_only" && (
                <>
                  <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                    <input
                      type="checkbox"
                      checked={useTransaction}
                      onChange={(e) => setUseTransaction(e.target.checked)}
                      disabled={isExporting}
                      className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent cursor-pointer"
                    />
                    <span>{t("sqlExport.wrapTransaction")}<code className="text-success text-[11px]">START TRANSACTION</code>)</span>
                  </label>

                  <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                    <input
                      type="checkbox"
                      checked={useExtendedInserts}
                      onChange={(e) => setUseExtendedInserts(e.target.checked)}
                      disabled={isExporting}
                      className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent cursor-pointer"
                    />
                    <span>{t("sqlExport.extendedInserts")}</span>
                  </label>
                </>
              )}

              <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg col-span-1 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={includeReplicationCoords}
                  onChange={(e) => setIncludeReplicationCoords(e.target.checked)}
                  disabled={isExporting}
                  className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent cursor-pointer"
                />
                <span>{t("sqlExport.includeReplication")}</span>
              </label>
            </div>

            {contentMode !== "structure_only" && useExtendedInserts && (
              <div className="pt-2 border-t border-line flex items-center justify-between text-xs">
                <span className="text-fg-muted">{t("sqlExport.rowsPerInsert")}</span>
                <select
                  value={insertBatchSize}
                  onChange={(e) => setInsertBatchSize(Number(e.target.value))}
                  disabled={isExporting}
                  aria-label={t("sqlExport.rowsPerInsertAria")}
                  className="bg-surface border border-line rounded px-2.5 py-1 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                >
                  <option value={100}>{t("sqlExport.batch100")}</option>
                  <option value={250}>{t("sqlExport.batch250")}</option>
                  <option value={500}>{t("sqlExport.batch500")}</option>
                  <option value={1000}>{t("sqlExport.batch1000")}</option>
                </select>
              </div>
            )}
          </div>
        </div>
<div className="px-6 py-4 bg-raised border-t border-line flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className={secondaryBtn}
          >
            {t("sqlExport.close")}
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                useUIStore.getState().openDataMaskingModal(database);
              }}
              disabled={isExporting}
              title={t("sqlExport.anonymizeTitle")}
              className={ghostBtn}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {t("sqlExport.anonymizeBtn")}
            </button>
            <button
              type="button"
              onClick={handleGeneratePreviewAndCopy}
              disabled={isExporting || (targetScope === "table" && !selectedTable)}
              className="flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-fg bg-elevated hover:bg-hover border border-line-strong rounded-lg transition-colors disabled:opacity-50"
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-fg-muted" />
              ) : copiedPreview ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-fg-muted" />
              )}
              <span>{copiedPreview ? t("sqlExport.copiedClipboard") : t("sqlExport.copySql")}</span>
            </button>

            <button
              type="button"
              onClick={handleExportToFile}
              disabled={isExporting || (targetScope === "table" && !selectedTable)}
              className={primaryBtn}
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t("sqlExport.exportingSql")}</span>
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  <span>{t("sqlExport.saveSqlFile")}</span>
                </>
              )}
            </button>
          </div>
        </div>
    </Modal>
  );
};
