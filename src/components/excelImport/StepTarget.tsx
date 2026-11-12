import {
  Database,
  Loader2,
  Plus,
  Key,
} from "lucide-react";
import type { ImportWizard } from "./useImportWizard";

/** Paso 2: tabla destino existente o nueva, con su esquema. */
export function StepTarget({ targetType, setTargetType, existingTables, selectedExistingTable, setSelectedExistingTable, targetColumns, isLoadingExistingCols, newTableName, setNewTableName, newTableEngine, setNewTableEngine, newTableCollation, setNewTableCollation, newTableColumns, setNewTableColumns, generatedIdName, handleToggleAutoAddIdPk, database }: Pick<ImportWizard, "targetType" | "setTargetType" | "existingTables" | "selectedExistingTable" | "setSelectedExistingTable" | "targetColumns" | "isLoadingExistingCols" | "newTableName" | "setNewTableName" | "newTableEngine" | "setNewTableEngine" | "newTableCollation" | "setNewTableCollation" | "newTableColumns" | "setNewTableColumns" | "generatedIdName" | "handleToggleAutoAddIdPk"> & {
  database: string;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="text-xs font-semibold text-fg">
          Elige dónde se importarán los datos en la base de datos:
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
                <span>Importar a una tabla existente</span>
              </span>
              <input
                type="radio"
                checked={targetType === "existing"}
                onChange={() => setTargetType("existing")}
                className="accent-accent"
              />
            </div>
            <p className="text-[11px] text-fg-muted leading-relaxed">
              Sincroniza o agrega los registros a una tabla ya creada en {database}.
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
                <span>Crear como una NUEVA tabla</span>
              </span>
              <input
                type="radio"
                checked={targetType === "new"}
                onChange={() => setTargetType("new")}
                className="accent-accent"
              />
            </div>
            <p className="text-[11px] text-fg-muted leading-relaxed">
              Crea una nueva tabla automáticamente infiriendo los tipos de datos a partir del archivo Excel.
            </p>
          </div>
        </div>
      </div>

      {/* Target Type Specific Configuration */}
      {targetType === "existing" ? (
        <div className="p-4 rounded-xl bg-raised border border-line space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="text-xs font-semibold text-fg">
              Selecciona la tabla destino:
            </label>
            <select
              value={selectedExistingTable}
              onChange={(e) => setSelectedExistingTable(e.target.value)}
              className="px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none focus:border-accent min-w-48"
            >
              {existingTables.map((tbl) => (
                <option key={tbl.name} value={tbl.name}>
                  {tbl.name} ({tbl.rows_count ?? 0} filas)
                </option>
              ))}
            </select>
          </div>

          {isLoadingExistingCols ? (
            <div className="py-6 flex items-center justify-center space-x-2 text-xs text-fg-muted">
              <Loader2 className="w-4 h-4 animate-spin text-fg-muted" />
              <span>Inspeccionando columnas de '{selectedExistingTable}'...</span>
            </div>
          ) : (
            <div className="text-xs text-fg-muted font-mono flex items-center space-x-2">
              <span className="text-success font-semibold">
                {targetColumns.length} columnas
              </span>{" "}
              <span>disponibles en la tabla '{selectedExistingTable}'.</span>
            </div>
          )}
        </div>
      ) : (
        /* New Table Designer */
        <div className="p-4 rounded-xl bg-raised border border-line space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-fg-muted block mb-1">
                Nombre de la nueva tabla:
              </label>
              <input
                type="text"
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                placeholder="mi_nueva_tabla"
                className="w-full px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none focus:border-accent font-semibold text-accent-text"
              />
            </div>

            <div>
              <label className="text-[11px] text-fg-muted block mb-1">
                Motor de almacenamiento:
              </label>
              <select
                value={newTableEngine}
                onChange={(e) => setNewTableEngine(e.target.value)}
                className="w-full px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none"
              >
                <option value="InnoDB">InnoDB (Transaccional)</option>
                <option value="Aria">Aria (Crash-safe)</option>
                <option value="MyISAM">MyISAM</option>
                <option value="MEMORY">MEMORY (En memoria RAM)</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] text-fg-muted block mb-1">
                Cotejamiento (Collation):
              </label>
              <select
                value={newTableCollation}
                onChange={(e) => setNewTableCollation(e.target.value)}
                className="w-full px-3 py-1.5 bg-surface border border-line rounded text-fg font-mono text-xs focus:outline-none"
              >
                <option value="utf8mb4_unicode_ci">utf8mb4_unicode_ci (Recomendado)</option>
                <option value="utf8mb4_general_ci">utf8mb4_general_ci</option>
                <option value="utf8_general_ci">utf8_general_ci</option>
                <option value="latin1_swedish_ci">latin1_swedish_ci</option>
              </select>
            </div>
          </div>

          {/* Auto Add ID PK Option */}
          <div className="p-3 bg-surface rounded-lg border border-line flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-2.5">
              <Key className="w-4 h-4 text-warning shrink-0" />
              <div>
                <span className="font-semibold text-fg">Agregar columna ID autoincremental como Primary Key</span>
                <p className="text-[11px] text-fg-muted mt-0.5">
                  Crea automáticamente <code className="font-mono text-accent-text">id BIGINT AUTO_INCREMENT PRIMARY KEY</code> para optimizar la edición y las relaciones.
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
              <span className="text-fg font-medium text-xs">Habilitar</span>
            </label>
          </div>

          {/* Column Schema Definition */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span className="font-semibold text-fg">
                Estructura de columnas inferida desde Excel:
              </span>
            </div>

            <div className="border border-line rounded-lg overflow-x-auto max-h-56 bg-surface">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead>
                  <tr className="bg-raised text-fg border-b border-line text-[11px]">
                    <th className="py-2 px-3">Nombre Columna</th>
                    <th className="py-2 px-3">Tipo de Dato</th>
                    <th className="py-2 px-3 text-center">Clave Primaria (PK)</th>
                    <th className="py-2 px-3 text-center">Permite NULL</th>
                    <th className="py-2 px-3 text-center">Auto Increment</th>
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
                            const updated = [...newTableColumns];
                            updated[idx].data_type = e.target.value;
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
                          <option value="TINYINT(1)">TINYINT(1) (Boolean)</option>
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
