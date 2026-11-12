import {
  Key,
} from "lucide-react";
import type { ImportWizard } from "./useImportWizard";

/** Paso 3: correspondencia entre columnas del archivo y de la tabla. */
export function StepMapping({ targetType, selectedExistingTable, targetColumns, newTableName, newTableColumns, mappings, setMappings }: Pick<ImportWizard, "targetType" | "selectedExistingTable" | "targetColumns" | "newTableName" | "newTableColumns" | "mappings" | "setMappings">) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <p>
          Asigna las columnas del archivo Excel a las columnas de MariaDB (
          <strong className="text-fg font-mono">
            {targetType === "new" ? newTableName : selectedExistingTable}
          </strong>).
        </p>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => {
              setMappings((prev) =>
                prev.map((m) => ({ ...m, ignored: false })),
              );
            }}
            className="text-accent-text hover:underline"
          >
            Activar todas
          </button>
          <span>|</span>
          <button
            type="button"
            onClick={() => {
              setMappings((prev) =>
                prev.map((m) => ({ ...m, ignored: true })),
              );
            }}
            className="text-fg-subtle hover:text-fg"
          >
            Ignorar todas
          </button>
        </div>
      </div>

      <div className="border border-line rounded-lg overflow-hidden bg-surface">
        <table className="w-full text-left text-xs border-collapse font-mono">
          <thead>
            <tr className="bg-raised text-fg border-b border-line">
              <th className="py-2.5 px-4 w-12 text-center">Importar</th>
              <th className="py-2.5 px-4">Campo de Origen (Excel)</th>
              <th className="py-2.5 px-4 w-8 text-center text-fg-subtle">
                ➔
              </th>
              <th className="py-2.5 px-4">Campo de Destino (MariaDB)</th>
              <th className="py-2.5 px-4 w-28 text-center">Clave Primaria (🔑)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {mappings.map((mapping, idx) => {
              const availableTargetCols =
                targetType === "new"
                  ? newTableColumns.map((c) => ({
                      name: c.name,
                      type: c.data_type,
                      is_pk: c.is_primary_key,
                    }))
                  : targetColumns.map((c) => ({
                      name: c.name,
                      type: c.column_type,
                      is_pk: c.column_key === "PRI",
                    }));

              return (
                <tr
                  key={idx}
                  className={
                    mapping.ignored
                      ? "opacity-50 bg-canvas"
                      : "hover:bg-hover"
                  }
                >
                  <td className="py-2.5 px-4 text-center">
                    <input
                      type="checkbox"
                      checked={!mapping.ignored}
                      onChange={(e) => {
                        const newMappings = [...mappings];
                        newMappings[idx].ignored = !e.target.checked;
                        setMappings(newMappings);
                      }}
                      className="accent-accent cursor-pointer"
                    />
                  </td>

                  <td className="py-2.5 px-4 font-semibold text-fg">
                    {mapping.excel_column}
                  </td>

                  <td className="py-2.5 px-4 text-center text-accent-text">
                    {mapping.ignored ? "—" : "➔"}
                  </td>

                  <td className="py-2.5 px-4">
                    <select
                      disabled={mapping.ignored}
                      value={mapping.db_column}
                      onChange={(e) => {
                        const newMappings = [...mappings];
                        newMappings[idx].db_column = e.target.value;
                        const matchedCol = availableTargetCols.find(
                          (c) => c.name === e.target.value,
                        );
                        if (matchedCol?.is_pk) {
                          newMappings[idx].is_key = true;
                        }
                        setMappings(newMappings);
                      }}
                      className="w-full px-2.5 py-1.5 bg-raised border border-line rounded text-fg text-xs focus:outline-none focus:border-accent disabled:opacity-40 font-mono"
                    >
                      <option value="">-- Seleccionar columna --</option>
                      {availableTargetCols.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.is_pk ? "🔑 " : ""}
                          {c.name} ({c.type})
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="py-2.5 px-4 text-center">
                    <button
                      type="button"
                      disabled={mapping.ignored}
                      onClick={() => {
                        const newMappings = [...mappings];
                        newMappings[idx].is_key = !newMappings[idx].is_key;
                        setMappings(newMappings);
                      }}
                      title="Haz clic para designar esta columna como clave de coincidencia (Llave Primaria o Clave Compuesta)"
                      className={`inline-flex items-center justify-center px-3 py-1 rounded-md transition-all ${
                        mapping.is_key
                          ? "border border-line text-warning shadow-sm font-semibold"
                          : "bg-raised border border-line text-fg-subtle hover:text-warning hover:border-line-strong"
                      } disabled:opacity-20`}
                    >
                      <Key className={`w-3.5 h-3.5 mr-1 ${mapping.is_key ? "text-warning fill-amber-400/20" : ""}`} />
                      <span className="text-[11px]">{mapping.is_key ? "Clave" : "—"}</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
