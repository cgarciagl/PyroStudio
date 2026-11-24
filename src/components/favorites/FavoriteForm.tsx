import { useTranslation } from "react-i18next";
import { ArrowLeft, Save } from "lucide-react";
import { fieldLabel, ghostBtn, inputClass, primaryBtn, secondaryBtn, selectClass } from "../ui/styles";

export interface FavoriteFormValues {
  title: string;
  category: string;
  description: string;
  sql: string;
  linked: boolean;
  database: string;
  folder: string;
}

interface FavoriteFormProps {
  mode: "create" | "edit";
  values: FavoriteFormValues;
  /** Offer "save in this database" (only with an active connection). */
  canLink: boolean;
  categories: string[];
  databases?: string[];
  folders?: string[];
  onChange: (values: FavoriteFormValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** Create or edit a saved query. Labels above fields; Cancel / Save at the bottom right. */
export function FavoriteForm({
  mode,
  values,
  canLink,
  categories,
  databases = [],
  folders = [],
  onChange,
  onSubmit,
  onCancel,
}: FavoriteFormProps) {
  const { t } = useTranslation("favorites");
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
      <div className="px-4 py-2.5 border-b border-line flex items-center justify-between gap-2 shrink-0">
        <h3 className="text-sm font-semibold text-fg">
          {mode === "edit" ? t("form.editTitle") : t("form.newTitle")}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className={`${ghostBtn} @2xl:hidden`}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t("form.backToList")}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 flex flex-col">
        <div className="grid grid-cols-1 @md:grid-cols-[1fr_11rem] gap-3">
          <div>
            <label htmlFor="fav-title" className={fieldLabel}>
              {t("form.titleLabel")}
            </label>
            <input
              id="fav-title"
              autoFocus
              required
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={t("form.titlePlaceholder")}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="fav-category" className={fieldLabel}>
              {t("form.categoryLabel")}
            </label>
            <input
              id="fav-category"
              list="fav-form-categories"
              value={values.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder={t("form.categoryPlaceholder")}
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
            {t("form.descriptionLabel")} <span className="font-normal text-fg-subtle">{t("form.optional")}</span>
          </label>
          <input
            id="fav-desc"
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder={t("form.descriptionPlaceholder")}
            className={inputClass}
          />
        </div>

        {canLink && (
          <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
            <label className="flex items-center gap-2 text-xs text-fg cursor-pointer">
              <input
                type="checkbox"
                checked={values.linked}
                onChange={(e) => set("linked", e.target.checked)}
                className="accent-[var(--pyro-accent)]"
              />
              <span>{t("form.linkToDb")}</span>
            </label>
            {values.linked && (
              <div className="grid grid-cols-1 @md:grid-cols-2 gap-2.5 pt-0.5">
                <div>
                  <label htmlFor="fav-db" className={fieldLabel}>
                    {t("form.databaseLabel")}
                  </label>
                  {databases.length > 0 ? (
                    <select
                      id="fav-db"
                      value={values.database}
                      onChange={(e) => set("database", e.target.value)}
                      className={`${selectClass} font-mono`}
                    >
                      {!databases.includes(values.database) && values.database && (
                        <option value={values.database}>{values.database}</option>
                      )}
                      {databases.map((db) => (
                        <option key={db} value={db}>
                          {db}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="fav-db"
                      value={values.database}
                      onChange={(e) => set("database", e.target.value)}
                      className={`${inputClass} font-mono`}
                    />
                  )}
                </div>
                <div>
                  <label htmlFor="fav-folder" className={fieldLabel}>
                    {t("form.folderLabel")} <span className="font-normal text-fg-subtle">{t("form.optional")}</span>
                  </label>
                  <input
                    id="fav-folder"
                    list="fav-form-folders"
                    value={values.folder}
                    onChange={(e) => set("folder", e.target.value)}
                    placeholder={t("form.folderPlaceholder")}
                    className={inputClass}
                  />
                  <datalist id="fav-form-folders">
                    {folders.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col flex-1 min-h-[10rem]">
          <label htmlFor="fav-sql" className={fieldLabel}>
            {t("form.sqlLabel")}
          </label>
          <textarea
            id="fav-sql"
            required
            rows={7}
            value={values.sql}
            onChange={(e) => set("sql", e.target.value)}
            placeholder="SELECT * FROM …"
            spellCheck={false}
            className={`${inputClass} font-mono leading-relaxed resize-y flex-1`}
          />
        </div>
      </div>

      <div className="px-4 py-3 flex items-center justify-end gap-2 border-t border-line shrink-0">
        <button type="button" onClick={onCancel} className={secondaryBtn}>
          {t("form.cancel")}
        </button>
        <button type="submit" disabled={!canSave} className={primaryBtn}>
          <Save className="w-3.5 h-3.5" /> {t("form.save")}
        </button>
      </div>
    </form>
  );
}
