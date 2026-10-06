import React, { useEffect, useState } from "react";
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
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { dbService } from "../services/tauriDb";
import { downloadFile } from "../services/diagnosticExport";
import { connectionStorage } from "../services/connectionStorage";
import { useSchemaStore } from "../stores/schemaStore";
import { useUIStore } from "../stores/uiStore";
import type {
  DatabaseSchema,
  MigrationPlan,
  SavedConnection,
  SchemaDiffResult,
} from "../types/database";

interface SchemaDiffTabProps {
  initialSourceDb?: string;
  initialTargetDb?: string;
  databases?: DatabaseSchema[];
  onExecuteMigration?: (sql: string) => void;
}

export const SchemaDiffTab: React.FC<SchemaDiffTabProps> = ({
  initialSourceDb,
  initialTargetDb,
  databases: propsDatabases,
  onExecuteMigration,
}) => {
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
    initialTargetDb || (databases.length > 1 ? databases[1].name : databases[0]?.name || ""),
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

  const handleCompare = async () => {
    setIsComparing(true);
    setError(null);
    setDiffResult(null);
    setMigrationPlan(null);
    try {
      if (compareMode === "SAME_CONNECTION") {
        if (!sourceDb || !targetDb) {
          throw new Error("Selecciona los esquemas de origen y destino.");
        }
        if (sourceDb === targetDb) {
          throw new Error("El esquema de origen y destino no pueden ser el mismo.");
        }
        const res = await dbService.compareSchemas(sourceDb, targetDb);
        setDiffResult(res);
      } else {
        const srcProfile = savedProfiles.find((p) => p.id === sourceProfileId);
        const tgtProfile = savedProfiles.find((p) => p.id === targetProfileId);
        if (!srcProfile || !tgtProfile) {
          throw new Error("Selecciona perfiles válidos para la comparación cruzada.");
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
        typeof err === "string"
          ? err
          : (err as Error)?.message || "Error al comparar las estructuras de esquema",
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
      alert(
        `Error al generar la migración: ${
          typeof err === "string" ? err : (err as Error)?.message
        }`,
      );
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
        id: `query-migration-${Date.now()}`,
        title: `Migración: ${migrationPlan.source_schema} -> ${migrationPlan.target_schema}`,
        type: "query",
        database: migrationPlan.target_schema,
        queryContent: migrationPlan.full_sql,
      });
    }
    setIsMigrationModalOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col p-6 bg-[#0a0c10] overflow-y-auto space-y-6 select-none">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#1c2233]">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-sky-950/40 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <GitCompare className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-white font-mono">Schema Diff & Migrations</h2>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-sky-950/50 text-sky-400 border border-sky-800/40">
                P3 Advanced
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Comparación profunda de esquemas (tablas, columnas, índices, FKs, rutinas) y generación de migraciones SQL
            </p>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="flex items-center space-x-1 bg-[#121622] p-1 rounded-lg border border-[#20273a] text-xs">
          <button
            onClick={() => setCompareMode("SAME_CONNECTION")}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
              compareMode === "SAME_CONNECTION"
                ? "bg-orange-600 text-white"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Misma Conexión
          </button>
          <button
            onClick={() => setCompareMode("CROSS_CONNECTION")}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
              compareMode === "CROSS_CONNECTION"
                ? "bg-orange-600 text-white"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Entre Conexiones Distintas
          </button>
        </div>
      </div>

      {/* Configuration Box */}
      <div className="p-4 rounded-xl bg-[#11141e] border border-[#1f2638] space-y-4">
        {compareMode === "SAME_CONNECTION" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block mb-1.5">
                Esquema Origen (Referencia / Desarrollo)
              </label>
              <select
                value={sourceDb}
                onChange={(e) => setSourceDb(e.target.value)}
                className="w-full px-3 py-2 bg-[#0c0e14] border border-[#22293d] rounded-lg text-xs font-mono text-white focus:outline-hidden focus:border-orange-500"
              >
                {databases.map((db) => (
                  <option key={db.name} value={db.name}>
                    {db.name} ({db.tables_count} tablas)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block mb-1.5">
                Esquema Destino (A Actualizar / Producción)
              </label>
              <select
                value={targetDb}
                onChange={(e) => setTargetDb(e.target.value)}
                className="w-full px-3 py-2 bg-[#0c0e14] border border-[#22293d] rounded-lg text-xs font-mono text-white focus:outline-hidden focus:border-orange-500"
              >
                {databases.map((db) => (
                  <option key={db.name} value={db.name}>
                    {db.name} ({db.tables_count} tablas)
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            {/* Source Profile */}
            <div className="p-3 rounded-lg bg-[#0c0e14] border border-[#1d2334] space-y-2">
              <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider block">
                Conexión Origen (Referencia)
              </span>
              <select
                value={sourceProfileId}
                onChange={(e) => setSourceProfileId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#141824] border border-[#22293d] rounded-md text-xs text-white"
              >
                {savedProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.host}:{p.port})
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Nombre de la Base de Datos Origen..."
                value={sourceCrossDb}
                onChange={(e) => setSourceCrossDb(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#141824] border border-[#22293d] rounded-md text-xs text-white"
              />
            </div>

            {/* Target Profile */}
            <div className="p-3 rounded-lg bg-[#0c0e14] border border-[#1d2334] space-y-2">
              <span className="text-[10px] font-bold text-orange-400 uppercase tracking-wider block">
                Conexión Destino (A Actualizar)
              </span>
              <select
                value={targetProfileId}
                onChange={(e) => setTargetProfileId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#141824] border border-[#22293d] rounded-md text-xs text-white"
              >
                {savedProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.host}:{p.port})
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Nombre de la Base de Datos Destino..."
                value={targetCrossDb}
                onChange={(e) => setTargetCrossDb(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#141824] border border-[#22293d] rounded-md text-xs text-white"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#1a2030]">
          <button
            onClick={handleCompare}
            disabled={isComparing}
            className="flex items-center space-x-2 px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg shadow-md transition-all active:scale-95"
          >
            {isComparing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GitCompare className="w-4 h-4" />
            )}
            <span>Comparar Estructuras</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/50 text-rose-300 text-xs flex items-start space-x-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <strong className="text-rose-200">Error en comparación: </strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Diff Results View */}
      {diffResult && (
        <div className="space-y-4">
          {/* Summary KPIs */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#11141e] border border-[#1f2638]">
            <div className="flex items-center space-x-4 text-xs font-mono">
              <div className="flex items-center space-x-2">
                <span className="text-neutral-400">Diferencias Totales:</span>
                <span className="text-sm font-bold text-white px-2 py-0.5 rounded bg-[#1c2234]">
                  {diffResult.total_differences}
                </span>
              </div>
              <span className="text-neutral-600">|</span>
              <div className="flex items-center space-x-3 text-[11px]">
                <span className="text-emerald-400 font-bold">
                  +{diffResult.tables.filter((t) => t.diff_type === "Added").length} Agregadas
                </span>
                <span className="text-rose-400 font-bold">
                  -{diffResult.tables.filter((t) => t.diff_type === "Removed").length} Eliminadas
                </span>
                <span className="text-amber-400 font-bold">
                  ~{diffResult.tables.filter((t) => t.diff_type === "Modified").length} Modificadas
                </span>
              </div>
            </div>

            <button
              onClick={handleGenerateMigration}
              disabled={isGeneratingPlan || diffResult.total_differences === 0}
              className="flex items-center space-x-2 px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 disabled:opacity-50 rounded-lg shadow-md transition-all active:scale-95"
            >
              {isGeneratingPlan ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              <span>Generar Migración SQL (Preview)</span>
            </button>
          </div>

          {/* Tables Diff Tree */}
          <div className="space-y-3">
            {diffResult.tables.length === 0 &&
            diffResult.routines.length === 0 &&
            diffResult.triggers.length === 0 &&
            diffResult.views.length === 0 ? (
              <div className="p-8 text-center bg-[#11141e] rounded-xl border border-[#1f2638] text-neutral-400">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <span className="text-sm font-semibold text-white block">
                  Los esquemas son idénticos
                </span>
                <span className="text-xs text-neutral-500 mt-1 block">
                  No se encontraron discrepancias en tablas, columnas, índices ni rutinas.
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
                    className={`rounded-xl bg-[#11141e] border border-[#1f2538] overflow-hidden shadow-md border-l-4 ${
                      isAdded
                        ? "border-l-emerald-500"
                        : isRemoved
                        ? "border-l-rose-500"
                        : "border-l-amber-500"
                    }`}
                  >
                    <div
                      onClick={() => toggleTableExpand(tbl.table_name)}
                      className="p-3.5 bg-[#141724] border-b border-[#1d2334] flex items-center justify-between cursor-pointer hover:bg-[#181d2c] transition-colors text-xs font-mono"
                    >
                      <div className="flex items-center space-x-2.5">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-neutral-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-neutral-400" />
                        )}
                        <Table className="w-4 h-4 text-neutral-400" />
                        <span className="font-bold text-white text-sm">{tbl.table_name}</span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                            isAdded
                              ? "bg-emerald-950/60 border-emerald-800 text-emerald-300"
                              : isRemoved
                              ? "bg-rose-950/60 border-rose-800 text-rose-300"
                              : "bg-amber-950/60 border-amber-800 text-amber-300"
                          }`}
                        >
                          {tbl.diff_type}
                        </span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="p-4 space-y-3 bg-[#0c0e14] text-xs font-mono">
                        {/* Column Changes */}
                        {tbl.columns.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
                              Columnas ({tbl.columns.length})
                            </span>
                            <div className="space-y-1">
                              {tbl.columns.map((c, cIdx) => (
                                <div
                                  key={cIdx}
                                  className={`p-2 rounded bg-[#10131d] border flex items-center justify-between ${
                                    c.diff_type === "Added"
                                      ? "border-emerald-900/50 text-emerald-300"
                                      : c.diff_type === "Removed"
                                      ? "border-rose-900/50 text-rose-300"
                                      : "border-amber-900/50 text-amber-300"
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
                                      <span className="text-neutral-400 text-[11px]">
                                        ({c.source_column.column_type})
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-neutral-400">
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
                            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
                              Índices ({tbl.indexes.length})
                            </span>
                            <div className="space-y-1">
                              {tbl.indexes.map((idx, iIdx) => (
                                <div
                                  key={iIdx}
                                  className="p-2 rounded bg-[#10131d] border border-[#1f2638] flex items-center justify-between text-neutral-300"
                                >
                                  <div className="flex items-center space-x-2">
                                    <span className="font-bold text-orange-400">
                                      {idx.diff_type === "Added" ? "+" : "-"}
                                    </span>
                                    <span>{idx.name}</span>
                                  </div>
                                  <span className="text-[11px] text-neutral-400">
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
                            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
                              Foreign Keys ({tbl.foreign_keys.length})
                            </span>
                            <div className="space-y-1">
                              {tbl.foreign_keys.map((fk, fIdx) => (
                                <div
                                  key={fIdx}
                                  className="p-2 rounded bg-[#10131d] border border-[#1f2638] flex items-center justify-between text-neutral-300"
                                >
                                  <div className="flex items-center space-x-2">
                                    <span className="font-bold text-sky-400">
                                      {fk.diff_type === "Added" ? "+" : "-"}
                                    </span>
                                    <span>{fk.name}</span>
                                  </div>
                                  <span className="text-[11px] text-neutral-400">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
          <div className="bg-[#0f121a] border border-[#232a3e] rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-[#141824] border-b border-[#212739] flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <FileCode className="w-5 h-5 text-orange-400" />
                <div>
                  <h3 className="text-sm font-bold text-white font-mono">
                    Plan de Migración SQL ({migrationPlan.total_statements} sentencias)
                  </h3>
                  <span className="text-[11px] text-neutral-400">
                    {migrationPlan.source_schema} &rarr; {migrationPlan.target_schema}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsMigrationModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-[#1f2638] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {migrationPlan.warnings.length > 0 && (
              <div className="p-3 bg-rose-950/40 border-b border-rose-800/40 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>
                  <strong>Atención:</strong> El plan contiene operaciones destructivas (DROP TABLE o DROP COLUMN).
                </span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 bg-[#0a0c10]">
              <CodeMirror
                value={migrationPlan.full_sql}
                height="320px"
                theme="dark"
                extensions={[sqlLang()]}
                readOnly
                className="text-xs font-mono rounded-lg overflow-hidden border border-[#1f2538]"
              />
            </div>

            <div className="p-4 bg-[#141824] border-t border-[#212739] flex items-center justify-between">
              <span className="text-xs text-neutral-400 font-mono">
                {migrationPlan.total_statements} sentencia(s) generadas
              </span>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCopyMigrationSql}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-300 bg-[#161a26] hover:bg-[#202738] border border-[#252d40] rounded-lg transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedSql ? "Copiado!" : "Copiar SQL"}</span>
                </button>
                <button
                  onClick={handleSaveMigrationFile}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-300 bg-[#161a26] hover:bg-[#202738] border border-[#252d40] rounded-lg transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar Archivo .sql</span>
                </button>
                <button
                  onClick={handleOpenMigrationInEditor}
                  className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-500 rounded-lg shadow-md transition-colors"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Abrir en Editor SQL</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
