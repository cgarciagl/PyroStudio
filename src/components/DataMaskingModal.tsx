import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, ShieldCheck, Sparkles, Trash2, Save } from "lucide-react";
import type {
  ColumnMetadata,
  ExportSummary,
  MaskingPreset,
  MaskingProfile,
  MaskingRule,
  MaskingStrategy,
  SqlDumpSummary,
} from "../types/database";
import { dbService } from "../services/tauriDb";
import { maskingProfiles, newMaskingProfileId, toMaskingRequest } from "../services/maskingProfiles";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useUIStore } from "../stores/uiStore";
import {
  DEFAULT_SHIFT_DAYS,
  KEY_SAFE_STRATEGIES,
  effectiveRules,
  inferMaskingStrategy,
  suggestRulesForTable,
  validateMaskingProfile,
} from "../utils/maskingInference";
import { Modal, Spinner, EmptyState } from "./ui/Modal";
import { ObjectIcon } from "./objectIcons";
import { cardClass, ghostBtn, inputClass, primaryBtn, secondaryBtn, sectionLabel, selectClass } from "./ui/styles";

interface DataMaskingModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
}

type OutputFormat = "sql" | "sheet";
const ruleKey = (table: string, column: string) => `${table}\u0000${column.toLowerCase()}`;
const COLUMN_LOAD_CONCURRENCY = 6;

/**
 * Masked export (Roadmap V3 · Fase 3): pick tables, review the suggested masking rule of
 * each sensitive column, optionally save the rules as a reusable profile, and export a
 * SQL dump (or one table to CSV/Excel) with personal data replaced. Masking runs in Rust
 * while the export streams to disk.
 */
export const DataMaskingModal: React.FC<DataMaskingModalProps> = ({ isOpen, onClose, database }) => {
  const workspaceVersion = useWorkspaceStore((s) => s.version);
  const [presets, setPresets] = useState<MaskingPreset[]>([]);
  const [columns, setColumns] = useState<Record<string, ColumnMetadata[]>>({});
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [rules, setRules] = useState<Map<string, MaskingRule>>(new Map());
  const [onlyRuled, setOnlyRuled] = useState(false);

  const [profiles, setProfiles] = useState<MaskingProfile[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [profileName, setProfileName] = useState("");
  const [stableSeed, setStableSeed] = useState(false);

  const [format, setFormat] = useState<OutputFormat>("sql");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ path: string; rows: number; masked?: number; notes: string[] } | null>(null);

  const presetByStrategy = useMemo(() => new Map(presets.map((p) => [p.strategy, p])), [presets]);

  const applySuggestions = useCallback((cols: Record<string, ColumnMetadata[]>) => {
    const next = new Map<string, MaskingRule>();
    for (const [table, list] of Object.entries(cols)) {
      for (const r of suggestRulesForTable(table, list)) next.set(ruleKey(r.table, r.column), r);
    }
    setRules(next);
  }, []);

  // Load tables, their columns and the strategy catalog when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setResult(null);
    setError(null);
    (async () => {
      try {
        const [catalog, tables] = await Promise.all([dbService.getMaskingPresets(), dbService.listTables(database)]);
        const names = tables.map((t) => t.name);
        const cols: Record<string, ColumnMetadata[]> = {};
        for (let i = 0; i < names.length; i += COLUMN_LOAD_CONCURRENCY) {
          const batch = names.slice(i, i + COLUMN_LOAD_CONCURRENCY);
          const loaded = await Promise.all(batch.map((t) => dbService.getTableColumns(database, t).catch(() => [])));
          batch.forEach((t, j) => (cols[t] = loaded[j]));
          if (cancelled) return;
        }
        if (cancelled) return;
        setPresets(catalog);
        setTableNames(names);
        setColumns(cols);
        setSelected(new Set(names));
        // Start on the first table with a suggestion, so the user sees what was detected.
        const firstSuggested = names.find((t) => suggestRulesForTable(t, cols[t]).length > 0);
        setActiveTable(firstSuggested ?? names[0] ?? null);
        applySuggestions(cols);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, database, applySuggestions]);

  useEffect(() => {
    if (!isOpen) return;
    maskingProfiles.list().then(setProfiles).catch(() => setProfiles([]));
  }, [isOpen, workspaceVersion]);

  const selectedRules = useMemo(
    () => effectiveRules([...rules.values()].filter((r) => selected.has(r.table))),
    [rules, selected],
  );
  const issues = useMemo(
    () => validateMaskingProfile({ name: profileName || "export", rules: selectedRules }, columns),
    [profileName, selectedRules, columns],
  );
  const blocking = issues.filter((i) => i.level === "error");
  const rulesPerTable = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of effectiveRules([...rules.values()])) counts.set(r.table, (counts.get(r.table) ?? 0) + 1);
    return counts;
  }, [rules]);

  const setRule = (table: string, column: string, patch: Partial<MaskingRule> | null) => {
    setRules((prev) => {
      const next = new Map(prev);
      const k = ruleKey(table, column);
      if (patch === null) next.delete(k);
      else next.set(k, { table, column, strategy: "keep", ...prev.get(k), ...patch });
      return next;
    });
  };

  const loadProfile = (id: string) => {
    setProfileId(id);
    if (!id) {
      setProfileName("");
      setStableSeed(false);
      applySuggestions(columns);
      return;
    }
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setProfileName(p.name);
    setStableSeed(p.stableSeed);
    const next = new Map<string, MaskingRule>();
    for (const r of p.rules) {
      // Match the profile's table/column names to this database case-insensitively.
      const table = tableNames.find((t) => t.toLowerCase() === r.table.toLowerCase());
      const col = table && columns[table]?.find((c) => c.name.toLowerCase() === r.column.toLowerCase());
      if (table && col) next.set(ruleKey(table, col.name), { ...r, table, column: col.name });
    }
    setRules(next);
  };

  const handleSaveProfile = async (asNew: boolean) => {
    const name = profileName.trim();
    if (!name) {
      setError("Escribe un nombre para guardar el perfil.");
      return;
    }
    const rulesToSave = effectiveRules([...rules.values()]);
    const problems = validateMaskingProfile({ name, rules: rulesToSave }).filter((i) => i.level === "error");
    if (problems.length) {
      setError(problems[0].message);
      return;
    }
    try {
      const saved = await maskingProfiles.save({
        id: !asNew && profileId ? profileId : newMaskingProfileId(),
        name,
        stableSeed,
        rules: rulesToSave,
      });
      setProfiles(await maskingProfiles.list());
      setProfileId(saved.id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteProfile = () => {
    const p = profiles.find((x) => x.id === profileId);
    if (!p) return;
    useUIStore.getState().showConfirm({
      title: "Eliminar perfil de enmascaramiento",
      message: `¿Eliminar el perfil «${p.name}»? Las exportaciones ya generadas no cambian.`,
      variant: "danger",
      confirmText: "Eliminar",
      onConfirm: async () => {
        try {
          await maskingProfiles.remove(p.id);
          setProfiles(await maskingProfiles.list());
          loadProfile("");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const selectedTables = tableNames.filter((t) => selected.has(t));
  const canSheet = selectedTables.length === 1;
  const effectiveFormat: OutputFormat = canSheet ? format : "sql";

  const handleExport = async () => {
    setError(null);
    setResult(null);
    if (selectedTables.length === 0) {
      setError("Selecciona al menos una tabla.");
      return;
    }
    if (selectedRules.length === 0) {
      setError("No hay columnas con regla de enmascaramiento en las tablas seleccionadas.");
      return;
    }
    if (blocking.length) {
      setError(blocking[0].message);
      return;
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
    const masking = toMaskingRequest({ id: profileId, name: profileName, stableSeed: stableSeed && !!profileId, rules: selectedRules });
    try {
      if (effectiveFormat === "sheet") {
        const table = selectedTables[0];
        const path = await dbService.saveExcelDialog(`${database}_${table}_anonimizado_${stamp}.xlsx`);
        if (!path) return;
        setExporting(true);
        const summary: ExportSummary = await dbService.exportExcelFile({ database, table, file_path: path, masking });
        setResult({ path: summary.file_path, rows: summary.total_rows, notes: [] });
      } else {
        const path = await dbService.saveSqlDialog(`${database}_anonimizado_${stamp}.sql`);
        if (!path) return;
        setExporting(true);
        const summary: SqlDumpSummary = await dbService.exportMaskedDump({
          database,
          tables: selectedTables,
          export_mode: "structure_and_data",
          include_drop_table: true,
          include_routines: false,
          include_triggers: false,
          include_views: false,
          insert_batch_size: 250,
          output_file_path: path,
          masking,
        });
        setResult({
          path: summary.file_path ?? path,
          rows: summary.total_rows_exported,
          masked: summary.masked_columns,
          notes: [...new Set(summary.masking_notes ?? [])],
        });
      }
    } catch (e) {
      setError(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const activeColumns = activeTable ? columns[activeTable] ?? [] : [];
  const visibleColumns = onlyRuled
    ? activeColumns.filter((c) => {
        const r = rules.get(ruleKey(activeTable!, c.name));
        return r && r.strategy !== "keep";
      })
    : activeColumns;

  const footer = (
    <>
      <span className="mr-auto text-[11px] text-fg-muted">
        {selectedRules.length} columna(s) enmascarada(s) en {selectedTables.length} tabla(s)
      </span>
      <select
        aria-label="Formato de salida"
        value={effectiveFormat}
        onChange={(e) => setFormat(e.target.value as OutputFormat)}
        className={`${selectClass} w-auto`}
      >
        <option value="sql">Volcado SQL (.sql)</option>
        <option value="sheet" disabled={!canSheet}>
          Excel / CSV (una tabla)
        </option>
      </select>
      <button type="button" className={secondaryBtn} onClick={onClose}>
        Cerrar
      </button>
      <button
        type="button"
        className={primaryBtn}
        onClick={() => void handleExport()}
        disabled={exporting || loading || selectedRules.length === 0}
      >
        {exporting ? <Spinner className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
        Exportar anonimizado
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      icon={<ShieldCheck className="w-4 h-4" />}
      title="Exportación anonimizada"
      subtitle={`${database} · sustituye datos personales para desarrollo y pruebas`}
      footer={footer}
      className="h-[85vh]"
      bodyClassName="flex-1 min-h-0 flex flex-col"
    >
      {loading ? (
        <EmptyState icon={<Spinner className="w-5 h-5" />} title="Analizando columnas…" />
      ) : loadError ? (
        <EmptyState icon={<AlertCircle className="w-5 h-5 text-danger" />} title="No se pudo leer la base" description={loadError} />
      ) : tableNames.length === 0 ? (
        <EmptyState title="La base no tiene tablas" />
      ) : (
        <>
          {/* Profile bar */}
          <div data-masking-profile className="flex flex-wrap items-end gap-2 px-5 py-3 border-b border-line">
            <label className="flex flex-col gap-1">
              <span className={sectionLabel}>Perfil</span>
              <select value={profileId} onChange={(e) => loadProfile(e.target.value)} className={`${selectClass} w-56`}>
                <option value="">Sugerencias automáticas</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={sectionLabel}>Nombre del perfil</span>
              <input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="p. ej. Clientes a desarrollo"
                className={`${inputClass} w-56`}
              />
            </label>
            <button type="button" className={ghostBtn} onClick={() => void handleSaveProfile(false)} title="Guardar las reglas en el perfil">
              <Save className="w-3.5 h-3.5" />
              Guardar
            </button>
            {profileId && (
              <>
                <button type="button" className={ghostBtn} onClick={() => void handleSaveProfile(true)}>
                  Guardar como nuevo
                </button>
                <button type="button" className={ghostBtn} onClick={handleDeleteProfile} title="Eliminar perfil">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <label
              className="flex items-center gap-1.5 text-xs text-fg ml-auto"
              title="Misma salida en cada exportación de este perfil. La semilla se guarda cifrada en el Vault de este equipo, nunca en el perfil."
            >
              <input type="checkbox" checked={stableSeed} onChange={(e) => setStableSeed(e.target.checked)} disabled={!profileId} />
              Semilla estable
            </label>
          </div>

          <div className="flex-1 min-h-0 flex">
            {/* Tables */}
            <div data-masking-tables className="w-60 shrink-0 border-r border-line flex flex-col min-h-0">
              <div className="flex items-center justify-between px-3 py-2">
                <span className={sectionLabel}>Tablas ({selectedTables.length}/{tableNames.length})</span>
                <button
                  type="button"
                  className="text-[11px] text-fg-muted hover:text-fg"
                  onClick={() => setSelected(selected.size === tableNames.length ? new Set() : new Set(tableNames))}
                >
                  {selected.size === tableNames.length ? "Ninguna" : "Todas"}
                </button>
              </div>
              <ul className="flex-1 overflow-y-auto pb-2">
                {tableNames.map((t) => {
                  const count = rulesPerTable.get(t) ?? 0;
                  return (
                    <li key={t}>
                      <div
                        className={`flex items-center gap-2 px-3 py-1 text-xs cursor-pointer ${
                          activeTable === t ? "bg-accent-soft text-accent-text" : "text-fg hover:bg-hover"
                        }`}
                        onClick={() => setActiveTable(t)}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Incluir ${t}`}
                          checked={selected.has(t)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(t);
                              else next.delete(t);
                              return next;
                            })
                          }
                        />
                        <ObjectIcon kind="tables" className="w-3.5 h-3.5" />
                        <span className="truncate flex-1">{t}</span>
                        {count > 0 && <span className="text-[11px] text-fg-muted tabular-nums">{count}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Rules of the active table */}
            <div data-masking-rules className="flex-1 min-w-0 flex flex-col min-h-0">
              <div className="flex items-center gap-3 px-4 py-2 border-b border-line">
                <span className="text-xs font-medium text-fg truncate">{activeTable}</span>
                <label className="flex items-center gap-1.5 text-[11px] text-fg-muted ml-auto">
                  <input type="checkbox" checked={onlyRuled} onChange={(e) => setOnlyRuled(e.target.checked)} />
                  Solo columnas con regla
                </label>
                {activeTable && (
                  <button
                    type="button"
                    className={ghostBtn}
                    title="Volver a aplicar las sugerencias automáticas a esta tabla"
                    onClick={() => {
                      setRules((prev) => {
                        const next = new Map([...prev].filter(([, r]) => r.table !== activeTable));
                        for (const r of suggestRulesForTable(activeTable, activeColumns)) next.set(ruleKey(r.table, r.column), r);
                        return next;
                      });
                    }}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Sugerir
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                {visibleColumns.length === 0 ? (
                  <EmptyState
                    title={onlyRuled ? "Ninguna columna con regla" : "Sin columnas"}
                    description={onlyRuled ? "Esta tabla se exporta sin cambios." : undefined}
                  />
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface text-fg-muted text-[11px]">
                      <tr className="border-b border-line">
                        <th className="text-left font-medium px-4 py-1.5">Columna</th>
                        <th className="text-left font-medium px-2 py-1.5">Tipo</th>
                        <th className="text-left font-medium px-2 py-1.5 w-56">Regla</th>
                        <th className="text-left font-medium px-2 py-1.5">Parámetro / ejemplo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleColumns.map((c) => {
                        const rule = rules.get(ruleKey(activeTable!, c.name));
                        const strategy: MaskingStrategy = rule?.strategy ?? "keep";
                        const suggestion = inferMaskingStrategy(c.name, c.column_type || c.data_type, activeTable!);
                        const isKey = c.column_key === "PRI" || c.column_key === "UNI";
                        const keyRisk = isKey && !KEY_SAFE_STRATEGIES.has(strategy);
                        return (
                          <tr key={c.name} className="border-b border-line/60 hover:bg-hover">
                            <td className="px-4 py-1.5 font-mono text-fg">
                              {c.name}
                              {isKey && <span className="ml-1.5 text-[11px] text-fg-subtle font-sans">{c.column_key === "PRI" ? "PK" : "único"}</span>}
                              {suggestion && <div className="text-[11px] text-fg-subtle font-sans">Detectado: {suggestion.reason}</div>}
                            </td>
                            <td className="px-2 py-1.5 font-mono text-fg-muted">{c.column_type || c.data_type}</td>
                            <td className="px-2 py-1.5">
                              <select
                                aria-label={`Regla para ${c.name}`}
                                value={strategy}
                                onChange={(e) => {
                                  const s = e.target.value as MaskingStrategy;
                                  if (s === "keep") setRule(activeTable!, c.name, null);
                                  else
                                    setRule(activeTable!, c.name, {
                                      strategy: s,
                                      shiftDays: s === "date_shift" ? rule?.shiftDays ?? DEFAULT_SHIFT_DAYS : undefined,
                                      fixedValue: s === "fixed" ? rule?.fixedValue ?? "REDACTADO" : undefined,
                                    });
                                }}
                                className={`${selectClass} w-full`}
                              >
                                {(presets.length ? presets : [{ strategy: "keep", label: "Conservar" } as MaskingPreset]).map((p) => (
                                  <option key={p.strategy} value={p.strategy}>
                                    {p.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              {strategy === "date_shift" ? (
                                <label className="flex items-center gap-1.5 text-fg-muted">
                                  ±
                                  <input
                                    type="number"
                                    min={1}
                                    max={3650}
                                    value={rule?.shiftDays ?? DEFAULT_SHIFT_DAYS}
                                    onChange={(e) => setRule(activeTable!, c.name, { shiftDays: Number(e.target.value) })}
                                    className={`${inputClass} w-20`}
                                  />
                                  días
                                </label>
                              ) : strategy === "fixed" ? (
                                <input
                                  value={rule?.fixedValue ?? ""}
                                  onChange={(e) => setRule(activeTable!, c.name, { fixedValue: e.target.value })}
                                  className={`${inputClass} w-48`}
                                  aria-label={`Valor fijo para ${c.name}`}
                                />
                              ) : (
                                <span className="text-fg-subtle font-mono" title={presetByStrategy.get(strategy)?.description}>
                                  {strategy === "keep" ? "—" : presetByStrategy.get(strategy)?.example}
                                </span>
                              )}
                              {keyRisk && (
                                <div className="flex items-center gap-1 text-[11px] text-fg-muted mt-0.5">
                                  <AlertTriangle className="w-3 h-3 text-warning" />
                                  Columna única: se exportará con hash para no repetir valores.
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {(error || result || issues.length > 0) && (
            <div data-masking-status className="px-5 py-3 border-t border-line space-y-1.5 max-h-40 overflow-y-auto">
              {error && (
                <p className="flex items-start gap-1.5 text-xs text-fg">
                  <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0 mt-px" />
                  {error}
                </p>
              )}
              {!result &&
                issues
                  .filter((i) => i.level === "warning")
                  .slice(0, 3)
                  .map((i) => (
                    <p key={i.message} className="flex items-start gap-1.5 text-[11px] text-fg-muted">
                      <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                      {i.message}
                    </p>
                  ))}
              {result && (
                <div className={`${cardClass} p-3 text-xs space-y-1`}>
                  <p className="flex items-center gap-1.5 text-fg font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                    Exportación anonimizada lista: {result.rows.toLocaleString()} filas
                    {result.masked !== undefined && ` · ${result.masked} columna(s) enmascarada(s)`}
                  </p>
                  <p className="font-mono text-[11px] text-fg-muted break-all">{result.path}</p>
                  {result.notes.map((n) => (
                    <p key={n} className="text-[11px] text-fg-muted">
                      {n}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
};
