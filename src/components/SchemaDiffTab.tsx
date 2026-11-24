import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode,
  GitCompare,
  Loader2,
  Play,
  Save,
  Table,
  X,
  Zap,
  Sparkles,
  Bot,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { dbService } from "../services/tauriDb";
import { aiService } from "../services/aiService";
import { downloadFile } from "../services/diagnosticExport";
import { connectionStorage } from "../services/connectionStorage";
import { useSchemaStore } from "../stores/schemaStore";
import { useUIStore } from "../stores/uiStore";
import { useAiStore } from "../stores/aiStore";
import { useIsLightTheme } from "../stores/preferenceStore";
import type {
  DatabaseSchema,
  MigrationPlan,
  SavedConnection,
  SchemaDiffResult,
  MigrationReviewResult,
} from "../types/database";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { primaryBtn } from "./ui/styles";
import { uid } from "../utils/uid";
import { errorText } from "../utils/errors";

interface SchemaDiffTabProps {
  initialSourceDb?: string;
  initialTargetDb?: string;
  databases?: DatabaseSchema[];
  onExecuteMigration?: (sql: string) => void;
}

const SYSTEM_SCHEMAS = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

export const SchemaDiffTab: React.FC<SchemaDiffTabProps> = ({
  initialSourceDb,
  initialTargetDb,
  databases: propsDatabases,
  onExecuteMigration,
}) => {
  const { t } = useTranslation("compare");
  const diffLabel = (type: string) => t(`schemaDiff.diffLabels.${type}` as any, { defaultValue: type });
  const isLight = useIsLightTheme();
  const { databases: storeDatabases } = useSchemaStore();
  const databases = propsDatabases || storeDatabases;
  const { openTab } = useUIStore();

  const [compareMode, setCompareMode] = useState<"SAME_CONNECTION" | "CROSS_CONNECTION">(
    "SAME_CONNECTION",
  );

  // Same connection state
  const [sourceDb, setSourceDb] = useState<string>(
    initialSourceDb || (databases.length > 0 ? databases[0].name : ""),
  );
  const [targetDb, setTargetDb] = useState<string>(
    // Destino por defecto: otra base de usuario, nunca un esquema del sistema.
    initialTargetDb ||
      databases.find((d) => d.name !== (initialSourceDb || databases[0]?.name) && !SYSTEM_SCHEMAS.has(d.name.toLowerCase()))?.name ||
      (databases.length > 1 ? databases[1].name : databases[0]?.name || ""),
  );

  // Cross connection state
  const [savedProfiles, setSavedProfiles] = useState<SavedConnection[]>([]);
  const [sourceProfileId, setSourceProfileId] = useState<string>("");
  const [targetProfileId, setTargetProfileId] = useState<string>("");
  const [sourceCrossDb, setSourceCrossDb] = useState<string>("");
  const [targetCrossDb, setTargetCrossDb] = useState<string>("");

  const [diffResult, setDiffResult] = useState<SchemaDiffResult | null>(null);
  const [migrationPlan, setMigrationPlan] = useState<MigrationPlan | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isReviewingAi, setIsReviewingAi] = useState(false);
  const [aiReviewResult, setAiReviewResult] = useState<MigrationReviewResult | null>(null);
  const [isAiReviewModalOpen, setIsAiReviewModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    const profiles = connectionStorage.getSavedConnections();
    setSavedProfiles(profiles);
    if (profiles.length >= 2) {
      setSourceProfileId(profiles[0].id);
      setTargetProfileId(profiles[1].id);
      setSourceCrossDb(profiles[0].database || "");
      setTargetCrossDb(profiles[1].database || "");
    }
  }, []);

  const handleReviewWithAi = async () => {
    if (!diffResult) return;
    setIsReviewingAi(true);
    try {
      const res = await aiService.reviewSchemaMigrationAi(
        diffResult,
        useAiStore.getState().config,
      );
      setAiReviewResult(res);
      setIsAiReviewModalOpen(true);
    } catch (err: unknown) {
      const msg =
        errorText(err, t("schemaDiff.aiError"));
      useUIStore.getState().showAlert({
        title: t("schemaDiff.aiAlertTitle"),
        message: t("schemaDiff.aiAlertMessage"),
        details: msg,
        variant: "warning",
        icon: "alert",
      });
    } finally {
      setIsReviewingAi(false);
    }
  };

  const handleCompare = async () => {
    setIsComparing(true);
    setError(null);
    setDiffResult(null);
    setMigrationPlan(null);
    try {
      if (compareMode === "SAME_CONNECTION") {
        if (!sourceDb || !targetDb) {
          throw new Error(t("schemaDiff.missingSchemas"));
        }
        if (sourceDb === targetDb) {
          throw new Error(t("schemaDiff.sameSchemas"));
        }
        const res = await dbService.compareSchemas(sourceDb, targetDb);
        setDiffResult(res);
      } else {
        const srcProfile = savedProfiles.find((p) => p.id === sourceProfileId);
        const tgtProfile = savedProfiles.find((p) => p.id === targetProfileId);
        if (!srcProfile || !tgtProfile) {
          throw new Error(t("schemaDiff.missingProfiles"));
        }
        const res = await dbService.compareCrossConnectionSchemas(
          {
            host: srcProfile.host,
            port: srcProfile.port,
            user: srcProfile.user,
            credential_id: srcProfile.credentialId,
            savedConnectionId: srcProfile.id,
            database: sourceCrossDb || srcProfile.database,
            tunnel: srcProfile.tunnel,
            tls: srcProfile.tls,
            ssh_tunnel: srcProfile.ssh_tunnel,
          },
          sourceCrossDb || srcProfile.database || "test",
          {
            host: tgtProfile.host,
            port: tgtProfile.port,
            user: tgtProfile.user,
            credential_id: tgtProfile.credentialId,
            savedConnectionId: tgtProfile.id,
            database: targetCrossDb || tgtProfile.database,
            tunnel: tgtProfile.tunnel,
            tls: tgtProfile.tls,
            ssh_tunnel: tgtProfile.ssh_tunnel,
          },
          targetCrossDb || tgtProfile.database || "test",
        );
        setDiffResult(res);
      }
    } catch (err: unknown) {
      console.error("Schema diff failed:", err);
      setError(
        errorText(err, t("schemaDiff.compareError")),
      );
    } finally {
      setIsComparing(false);
    }
  };

  const handleGenerateMigration = async () => {
    if (!diffResult) return;
    setIsGeneratingPlan(true);
    try {
      const plan = await dbService.generateMigrationPlan(diffResult);
      setMigrationPlan(plan);
      setIsMigrationModalOpen(true);
    } catch (err: unknown) {
      console.error("Migration generation failed:", err);
      useUIStore.getState().showAlert({
        title: t("schemaDiff.migrationErrorTitle"),
        message: t("schemaDiff.migrationErrorMessage"),
        details: errorText(err),
        variant: "danger",
        icon: "alert",
      });
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const toggleTableExpand = (tblName: string) => {
    setExpandedTables((prev) => ({ ...prev, [tblName]: !prev[tblName] }));
  };

  const handleCopyMigrationSql = () => {
    if (!migrationPlan) return;
    navigator.clipboard.writeText(migrationPlan.full_sql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const handleSaveMigrationFile = () => {
    if (!migrationPlan) return;
    downloadFile(
      migrationPlan.full_sql,
      `migration_${migrationPlan.source_schema}_to_${migrationPlan.target_schema}_${Date.now()}.sql`,
      "application/sql",
    );
  };

  const handleOpenMigrationInEditor = () => {
    if (!migrationPlan) return;
    if (onExecuteMigration) {
      onExecuteMigration(migrationPlan.full_sql);
    } else {
      openTab({
        id: `query-migration-${uid()}`,
        title: t("schemaDiff.migrationTabTitle", { source: migrationPlan.source_schema, target: migrationPlan.target_schema }),
        type: "query",
        database: migrationPlan.target_schema,
        queryContent: migrationPlan.full_sql,
      });
    }
    setIsMigrationModalOpen(false);
  };

  return (
    <div className="pyro-view pyro-schema-diff flex-1 flex flex-col p-6 bg-canvas overflow-y-auto space-y-6 select-none" data-schema-diff-view>
      {/* Header */}
      <div data-view-toolbar data-schema-diff-header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-sky-950/40 border border-sky-500/30 flex items-center justify-center text-info">
            <GitCompare className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-semibold text-fg">{t("schemaDiff.title")}</h2>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-accent-soft text-accent-text border border-accent/30">
                {t("schemaDiff.advancedBadge")}
              </span>
            </div>
            <p className="text-xs text-fg-muted">
              {t("schemaDiff.subtitle")}
            </p>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="flex items-center space-x-1 bg-raised p-1 rounded-lg border border-line text-xs">
          <button
            onClick={() => setCompareMode("SAME_CONNECTION")}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
              compareMode === "SAME_CONNECTION"
                ? "bg-accent text-accent-fg"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {t("schemaDiff.sameConnection")}
          </button>
          <button
            onClick={() => setCompareMode("CROSS_CONNECTION")}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
              compareMode === "CROSS_CONNECTION"
                ? "bg-accent text-accent-fg"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {t("schemaDiff.crossConnection")}
          </button>
        </div>
      </div>

      {/* Configuration Box */}
      <div className="pyro-schema-diff-config p-4 rounded-xl bg-raised border border-line space-y-4" data-schema-diff-config>
        {compareMode === "SAME_CONNECTION" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label className="text-[11px] font-medium text-fg-muted block mb-1.5">
                {t("schemaDiff.sourceSchemaLabel")}
              </label>
              <select
                value={sourceDb}
                onChange={(e) => setSourceDb(e.target.value)}
                className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-xs font-mono text-fg focus:outline-hidden focus:border-accent"
              >
                {databases.map((db) => (
                  <option key={db.name} value={db.name}>
                    {t("schemaDiff.tablesCount", { name: db.name, count: db.tables_count })}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-fg-muted block mb-1.5">
                {t("schemaDiff.targetSchemaLabel")}
              </label>
              <select
                value={targetDb}
                onChange={(e) => setTargetDb(e.target.value)}
                className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-xs font-mono text-fg focus:outline-hidden focus:border-accent"
              >
                {databases.map((db) => (
                  <option key={db.name} value={db.name}>
                    {t("schemaDiff.tablesCount", { name: db.name, count: db.tables_count })}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            {/* Source Profile */}
            <div className="p-3 rounded-lg bg-canvas border border-line space-y-2">
              <span className="text-[11px] font-medium text-info block">
                {t("schemaDiff.sourceConnLabel")}
              </span>
              <select
                value={sourceProfileId}
                onChange={(e) => setSourceProfileId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-raised border border-line rounded-md text-xs text-fg"
              >
                {savedProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.host}:{p.port})
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder={t("schemaDiff.sourceDbPlaceholder")}
                value={sourceCrossDb}
                onChange={(e) => setSourceCrossDb(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-raised border border-line rounded-md text-xs text-fg"
              />
            </div>

            {/* Target Profile */}
            <div className="p-3 rounded-lg bg-canvas border border-line space-y-2">
              <span className="text-[11px] font-medium text-accent-text block">
                {t("schemaDiff.targetConnLabel")}
              </span>
              <select
                value={targetProfileId}
                onChange={(e) => setTargetProfileId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-raised border border-line rounded-md text-xs text-fg"
              >
                {savedProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.host}:{p.port})
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder={t("schemaDiff.targetDbPlaceholder")}
                value={targetCrossDb}
                onChange={(e) => setTargetCrossDb(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-raised border border-line rounded-md text-xs text-fg"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-end space-x-2 pt-2 border-t border-line">
          <button
            onClick={handleCompare}
            disabled={isComparing}
            className="flex items-center space-x-2 px-4 py-2 text-xs font-bold text-accent-fg bg-accent hover:bg-accent-hover disabled:opacity-50 rounded-lg shadow-md transition-all"
          >
            {isComparing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GitCompare className="w-4 h-4" />
            )}
            <span>{t("schemaDiff.compareBtn")}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/50 text-danger text-xs flex items-start space-x-2.5">
          <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <div>
            <strong className="text-rose-200">{t("schemaDiff.compareErrorPrefix")} </strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Diff Results View */}
      {diffResult && (
        <div className="pyro-schema-diff-results space-y-4" data-schema-diff-results>
          {/* Summary KPIs */}
          <div className="pyro-schema-diff-summary flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-raised border border-line" data-schema-diff-summary>
            <div className="flex items-center space-x-4 text-xs font-mono">
              <div className="flex items-center space-x-2">
                <span className="text-fg-muted">{t("schemaDiff.totalDiffs")}</span>
                <span className="text-sm font-bold text-fg px-2 py-0.5 rounded bg-elevated">
                  {diffResult.total_differences}
                </span>
              </div>
              <span className="text-fg-subtle">|</span>
              <div className="flex items-center space-x-3 text-[11px]">
                <span className="text-success font-bold">
                  {t("schemaDiff.addedCount", { count: diffResult.tables.filter((tbl) => tbl.diff_type === "Added").length })}
                </span>
                <span className="text-danger font-bold">
                  {t("schemaDiff.removedCount", { count: diffResult.tables.filter((tbl) => tbl.diff_type === "Removed").length })}
                </span>
                <span className="text-warning font-bold">
                  {t("schemaDiff.modifiedCount", { count: diffResult.tables.filter((tbl) => tbl.diff_type === "Modified").length })}
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleReviewWithAi}
                disabled={isReviewingAi || diffResult.total_differences === 0}
                title={t("schemaDiff.reviewAiTitle")}
                className="flex items-center space-x-1.5 px-3 py-2 text-xs font-bold text-purple-200 bg-purple-950/40 hover:bg-purple-900/50 border border-purple-700/50 disabled:opacity-50 rounded-lg transition-all"
              >
                {isReviewingAi ? (
                  <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                ) : (
                  <Sparkles className="w-4 h-4 text-purple-400" />
                )}
                <span>{t("schemaDiff.reviewAiBtn")}</span>
              </button>

              <button
                onClick={handleGenerateMigration}
                disabled={isGeneratingPlan || diffResult.total_differences === 0}
                className={primaryBtn}
              >
                {isGeneratingPlan ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                <span>{t("schemaDiff.previewMigrationBtn")}</span>
              </button>
            </div>
          </div>

          {/* Tables Diff Tree */}
          <div className="space-y-3">
            {diffResult.tables.length === 0 &&
            diffResult.routines.length === 0 &&
            diffResult.triggers.length === 0 &&
            diffResult.views.length === 0 ? (
              <div className="p-8 text-center bg-raised rounded-xl border border-line text-fg-muted">
                <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" />
                <span className="text-sm font-semibold text-fg block">
                  {t("schemaDiff.identicalTitle")}
                </span>
                <span className="text-xs text-fg-subtle mt-1 block">
                  {t("schemaDiff.identicalDesc")}
                </span>
              </div>
            ) : (
              diffResult.tables.map((tbl) => {
                const isExpanded = Boolean(expandedTables[tbl.table_name]);
                const isAdded = tbl.diff_type === "Added";
                const isRemoved = tbl.diff_type === "Removed";

                return (
                  <div
                    key={tbl.table_name}
                    className={`rounded-xl bg-raised border border-line overflow-hidden shadow-md border-l-4 ${
                      isAdded
                        ? "border-l-emerald-500"
                        : isRemoved
                        ? "border-l-rose-500"
                        : "border-l-amber-500"
                    }`}
                  >
                    <div
                      onClick={() => toggleTableExpand(tbl.table_name)}
                      className="p-3.5 bg-raised border-b border-line flex items-center justify-between cursor-pointer hover:bg-hover transition-colors text-xs font-mono"
                    >
                      <div className="flex items-center space-x-2.5">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-fg-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-fg-muted" />
                        )}
                        <Table className="w-4 h-4 text-fg-muted" />
                        <span className="font-bold text-fg text-sm">{tbl.table_name}</span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
                            isAdded
                              ? "bg-emerald-950/60 border-emerald-800 text-success"
                              : isRemoved
                              ? "bg-rose-950/60 border-rose-800 text-danger"
                              : "bg-amber-950/60 border-amber-800 text-warning"
                          }`}
                        >
                          {diffLabel(tbl.diff_type)}
                        </span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="p-4 space-y-3 bg-canvas text-xs font-mono">
                        {/* Column Changes */}
                        {tbl.columns.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-medium text-fg-muted block">
                              {t("schemaDiff.columnsCount", { count: tbl.columns.length })}
                            </span>
                            <div className="space-y-1">
                              {tbl.columns.map((c, cIdx) => (
                                <div
                                  key={cIdx}
                                  className={`p-2 rounded bg-surface border flex items-center justify-between ${
                                    c.diff_type === "Added"
                                      ? "border-emerald-900/50 text-success"
                                      : c.diff_type === "Removed"
                                      ? "border-rose-900/50 text-danger"
                                      : "border-amber-900/50 text-warning"
                                  }`}
                                >
                                  <div className="flex items-center space-x-2">
                                    <span className="font-bold">
                                      {c.diff_type === "Added"
                                        ? "+"
                                        : c.diff_type === "Removed"
                                        ? "-"
                                        : "~"}
                                    </span>
                                    <span>{c.name}</span>
                                    {c.source_column && (
                                      <span className="text-fg-muted text-[11px]">
                                        ({c.source_column.column_type})
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-fg-muted">
                                    {c.change_details.join(" | ")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Index Changes */}
                        {tbl.indexes.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-medium text-fg-muted block">
                              {t("schemaDiff.indexesCount", { count: tbl.indexes.length })}
                            </span>
                            <div className="space-y-1">
                              {tbl.indexes.map((idx, iIdx) => (
                                <div
                                  key={iIdx}
                                  className="p-2 rounded bg-surface border border-line flex items-center justify-between text-fg"
                                >
                                  <div className="flex items-center space-x-2">
                                    <span className="font-bold text-accent-text">
                                      {idx.diff_type === "Added" ? "+" : "-"}
                                    </span>
                                    <span>{idx.name}</span>
                                  </div>
                                  <span className="text-[11px] text-fg-muted">
                                    {idx.change_details.join(" | ")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Foreign Keys Changes */}
                        {tbl.foreign_keys.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-medium text-fg-muted block">
                              {t("schemaDiff.fksCount", { count: tbl.foreign_keys.length })}
                            </span>
                            <div className="space-y-1">
                              {tbl.foreign_keys.map((fk, fIdx) => (
                                <div
                                  key={fIdx}
                                  className="p-2 rounded bg-surface border border-line flex items-center justify-between text-fg"
                                >
                                  <div className="flex items-center space-x-2">
                                    <span className="font-bold text-info">
                                      {fk.diff_type === "Added" ? "+" : "-"}
                                    </span>
                                    <span>{fk.name}</span>
                                  </div>
                                  <span className="text-[11px] text-fg-muted">
                                    {fk.change_details.join(" | ")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Migration Script Preview Modal */}
      {isMigrationModalOpen && migrationPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
          <div className="bg-surface border border-line rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-modal overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-raised border-b border-line flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <FileCode className="w-5 h-5 text-accent-text" />
                <div>
                  <h3 className="text-sm font-bold text-fg font-mono">
                    {t("schemaDiff.migrationModal.title", { count: migrationPlan.total_statements })}
                  </h3>
                  <span className="text-[11px] text-fg-muted">
                    {migrationPlan.source_schema} &rarr; {migrationPlan.target_schema}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsMigrationModalOpen(false)}
                className="p-1 rounded-lg text-fg-muted hover:text-fg hover:bg-hover transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-raised border-b border-line-strong text-xs space-y-1.5">
              <div className="flex items-center space-x-2 text-warning font-semibold">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                <span>{t("schemaDiff.migrationModal.safetyTitle")}</span>
              </div>
              <p className="text-[11px] text-fg-muted leading-relaxed">
                {t("schemaDiff.migrationModal.safetyDesc")}
              </p>
              {migrationPlan.warnings.length > 0 && (
                <div className="p-2 rounded bg-rose-950/50 border border-rose-800/50 text-danger text-[11px] flex items-center space-x-2 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" />
                  <span>
                    {t("schemaDiff.migrationModal.destructiveWarning")}
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-canvas">
              <CodeMirror
                value={migrationPlan.full_sql}
                height="320px"
                theme={isLight ? "light" : "dark"}
                extensions={[sqlLang()]}
                readOnly
                className="text-xs font-mono rounded-lg overflow-hidden border border-line"
              />
            </div>

            <div className="p-4 bg-raised border-t border-line flex items-center justify-between">
              <span className="text-xs text-fg-muted font-mono">
                {t("schemaDiff.migrationModal.statementsGenerated", { count: migrationPlan.total_statements })}
              </span>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCopyMigrationSql}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-fg bg-raised hover:bg-hover border border-line rounded-lg transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedSql ? t("schemaDiff.migrationModal.copied") : t("schemaDiff.migrationModal.copySql")}</span>
                </button>
                <button
                  onClick={handleSaveMigrationFile}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-fg bg-raised hover:bg-hover border border-line rounded-lg transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{t("schemaDiff.migrationModal.saveFile")}</span>
                </button>
                <button
                  onClick={handleOpenMigrationInEditor}
                  className={primaryBtn}
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>{t("schemaDiff.migrationModal.openEditor")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Migration Review Modal */}
      {isAiReviewModalOpen && aiReviewResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
          <div className="bg-surface border border-line rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-modal overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-raised border-b border-line flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-lg bg-purple-950/40 border border-purple-700/50 text-purple-300">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-fg font-mono">
                    {t("schemaDiff.aiModal.title")}
                  </h3>
                  <span className="text-[11px] text-fg-muted">
                    {t("schemaDiff.aiModal.subtitle", { source: sourceDb, target: targetDb })}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsAiReviewModalOpen(false)}
                className="p-1 rounded-lg text-fg-muted hover:text-fg hover:bg-hover transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-canvas text-xs font-sans">
              {/* Risk Level Badge */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-raised border border-line">
                <span className="text-fg-muted font-medium">{t("schemaDiff.aiModal.riskLabel")}</span>
                <span
                  className={`px-2.5 py-1 rounded font-bold text-[11px] font-mono border ${
                    aiReviewResult.risk_level === "high" || aiReviewResult.risk_level === "critical"
                      ? "bg-rose-950/60 border-rose-800 text-danger"
                      : aiReviewResult.risk_level === "medium"
                      ? "bg-amber-950/60 border-amber-800 text-warning"
                      : "bg-emerald-950/60 border-emerald-800 text-success"
                  }`}
                >
                  {aiReviewResult.risk_level.toUpperCase()}
                </span>
              </div>

              {/* Detailed Markdown Analysis */}
              <div className="p-4 bg-raised border border-line rounded-lg space-y-2 select-text">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-fg flex items-center space-x-2">
                    <Bot className="w-4 h-4 text-purple-400" />
                    <span>{t("schemaDiff.aiModal.analysisTitle")}</span>
                  </h4>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(aiReviewResult.full_markdown);
                    }}
                    className="px-2 py-0.5 bg-elevated hover:bg-hover text-fg rounded border border-line-strong text-[11px] flex items-center space-x-1 select-none"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{t("schemaDiff.aiModal.copy")}</span>
                  </button>
                </div>
                <MarkdownRenderer
                  content={aiReviewResult.full_markdown}
                />
              </div>
            </div>

            <div className="p-4 bg-raised border-t border-line flex items-center justify-between">
              <span className="text-xs text-fg-muted font-mono">
                {t("schemaDiff.aiModal.footer")}
              </span>
              <button
                onClick={() => setIsAiReviewModalOpen(false)}
                className="px-4 py-1.5 bg-elevated hover:bg-hover text-fg rounded text-xs font-semibold transition-colors"
              >
                {t("schemaDiff.aiModal.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
