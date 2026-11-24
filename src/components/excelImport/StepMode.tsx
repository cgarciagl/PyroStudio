import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Key,
  ArrowRight,
} from "lucide-react";
import type { ImportWizard } from "./useImportWizard";

/** Paso 4: modo de importación, claves, lote y estrategia de errores. */
export function StepMode({ setCurrentStep, mappings, importMode, setImportMode, batchSize, setBatchSize, errorStrategy, setErrorStrategy, dryRun, setDryRun }: Pick<ImportWizard, "setCurrentStep" | "mappings" | "importMode" | "setImportMode" | "batchSize" | "setBatchSize" | "errorStrategy" | "setErrorStrategy" | "dryRun" | "setDryRun">) {
  const { t } = useTranslation("transfer");
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="text-xs font-semibold text-fg block">
          {t("excelImport.stepMode.title")}
        </label>

        <div className="space-y-2 bg-surface border border-line rounded-xl p-4">
          {/* 1. Append */}
          <label
            onClick={() => setImportMode("append")}
            className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
              importMode === "append"
                ? "bg-accent-soft text-fg"
                : "hover:bg-hover text-fg"
            }`}
          >
            <input
              type="radio"
              name="excel_import_mode"
              checked={importMode === "append"}
              onChange={() => setImportMode("append")}
              className="accent-accent mt-0.5"
            />
            <div className="text-xs">
              <span className="font-semibold text-fg block">
                {t("excelImport.stepMode.appendTitle")}
              </span>
              <span className="text-[11px] text-fg-muted">
                {t("excelImport.stepMode.appendDesc")}<code className="text-accent-text">INSERT INTO</code>).
              </span>
            </div>
          </label>

          {/* 2. Update */}
          <label
            onClick={() => setImportMode("update")}
            className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
              importMode === "update"
                ? "bg-accent-soft text-fg"
                : "hover:bg-hover text-fg"
            }`}
          >
            <input
              type="radio"
              name="excel_import_mode"
              checked={importMode === "update"}
              onChange={() => setImportMode("update")}
              className="accent-accent mt-0.5"
            />
            <div className="text-xs">
              <span className="font-semibold text-fg block">
                {t("excelImport.stepMode.updateTitle")}
              </span>
              <span className="text-[11px] text-fg-muted">
                {t("excelImport.stepMode.updateDesc")}<code className="text-accent-text">UPDATE ... WHERE pk = ?</code>).
              </span>
            </div>
          </label>

          {/* 3. Append / Update */}
          <label
            onClick={() => setImportMode("append_update")}
            className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
              importMode === "append_update"
                ? "bg-accent-soft text-fg"
                : "hover:bg-hover text-fg"
            }`}
          >
            <input
              type="radio"
              name="excel_import_mode"
              checked={importMode === "append_update"}
              onChange={() => setImportMode("append_update")}
              className="accent-accent mt-0.5"
            />
            <div className="text-xs">
              <span className="font-semibold text-fg block">
                {t("excelImport.stepMode.appendUpdateTitle")}
              </span>
              <span className="text-[11px] text-fg-muted">
                {t("excelImport.stepMode.appendUpdateDesc")}<code className="text-accent-text">ON DUPLICATE KEY UPDATE</code>).
              </span>
            </div>
          </label>

          {/* 4. Append without update */}
          <label
            onClick={() => setImportMode("append_without_update")}
            className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
              importMode === "append_without_update"
                ? "bg-accent-soft text-fg"
                : "hover:bg-hover text-fg"
            }`}
          >
            <input
              type="radio"
              name="excel_import_mode"
              checked={importMode === "append_without_update"}
              onChange={() => setImportMode("append_without_update")}
              className="accent-accent mt-0.5"
            />
            <div className="text-xs">
              <span className="font-semibold text-fg block">
                {t("excelImport.stepMode.appendNoUpdateTitle")}
              </span>
              <span className="text-[11px] text-fg-muted">
                {t("excelImport.stepMode.appendNoUpdateDesc")}<code className="text-accent-text">INSERT IGNORE</code>).
              </span>
            </div>
          </label>

          {/* 5. Delete */}
          <label
            onClick={() => setImportMode("delete")}
            className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
              importMode === "delete"
                ? "bg-accent-soft text-fg"
                : "hover:bg-hover text-fg"
            }`}
          >
            <input
              type="radio"
              name="excel_import_mode"
              checked={importMode === "delete"}
              onChange={() => setImportMode("delete")}
              className="accent-accent mt-0.5"
            />
            <div className="text-xs">
              <span className="font-semibold text-fg block">
                {t("excelImport.stepMode.deleteTitle")}
              </span>
              <span className="text-[11px] text-fg-muted">
                {t("excelImport.stepMode.deleteDesc")}<code className="text-danger">DELETE WHERE pk IN (...)</code>).
              </span>
            </div>
          </label>

          {/* 6. Copy */}
          <label
            onClick={() => setImportMode("copy")}
            className={`flex items-start space-x-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
              importMode === "copy"
                ? "text-fg"
                : "hover:bg-hover text-fg"
            }`}
          >
            <input
              type="radio"
              name="excel_import_mode"
              checked={importMode === "copy"}
              onChange={() => setImportMode("copy")}
              className="accent-red-500 mt-0.5"
            />
            <div className="text-xs">
              <span className="font-semibold text-fg block">
                {t("excelImport.stepMode.copyTitle")}
              </span>
              <span className="text-[11px] text-fg-muted">
                {t("excelImport.stepMode.copyDesc")}<code className="text-danger">TRUNCATE TABLE</code>{t("excelImport.stepMode.copyDesc2")}
              </span>
            </div>
          </label>
        </div>
      </div>

      {/* Matching Key(s) configuration from Step 3 */}
      {(importMode === "update" ||
        importMode === "append_update" ||
        importMode === "delete") && (
        <div className="p-4 rounded-xl bg-raised border border-line space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-accent-text flex items-center space-x-1.5">
              <Key className="w-4 h-4 text-warning" />
              <span>
                {t("excelImport.stepMode.matchingKeysTitle")}
              </span>
            </h4>
            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              className="text-[11px] text-accent-text hover:underline flex items-center space-x-1"
            >
              <span>{t("excelImport.stepMode.modifyStep3")}</span>
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
                      className="inline-flex items-center space-x-1 px-2.5 py-1 rounded border border-line text-warning font-mono text-xs"
                    >
                      <Key className="w-3 h-3 text-warning" />
                      <span>
                        {k.excel_column} ➔ {k.db_column || k.excel_column}
                      </span>
                    </span>
                  ))}
              </div>
              <p className="text-[11px] text-fg-muted">
                {t("excelImport.stepMode.matchingKeysDesc", { count: mappings.filter((m) => !m.ignored && m.is_key).length })}
              </p>
            </div>
          ) : (
            <div className="p-3 border border-line rounded-lg text-xs text-warning flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-warning" />
              <span>
                {t("excelImport.stepMode.noKeysWarning")}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Batch configuration */}
      <div className="flex items-center space-x-3 text-xs text-fg">
        <span>{t("excelImport.stepMode.batchSize")}</span>
        <select
          value={batchSize}
          onChange={(e) => setBatchSize(parseInt(e.target.value, 10))}
          className="px-2.5 py-1 bg-raised border border-line rounded text-fg font-mono text-xs"
        >
          <option value={200}>{t("excelImport.stepMode.batch200")}</option>
          <option value={500}>{t("excelImport.stepMode.batch500")}</option>
          <option value={1000}>{t("excelImport.stepMode.batch1000")}</option>
        </select>
        <span className="text-[11px] text-fg-subtle">
          {t("excelImport.stepMode.batchNote")}
        </span>
      </div>

      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs text-fg">
          <span className="block font-semibold">{t("excelImport.stepMode.invalidRows")}</span>
          <select
            value={errorStrategy}
            onChange={(event) =>
              setErrorStrategy(event.target.value as "strict" | "tolerant")
            }
            className="w-full rounded-md border border-line bg-raised px-2.5 py-2 text-xs text-fg"
          >
            <option value="tolerant">{t("excelImport.stepMode.tolerant")}</option>
            <option value="strict">{t("excelImport.stepMode.strict")}</option>
          </select>
          {errorStrategy === "strict" && (
            <span className="block text-[11px] text-warning">
              {t("excelImport.stepMode.strictNote")}
            </span>
          )}
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-raised p-3 text-xs text-fg">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(event) => setDryRun(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line bg-surface text-fg-muted"
          />
          <span>
            <strong className="block">{t("excelImport.stepMode.dryRunTitle")}</strong>
            <span className="mt-1 block text-[11px] text-fg">
              {t("excelImport.stepMode.dryRunDesc")}
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
