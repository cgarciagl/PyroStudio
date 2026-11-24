import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Database, FolderOpen, FolderPlus, KeyRound, Languages, Plug } from "lucide-react";
import { dbService, type VaultKeyStorage } from "../services/tauriDb";
import { usePreferenceStore } from "../stores/preferenceStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { Modal } from "./ui/Modal";
import { cardClass, fieldLabel, ghostBtn, inputClass, primaryBtn, secondaryBtn } from "./ui/styles";
import { errorText } from "../utils/errors";

interface OnboardingWizardProps {
  isOpen: boolean;
  /** Closes the wizard; it is marked as seen whether finished or skipped. */
  onClose: () => void;
  onNewConnection: () => void;
  /** Optional: creates the demo database and connects to it. */
  onOpenDemo: () => Promise<void>;
}

/** First-run introduction: workspace, vault and first connection. Always skippable. */
export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ isOpen, onClose, onNewConnection, onOpenDemo }) => {
  const { t } = useTranslation(["settings", "common"]);
  const language = usePreferenceStore((s) => s.language);
  const setLanguage = usePreferenceStore((s) => s.setLanguage);
  const [step, setStep] = useState(0);
  const [vault, setVault] = useState<VaultKeyStorage | null>(null);
  const [workspaceName, setWorkspaceName] = useState("PyroStudio");
  const [demoState, setDemoState] = useState<"idle" | "busy" | { error: string }>("idle");
  const status = useWorkspaceStore((s) => s.status);
  const isFolderMode = useWorkspaceStore((s) => s.isFolderMode());
  const { openWorkspace, createWorkspace } = useWorkspaceStore.getState();

  const steps = [
    t("settings:onboarding.steps.language"),
    t("settings:onboarding.steps.workspace"),
    t("settings:onboarding.steps.passwords"),
    t("settings:onboarding.steps.firstConnection"),
  ];

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setDemoState("idle");
    dbService.getVaultStatus().then(setVault).catch(() => setVault(null));
  }, [isOpen]);

  const isLast = step === steps.length - 1;

  const footer = (
    <>
      <button type="button" className={`${ghostBtn} mr-auto`} onClick={onClose}>
        {t("settings:onboarding.skip")}
      </button>
      {step > 0 && (
        <button type="button" className={secondaryBtn} onClick={() => setStep(step - 1)}>
          {t("settings:onboarding.back")}
        </button>
      )}
      {isLast ? (
        <button
          type="button"
          className={primaryBtn}
          onClick={() => {
            onClose();
            onNewConnection();
          }}
        >
          <Plug className="w-3.5 h-3.5" />
          <span>{t("settings:onboarding.createConnection")}</span>
        </button>
      ) : (
        <button type="button" className={primaryBtn} onClick={() => setStep(step + 1)}>
          {t("settings:onboarding.next")}
        </button>
      )}
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("settings:onboarding.title")}
      subtitle={t("settings:onboarding.subtitle", { current: step + 1, total: steps.length, step: steps[step] })}
      footer={footer}
      closeOnBackdrop={false}
    >
      <div className="space-y-4 text-xs text-fg-muted leading-relaxed">
        {step === 0 && (
          <>
            <p>{t("settings:onboarding.step0Intro")}</p>
            <div className="grid grid-cols-1 gap-2">
              {([
                { id: "es" as const, title: "Español", desc: t("settings:onboarding.step0EsDesc") },
                { id: "en" as const, title: "English", desc: t("settings:onboarding.step0EnDesc") },
                { id: "system" as const, title: t("common:languages.system"), desc: t("settings:onboarding.step0SystemDesc") },
              ]).map((opt) => {
                const active = language === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setLanguage(opt.id)}
                    className={`w-full text-left px-3.5 py-2.5 rounded-lg border transition-colors flex items-center justify-between gap-3 ${
                      active
                        ? "bg-accent-soft text-accent-text border-accent/40"
                        : "bg-raised text-fg border-line hover:bg-hover"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Languages className={`w-4 h-4 shrink-0 ${active ? "text-accent-text" : "text-fg-muted"}`} />
                      <div className="min-w-0">
                        <div className="font-medium text-xs">{opt.title}</div>
                        <div className={`text-[11px] ${active ? "text-accent-text/80" : "text-fg-subtle"}`}>
                          {opt.desc}
                        </div>
                      </div>
                    </div>
                    {active && <Check className="w-4 h-4 shrink-0 text-accent-text" />}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-fg-subtle">{t("settings:onboarding.step0Note")}</p>
          </>
        )}

        {step === 1 && (
          <>
            <p>{t("settings:onboarding.step1Intro")}</p>
            {isFolderMode && status?.path ? (
              <div className={`${cardClass} flex items-center gap-2`}>
                <Check className="w-4 h-4 text-success shrink-0" />
                <span>
                  {t("settings:onboarding.activeWorkspace")} <span className="text-fg">{status.name}</span>{" "}
                  <span className="font-mono text-[11px]">{status.path}</span>
                </span>
              </div>
            ) : (
              <>
                <div>
                  <label className={fieldLabel} htmlFor="onboarding-ws-name">
                    {t("settings:onboarding.newWorkspaceLabel")}
                  </label>
                  <input
                    id="onboarding-ws-name"
                    className={inputClass}
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={secondaryBtn}
                    disabled={!workspaceName.trim()}
                    onClick={() => createWorkspace(workspaceName.trim())}
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span>{t("settings:onboarding.createNew")}</span>
                  </button>
                  <button type="button" className={secondaryBtn} onClick={() => openWorkspace()}>
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>{t("settings:onboarding.chooseFolder")}</span>
                  </button>
                  <button type="button" className={ghostBtn} onClick={() => setStep(2)}>
                    {t("settings:onboarding.later")}
                  </button>
                </div>
                <p className="text-[11px] text-fg-subtle">
                  {t("settings:onboarding.noWorkspaceNote")}
                </p>
              </>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <p>{t("settings:onboarding.step2Intro")}</p>
            <div className={`${cardClass} flex items-start gap-2`}>
              <KeyRound
                className={`w-4 h-4 shrink-0 mt-0.5 ${vault?.storage === "file_fallback" ? "text-warning" : "text-success"}`}
              />
              {vault === null ? (
                <span>{t("settings:onboarding.vaultUnavailable")}</span>
              ) : vault.storage === "keychain" ? (
                <span>{t("settings:onboarding.vaultKeychain")}</span>
              ) : (
                <span>{t("settings:onboarding.vaultFallback", { reason: vault.reason })}</span>
              )}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p>{t("settings:onboarding.step3Intro")}</p>
            <div className={`${cardClass} flex items-center justify-between gap-3`}>
              <span>
                <span className="text-fg">{t("settings:onboarding.demoPrefix")}</span> {t("settings:onboarding.demoBody")}
              </span>
              <button
                type="button"
                className={secondaryBtn}
                disabled={demoState === "busy"}
                onClick={async () => {
                  setDemoState("busy");
                  try {
                    await onOpenDemo();
                    onClose();
                  } catch (err) {
                    setDemoState({ error: errorText(err) });
                  }
                }}
              >
                <Database className="w-3.5 h-3.5" />
                <span>{demoState === "busy" ? t("settings:onboarding.demoCreating") : t("settings:onboarding.demoTry")}</span>
              </button>
            </div>
            {typeof demoState === "object" && <p className="text-danger">{demoState.error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
};
