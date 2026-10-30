import React, { useEffect, useMemo, useState } from "react";
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
    const host = (v: string) => (hideSensitive ? redactValue(v, "host") : v);
    const path = (v: string) => (hideSensitive ? redactValue(v, "path") : v);
    const cfg = connectionStatus.config;
    const engine = cfg ? connectionEngine(cfg) : undefined;
    const sections: [string, [string, string][]][] = [
      [
        "Aplicación",
        [
          ["Versión", __APP_VERSION__],
          ["Sistema", info ? `${info.os} (${info.arch})` : "…"],
          ["Configuración local", info ? path(info.config_dir) : "…"],
          ["Log de auditoría", info ? path(info.audit_dir) : "…"],
          ["Logs de la aplicación", info ? path(info.log_dir) : "…"],
        ],
      ],
      [
        "Credenciales",
        [
          [
            "Clave maestra del vault",
            !vault
              ? "…"
              : vault.storage === "keychain"
                ? "Llavero del sistema"
                : `Archivo master.key (sin llavero: ${vault.reason})`,
          ],
        ],
      ],
      [
        "Workspace",
        workspace && workspace.availability !== "local"
          ? [
              ["Estado", workspace.availability],
              ["Nombre", workspace.name ?? "—"],
              ["Carpeta", workspace.path ? path(workspace.path) : "—"],
              ["Versión de formato", String(workspace.formatVersion ?? "—")],
              ...(workspace.error ? ([["Error", workspace.error]] as [string, string][]) : []),
            ]
          : [["Estado", "Almacenamiento local (sin workspace)"]],
      ],
      [
        "Conexión",
        connectionStatus.is_connected && cfg
          ? [
              ["Motor", engine === "sqlite" ? "SQLite" : "MariaDB / MySQL"],
              ["Servidor", connectionStatus.server_info?.version ?? "—"],
              [engine === "sqlite" ? "Archivo" : "Host", engine === "sqlite" ? path(cfg.file_path ?? "") : host(`${cfg.host}:${cfg.port}`)],
              ["Entorno", cfg.environment ?? "local"],
              ["Solo lectura", cfg.read_only ? "Sí" : "No"],
              [
                "Transporte",
                ("tunnel" in cfg && cfg.tunnel) || ("tunnel_enabled" in cfg && cfg.tunnel_enabled)
                  ? "Túnel HTTP"
                  : "ssh_tunnel" in cfg && cfg.ssh_tunnel
                    ? "Túnel SSH"
                    : "Directo",
              ],
              ["Latencia", connectionStatus.server_info ? `${connectionStatus.server_info.ping_ms} ms` : "—"],
            ]
          : [["Estado", "Sin conexión"]],
      ],
    ];
    return sections;
  }, [connectionStatus, workspace, info, vault, hideSensitive]);

  const report = useMemo(
    () =>
      [
        "# Informe de diagnóstico de PyroStudio",
        `Generado: ${new Date().toISOString()}`,
        ...rows.flatMap(([title, items]) => ["", `## ${title}`, ...items.map(([k, v]) => `- ${k}: ${v}`)]),
        "",
        "## Últimos errores y avisos",
        ...(recentProblems.length ? recentProblems : ["(ninguno)"]),
      ].join("\n"),
    [rows, recentProblems],
  );

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      useUIStore.getState().showAlert({
        title: "No se pudo copiar",
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
      title="Diagnóstico"
      subtitle="Información para soporte; nunca incluye contraseñas ni tokens"
      icon={<Stethoscope className="w-4 h-4 text-fg-muted" />}
      size="md"
      footer={
        <>
          <label className="mr-auto flex items-center gap-1.5 text-xs text-fg-muted select-none">
            <input type="checkbox" checked={hideSensitive} onChange={(e) => setHideSensitive(e.target.checked)} />
            Ocultar hosts y rutas
          </label>
          <button className={secondaryBtn} onClick={onClose}>
            Cerrar
          </button>
          <button className={primaryBtn} onClick={copyReport}>
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copiado" : "Copiar informe"}
          </button>
        </>
      }
    >
      {!info && !vault ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Spinner /> Recopilando información…
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
            <div className="text-[11px] font-medium text-fg-muted mb-1.5">Últimos errores y avisos</div>
            {recentProblems.length === 0 ? (
              <p className="text-xs text-fg-muted">Ninguno en el log más reciente.</p>
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
