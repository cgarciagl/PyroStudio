import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Copy, Download, FileCode, KeyRound } from "lucide-react";
import { generateTunnelToken } from "../utils/tunnelToken";
import { Modal } from "./ui/Modal";
import { fieldLabel, ghostBtn, inputClass, primaryBtn, secondaryBtn } from "./ui/styles";

export type TunnelScriptKind = "mysql" | "sqlite";

const MIN_TOKEN_LENGTH = 16;

interface SaveTunnelScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  kind: TunnelScriptKind;
  initialToken?: string;
  onTokenUsed?: (token: string) => void;
}

export const SaveTunnelScriptModal: React.FC<SaveTunnelScriptModalProps> = ({
  isOpen,
  onClose,
  kind,
  initialToken = "",
  onTokenUsed,
}) => {
  const { t } = useTranslation(["connection", "common"]);
  const [token, setToken] = useState(initialToken);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const scriptName = kind === "sqlite" ? "pyro_tunnel_sqlite.php" : "pyro_tunnel.php";

  useEffect(() => {
    if (isOpen) {
      setToken(initialToken);
      setError(null);
      setSavedPath(null);
      setCopied(false);
      setSaving(false);
    }
  }, [isOpen, initialToken, kind]);

  const trimmedToken = token.trim();
  const tokenTooShort = trimmedToken.length > 0 && trimmedToken.length < MIN_TOKEN_LENGTH;

  const handleGenerate = () => {
    setToken(generateTunnelToken());
    setError(null);
    setSavedPath(null);
  };

  const handleCopyToken = async () => {
    if (!trimmedToken) return;
    try {
      await navigator.clipboard.writeText(trimmedToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable in non-secure contexts
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (tokenTooShort || saving) return;
    setSaving(true);
    setError(null);
    setSavedPath(null);
    try {
      const path = await invoke<string | null>("save_tunnel_script", {
        kind,
        token: trimmedToken || null,
        dialogTitle: t("connection:tunnelScriptModal.dialogTitle", { script: scriptName }),
      });
      if (path) {
        setSavedPath(path);
        if (trimmedToken && onTokenUsed) {
          onTokenUsed(trimmedToken);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("connection:tunnelScriptModal.title", { script: scriptName })}
      subtitle={
        kind === "sqlite"
          ? t("connection:tunnelScriptModal.subtitleSqlite")
          : t("connection:tunnelScriptModal.subtitleMysql")
      }
      icon={<FileCode className="w-4 h-4" />}
      size="md"
      zIndex="z-[60]"
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryBtn}>
            {savedPath ? t("common:actions.close") : t("common:actions.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={tokenTooShort || saving}
            className={primaryBtn}
          >
            <Download className="w-3.5 h-3.5" />
            {saving
              ? t("connection:tunnelScriptModal.saving")
              : t("connection:tunnelScriptModal.saveButton")}
          </button>
        </>
      }
    >
      <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
        <p className="text-xs text-fg-muted leading-relaxed">
          {t("connection:tunnelScriptModal.description", { script: scriptName })}
        </p>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="tunnel-script-token-input" className={fieldLabel}>
              {t("connection:tunnelScriptModal.tokenLabel")}
            </label>
            <div className="flex items-center gap-1">
              {trimmedToken && (
                <button type="button" onClick={() => void handleCopyToken()} className={ghostBtn}>
                  <Copy className="w-3 h-3" />
                  {copied
                    ? t("connection:transport.http.copied")
                    : t("connection:transport.http.copyToken")}
                </button>
              )}
              <button type="button" onClick={handleGenerate} className={ghostBtn}>
                <KeyRound className="w-3 h-3" />
                {t("connection:transport.http.generateToken")}
              </button>
            </div>
          </div>

          <input
            id="tunnel-script-token-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError(null);
              setSavedPath(null);
            }}
            placeholder={t("connection:tunnelScriptModal.tokenPlaceholder")}
            className={`${inputClass} font-mono`}
          />

          {tokenTooShort ? (
            <p className="flex items-center gap-1.5 text-[11px] text-danger">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {t("connection:tunnelScriptModal.tokenMinLengthError")}
            </p>
          ) : (
            <p className="text-[11px] text-fg-muted leading-snug">
              {t("connection:tunnelScriptModal.tokenHint")}
            </p>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-line bg-raised p-2.5 text-xs text-danger">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {savedPath && (
          <div className="flex items-start gap-2 rounded-md border border-line bg-raised p-2.5 text-xs text-fg">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
            <div className="space-y-0.5 min-w-0">
              <div className="font-medium">{t("connection:tunnelScriptModal.savedSuccess")}</div>
              <div className="text-[11px] font-mono text-fg-muted break-all">{savedPath}</div>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
};
