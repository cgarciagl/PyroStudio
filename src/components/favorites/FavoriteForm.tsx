import { Save } from "lucide-react";
import { fieldLabel, inputClass, primaryBtn, secondaryBtn } from "../ui/styles";

export interface FavoriteFormValues {
  title: string;
  category: string;
  description: string;
  sql: string;
  linked: boolean;
  database: string;
}

interface FavoriteFormProps {
  mode: "create" | "edit";
  values: FavoriteFormValues;
  /** Offer "save in this database" (only with an active connection). */
  canLink: boolean;
  categories: string[];
  onChange: (values: FavoriteFormValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** Create or edit a saved query. Labels above fields; Cancel / Save at the bottom right. */
export function FavoriteForm({ mode, values, canLink, categories, onChange, onSubmit, onCancel }: FavoriteFormProps) {
  const set = <K extends keyof FavoriteFormValues>(key: K, value: FavoriteFormValues[K]) =>
    onChange({ ...values, [key]: value });
  const canSave = values.title.trim() !== "" && values.sql.trim() !== "";

  return (
    <form
      data-favorite-form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSubmit();
      }}
      className="flex-1 flex flex-col min-h-0"
    >
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2 space-y-3">
        <h3 className="text-sm font-semibold text-fg">{mode === "edit" ? "Editar consulta" : "Nueva consulta"}</h3>

        <div className="grid grid-cols-1 @md:grid-cols-[1fr_12rem] gap-3">
          <div>
            <label htmlFor="fav-title" className={fieldLabel}>
              Título
            </label>
            <input
              id="fav-title"
              autoFocus
              required
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Reporte mensual de ventas"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="fav-category" className={fieldLabel}>
              Categoría
            </label>
            <input
              id="fav-category"
              list="fav-form-categories"
              value={values.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder="General"
              className={inputClass}
            />
            <datalist id="fav-form-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <label htmlFor="fav-desc" className={fieldLabel}>
            Descripción <span className="font-normal text-fg-subtle">(opcional)</span>
          </label>
          <input
            id="fav-desc"
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Qué devuelve y cuándo usarla"
            className={inputClass}
          />
        </div>

        {canLink && (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-xs text-fg">
              <input
                type="checkbox"
                checked={values.linked}
                onChange={(e) => set("linked", e.target.checked)}
                className="accent-[var(--pyro-accent)]"
              />
              Guardar en la base de datos
            </label>
            <input
              aria-label="Base de datos"
              value={values.database}
              disabled={!values.linked}
              onChange={(e) => set("database", e.target.value)}
              className={`${inputClass} font-mono @md:w-60`}
            />
            <p className="text-[11px] text-fg-subtle">
              {values.linked
                ? "Aparecerá en el explorador bajo esa base de datos."
                : "Consulta general: disponible en cualquier base de datos."}
            </p>
          </div>
        )}

        <div className="flex flex-col min-h-[10rem]">
          <label htmlFor="fav-sql" className={fieldLabel}>
            SQL
          </label>
          <textarea
            id="fav-sql"
            required
            rows={8}
            value={values.sql}
            onChange={(e) => set("sql", e.target.value)}
            placeholder="SELECT * FROM …"
            spellCheck={false}
            className={`${inputClass} font-mono leading-relaxed resize-y flex-1`}
          />
        </div>
      </div>

      <div className="px-4 py-3 flex items-center justify-end gap-2 border-t border-line">
        <button type="button" onClick={onCancel} className={secondaryBtn}>
          Cancelar
        </button>
        <button type="submit" disabled={!canSave} className={primaryBtn}>
          <Save className="w-3.5 h-3.5" /> Guardar
        </button>
      </div>
    </form>
  );
}
