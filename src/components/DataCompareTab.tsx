import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Copy, FileCode, GitCompareArrows } from "lucide-react";
import { dbService } from "../services/tauriDb";
import { connectionStorage } from "../services/connectionStorage";
import { useSchemaStore } from "../stores/schemaStore";
import { useUIStore } from "../stores/uiStore";
import {
  databaseCredentialId,
  type ConnectionConfig,
  type DataCompareResult,
  type RowDifference,
  type RowDifferenceKind,
  type SavedConnection,
  type TableMetadata,
} from "../types/database";
import { EmptyState, Spinner } from "./ui/Modal";
import {
  cardClass,
  fieldLabel,
  ghostBtn,
  inputClass,
  mutedText,
  primaryBtn,
  sectionLabel,
  selectClass,
  tabClass,
} from "./ui/styles";
import { uid } from "../utils/uid";

interface DataCompareTabProps {
  database: string;
  tableName?: string;
}

/** "" = the active connection; otherwise a saved profile id. */
interface SideState {
  profileId: string;
  database: string;
  table: string;
}

const KIND_DOT: Record<RowDifferenceKind, string> = {
  insert: "bg-success",
  delete: "bg-danger",
  update: "bg-warning",
};

/** Connection config for a saved profile (secrets stay in the vault). */
function profileConfig(profile: SavedConnection, database: string): ConnectionConfig {
  return {
    engine: profile.engine,
    file_path: profile.filePath,
    host: profile.host,
    port: profile.port,
    user: profile.user,
    credential_id: databaseCredentialId(profile),
    database,
    environment: profile.environment,
    read_only: profile.readOnly || undefined,
    tunnel: profile.tunnel
      ? {
          ...profile.tunnel,
          tunnel_credential_id: !profile.tunnel.http_password
            ? profile.tunnel.tunnel_credential_id ||
              profile.tunnelCredentialId ||
              `tunnel-cred-${profile.id}`
            : undefined,
        }
      : undefined,
    tls: profile.tls,
    ssh_tunnel: profile.ssh_tunnel,
    savedConnectionId: profile.id,
    savedConnectionName: profile.name,
  };
}

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const SidePicker: React.FC<{
  title: string;
  side: SideState;
  profiles: SavedConnection[];
  onChange: (side: SideState) => void;
}> = ({ title, side, profiles, onChange }) => {
  const { t } = useTranslation("compare");
  const { databases } = useSchemaStore();
  const [tables, setTables] = useState<TableMetadata[]>([]);
  const isActive = side.profileId === "";

  useEffect(() => {
    if (!isActive || !side.database) {
      setTables([]);
      return;
    }
    let alive = true;
    dbService
      .listTables(side.database)
      .then((list) => alive && setTables(list.filter((tbl) => !tbl.table_type.toUpperCase().includes("VIEW"))))
      .catch(() => alive && setTables([]));
    return () => {
      alive = false;
    };
  }, [isActive, side.database]);

  return (
    <div className={`${cardClass} pyro-data-compare-side p-3 space-y-2.5 flex-1 min-w-0`} data-compare-side>
      <div className={sectionLabel}>{title}</div>
      <div>
        <label className={fieldLabel}>{t("dataCompare.connection")}</label>
        <select
          className={selectClass}
          value={side.profileId}
          onChange={(e) => onChange({ profileId: e.target.value, database: "", table: "" })}
        >
          <option value="">{t("dataCompare.activeConnection")}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={fieldLabel}>{t("dataCompare.database")}</label>
          {isActive ? (
            <select
              className={selectClass}
              value={side.database}
              onChange={(e) => onChange({ ...side, database: e.target.value, table: "" })}
            >
              <option value="" disabled>
                {t("dataCompare.choose")}
              </option>
              {databases.map((db) => (
                <option key={db.name} value={db.name}>
                  {db.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={inputClass}
              value={side.database}
              placeholder={t("dataCompare.dbPlaceholder")}
              onChange={(e) => onChange({ ...side, database: e.target.value })}
            />
          )}
        </div>
        <div>
          <label className={fieldLabel}>{t("dataCompare.table")}</label>
          {isActive ? (
            <select
              className={selectClass}
              value={side.table}
              onChange={(e) => onChange({ ...side, table: e.target.value })}
            >
              <option value="" disabled>
                {t("dataCompare.choose")}
              </option>
              {tables.map((tbl) => (
                <option key={tbl.name} value={tbl.name}>
                  {tbl.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={inputClass}
              value={side.table}
              placeholder={t("dataCompare.tablePlaceholder")}
              onChange={(e) => onChange({ ...side, table: e.target.value })}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const DataCompareTab: React.FC<DataCompareTabProps> = ({ database, tableName }) => {
  const { t } = useTranslation("compare");
  const kindLabel = (kind: RowDifferenceKind) => t(`dataCompare.kinds.${kind}` as any, { defaultValue: kind });
  const profiles = useMemo(() => connectionStorage.getSavedConnections(), []);
  const [source, setSource] = useState<SideState>({ profileId: "", database, table: tableName ?? "" });
  const [target, setTarget] = useState<SideState>({ profileId: "", database: "", table: tableName ?? "" });
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DataCompareResult | null>(null);
  const [kindFilter, setKindFilter] = useState<RowDifferenceKind | "all">("all");

  const toSide = (side: SideState) => {
    const profile = profiles.find((p) => p.id === side.profileId);
    return {
      connection: profile ? profileConfig(profile, side.database) : null,
      database: side.database.trim(),
      table: side.table.trim(),
    };
  };

  const isSameTable =
    source.profileId === target.profileId &&
    source.database === target.database &&
    source.table === target.table;
  const canCompare =
    !isComparing && source.database && source.table && target.database && target.table && !isSameTable;

  const handleCompare = async () => {
    setIsComparing(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await dbService.compareTableData({
          source: toSide(source),
          target: toSide(target),
          max_differences: 2000,
        }),
      );
      setKindFilter("all");
    } catch (err) {
      setError(String(err));
    } finally {
      setIsComparing(false);
    }
  };

  const script = result ? result.sync_statements.join("\n") : "";

  const openScript = () => {
    if (!result) return;
    const header = `${t("dataCompare.syncHeader", {
      targetDb: target.database,
      targetTable: target.table,
      sourceDb: source.database,
      sourceTable: source.table,
    })}${
      result.truncated ? t("dataCompare.syncTruncated", { count: result.sync_statements.length }) : ""
    }\n`;
    useUIStore.getState().openTab({
      id: `query-${uid()}`,
      type: "query",
      title: t("dataCompare.syncTabTitle", { table: target.table }),
      database: target.database,
      queryContent: header + script,
    });
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(script);
    } catch (err) {
      useUIStore.getState().showAlert({
        title: t("dataCompare.copyErrorTitle"),
        message: String(err),
        variant: "warning",
        icon: "alert",
      });
    }
  };

  const shown: RowDifference[] = useMemo(
    () => (result ? result.differences.filter((d) => kindFilter === "all" || d.kind === kindFilter) : []),
    [result, kindFilter],
  );

  const totalDiffs = result ? result.inserted + result.deleted + result.modified : 0;

  return (
    <div className="pyro-view pyro-data-compare h-full flex flex-col bg-canvas overflow-hidden" data-data-compare-view>
      <div className="pyro-data-compare-header flex items-center gap-2 px-4 py-3 border-b border-line bg-surface shrink-0" data-view-toolbar>
        <GitCompareArrows className="w-4 h-4 text-fg-muted" />
        <span className="text-sm font-medium text-fg">{t("dataCompare.title")}</span>
        <span className={mutedText}>{t("dataCompare.subtitle")}</span>
      </div>

      <div className="pyro-data-compare-config p-4 space-y-3 border-b border-line shrink-0" data-compare-config>
        <div className="pyro-data-compare-sides flex items-stretch gap-3" data-compare-sides>
          <SidePicker title={t("dataCompare.sourceTitle")} side={source} profiles={profiles} onChange={setSource} />
          <div className="flex items-center" data-compare-direction>
            <ArrowRight className="w-4 h-4 text-fg-subtle" />
          </div>
          <SidePicker title={t("dataCompare.targetTitle")} side={target} profiles={profiles} onChange={setTarget} />
        </div>
        <div className="flex items-center justify-end gap-3">
          {isSameTable && source.table && (
            <span className={mutedText}>{t("dataCompare.sameTable")}</span>
          )}
          <button className={primaryBtn} disabled={!canCompare} onClick={handleCompare}>
            {isComparing ? <Spinner className="w-3.5 h-3.5" /> : <GitCompareArrows className="w-3.5 h-3.5" />}
            {t("dataCompare.compareBtn")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isComparing ? (
          <div className="h-full flex items-center justify-center gap-2 text-xs text-fg-muted">
            <Spinner /> {t("dataCompare.comparing")}
          </div>
        ) : error ? (
          <EmptyState title={t("dataCompare.errorTitle")} description={error} />
        ) : !result ? (
          <EmptyState
            icon={<GitCompareArrows className="w-6 h-6" />}
            title={t("dataCompare.emptyTitle")}
            description={t("dataCompare.emptyDesc")}
          />
        ) : (
          <div className="pyro-data-compare-results p-4 space-y-3" data-compare-results>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fg">
              {(["insert", "delete", "update"] as RowDifferenceKind[]).map((kind) => {
                const count = kind === "insert" ? result.inserted : kind === "delete" ? result.deleted : result.modified;
                return (
                  <span key={kind} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${KIND_DOT[kind]}`} />
                    {kindLabel(kind)}: <span className="font-medium tabular-nums">{count}</span>
                  </span>
                );
              })}
              <span className={mutedText}>
                {t("dataCompare.summaryRows", { source: result.source_rows, target: result.target_rows })}
                {result.used_checksums
                  ? t("dataCompare.summaryChunks", { identical: result.identical_chunks, total: result.chunks })
                  : ""}
                {(result.elapsed_ms / 1000).toFixed(1)} s
              </span>
            </div>

            {(result.source_only_columns.length > 0 || result.target_only_columns.length > 0) && (
              <p className={mutedText}>
                {t("dataCompare.uncomparedCols")}{" "}
                {[
                  ...result.source_only_columns.map((c) => t("dataCompare.onlySource", { col: c })),
                  ...result.target_only_columns.map((c) => t("dataCompare.onlyTarget", { col: c })),
                ].join(", ")}
                .
              </p>
            )}

            {totalDiffs === 0 ? (
              <EmptyState title={t("dataCompare.identicalTitle")} description={t("dataCompare.identicalDesc")} />
            ) : (
              <>
                <div className="pyro-data-compare-result-toolbar flex items-center gap-1 border-b border-line">
                  {(["all", "insert", "delete", "update"] as const).map((k) => (
                    <button key={k} className={tabClass(kindFilter === k)} onClick={() => setKindFilter(k)}>
                      {k === "all" ? t("dataCompare.all") : kindLabel(k)}
                    </button>
                  ))}
                  <div className="flex-1" />
                  <button className={ghostBtn} onClick={copyScript}>
                    <Copy className="w-3.5 h-3.5" /> {t("dataCompare.copyScript")}
                  </button>
                  <button className={ghostBtn} onClick={openScript}>
                    <FileCode className="w-3.5 h-3.5" /> {t("dataCompare.openScript")}
                  </button>
                </div>
                {result.truncated && (
                  <p className={mutedText}>
                    {t("dataCompare.truncatedNotice", { shown: result.differences.length, total: totalDiffs })}
                  </p>
                )}
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-left text-fg-muted border-b border-line">
                      <th className="py-1.5 pr-3 font-medium">{result.key_columns.join(", ")}</th>
                      <th className="py-1.5 pr-3 font-medium">{t("dataCompare.changesCol")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((d, i) => (
                      <tr key={i} className="border-b border-line align-top">
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${KIND_DOT[d.kind]}`} title={kindLabel(d.kind)} />
                            {d.key.map(formatValue).join(", ")}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-fg">
                          {d.kind === "update" ? (
                            d.changed_columns.map((col) => {
                              const idx = result.columns.findIndex(
                                (c) => c.toLowerCase() === col.toLowerCase(),
                              );
                              return (
                                <div key={col} className="truncate">
                                  <span className="text-fg-muted">{col}:</span>{" "}
                                  {formatValue(d.source?.[idx])}{" "}
                                  <span className="text-fg-subtle">→</span> {formatValue(d.target?.[idx])}
                                </div>
                              );
                            })
                          ) : (
                            <span className="text-fg-muted truncate block">
                              {(d.source ?? d.target ?? []).map(formatValue).join(" · ")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
