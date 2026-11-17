import React, { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Info } from "lucide-react";
import { Modal } from "./ui/Modal";
import { ghostBtn, primaryBtn, sectionLabel } from "./ui/styles";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const REPO_URL = "https://github.com/cgarciagl/PyroStudio";

const STACK: [string, string][] = [
  ["Motor nativo", "Tauri v2 + Rust + SQLx"],
  ["Interfaz", "React 19 + TypeScript + Tailwind CSS"],
  ["Cuadrícula", "Glide Data Grid"],
  ["Editor SQL", "CodeMirror 6"],
  ["Gráficas", "Apache ECharts"],
  ["Bóveda de credenciales", "AES-256-GCM"],
];

const OPEN_SOURCE = [
  "Tauri", "SQLx", "Tokio", "Serde", "React", "Zustand", "Tailwind CSS",
  "CodeMirror", "Glide Data Grid", "ECharts", "Lucide", "sql-formatter",
  "marked", "lodash", "Maple Mono", "Vite", "Vitest",
];

const openExternal = (url: string) => {
  openUrl(url).catch(() => window.open(url, "_blank", "noopener"));
};

/** «Acerca de»: versión, autoría, licencia y créditos de terceros. */
export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const [version, setVersion] = useState(__APP_VERSION__);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    getVersion()
      .then((v) => mounted && setVersion(v))
      .catch(() => {
        // En navegador/Vite se conserva la versión inyectada por Vite.
      });
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Acerca de Pyro Studio"
      icon={<Info className="w-4 h-4" />}
      size="md"
      footer={
        <button type="button" onClick={onClose} className={primaryBtn}>
          Cerrar
        </button>
      }
    >
      <div className="space-y-5 text-xs text-fg">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt=""
            className="w-12 h-12 rounded-lg object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = "none";
            }}
          />
          <div>
            <h3 className="text-sm font-semibold">
              Pyro <span className="text-accent-text">Studio</span>
            </h3>
            <p className="text-fg-muted">Versión {version}</p>
            <p className="text-[11px] text-fg-subtle">
              Cliente nativo y ligero para MariaDB y MySQL
            </p>
          </div>
        </div>

        <section className="space-y-1.5">
          <h4 className={sectionLabel}>Créditos</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-fg-muted">Autor</dt>
            <dd>Carlos García Trujillo</dd>
            <dt className="text-fg-muted">Licencia</dt>
            <dd>MIT © 2026 Pyro Studio Team</dd>
          </dl>
        </section>

        <section className="space-y-1.5">
          <h4 className={sectionLabel}>Tecnología</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {STACK.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-fg-muted">{k}</dt>
                <dd className="font-mono text-[11px]">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        <section className="space-y-1.5">
          <h4 className={sectionLabel}>Software de código abierto</h4>
          <p className="text-fg-muted leading-relaxed">
            Pyro Studio se apoya en {OPEN_SOURCE.join(", ")} y muchos otros
            proyectos. Gracias a sus autores y comunidades.
          </p>
        </section>

        <button type="button" onClick={() => openExternal(REPO_URL)} className={ghostBtn}>
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Repositorio en GitHub</span>
        </button>
      </div>
    </Modal>
  );
};
