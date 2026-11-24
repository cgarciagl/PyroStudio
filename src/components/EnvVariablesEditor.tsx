import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { useEnvVariablesStore } from "../stores/envVariablesStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useUIStore } from "../stores/uiStore";
import { formatVariableLines, parseVariableLines, type Environments } from "../utils/envVariables";
import { dangerGhostBtn, ghostBtn, inputClass, primaryBtn } from "./ui/styles";

interface Draft {
  name: string;
  text: string;
}

const toDrafts = (envs: Environments): Draft[] =>
  Object.entries(envs).map(([name, vars]) => ({ name, text: formatVariableLines(vars) }));

/** Edits the environments (dev, staging, prod…) and their `${variable}` values. */
export const EnvVariablesEditor: React.FC = () => {
  const { t } = useTranslation("favorites");
  const environments = useEnvVariablesStore((s) => s.environments);
  const isFolderMode = useWorkspaceStore((s) => s.isFolderMode());
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(environments));
  const [saving, setSaving] = useState(false);

  useEffect(() => setDrafts(toDrafts(environments)), [environments]);

  const update = (index: number, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const save = async () => {
    const result: Environments = {};
    for (const draft of drafts) {
      const name = draft.name.trim();
      if (name) result[name] = parseVariableLines(draft.text);
    }
    setSaving(true);
    try {
      await useEnvVariablesStore.getState().save(result);
    } catch (e) {
      useUIStore.getState().showAlert({
        title: t("envVars.saveError"),
        message: e instanceof Error ? e.message : String(e),
        variant: "danger",
        icon: "alert",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 rounded-lg bg-raised border border-line space-y-3">
      <div className="text-xs font-semibold text-fg">{t("envVars.title")}</div>
      <p className="text-xs text-fg-muted">
        {t("envVars.descriptionPrefix")}
        <span className="font-mono">{"${schema}"}</span>
        {t("envVars.descriptionMiddle1")}
        <span className="font-mono">{t("envVars.keyValueExample")}</span>
        {t("envVars.descriptionMiddle2")}
        {isFolderMode
          ? t("envVars.descriptionWorkspace")
          : t("envVars.descriptionLocal")}
        {t("envVars.descriptionPasswordWarning")}
      </p>
      {drafts.map((draft, index) => (
        <div key={index} className="space-y-1.5">
          <div className="flex gap-2">
            <input
              className={inputClass}
              value={draft.name}
              placeholder={t("envVars.envNamePlaceholder")}
              onChange={(e) => update(index, { name: e.target.value })}
            />
            <button
              type="button"
              className={dangerGhostBtn}
              title={t("envVars.removeEnv")}
              aria-label={t("envVars.removeEnv")}
              onClick={() => setDrafts((list) => list.filter((_, i) => i !== index))}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            className={`${inputClass} font-mono h-20 resize-y`}
            value={draft.text}
            placeholder={"schema=tienda_dev\ntenant=acme"}
            onChange={(e) => update(index, { text: e.target.value })}
          />
        </div>
      ))}
      <div className="flex justify-between gap-2">
        <button type="button" className={ghostBtn} onClick={() => setDrafts((list) => [...list, { name: "", text: "" }])}>
          <Plus className="w-3.5 h-3.5" /> {t("envVars.addEnv")}
        </button>
        <button type="button" className={primaryBtn} disabled={saving} onClick={save}>
          {saving ? t("envVars.saving") : t("envVars.save")}
        </button>
      </div>
    </div>
  );
};
