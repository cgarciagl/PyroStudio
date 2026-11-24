import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Stethoscope } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { dbService, type VaultKeyStorage } from "../services/tauriDb";
import { useConnectionStore } from "../stores/connectionStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useUIStore } from "../stores/uiStore";
import { connectionEngine } from "../types/database";
import { Modal, Spinner } from "./ui/Modal";
import { cardClass, primaryBtn, secondaryBtn } from "./ui/styles";

interface DiagnosticsInfo {
  os: string;
  arch: string;
  config_dir: string;
  audit_dir: string;
  log_dir: string;
}

/** Warning and error lines of the log, newest last. */
export function problemLines(lines: string[], max = 15): string[] {
  return lines.filter((l) => /\b(ERROR|WARN)\b/.test(l)).slice(-max);
}

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Replaces the parts of a report that identify servers or the user's folders. */
export function redactValue(value: string, kind: "host" | "path"): string {
  if (!value) return value;
  return kind === "host" ? "[oculto]" : value.replace(/^.*[\\/]/, "…/");
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation("diagnostics");
  const { connectionStatus } = useConnectionStore();
  const workspace = useWorkspaceStore((s) => s.status);
  const [info, setInfo] = useState<DiagnosticsInfo | null>(null);
  const [vault, setVault] = useState<VaultKeyStorage | null>(null);
  const [recentProblems, setRecentProblems] = useState<string[]>([]);
  const [hideSensitive, setHideSensitive] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    invoke<DiagnosticsInfo>("get_diagnostics_info").then(setInfo).catch(() => setInfo(null));
    dbService.getVaultStatus().then(setVault).catch(() => setVault(null));
    invoke<string[]>("read_recent_log", { maxLines: 2000 })
      .then((lines) => setRecentProblems(problemLines(lines)))
      .catch(() => setRecentProblems([]));
  }, [isOpen]);

  const rows = useMemo(() => {
    const host = (v: string) => (hideSensitive ? (v ? t("diagnosticsModal.redactedHost") : v) : v);
    const path = (v: string) => (hideSensitive ? redactValue(v, "path") : v);
    const cfg = connectionStatus.config;
    const engine = cfg ? connectionEngine(cfg) : undefined;
    const sections: [string, [string, string][]][] = [
      [
        t("diagnosticsModal.sections.app"),
        [
          [t("diagnosticsModal.sections.version"), __APP_VERSION__],
          [t("diagnosticsModal.sections.system"), info ? `${info.os} (${info.arch})` : "…"],
          [t("diagnosticsModal.sections.localConfig"), info ? path(info.config_dir) : "…"],
          [t("diagnosticsModal.sections.auditLog"), info ? path(info.audit_dir) : "…"],
          [t("diagnosticsModal.sections.appLogs"), info ? path(info.log_dir) : "…"],
        ],
      ],
      [
        t("diagnosticsModal.sections.credentials"),
        [
          [
            t("diagnosticsModal.sections.vaultKey"),
            !vault
              ? "…"
              : vault.storage === "keychain"
                ? t("diagnosticsModal.sections.keychain")
                : t("diagnosticsModal.sections.masterKeyFile", { reason: vault.reason }),
          ],
        ],
      ],
      [
        t("diagnosticsModal.sections.workspace"),
        workspace && workspace.availability !== "local"
          ? [
              [t("diagnosticsModal.sections.status"), workspace.availability],
              [t("diagnosticsModal.sections.name"), workspace.name ?? "—"],
              [t("diagnosticsModal.sections.folder"), workspace.path ? path(workspace.path) : "—"],
              [t("diagnosticsModal.sections.formatVersion"), String(workspace.formatVersion ?? "—")],
              ...(workspace.error ? ([[t("diagnosticsModal.sections.error"), workspace.error]] as [string, string][]) : []),
            ]
          : [[t("diagnosticsModal.sections.status"), t("diagnosticsModal.sections.localStorageOnly")]],
      ],
      [
        t("diagnosticsModal.sections.connection"),
        connectionStatus.is_connected && cfg
          ? [
              [t("diagnosticsModal.sections.engine"), engine === "sqlite" ? "SQLite" : "MariaDB / MySQL"],
              [t("diagnosticsModal.sections.server"), connectionStatus.server_info?.version ?? "—"],
              [engine === "sqlite" ? t("diagnosticsModal.sections.file") : t("diagnosticsModal.sections.host"), engine === "sqlite" ? path(cfg.file_path ?? "") : host(`${cfg.host}:${cfg.port}`)],
              [t("diagnosticsModal.sections.environment"), cfg.environment ?? "local"],
              [t("diagnosticsModal.sections.readOnly"), cfg.read_only ? t("diagnosticsModal.sections.yes") : t("diagnosticsModal.sections.no")],
              [
                t("diagnosticsModal.sections.transport"),
                ("tunnel" in cfg && cfg.tunnel) || ("tunnel_enabled" in cfg && cfg.tunnel_enabled)
                  ? t("diagnosticsModal.sections.httpTunnel")
                  : "ssh_tunnel" in cfg && cfg.ssh_tunnel
                    ? t("diagnosticsModal.sections.sshTunnel")
                    : t("diagnosticsModal.sections.direct"),
              ],
              [t("diagnosticsModal.sections.latency"), connectionStatus.server_info ? `${connectionStatus.server_info.ping_ms} ms` : "—"],
            ]
          : [[t("diagnosticsModal.sections.status"), t("diagnosticsModal.sections.disconnected")]],
      ],
    ];
    return sections;
  }, [connectionStatus, workspace, info, vault, hideSensitive, t]);

  const report = useMemo(
    () =>
      [
        t("diagnosticsModal.reportHeader"),
        t("diagnosticsModal.reportGenerated", { date: new Date().toISOString() }),
        ...rows.flatMap(([title, items]) => ["", `## ${title}`, ...items.map(([k, v]) => `- ${k}: ${v}`)]),
        "",
        `## ${t("diagnosticsModal.recentProblemsTitle")}`,
        ...(recentProblems.length ? recentProblems : [t("diagnosticsModal.reportNone")]),
      ].join("\n"),
    [rows, recentProblems, t],
  );

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      useUIStore.getState().showAlert({
        title: t("diagnosticsModal.copyErrorTitle"),
        message: String(err),
        variant: "warning",
        icon: "alert",
      });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("diagnosticsModal.title")}
      subtitle={t("diagnosticsModal.subtitle")}
      icon={<Stethoscope className="w-4 h-4 text-fg-muted" />}
      size="md"
      footer={
        <>
          <label className="mr-auto flex items-center gap-1.5 text-xs text-fg-muted select-none">
            <input type="checkbox" checked={hideSensitive} onChange={(e) => setHideSensitive(e.target.checked)} />
            {t("diagnosticsModal.hideSensitive")}
          </label>
          <button className={secondaryBtn} onClick={onClose}>
            {t("diagnosticsModal.close")}
          </button>
          <button className={primaryBtn} onClick={copyReport}>
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t("diagnosticsModal.copied") : t("diagnosticsModal.copyReport")}
          </button>
        </>
      }
    >
      {!info && !vault ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Spinner /> {t("diagnosticsModal.gathering")}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(([title, items]) => (
            <div key={title} className={`${cardClass} p-3`}>
              <div className="text-[11px] font-medium text-fg-muted mb-1.5">{title}</div>
              <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1 text-xs">
                {items.map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt className="text-fg-muted">{k}</dt>
                    <dd className="text-fg font-mono break-all">{v}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          ))}
          <div className={`${cardClass} p-3`}>
            <div className="text-[11px] font-medium text-fg-muted mb-1.5">{t("diagnosticsModal.recentProblemsTitle")}</div>
            {recentProblems.length === 0 ? (
              <p className="text-xs text-fg-muted">{t("diagnosticsModal.noProblems")}</p>
            ) : (
              <pre className="text-[11px] font-mono text-fg whitespace-pre-wrap break-all max-h-48 overflow-auto">
                {recentProblems.join("\n")}
              </pre>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};
