import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { dbService } from "../../services/tauriDb";
import { useUIStore } from "../../stores/uiStore";
import type { TableOptions, TableOptionsInfo } from "../../types/database";
import { errorText } from "../../utils/errors";
import { fieldLabel, inputClass, mutedText, primaryBtn, secondaryBtn, sectionLabel, selectClass } from "../ui/styles";
import { InspectorLoading } from "./InspectorLoading";

interface OptionsPanelProps {
  database: string;
  table: string;
  /** Called after the options were applied (engine/charset changes alter metadata). */
  onApplied: (message: string) => void;
  onError: (message: string) => void;
}

const sameOptions = (a: TableOptions, b: TableOptions) => JSON.stringify(a) === JSON.stringify(b);

/** Number input value → option (`""` = server default). */
const toNumber = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/** Table-level options (engine, charset, collation, AUTO_INCREMENT, row format, statistics…). */
export function OptionsPanel({ database, table, onApplied, onError }: OptionsPanelProps) {
  const { t } = useTranslation("tableViewer");
  const showConfirm = useUIStore((s) => s.showConfirm);
  const [info, setInfo] = useState<TableOptionsInfo | null>(null);
  const [draft, setDraft] = useState<TableOptions | null>(null);
  const [convertCharset, setConvertCharset] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewSql, setPreviewSql] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await dbService.getTableOptions(database, table);
      setInfo(result);
      setDraft(result.options);
      setConvertCharset(false);
    } catch (err) {
      setLoadError(errorText(err));
    } finally {
      setIsLoading(false);
    }
  }, [database, table]);

  useEffect(() => {
    void load();
  }, [load]);

  const isDirty = !!info && !!draft && (!sameOptions(info.options, draft) || convertCharset);

  // Live SQL preview of the ALTER TABLE (debounced).
  useEffect(() => {
    if (!info || !draft || !isDirty) {
      setPreviewSql(null);
      setPreviewError(null);
      return;
    }
    const timer = setTimeout(() => {
      dbService
        .previewTableOptions(database, table, { current: info.options, desired: draft, convert_charset: convertCharset })
        .then((sql) => {
          setPreviewSql(sql);
          setPreviewError(null);
        })
        .catch((err) => {
          setPreviewSql(null);
          setPreviewError(errorText(err));
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [database, table, info, draft, convertCharset, isDirty]);

  const collations = useMemo(
    () => (info && draft ? info.collations.filter((c) => c.charset === draft.charset) : []),
    [info, draft],
  );

  if (isLoading) return <InspectorLoading label={t("options.loading")} />;
  if (loadError || !info || !draft) {
    return (
      <div className="p-8 text-center text-xs text-fg-muted space-y-3">
        <p>{t("options.loadError")}</p>
        {loadError && <p className="font-mono text-danger">{loadError}</p>}
        <button type="button" className={secondaryBtn} onClick={() => void load()}>
          {t("options.retry")}
        </button>
      </div>
    );
  }

  const set = <K extends keyof TableOptions>(key: K, value: TableOptions[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const setCharset = (charset: string) => {
    const fallback = info.charsets.find((c) => c.name === charset)?.default_collation ?? "";
    setDraft((d) => (d ? { ...d, charset, collation: fallback } : d));
  };

  const charsetChanged = draft.charset !== info.options.charset || draft.collation !== info.options.collation;
  const engineChanged = draft.engine.toLowerCase() !== info.options.engine.toLowerCase();

  const apply = () => {
    if (!previewSql) return;
    const heavy = engineChanged || convertCharset || draft.row_format !== info.options.row_format;
    showConfirm({
      title: t("options.confirmTitle"),
      message: heavy ? t("options.confirmHeavy", { table }) : t("options.confirmMessage", { table }),
      details: previewSql,
      variant: heavy ? "warning" : "primary",
      icon: heavy ? "alert" : "info",
      confirmText: t("options.apply"),
      onConfirm: async () => {
        setIsApplying(true);
        try {
          await dbService.applyTableOptions(database, table, {
            current: info.options,
            desired: draft,
            convert_charset: convertCharset,
          });
          onApplied(t("options.applied", { table }));
          await load();
        } catch (err) {
          onError(errorText(err, t("options.applyError")));
        } finally {
          setIsApplying(false);
        }
      },
    });
  };

  const numberField = (key: "auto_increment" | "avg_row_length" | "max_rows" | "key_block_size" | "stats_sample_pages") => (
    <input
      type="number"
      min={0}
      className={`${inputClass} font-mono max-w-[12rem]`}
      value={draft[key] ?? ""}
      placeholder={t("options.defaultPlaceholder")}
      onChange={(e) => set(key, toNumber(e.target.value))}
    />
  );

  const flagSelect = (key: "stats_auto_recalc" | "stats_persistent") => (
    <select className={`${selectClass} max-w-[12rem]`} value={draft[key]} onChange={(e) => set(key, e.target.value)}>
      <option value="">{t("options.default")}</option>
      <option value="1">{t("options.on")}</option>
      <option value="0">{t("options.off")}</option>
    </select>
  );

  const row = (label: string, control: React.ReactNode, hint?: string) => (
    <div className="grid grid-cols-[10rem_1fr] items-center gap-3">
      <label className={`${fieldLabel} mb-0`}>{label}</label>
      <div className="min-w-0">
        {control}
        {hint && <p className={`${mutedText} mt-1`}>{hint}</p>}
      </div>
    </div>
  );

  return (
    <div data-table-options className="max-w-3xl space-y-6">
      <section className="space-y-3">
        <h3 className={sectionLabel}>{t("options.sectionGeneral")}</h3>
        {row(
          t("options.engine"),
          <select className={`${selectClass} max-w-xs`} value={draft.engine} onChange={(e) => set("engine", e.target.value)}>
            {!info.engines.some((e) => e.toLowerCase() === draft.engine.toLowerCase()) && (
              <option value={draft.engine}>{draft.engine}</option>
            )}
            {info.engines.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>,
          engineChanged ? t("options.engineHint") : undefined,
        )}
        {row(
          t("options.charset"),
          <select className={`${selectClass} max-w-xs`} value={draft.charset} onChange={(e) => setCharset(e.target.value)}>
            {info.charsets.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>,
        )}
        {row(
          t("options.collation"),
          <select className={`${selectClass} max-w-xs`} value={draft.collation} onChange={(e) => set("collation", e.target.value)}>
            {!collations.some((c) => c.name === draft.collation) && <option value={draft.collation}>{draft.collation}</option>}
            {collations.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>,
        )}
        {charsetChanged && (
          <div className="grid grid-cols-[10rem_1fr] gap-3">
            <span />
            <label className="flex items-start gap-2 text-xs text-fg cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={convertCharset}
                onChange={(e) => setConvertCharset(e.target.checked)}
              />
              <span>
                {t("options.convertCharset")}
                <span className={`block ${mutedText}`}>{t("options.convertCharsetHint")}</span>
              </span>
            </label>
          </div>
        )}
        {row(t("options.autoIncrement"), numberField("auto_increment"))}
        {row(
          t("options.comment"),
          <input
            className={inputClass}
            value={draft.comment}
            maxLength={2048}
            onChange={(e) => set("comment", e.target.value)}
          />,
        )}
      </section>

      <section className="space-y-3">
        <h3 className={sectionLabel}>{t("options.sectionStorage")}</h3>
        {row(
          t("options.rowFormat"),
          <select className={`${selectClass} max-w-[12rem]`} value={draft.row_format} onChange={(e) => set("row_format", e.target.value)}>
            <option value="">{t("options.default")}</option>
            {!info.row_formats.includes(draft.row_format) && draft.row_format && (
              <option value={draft.row_format}>{draft.row_format}</option>
            )}
            {info.row_formats.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>,
        )}
        {row(t("options.avgRowLength"), numberField("avg_row_length"))}
        {row(t("options.maxRows"), numberField("max_rows"))}
        {row(t("options.keyBlockSize"), numberField("key_block_size"))}
        {row(
          t("options.checksum"),
          <input type="checkbox" checked={draft.checksum} onChange={(e) => set("checksum", e.target.checked)} />,
        )}
        {row(
          t("options.encryption"),
          <input type="checkbox" checked={draft.encrypted} onChange={(e) => set("encrypted", e.target.checked)} />,
          draft.encrypted !== info.options.encrypted ? t("options.encryptionHint") : undefined,
        )}
      </section>

      <section className="space-y-3">
        <h3 className={sectionLabel}>{t("options.sectionStats")}</h3>
        {row(t("options.statsAutoRecalc"), flagSelect("stats_auto_recalc"))}
        {row(t("options.statsPersistent"), flagSelect("stats_persistent"))}
        {row(t("options.statsSamplePages"), numberField("stats_sample_pages"))}
      </section>

      {info.partitioned && <p className={mutedText}>{t("options.partitionedNote")}</p>}

      {isDirty && (
        <section className="space-y-2">
          <h3 className={sectionLabel}>{t("options.sqlPreview")}</h3>
          {previewError ? (
            <p className="text-xs font-mono text-danger">{previewError}</p>
          ) : (
            <pre className="p-3 bg-canvas border border-line rounded-lg font-mono text-xs text-fg overflow-x-auto whitespace-pre-wrap">
              {previewSql ?? "…"}
            </pre>
          )}
        </section>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-line">
        <button
          type="button"
          className={secondaryBtn}
          disabled={!isDirty || isApplying}
          onClick={() => {
            setDraft(info.options);
            setConvertCharset(false);
          }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t("options.discard")}
        </button>
        <button type="button" className={primaryBtn} disabled={!previewSql || isApplying} onClick={apply}>
          {t("options.apply")}
        </button>
      </div>
    </div>
  );
}
