import React, { useEffect, useMemo, useState } from "react";
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

const KIND_LABELS: Record<RowDifferenceKind, string> = {
  insert: "Solo en origen",
  delete: "Solo en destino",
  update: "Modificadas",
};

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
      .then((list) => alive && setTables(list.filter((t) => !t.table_type.toUpperCase().includes("VIEW"))))
      .catch(() => alive && setTables([]));
    return () => {
      alive = false;
    };
  }, [isActive, side.database]);

  return (
    <div className={`${cardClass} p-3 space-y-2.5 flex-1 min-w-0`}>
      <div className={sectionLabel}>{title}</div>
      <div>
        <label className={fieldLabel}>Conexión</label>
        <select
          className={selectClass}
          value={side.profileId}
          onChange={(e) => onChange({ profileId: e.target.value, database: "", table: "" })}
        >
          <option value="">Conexión activa</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={fieldLabel}>Base de datos</label>
          {isActive ? (
            <select
              className={selectClass}
              value={side.database}
              onChange={(e) => onChange({ ...side, database: e.target.value, table: "" })}
            >
              <option value="" disabled>
                Elegir…
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
              placeholder="Nombre de la base"
              onChange={(e) => onChange({ ...side, database: e.target.value })}
            />
          )}
        </div>
        <div>
          <label className={fieldLabel}>Tabla</label>
          {isActive ? (
            <select
              className={selectClass}
              value={side.table}
              onChange={(e) => onChange({ ...side, table: e.target.value })}
            >
              <option value="" disabled>
                Elegir…
              </option>
              {tables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={inputClass}
              value={side.table}
              placeholder="Nombre de la tabla"
              onChange={(e) => onChange({ ...side, table: e.target.value })}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const DataCompareTab: React.FC<DataCompareTabProps> = ({ database, tableName }) => {
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
    const header = `-- Sincroniza ${target.database}.${target.table} con ${source.database}.${source.table}${
      result.truncated ? `\n-- Incompleto: solo las primeras ${result.sync_statements.length} diferencias` : ""
    }\n`;
    useUIStore.getState().openTab({
      id: `query-${Date.now()}`,
      type: "query",
      title: `Sincronizar ${target.table}`,
      database: target.database,
      queryContent: header + script,
    });
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(script);
    } catch (err) {
      useUIStore.getState().showAlert({
        title: "No se pudo copiar",
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
    <div className="h-full flex flex-col bg-canvas overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-surface shrink-0">
        <GitCompareArrows className="w-4 h-4 text-fg-muted" />
        <span className="text-sm font-medium text-fg">Comparar datos</span>
        <span className={mutedText}>Fila a fila por clave primaria</span>
      </div>

      <div className="p-4 space-y-3 border-b border-line shrink-0">
        <div className="flex items-stretch gap-3">
          <SidePicker title="Origen (referencia)" side={source} profiles={profiles} onChange={setSource} />
          <div className="flex items-center">
            <ArrowRight className="w-4 h-4 text-fg-subtle" />
          </div>
          <SidePicker title="Destino (a sincronizar)" side={target} profiles={profiles} onChange={setTarget} />
        </div>
        <div className="flex items-center justify-end gap-3">
          {isSameTable && source.table && (
            <span className={mutedText}>Origen y destino son la misma tabla.</span>
          )}
          <button className={primaryBtn} disabled={!canCompare} onClick={handleCompare}>
            {isComparing ? <Spinner className="w-3.5 h-3.5" /> : <GitCompareArrows className="w-3.5 h-3.5" />}
            Comparar datos
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isComparing ? (
          <div className="h-full flex items-center justify-center gap-2 text-xs text-fg-muted">
            <Spinner /> Comparando… en tablas grandes puede tardar.
          </div>
        ) : error ? (
          <EmptyState title="No se pudo comparar" description={error} />
        ) : !result ? (
          <EmptyState
            icon={<GitCompareArrows className="w-6 h-6" />}
            title="Elija dos tablas con la misma clave primaria"
            description="En MariaDB/MySQL solo se descargan los bloques cuyo checksum difiere."
          />
        ) : (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fg">
              {(["insert", "delete", "update"] as RowDifferenceKind[]).map((kind) => {
                const count = kind === "insert" ? result.inserted : kind === "delete" ? result.deleted : result.modified;
                return (
                  <span key={kind} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${KIND_DOT[kind]}`} />
                    {KIND_LABELS[kind]}: <span className="font-medium tabular-nums">{count}</span>
                  </span>
                );
              })}
              <span className={mutedText}>
                {result.source_rows} filas en origen · {result.target_rows} en destino ·{" "}
                {result.used_checksums
                  ? `${result.identical_chunks}/${result.chunks} bloques idénticos por checksum · `
                  : ""}
                {(result.elapsed_ms / 1000).toFixed(1)} s
              </span>
            </div>

            {(result.source_only_columns.length > 0 || result.target_only_columns.length > 0) && (
              <p className={mutedText}>
                Columnas no comparadas:{" "}
                {[
                  ...result.source_only_columns.map((c) => `${c} (solo origen)`),
                  ...result.target_only_columns.map((c) => `${c} (solo destino)`),
                ].join(", ")}
                .
              </p>
            )}

            {totalDiffs === 0 ? (
              <EmptyState title="Los datos son idénticos" description="No hay nada que sincronizar." />
            ) : (
              <>
                <div className="flex items-center gap-1 border-b border-line">
                  {(["all", "insert", "delete", "update"] as const).map((k) => (
                    <button key={k} className={tabClass(kindFilter === k)} onClick={() => setKindFilter(k)}>
                      {k === "all" ? "Todas" : KIND_LABELS[k]}
                    </button>
                  ))}
                  <div className="flex-1" />
                  <button className={ghostBtn} onClick={copyScript}>
                    <Copy className="w-3.5 h-3.5" /> Copiar script
                  </button>
                  <button className={ghostBtn} onClick={openScript}>
                    <FileCode className="w-3.5 h-3.5" /> Abrir script de sincronización
                  </button>
                </div>
                {result.truncated && (
                  <p className={mutedText}>
                    Se muestran y se incluyen en el script las primeras {result.differences.length} de{" "}
                    {totalDiffs} diferencias. Los totales son exactos.
                  </p>
                )}
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-left text-fg-muted border-b border-line">
                      <th className="py-1.5 pr-3 font-medium">{result.key_columns.join(", ")}</th>
                      <th className="py-1.5 pr-3 font-medium">Cambios (origen → destino)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((d, i) => (
                      <tr key={i} className="border-b border-line align-top">
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${KIND_DOT[d.kind]}`} title={KIND_LABELS[d.kind]} />
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
