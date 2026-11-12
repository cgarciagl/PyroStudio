import {
  AlertCircle,
  Key,
  ArrowRight,
} from "lucide-react";
import type { ImportWizard } from "./useImportWizard";

/** Paso 4: modo de importación, claves, lote y estrategia de errores. */
export function StepMode({ setCurrentStep, mappings, importMode, setImportMode, batchSize, setBatchSize, errorStrategy, setErrorStrategy, dryRun, setDryRun }: Pick<ImportWizard, "setCurrentStep" | "mappings" | "importMode" | "setImportMode" | "batchSize" | "setBatchSize" | "errorStrategy" | "setErrorStrategy" | "dryRun" | "setDryRun">) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="text-xs font-semibold text-fg block">
          Modo de Importación avanzado:
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
                Agregar (Append): añadir registros a la tabla de destino
              </span>
              <span className="text-[11px] text-fg-muted">
                Inserta todas las filas del archivo Excel al final de la tabla de destino (<code className="text-accent-text">INSERT INTO</code>).
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
                Actualizar (Update): actualizar registros en destino que coincidan con el origen
              </span>
              <span className="text-[11px] text-fg-muted">
                Actualiza únicamente los registros que ya existan coincidiendo por la clave primaria (<code className="text-accent-text">UPDATE ... WHERE pk = ?</code>).
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
                Agregar / Actualizar: si existe en destino lo actualiza, de lo contrario lo añade
              </span>
              <span className="text-[11px] text-fg-muted">
                Si el registro existe por clave primaria lo actualiza; si no existe, lo inserta (<code className="text-accent-text">ON DUPLICATE KEY UPDATE</code>).
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
                Agregar sin actualizar: si existe en destino lo omite, de lo contrario lo añade
              </span>
              <span className="text-[11px] text-fg-muted">
                Inserta nuevos registros e ignora silenciosamente los que tengan clave duplicada (<code className="text-accent-text">INSERT IGNORE</code>).
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
                Eliminar (Delete): eliminar registros en destino que coincidan con el origen
              </span>
              <span className="text-[11px] text-fg-muted">
                Elimina de la tabla de destino todos los registros cuyas claves coincidan con el Excel (<code className="text-danger">DELETE WHERE pk IN (...)</code>).
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
                Copiar (Copy): vaciar tabla de destino y repoblar desde el origen
              </span>
              <span className="text-[11px] text-fg-muted">
                Vacía la tabla por completo (<code className="text-danger">TRUNCATE TABLE</code>) y vuelve a poblarla con el contenido del Excel.
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
                Columnas Clave de Coincidencia (Llaves seleccionadas en Paso 3):
              </span>
            </h4>
            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              className="text-[11px] text-accent-text hover:underline flex items-center space-x-1"
            >
              <span>Modificar en Paso 3</span>
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
                Se usarán estas {mappings.filter((m) => !m.ignored && m.is_key).length} columna(s) para identificar de forma unívoca cada registro durante la importación.
              </p>
            </div>
          ) : (
            <div className="p-3 border border-line rounded-lg text-xs text-warning flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-warning" />
              <span>
                No has marcado ninguna columna con el icono 🔑 en el Paso 3. Puedes hacer clic en <strong>Modificar en Paso 3</strong> para activar la(s) llave(s) deseadas.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Batch configuration */}
      <div className="flex items-center space-x-3 text-xs text-fg">
        <span>Tamaño de lote:</span>
        <select
          value={batchSize}
          onChange={(e) => setBatchSize(parseInt(e.target.value, 10))}
          className="px-2.5 py-1 bg-raised border border-line rounded text-fg font-mono text-xs"
        >
          <option value={200}>200 filas</option>
          <option value={500}>500 filas</option>
          <option value={1000}>1,000 filas (Recomendado)</option>
        </select>
        <span className="text-[11px] text-fg-subtle">
          (lote multi-fila, limitado para controlar memoria y packet size)
        </span>
      </div>

      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs text-fg">
          <span className="block font-semibold">Filas inválidas</span>
          <select
            value={errorStrategy}
            onChange={(event) =>
              setErrorStrategy(event.target.value as "strict" | "tolerant")
            }
            className="w-full rounded-md border border-line bg-raised px-2.5 py-2 text-xs text-fg"
          >
            <option value="tolerant">Tolerante — omitirlas y continuar</option>
            <option value="strict">Estricto — abortar y revertir el lote completo</option>
          </select>
          {errorStrategy === "strict" && (
            <span className="block text-[11px] text-warning">
              Requiere TCP o SSH, tabla InnoDB y no admite HTTP Tunnel.
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
            <strong className="block">Simulación: validar sin modificar</strong>
            <span className="mt-1 block text-[11px] text-fg">
              Revisa mapeos, tipos, columnas requeridas y claves duplicadas sin escribir en la base de datos.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
