import { useTranslation } from "react-i18next";
import {
  Database,
  Loader2,
  Plus,
  Key,
} from "lucide-react";
import type { ImportWizard } from "./useImportWizard";
import { useCapabilitiesStore } from "../../stores/capabilitiesStore";

/** Paso 2: tabla destino existente o nueva, con su esquema. */
export function StepTarget({ targetType, setTargetType, existingTables, selectedExistingTable, setSelectedExistingTable, targetColumns, isLoadingExistingCols, newTableName, setNewTableName, newTableEngine, setNewTableEngine, newTableCollation, setNewTableCollation, newTableColumns, setNewTableColumns, generatedIdName, handleToggleAutoAddIdPk, database }: Pick<ImportWizard, "targetType" | "setTargetType" | "existingTables" | "selectedExistingTable" | "setSelectedExistingTable" | "targetColumns" | "isLoadingExistingCols" | "newTableName" | "setNewTableName" | "newTableEngine" | "setNewTableEngine" | "newTableCollation" | "setNewTableCollation" | "newTableColumns" | "setNewTableColumns" | "generatedIdName" | "handleToggleAutoAddIdPk"> & {
  database: string;
}) {
  const { t } = useTranslation("transfer");
  const supportsStorageEngines = useCapabilitiesStore((s) => s.supportsFeature("storageEngines"));
  const supportsCollations = useCapabilitiesStore((s) => s.supportsFeature("collations"));
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="text-xs font-semibold text-fg">
          {t("excelImport.stepTarget.chooseWhere")}
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Option: Existing Table */}
          <div
            onClick={() => setTargetType("existing")}
            className={`p-4 rounded-xl border cursor-pointer transition-all ${
              targetType === "existing"
                ? "bg-accent-soft border-accent shadow-sm"
                : "bg-raised border-line hover:border-line-strong"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-xs text-fg flex items-center space-x-2">
                <Database className="w-4 h-4 text-fg-muted" />
                <span>{t("excelImport.stepTarget.existingTitle")}</span>
              </span>
              <input
                type="radio"
                checked={targetType === "existing"}
                onChange={() => setTargetType("existing")}
                className="accent-accent"
              />
            </div>
            <p className="text-[11px] text-fg-muted leading-relaxed">
              {t("excelImport.stepTarget.existingDesc", { database })}
            </p>
          </div>

          {/* Option: New Table */}
          <div
            onClick={() => setTargetType("new")}
            className={`p-4 rounded-xl border cursor-pointer transition-all ${
              targetType === "new"
                ? "bg-accent-soft border-accent shadow-sm"
                : "bg-raised border-line hover:border-line-strong"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-xs text-fg flex items-center space-x-2">
                <Plus className="w-4 h-4 text-fg-muted" />
                <span>{t("excelImport.stepTarget.newTitle")}</span>
              </span>
              <input
                type="radio"
                checked={targetType === "new"}
                onChange={() => setTargetType("new")}
                className="accent-accent"
              />
            </div>
            <p className="text-[11px] text-fg-muted leading-relaxed">
              {t("excelImport.stepTarget.newDesc")}
            </p>
          </div>
        </div>
      </div>

      {/* Target Type Specific Configuration */}
      {targetType === "existing" ? (
        <div className="p-4 rounded-xl bg-raised border border-line space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="text-xs font-semibold text-fg">
              {t("excelImport.stepTarget.selectTargetTable")}
            </label>
            <select
              value={selectedExistingTable}
              onChange={(e) => setSelectedExistingTable(e.target.value)}
              className="px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none focus:border-accent min-w-48"
            >
              {existingTables.map((tbl) => (
                <option key={tbl.name} value={tbl.name}>
                  {tbl.name} {t("excelImport.stepTarget.rowsCount", { count: tbl.rows_count ?? 0 })}
                </option>
              ))}
            </select>
          </div>

          {isLoadingExistingCols ? (
            <div className="py-6 flex items-center justify-center space-x-2 text-xs text-fg-muted">
              <Loader2 className="w-4 h-4 animate-spin text-fg-muted" />
              <span>{t("excelImport.stepTarget.inspectingCols", { table: selectedExistingTable })}</span>
            </div>
          ) : (
            <div className="text-xs text-fg-muted font-mono flex items-center space-x-2">
              <span className="text-success font-semibold">
                {t("excelImport.stepTarget.columnsCount", { count: targetColumns.length })}
              </span>{" "}
              <span>{t("excelImport.stepTarget.columnsAvailable", { table: selectedExistingTable })}</span>
            </div>
          )}
        </div>
      ) : (
        /* New Table Designer */
        <div className="p-4 rounded-xl bg-raised border border-line space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-fg-muted block mb-1">
                {t("excelImport.stepTarget.newTableName")}
              </label>
              <input
                type="text"
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                placeholder={t("excelImport.stepTarget.newTablePlaceholder")}
                className="w-full px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none focus:border-accent font-semibold text-accent-text"
              />
            </div>

            {supportsStorageEngines && (
              <div>
                <label className="text-[11px] text-fg-muted block mb-1">
                  {t("excelImport.stepTarget.storageEngine")}
                </label>
                <select
                  value={newTableEngine}
                  onChange={(e) => setNewTableEngine(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none"
                >
                  <option value="InnoDB">{t("excelImport.stepTarget.engineInnoDB")}</option>
                  <option value="Aria">{t("excelImport.stepTarget.engineAria")}</option>
                  <option value="MyISAM">MyISAM</option>
                  <option value="MEMORY">{t("excelImport.stepTarget.engineMemory")}</option>
                </select>
              </div>
            )}

            {supportsCollations && (
              <div>
                <label className="text-[11px] text-fg-muted block mb-1">
                  {t("excelImport.stepTarget.collation")}
                </label>
                <select
                  value={newTableCollation}
                  onChange={(e) => setNewTableCollation(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none"
                >
                  <option value="utf8mb4_unicode_ci">{t("excelImport.stepTarget.collationRecommended")}</option>
                  <option value="utf8mb4_general_ci">utf8mb4_general_ci</option>
                  <option value="utf8_general_ci">utf8_general_ci</option>
                  <option value="latin1_swedish_ci">latin1_swedish_ci</option>
                </select>
              </div>
            )}
          </div>

          {/* Auto Add ID PK Option */}
          <div className="p-3 bg-surface rounded-lg border border-line flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-2.5">
              <Key className="w-4 h-4 text-warning shrink-0" />
              <div>
                <span className="font-semibold text-fg">{t("excelImport.stepTarget.autoIdTitle")}</span>
                <p className="text-[11px] text-fg-muted mt-0.5">
                  {t("excelImport.stepTarget.autoIdPrefix")}{" "}
                  <code className="font-mono text-accent-text">
                    {supportsStorageEngines
                      ? "id BIGINT AUTO_INCREMENT PRIMARY KEY"
                      : "id INTEGER PRIMARY KEY AUTOINCREMENT"}
                  </code>{" "}
                  {t("excelImport.stepTarget.autoIdSuffix")}
                </p>
              </div>
            </div>
            <label className="flex items-center space-x-2 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={generatedIdName !== null}
                onChange={(e) => handleToggleAutoAddIdPk(e.target.checked)}
                className="rounded border-line-strong text-accent-text focus:ring-0 bg-raised"
              />
              <span className="text-fg font-medium text-xs">{t("excelImport.stepTarget.enable")}</span>
            </label>
          </div>

          {/* Column Schema Definition */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span className="font-semibold text-fg">
                {t("excelImport.stepTarget.inferredSchema")}
              </span>
            </div>

            <div className="border border-line rounded-lg overflow-x-auto max-h-56 bg-surface">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead>
                  <tr className="bg-raised text-fg border-b border-line text-[11px]">
                    <th className="py-2 px-3">{t("excelImport.stepTarget.colName")}</th>
                    <th className="py-2 px-3">{t("excelImport.stepTarget.colType")}</th>
                    <th className="py-2 px-3 text-center">{t("excelImport.stepTarget.colPk")}</th>
                    <th className="py-2 px-3 text-center">{t("excelImport.stepTarget.colNullable")}</th>
                    <th className="py-2 px-3 text-center">{t("excelImport.stepTarget.colAutoInc")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {newTableColumns.map((col, idx) => (
                    <tr key={idx} className="hover:bg-hover">
                      <td className="py-1.5 px-3">
                        <input
                          type="text"
                          value={col.name}
                          onChange={(e) => {
                            const updated = [...newTableColumns];
                            updated[idx].name = e.target.value;
                            setNewTableColumns(updated);
                          }}
                          className="w-full px-2 py-1 bg-raised border border-line rounded text-fg text-xs font-mono"
                        />
                      </td>
                      <td className="py-1.5 px-3">
                        <select
                          value={col.data_type}
                          onChange={(e) => {
                            const nextType = e.target.value;
                            const updated = [...newTableColumns];
                            updated[idx] = {
                              ...updated[idx],
                              data_type: nextType,
                              auto_increment: nextType.includes("INT")
                                ? updated[idx].auto_increment
                                : false,
                            };
                            setNewTableColumns(updated);
                          }}
                          className="w-full px-2 py-1 bg-raised border border-line rounded text-accent-text text-xs font-mono"
                        >
                          <option value="INT">INT</option>
                          <option value="BIGINT">BIGINT</option>
                          <option value="VARCHAR(255)">VARCHAR(255)</option>
                          <option value="VARCHAR(100)">VARCHAR(100)</option>
                          <option value="TEXT">TEXT</option>
                          <option value="DOUBLE">DOUBLE</option>
                          <option value="DECIMAL(12,2)">DECIMAL(12,2)</option>
                          <option value="DATETIME">DATETIME</option>
                          <option value="DATE">DATE</option>
                          <option value="TINYINT(1)">{t("excelImport.stepTarget.boolHint")}</option>
                        </select>
                      </td>
                      <td className="py-1.5 px-3 text-center">
                        <input
                          type="radio"
                          name="pk_selection"
                          checked={col.is_primary_key}
                          onChange={() => {
                            const updated = newTableColumns.map((c, i) => ({
                              ...c,
                              is_primary_key: i === idx,
                              is_nullable: i === idx ? false : c.is_nullable,
                              auto_increment:
                                i === idx ? c.auto_increment && c.data_type.includes("INT") : false,
                            }));
                            setNewTableColumns(updated);
                          }}
                          className="accent-amber-400 cursor-pointer"
                        />
                      </td>
                      <td className="py-1.5 px-3 text-center">
                        <input
                          type="checkbox"
                          disabled={col.is_primary_key}
                          checked={col.is_nullable}
                          onChange={(e) => {
                            const updated = [...newTableColumns];
                            updated[idx].is_nullable = e.target.checked;
                            setNewTableColumns(updated);
                          }}
                          className="accent-accent cursor-pointer disabled:opacity-30"
                        />
                      </td>
                      <td className="py-1.5 px-3 text-center">
                        <input
                          type="checkbox"
                          disabled={!col.is_primary_key || (!col.data_type.includes("INT"))}
                          checked={col.auto_increment}
                          onChange={(e) => {
                            const updated = [...newTableColumns];
                            updated[idx].auto_increment = e.target.checked;
                            setNewTableColumns(updated);
                          }}
                          className="accent-accent cursor-pointer disabled:opacity-30"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
