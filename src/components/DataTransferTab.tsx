import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  Database,
  FileCode,
  Play,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { dbService } from "../services/tauriDb";
import { connectionStorage } from "../services/connectionStorage";
import { useConnectionStore } from "../stores/connectionStore";
import { useSchemaStore } from "../stores/schemaStore";
import { useUIStore } from "../stores/uiStore";
import { useIsLightTheme } from "../stores/preferenceStore";
import { useTauriEvent } from "../hooks/useTauriEvent";
import {
  databaseCredentialId,
  type ConnectionConfig,
  type DatabaseSchema,
  type DbEngine,
  type SavedConnection,
  type TableTransferItem,
  type TableTransferMode,
  type TransferObjectsCatalog,
  type TransferOptions,
  type TransferPreview,
  type TransferProgressEvent,
  type TransferResult,
} from "../types/database";
import { ObjectIcon } from "./objectIcons";
import { EmptyState, Spinner } from "./ui/Modal";
import {
  cardClass,
  fieldLabel,
  ghostBtn,
  inputClass,
  mutedText,
  primaryBtn,
  secondaryBtn,
  sectionLabel,
  selectClass,
  tabClass,
} from "./ui/styles";
import { uid } from "../utils/uid";
import { errorText } from "../utils/errors";

interface DataTransferTabProps {
  initialSourceDb?: string;
}

type WizardStep = 1 | 2 | 3 | 4;
type ObjectCategory = "tables" | "views" | "routines" | "triggers" | "events";

const SYSTEM_SCHEMAS = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

const ENGINE_LABEL: Record<DbEngine, string> = {
  mysql: "MariaDB / MySQL",
  sqlite: "SQLite",
};

const MODE_LABELS: Record<TableTransferMode, string> = {
  structure_and_data: "Estructura + Datos",
  structure_only: "Solo Estructura",
  data_only: "Solo Datos",
};

function profileToConfig(profile: SavedConnection, database: string): ConnectionConfig {
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

interface EndpointState {
  profileId: string; // "" = active connection
  database: string;
  engine: DbEngine;
  databases: DatabaseSchema[];
  loading: boolean;
  error: string | null;
}

export const DataTransferTab: React.FC<DataTransferTabProps> = ({ initialSourceDb }) => {
  const isLight = useIsLightTheme();
  const { connectionStatus } = useConnectionStore();
  const { databases: activeDatabases } = useSchemaStore();
  const { showConfirm } = useUIStore();

  const [profiles, setProfiles] = useState<SavedConnection[]>([]);
  const [step, setStep] = useState<WizardStep>(1);

  const activeConfig = connectionStatus.is_connected ? connectionStatus.config : undefined;
  const activeEngine: DbEngine = activeConfig?.engine ?? "mysql";

  const [source, setSource] = useState<EndpointState>(() => ({
    profileId: "",
    database:
      initialSourceDb ||
      activeDatabases.find((d) => !SYSTEM_SCHEMAS.has(d.name.toLowerCase()))?.name ||
      activeDatabases[0]?.name ||
      "",
    engine: activeEngine,
    databases: activeDatabases,
    loading: false,
    error: null,
  }));

  const [target, setTarget] = useState<EndpointState>(() => {
    const defaultTargetDb =
      activeDatabases.find(
        (d) => d.name !== initialSourceDb && !SYSTEM_SCHEMAS.has(d.name.toLowerCase()),
      )?.name || "";
    return {
      profileId: "",
      database: defaultTargetDb,
      engine: activeEngine,
      databases: activeDatabases,
      loading: false,
      error: null,
    };
  });

  // Step 2: Object catalog & selections
  const [catalog, setCatalog] = useState<TransferObjectsCatalog | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<ObjectCategory>("tables");
  const [objectFilter, setObjectFilter] = useState("");

  const [selectedTables, setSelectedTables] = useState<Record<string, TableTransferMode>>({});
  const [selectedViews, setSelectedViews] = useState<Set<string>>(new Set());
  const [selectedRoutines, setSelectedRoutines] = useState<Set<string>>(new Set());
  const [selectedTriggers, setSelectedTriggers] = useState<Set<string>>(new Set());
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());

  // Step 3: Options & SQL Preview
  const [options, setOptions] = useState<TransferOptions>({
    drop_existing: false,
    create_if_not_exists: true,
    truncate_before_insert: false,
    disable_foreign_keys: true,
    continue_on_error: true,
    batch_size: 250,
  });
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Step 4: Execution & Progress
  const [transferId, setTransferId] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<TransferProgressEvent | null>(null);
  const [liveLog, setLiveLog] = useState<TransferProgressEvent[]>([]);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [latestProgress] = useTauriEvent<TransferProgressEvent>("transfer-progress");

  useEffect(() => {
    setProfiles(connectionStorage.getSavedConnections());
  }, []);

  // Keep active connection databases synced when profileId === ""
  useEffect(() => {
    if (source.profileId === "" && activeConfig) {
      setSource((prev) => ({
        ...prev,
        engine: activeConfig.engine ?? "mysql",
        databases: activeDatabases,
        database:
          prev.database ||
          initialSourceDb ||
          activeDatabases.find((d) => !SYSTEM_SCHEMAS.has(d.name.toLowerCase()))?.name ||
          activeDatabases[0]?.name ||
          "",
      }));
    }
  }, [activeDatabases, activeConfig, initialSourceDb, source.profileId]);

  useEffect(() => {
    if (target.profileId === "" && activeConfig) {
      setTarget((prev) => ({
        ...prev,
        engine: activeConfig.engine ?? "mysql",
        databases: activeDatabases,
      }));
    }
  }, [activeDatabases, activeConfig, target.profileId]);

  useEffect(() => {
    if (!latestProgress || !transferId || latestProgress.transferId !== transferId) return;
    setProgress(latestProgress);
    setLiveLog((prev) => [...prev.slice(-199), latestProgress]);
  }, [latestProgress, transferId]);

  const buildEndpointConfig = (ep: EndpointState): ConnectionConfig | null => {
    if (!ep.profileId) return null;
    const profile = profiles.find((p) => p.id === ep.profileId);
    if (!profile) return null;
    return profileToConfig(profile, ep.database);
  };

  const loadDatabasesForSide = async (
    side: "source" | "target",
    profileId: string,
  ) => {
    const setter = side === "source" ? setSource : setTarget;
    if (profileId === "") {
      setter((prev) => ({
        ...prev,
        profileId: "",
        engine: activeConfig?.engine ?? "mysql",
        databases: activeDatabases,
        database:
          activeDatabases.find((d) => !SYSTEM_SCHEMAS.has(d.name.toLowerCase()))?.name ||
          activeDatabases[0]?.name ||
          "",
        loading: false,
        error: null,
      }));
      return;
    }

    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    setter((prev) => ({
      ...prev,
      profileId,
      engine: profile.engine ?? "mysql",
      loading: true,
      error: null,
      databases: [],
      database: "",
    }));

    try {
      const cat = await dbService.inspectTransferDatabases(
        profileToConfig(profile, profile.database || ""),
      );
      const defaultDb =
        cat.databases.find(
          (d) =>
            d.name === profile.database ||
            !SYSTEM_SCHEMAS.has(d.name.toLowerCase()),
        )?.name ||
        cat.databases[0]?.name ||
        "";
      setter((prev) => ({
        ...prev,
        engine: cat.engine,
        databases: cat.databases,
        database: defaultDb,
        loading: false,
      }));
    } catch (err) {
      setter((prev) => ({
        ...prev,
        loading: false,
        error: errorText(err),
      }));
    }
  };

  const crossEngine = source.engine !== target.engine;
  const sameDestination =
    source.profileId === target.profileId &&
    source.database !== "" &&
    source.database === target.database;

  const canProceedStep1 =
    Boolean(source.database) &&
    Boolean(target.database) &&
    !sameDestination &&
    !source.loading &&
    !target.loading;

  const loadSourceCatalog = async () => {
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const cat = await dbService.inspectTransferObjects(
        buildEndpointConfig(source),
        source.database,
      );
      setCatalog(cat);
      // Preselect all tables by default with Structure + Data
      const tblMap: Record<string, TableTransferMode> = {};
      for (const t of cat.tables) {
        tblMap[t.name] = "structure_and_data";
      }
      setSelectedTables(tblMap);
      setSelectedViews(new Set(cat.views));
      setSelectedRoutines(
        new Set(
          target.engine === "sqlite"
            ? []
            : cat.routines.map((r) => `${r.routine_type}:${r.name}`),
        ),
      );
      setSelectedTriggers(
        new Set(crossEngine ? [] : cat.triggers.map((t) => t.name)),
      );
      setSelectedEvents(
        new Set(target.engine === "sqlite" ? [] : cat.events.map((e) => e.name)),
      );
      setActiveCategory("tables");
    } catch (err) {
      setCatalogError(errorText(err));
    } finally {
      setLoadingCatalog(false);
    }
  };

  const handleGoStep2 = async () => {
    setStep(2);
    await loadSourceCatalog();
  };

  const totalSelectedCount = useMemo(
    () =>
      Object.keys(selectedTables).length +
      selectedViews.size +
      selectedRoutines.size +
      selectedTriggers.size +
      selectedEvents.size,
    [selectedTables, selectedViews, selectedRoutines, selectedTriggers, selectedEvents],
  );

  const buildRequest = (id: string) => {
    const tables: TableTransferItem[] = Object.entries(selectedTables).map(
      ([name, mode]) => ({ name, mode }),
    );
    const routines = Array.from(selectedRoutines).map((key) => {
      const idx = key.indexOf(":");
      return {
        routine_type: idx >= 0 ? key.slice(0, idx) : "PROCEDURE",
        name: idx >= 0 ? key.slice(idx + 1) : key,
      };
    });
    return {
      transfer_id: id,
      source_connection: buildEndpointConfig(source),
      source_database: source.database,
      target_connection: buildEndpointConfig(target),
      target_database: target.database,
      tables,
      views: Array.from(selectedViews),
      routines,
      triggers: Array.from(selectedTriggers),
      events: Array.from(selectedEvents),
      options,
    };
  };

  const loadPreview = async () => {
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const p = await dbService.previewTransferPlan(buildRequest("preview"));
      setPreview(p);
    } catch (err) {
      setPreviewError(errorText(err));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleGoStep3 = () => {
    setPreview(null);
    setPreviewError(null);
    setStep(3);
  };

  const startExecution = async () => {
    const newId = `transfer-${uid()}`;
    setTransferId(newId);
    setIsRunning(true);
    setProgress(null);
    setLiveLog([]);
    setResult(null);
    setExecutionError(null);
    setStep(4);

    try {
      const res = await dbService.executeDataTransfer(buildRequest(newId));
      setResult(res);
    } catch (err) {
      setExecutionError(errorText(err));
    } finally {
      setIsRunning(false);
    }
  };

  const handleExecuteClick = () => {
    const targetProfile = target.profileId
      ? profiles.find((p) => p.id === target.profileId)
      : null;
    const targetEnv = target.profileId
      ? targetProfile?.environment
      : activeConfig?.environment;
    const isProd = targetEnv === "production";
    const isDestructive = options.drop_existing || options.truncate_before_insert;

    if (isProd || isDestructive) {
      const reasons: string[] = [];
      if (isProd) reasons.push("la conexión destino es de PRODUCCIÓN");
      if (options.drop_existing) reasons.push("se eliminarán objetos existentes (DROP IF EXISTS)");
      if (options.truncate_before_insert) reasons.push("se vaciarán las tablas destino antes de insertar");

      showConfirm({
        title: "Confirmar migración",
        message: `Vas a migrar ${totalSelectedCount} objeto(s) hacia "${target.database}" y ${reasons.join(", ")}. ¿Deseas continuar?`,
        confirmText: "Iniciar migración",
        variant: isDestructive || isProd ? "danger" : "warning",
        onConfirm: () => {
          void startExecution();
        },
      });
      return;
    }

    void startExecution();
  };

  const targetProfileReadOnly = Boolean(
    target.profileId
      ? profiles.find((p) => p.id === target.profileId)?.readOnly
      : activeConfig?.read_only,
  );

  // Filtered lists for Step 2
  const filterLower = objectFilter.trim().toLowerCase();
  const filteredTables = (catalog?.tables ?? []).filter((t) =>
    t.name.toLowerCase().includes(filterLower),
  );
  const filteredViews = (catalog?.views ?? []).filter((v) =>
    v.toLowerCase().includes(filterLower),
  );
  const filteredRoutines = (catalog?.routines ?? []).filter((r) =>
    r.name.toLowerCase().includes(filterLower),
  );
  const filteredTriggers = (catalog?.triggers ?? []).filter((t) =>
    t.name.toLowerCase().includes(filterLower),
  );
  const filteredEvents = (catalog?.events ?? []).filter((e) =>
    e.name.toLowerCase().includes(filterLower),
  );

  const toggleAllCurrentCategory = (select: boolean) => {
    if (!catalog) return;
    if (activeCategory === "tables") {
      if (!select) {
        setSelectedTables({});
      } else {
        const next: Record<string, TableTransferMode> = {};
        for (const t of filteredTables) next[t.name] = "structure_and_data";
        setSelectedTables(next);
      }
    } else if (activeCategory === "views") {
      setSelectedViews(select ? new Set(filteredViews) : new Set());
    } else if (activeCategory === "routines") {
      setSelectedRoutines(
        select
          ? new Set(filteredRoutines.map((r) => `${r.routine_type}:${r.name}`))
          : new Set(),
      );
    } else if (activeCategory === "triggers") {
      setSelectedTriggers(select ? new Set(filteredTriggers.map((t) => t.name)) : new Set());
    } else if (activeCategory === "events") {
      setSelectedEvents(select ? new Set(filteredEvents.map((e) => e.name)) : new Set());
    }
  };

  const applyModeToAllSelectedTables = (mode: TableTransferMode) => {
    setSelectedTables((prev) => {
      const next: Record<string, TableTransferMode> = {};
      for (const name of Object.keys(prev)) {
        next[name] = mode;
      }
      return next;
    });
  };

  const stepTitles: { num: WizardStep; label: string }[] = [
    { num: 1, label: "1. Conexiones" },
    { num: 2, label: "2. Objetos" },
    { num: 3, label: "3. Opciones y SQL" },
    { num: 4, label: "4. Ejecución" },
  ];

  const progressPct =
    progress && progress.totalObjects > 0
      ? Math.round((progress.completedObjects / progress.totalObjects) * 100)
      : result
        ? 100
        : 0;

  return (
    <div className="pyro-view flex flex-col h-full bg-canvas text-fg overflow-hidden">
      {/* Header */}
      <div
        data-view-toolbar
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-line bg-surface shrink-0"
      >
        <div className="flex items-center gap-2.5">
          <ArrowLeftRight className="w-4 h-4 text-accent-text" />
          <div>
            <h1 className="text-sm font-semibold text-fg">
              Asistente de migración y transferencia
            </h1>
            <p className={mutedText}>
              Copia tablas, datos, vistas, rutinas y triggers entre bases de datos o motores distintos
            </p>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1" role="tablist" aria-label="Pasos del asistente">
          {stepTitles.map((s) => (
            <button
              key={s.num}
              type="button"
              disabled={isRunning || (s.num > 1 && !canProceedStep1) || (s.num === 4 && !result && !isRunning)}
              onClick={() => {
                if (s.num === 2 && !catalog) {
                  void handleGoStep2();
                } else {
                  setStep(s.num);
                }
              }}
              className={tabClass(step === s.num)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-5">
        {step === 1 && (
          <div className="max-w-5xl mx-auto space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
              {/* Source */}
              <div className={`${cardClass} p-4 space-y-3`}>
                <div className="flex items-center justify-between">
                  <span className={sectionLabel}>Origen</span>
                  <span className="text-[11px] font-mono text-fg-muted">
                    {ENGINE_LABEL[source.engine]}
                  </span>
                </div>

                <div>
                  <label className={fieldLabel} htmlFor="transfer-source-conn">
                    Conexión origen
                  </label>
                  <select
                    id="transfer-source-conn"
                    value={source.profileId}
                    onChange={(e) => void loadDatabasesForSide("source", e.target.value)}
                    className={selectClass}
                  >
                    {activeConfig && (
                      <option value="">
                        Conexión activa ({activeConfig.savedConnectionName || activeConfig.host || "SQLite"})
                      </option>
                    )}
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({ENGINE_LABEL[p.engine ?? "mysql"]})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={fieldLabel} htmlFor="transfer-source-db">
                    Base de datos origen
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      id="transfer-source-db"
                      value={source.database}
                      disabled={source.loading || source.databases.length === 0}
                      onChange={(e) =>
                        setSource((prev) => ({ ...prev, database: e.target.value }))
                      }
                      className={selectClass}
                    >
                      {source.databases.length === 0 && (
                        <option value="">Sin bases de datos disponibles</option>
                      )}
                      {source.databases.map((db) => (
                        <option key={db.name} value={db.name}>
                          {db.name} ({db.tables_count})
                        </option>
                      ))}
                    </select>
                    {source.loading && <Spinner className="w-3.5 h-3.5" />}
                  </div>
                </div>

                {source.error && (
                  <p className="text-xs text-danger flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{source.error}</span>
                  </p>
                )}
              </div>

              {/* Direction */}
              <div className="flex items-center justify-center">
                <div className="p-2 rounded-full border border-line bg-surface text-fg-muted">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>

              {/* Target */}
              <div className={`${cardClass} p-4 space-y-3`}>
                <div className="flex items-center justify-between">
                  <span className={sectionLabel}>Destino</span>
                  <span className="text-[11px] font-mono text-fg-muted">
                    {ENGINE_LABEL[target.engine]}
                  </span>
                </div>

                <div>
                  <label className={fieldLabel} htmlFor="transfer-target-conn">
                    Conexión destino
                  </label>
                  <select
                    id="transfer-target-conn"
                    value={target.profileId}
                    onChange={(e) => void loadDatabasesForSide("target", e.target.value)}
                    className={selectClass}
                  >
                    {activeConfig && (
                      <option value="">
                        Conexión activa ({activeConfig.savedConnectionName || activeConfig.host || "SQLite"})
                      </option>
                    )}
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({ENGINE_LABEL[p.engine ?? "mysql"]})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={fieldLabel} htmlFor="transfer-target-db">
                    Base de datos destino
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      id="transfer-target-db"
                      value={target.database}
                      disabled={target.loading || target.databases.length === 0}
                      onChange={(e) =>
                        setTarget((prev) => ({ ...prev, database: e.target.value }))
                      }
                      className={selectClass}
                    >
                      {target.databases.length === 0 && (
                        <option value="">Sin bases de datos disponibles</option>
                      )}
                      {target.databases.map((db) => (
                        <option key={db.name} value={db.name}>
                          {db.name} ({db.tables_count})
                        </option>
                      ))}
                    </select>
                    {target.loading && <Spinner className="w-3.5 h-3.5" />}
                  </div>
                </div>

                {target.error && (
                  <p className="text-xs text-danger flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{target.error}</span>
                  </p>
                )}
              </div>
            </div>

            {sameDestination && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-line bg-surface text-xs text-warning">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>El origen y el destino apuntan a la misma base de datos. Selecciona una base distinta.</span>
              </div>
            )}

            {targetProfileReadOnly && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-line bg-surface text-xs text-danger">
                <XCircle className="w-4 h-4 shrink-0" />
                <span>La conexión destino está marcada como solo lectura; no podrá recibir objetos ni datos.</span>
              </div>
            )}

            {crossEngine && (
              <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border border-line bg-surface text-xs text-fg-muted">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-fg font-medium">
                    Migración entre motores diferentes ({ENGINE_LABEL[source.engine]} → {ENGINE_LABEL[target.engine]})
                  </p>
                  <p>
                    Se traducirán automáticamente los tipos de columnas, valores por defecto, claves primarias, índices y comillas de identificadores.
                    {target.engine === "sqlite"
                      ? " Las rutinas almacenadas y eventos no son compatibles con SQLite y se omitirán."
                      : " Los triggers entre motores distintos requieren adaptación manual."}
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                disabled={!canProceedStep1}
                onClick={() => void handleGoStep2()}
                className={primaryBtn}
              >
                <span>Seleccionar objetos</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="max-w-5xl mx-auto space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <Database className="w-3.5 h-3.5" />
                <span className="font-mono text-fg">{source.database}</span>
                <ArrowRight className="w-3.5 h-3.5" />
                <span className="font-mono text-fg">{target.database}</span>
                <span className="tabular-nums">({totalSelectedCount} seleccionados)</span>
              </div>
              <button
                type="button"
                onClick={() => void loadSourceCatalog()}
                disabled={loadingCatalog}
                className={ghostBtn}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingCatalog ? "animate-spin" : ""}`} />
                <span>Recargar catálogo</span>
              </button>
            </div>

            {loadingCatalog ? (
              <div className="py-12 flex items-center justify-center gap-2 text-xs text-fg-muted">
                <Spinner className="w-3.5 h-3.5" />
                <span>Inspeccionando objetos de {source.database}...</span>
              </div>
            ) : catalogError ? (
              <EmptyState
                icon={<XCircle className="w-8 h-8 text-danger" />}
                title="No se pudo leer el catálogo origen"
                description={catalogError}
                action={
                  <button type="button" onClick={() => void loadSourceCatalog()} className={secondaryBtn}>
                    Reintentar
                  </button>
                }
              />
            ) : (
              <div className={`${cardClass} overflow-hidden`}>
                {/* Category tabs + search */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 border-b border-line bg-raised">
                  <div className="flex items-center gap-1 overflow-x-auto">
                    <button
                      type="button"
                      onClick={() => setActiveCategory("tables")}
                      className={tabClass(activeCategory === "tables")}
                    >
                      Tablas ({Object.keys(selectedTables).length}/{catalog?.tables.length ?? 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveCategory("views")}
                      className={tabClass(activeCategory === "views")}
                    >
                      Vistas ({selectedViews.size}/{catalog?.views.length ?? 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveCategory("routines")}
                      className={tabClass(activeCategory === "routines")}
                    >
                      Rutinas ({selectedRoutines.size}/{catalog?.routines.length ?? 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveCategory("triggers")}
                      className={tabClass(activeCategory === "triggers")}
                    >
                      Triggers ({selectedTriggers.size}/{catalog?.triggers.length ?? 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveCategory("events")}
                      className={tabClass(activeCategory === "events")}
                    >
                      Eventos ({selectedEvents.size}/{catalog?.events.length ?? 0})
                    </button>
                  </div>

                  <div className="relative py-1.5">
                    <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={objectFilter}
                      onChange={(e) => setObjectFilter(e.target.value)}
                      placeholder="Filtrar objetos..."
                      className={`${inputClass} pl-8 w-52`}
                    />
                  </div>
                </div>

                {/* Bulk actions bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-line bg-surface text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleAllCurrentCategory(true)}
                      className={ghostBtn}
                    >
                      Seleccionar visibles
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleAllCurrentCategory(false)}
                      className={ghostBtn}
                    >
                      Deseleccionar
                    </button>
                  </div>

                  {activeCategory === "tables" && Object.keys(selectedTables).length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className={mutedText}>Modo para seleccionadas:</span>
                      {(
                        [
                          "structure_and_data",
                          "structure_only",
                          "data_only",
                        ] as TableTransferMode[]
                      ).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => applyModeToAllSelectedTables(m)}
                          className={ghostBtn}
                        >
                          {MODE_LABELS[m]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Object list */}
                <div className="max-h-[400px] overflow-auto divide-y divide-line">
                  {activeCategory === "tables" &&
                    (filteredTables.length === 0 ? (
                      <div className="p-6 text-center text-xs text-fg-muted">
                        No hay tablas que coincidan.
                      </div>
                    ) : (
                      filteredTables.map((t) => {
                        const mode = selectedTables[t.name];
                        const checked = mode !== undefined;
                        return (
                          <div
                            key={t.name}
                            className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-hover text-xs"
                          >
                            <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setSelectedTables((prev) => {
                                    const next = { ...prev };
                                    if (e.target.checked) {
                                      next[t.name] = "structure_and_data";
                                    } else {
                                      delete next[t.name];
                                    }
                                    return next;
                                  });
                                }}
                              />
                              <ObjectIcon kind="tables" />
                              <span className="font-mono truncate">{t.name}</span>
                              {t.rows_count !== null && t.rows_count !== undefined && (
                                <span className="text-[11px] text-fg-subtle tabular-nums">
                                  ~{t.rows_count.toLocaleString()} filas
                                </span>
                              )}
                            </label>
                            {checked && (
                              <select
                                aria-label={`Modo para ${t.name}`}
                                value={mode}
                                onChange={(e) =>
                                  setSelectedTables((prev) => ({
                                    ...prev,
                                    [t.name]: e.target.value as TableTransferMode,
                                  }))
                                }
                                className={`${selectClass} w-44`}
                              >
                                <option value="structure_and_data">Estructura + Datos</option>
                                <option value="structure_only">Solo Estructura</option>
                                <option value="data_only">Solo Datos</option>
                              </select>
                            )}
                          </div>
                        );
                      })
                    ))}

                  {activeCategory === "views" &&
                    (filteredViews.length === 0 ? (
                      <div className="p-6 text-center text-xs text-fg-muted">
                        No hay vistas disponibles.
                      </div>
                    ) : (
                      filteredViews.map((v) => (
                        <label
                          key={v}
                          className="flex items-center gap-2.5 px-4 py-2 hover:bg-hover text-xs cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedViews.has(v)}
                            onChange={(e) => {
                              setSelectedViews((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(v);
                                else next.delete(v);
                                return next;
                              });
                            }}
                          />
                          <ObjectIcon kind="views" />
                          <span className="font-mono">{v}</span>
                        </label>
                      ))
                    ))}

                  {activeCategory === "routines" && (
                    <>
                      {target.engine === "sqlite" && (
                        <div className="px-4 py-2 bg-raised text-[11px] text-warning flex items-center gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>SQLite no soporta funciones ni procedimientos almacenados; si los seleccionas serán omitidos.</span>
                        </div>
                      )}
                      {filteredRoutines.length === 0 ? (
                        <div className="p-6 text-center text-xs text-fg-muted">
                          No hay rutinas disponibles.
                        </div>
                      ) : (
                        filteredRoutines.map((r) => {
                          const key = `${r.routine_type}:${r.name}`;
                          return (
                            <label
                              key={key}
                              className="flex items-center justify-between gap-2.5 px-4 py-2 hover:bg-hover text-xs cursor-pointer"
                            >
                              <div className="flex items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={selectedRoutines.has(key)}
                                  onChange={(e) => {
                                    setSelectedRoutines((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(key);
                                      else next.delete(key);
                                      return next;
                                    });
                                  }}
                                />
                                <ObjectIcon
                                  kind={
                                    r.routine_type.toUpperCase() === "FUNCTION"
                                      ? "functions"
                                      : "procedures"
                                  }
                                />
                                <span className="font-mono">{r.name}</span>
                              </div>
                              <span className="text-[11px] text-fg-subtle">{r.routine_type}</span>
                            </label>
                          );
                        })
                      )}
                    </>
                  )}

                  {activeCategory === "triggers" && (
                    <>
                      {crossEngine && (
                        <div className="px-4 py-2 bg-raised text-[11px] text-warning flex items-center gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>Los triggers entre motores diferentes se omitirán por incompatibilidad sintáctica.</span>
                        </div>
                      )}
                      {filteredTriggers.length === 0 ? (
                        <div className="p-6 text-center text-xs text-fg-muted">
                          No hay triggers disponibles.
                        </div>
                      ) : (
                        filteredTriggers.map((tr) => (
                          <label
                            key={tr.name}
                            className="flex items-center justify-between gap-2.5 px-4 py-2 hover:bg-hover text-xs cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={selectedTriggers.has(tr.name)}
                                onChange={(e) => {
                                  setSelectedTriggers((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(tr.name);
                                    else next.delete(tr.name);
                                    return next;
                                  });
                                }}
                              />
                              <ObjectIcon kind="triggers" />
                              <span className="font-mono">{tr.name}</span>
                            </div>
                            <span className="text-[11px] text-fg-subtle">
                              {tr.timing} {tr.event} ON {tr.table_name}
                            </span>
                          </label>
                        ))
                      )}
                    </>
                  )}

                  {activeCategory === "events" && (
                    <>
                      {target.engine === "sqlite" && (
                        <div className="px-4 py-2 bg-raised text-[11px] text-warning flex items-center gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>SQLite no soporta eventos programados.</span>
                        </div>
                      )}
                      {filteredEvents.length === 0 ? (
                        <div className="p-6 text-center text-xs text-fg-muted">
                          No hay eventos disponibles.
                        </div>
                      ) : (
                        filteredEvents.map((ev) => (
                          <label
                            key={ev.name}
                            className="flex items-center justify-between gap-2.5 px-4 py-2 hover:bg-hover text-xs cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={selectedEvents.has(ev.name)}
                                onChange={(e) => {
                                  setSelectedEvents((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(ev.name);
                                    else next.delete(ev.name);
                                    return next;
                                  });
                                }}
                              />
                              <ObjectIcon kind="events" />
                              <span className="font-mono">{ev.name}</span>
                            </div>
                            <span className="text-[11px] text-fg-subtle">{ev.status}</span>
                          </label>
                        ))
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setStep(1)} className={secondaryBtn}>
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Atrás</span>
              </button>
              <button
                type="button"
                disabled={totalSelectedCount === 0}
                onClick={handleGoStep3}
                className={primaryBtn}
              >
                <span>Opciones y revisión</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="max-w-5xl mx-auto space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={`${cardClass} p-4 space-y-3`}>
                <span className={sectionLabel}>Opciones de estructura y datos</span>

                <label className="flex items-start gap-2.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.drop_existing}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, drop_existing: e.target.checked }))
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-fg font-medium">Eliminar objetos existentes antes de crear (DROP IF EXISTS)</span>
                    <p className={mutedText}>Reemplaza las tablas o vistas existentes en el destino.</p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.create_if_not_exists}
                    disabled={options.drop_existing}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, create_if_not_exists: e.target.checked }))
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-fg font-medium">Usar CREATE IF NOT EXISTS</span>
                    <p className={mutedText}>Evita errores si la tabla ya existe en el destino.</p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.truncate_before_insert}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, truncate_before_insert: e.target.checked }))
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-fg font-medium">Vaciar tabla destino antes de insertar datos</span>
                    <p className={mutedText}>Ejecuta TRUNCATE / DELETE FROM antes de copiar filas.</p>
                  </div>
                </label>
              </div>

              <div className={`${cardClass} p-4 space-y-3`}>
                <span className={sectionLabel}>Seguridad y rendimiento</span>

                <label className="flex items-start gap-2.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.disable_foreign_keys}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, disable_foreign_keys: e.target.checked }))
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-fg font-medium">Desactivar verificación de claves foráneas</span>
                    <p className={mutedText}>Permite crear e insertar tablas sin importar el orden de dependencias.</p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.continue_on_error}
                    onChange={(e) =>
                      setOptions((prev) => ({ ...prev, continue_on_error: e.target.checked }))
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-fg font-medium">Continuar si ocurre un error en un objeto</span>
                    <p className={mutedText}>Registra el error y prosigue con el siguiente elemento.</p>
                  </div>
                </label>

                <div>
                  <label className={fieldLabel} htmlFor="transfer-batch-size">
                    Filas por lote (INSERT batch size)
                  </label>
                  <input
                    id="transfer-batch-size"
                    type="number"
                    min={10}
                    max={2000}
                    value={options.batch_size}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        batch_size: Math.max(10, Math.min(2000, Number(e.target.value) || 250)),
                      }))
                    }
                    className={`${inputClass} w-36 tabular-nums`}
                  />
                </div>
              </div>
            </div>

            {/* Preview DDL */}
            <div className={`${cardClass} p-4 space-y-3`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className={sectionLabel}>Previsualización de DDL</span>
                  <p className={mutedText}>
                    Inspecciona las sentencias de estructura generadas para {ENGINE_LABEL[target.engine]} antes de ejecutar
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadPreview()}
                  disabled={loadingPreview}
                  className={secondaryBtn}
                >
                  {loadingPreview ? <Spinner className="w-3.5 h-3.5" /> : <FileCode className="w-3.5 h-3.5" />}
                  <span>Generar vista previa SQL</span>
                </button>
              </div>

              {previewError && (
                <p className="text-xs text-danger">{previewError}</p>
              )}

              {preview && (
                <div className="space-y-2.5">
                  {preview.warnings.length > 0 && (
                    <div className="space-y-1 text-xs text-warning">
                      {preview.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="border border-line rounded-md overflow-hidden max-h-72">
                    <CodeMirror
                      value={preview.statements.join("\n\n")}
                      height="240px"
                      theme={isLight ? "light" : "dark"}
                      extensions={[sqlLang()]}
                      editable={false}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setStep(2)} className={secondaryBtn}>
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Atrás</span>
              </button>
              <button
                type="button"
                disabled={targetProfileReadOnly}
                onClick={handleExecuteClick}
                className={primaryBtn}
              >
                <Play className="w-3.5 h-3.5" />
                <span>Ejecutar migración ({totalSelectedCount} objetos)</span>
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="max-w-5xl mx-auto space-y-4">
            {/* Progress summary */}
            <div className={`${cardClass} p-4 space-y-3`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  {isRunning ? (
                    <Spinner className="w-3.5 h-3.5" />
                  ) : executionError || (result && result.failed > 0) ? (
                    <AlertTriangle className="w-4 h-4 text-warning" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-success" />
                  )}
                  <span className="font-medium text-fg">
                    {isRunning
                      ? progress?.message || "Iniciando migración..."
                      : executionError
                        ? "La migración falló"
                        : `Migración completada en ${result?.elapsed_ms ?? 0} ms`}
                  </span>
                </div>
                <span className="text-xs font-mono text-fg-muted tabular-nums">
                  {progressPct}% · {(result?.total_rows_transferred ?? progress?.totalRowsTransferred ?? 0).toLocaleString()} filas
                </span>
              </div>

              <div className="w-full h-2 rounded-full bg-raised overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-200"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {result && (
                <div className="flex flex-wrap items-center gap-4 text-xs pt-1 tabular-nums">
                  <span className="text-success">Exitosos: {result.succeeded}</span>
                  <span className="text-warning">Advertencias/Omitidos: {result.warnings}</span>
                  <span className="text-danger">Errores: {result.failed}</span>
                  <span className="text-fg-muted">Total filas: {result.total_rows_transferred.toLocaleString()}</span>
                </div>
              )}
            </div>

            {executionError && (
              <div className="p-3 rounded-lg border border-line bg-surface text-xs text-danger">
                {executionError}
              </div>
            )}

            {/* Detailed item results or live log */}
            <div className={`${cardClass} overflow-hidden`}>
              <div className="px-4 py-2.5 border-b border-line bg-raised flex items-center justify-between">
                <span className={sectionLabel}>
                  {result ? "Detalle por objeto" : "Registro en tiempo real"}
                </span>
              </div>

              <div className="max-h-80 overflow-auto divide-y divide-line text-xs">
                {result
                  ? result.items.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 px-4 py-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {item.status === "success" ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                          ) : item.status === "error" ? (
                            <XCircle className="w-3.5 h-3.5 text-danger shrink-0" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                          )}
                          <span className="font-mono truncate">{item.name}</span>
                          <span className="text-[11px] text-fg-subtle">{item.object_type}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-fg-muted">
                          {item.rows_transferred > 0 && (
                            <span className="tabular-nums">
                              {item.rows_transferred.toLocaleString()} filas
                            </span>
                          )}
                          <span className="max-w-md truncate" title={item.message}>
                            {item.message}
                          </span>
                        </div>
                      </div>
                    ))
                  : liveLog.map((entry, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 px-4 py-1.5">
                        <span className="text-fg truncate">{entry.message}</span>
                        <span className="text-[11px] text-fg-subtle tabular-nums shrink-0">
                          {entry.completedObjects}/{entry.totalObjects}
                        </span>
                      </div>
                    ))}
              </div>
            </div>

            {!isRunning && (
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setStep(3)} className={secondaryBtn}>
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Volver a opciones</span>
                </button>
                <button type="button" onClick={() => setStep(1)} className={primaryBtn}>
                  <span>Nueva migración</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
