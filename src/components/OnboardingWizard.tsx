import React, { useEffect, useState } from "react";
import { Check, Database, FolderOpen, FolderPlus, KeyRound, Plug } from "lucide-react";
import { dbService, type VaultKeyStorage } from "../services/tauriDb";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { Modal } from "./ui/Modal";
import { cardClass, fieldLabel, ghostBtn, inputClass, primaryBtn, secondaryBtn } from "./ui/styles";

interface OnboardingWizardProps {
  isOpen: boolean;
  /** Closes the wizard; it is marked as seen whether finished or skipped. */
  onClose: () => void;
  onNewConnection: () => void;
  /** Optional: creates the demo database and connects to it. */
  onOpenDemo: () => Promise<void>;
}

const STEPS = ["Workspace", "Contraseñas", "Primera conexión"];

/** First-run introduction: workspace, vault and first connection. Always skippable. */
export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ isOpen, onClose, onNewConnection, onOpenDemo }) => {
  const [step, setStep] = useState(0);
  const [vault, setVault] = useState<VaultKeyStorage | null>(null);
  const [workspaceName, setWorkspaceName] = useState("PyroStudio");
  const [demoState, setDemoState] = useState<"idle" | "busy" | { error: string }>("idle");
  const status = useWorkspaceStore((s) => s.status);
  const isFolderMode = useWorkspaceStore((s) => s.isFolderMode());
  const { openWorkspace, createWorkspace } = useWorkspaceStore.getState();

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setDemoState("idle");
    dbService.getVaultStatus().then(setVault).catch(() => setVault(null));
  }, [isOpen]);

  const isLast = step === STEPS.length - 1;

  const footer = (
    <>
      <button type="button" className={`${ghostBtn} mr-auto`} onClick={onClose}>
        Omitir introducción
      </button>
      {step > 0 && (
        <button type="button" className={secondaryBtn} onClick={() => setStep(step - 1)}>
          Atrás
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
          <span>Crear conexión</span>
        </button>
      ) : (
        <button type="button" className={primaryBtn} onClick={() => setStep(step + 1)}>
          Siguiente
        </button>
      )}
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Bienvenido a PyroStudio"
      subtitle={`Paso ${step + 1} de ${STEPS.length} · ${STEPS[step]}`}
      footer={footer}
      closeOnBackdrop={false}
    >
      <div className="space-y-4 text-xs text-fg-muted leading-relaxed">
        {step === 0 && (
          <>
            <p>
              Un <span className="text-fg">workspace</span> es una carpeta con tus conexiones (sin contraseñas),
              consultas guardadas, favoritos y snippets. Sirve para versionarlo con git, compartirlo con tu equipo
              o separar proyectos.
            </p>
            {isFolderMode && status?.path ? (
              <div className={`${cardClass} flex items-center gap-2`}>
                <Check className="w-4 h-4 text-success shrink-0" />
                <span>
                  Workspace activo: <span className="text-fg">{status.name}</span>{" "}
                  <span className="font-mono text-[11px]">{status.path}</span>
                </span>
              </div>
            ) : (
              <>
                <div>
                  <label className={fieldLabel} htmlFor="onboarding-ws-name">
                    Nombre para un workspace nuevo
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
                    <span>Crear nueva</span>
                  </button>
                  <button type="button" className={secondaryBtn} onClick={() => openWorkspace()}>
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Elegir carpeta existente</span>
                  </button>
                  <button type="button" className={ghostBtn} onClick={() => setStep(1)}>
                    Más tarde
                  </button>
                </div>
                <p className="text-[11px] text-fg-subtle">
                  Sin workspace, todo se guarda solo en este equipo. Puedes crearlo después desde la barra lateral.
                </p>
              </>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <p>
              Las contraseñas nunca se guardan en la interfaz ni en el workspace: van a un almacén cifrado
              (AES-256-GCM) en este equipo, y su clave maestra se guarda en el llavero del sistema operativo.
            </p>
            <div className={`${cardClass} flex items-start gap-2`}>
              <KeyRound
                className={`w-4 h-4 shrink-0 mt-0.5 ${vault?.storage === "file_fallback" ? "text-warning" : "text-success"}`}
              />
              {vault === null ? (
                <span>No se pudo consultar el estado del almacén.</span>
              ) : vault.storage === "keychain" ? (
                <span>La clave maestra está en el llavero del sistema.</span>
              ) : (
                <span>
                  No hay llavero del sistema disponible: la clave maestra se guarda en un archivo protegido{" "}
                  (<span className="font-mono">master.key</span>, permisos 0600). Motivo: {vault.reason}
                </span>
              )}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p>
              Crea tu primera conexión a MariaDB, MySQL o SQLite. Puedes marcarla como entorno de producción
              (confirmaciones reforzadas) o de solo lectura. Esta introducción se puede volver a ver desde
              Preferencias → Acerca de.
            </p>
            <div className={`${cardClass} flex items-center justify-between gap-3`}>
              <span>
                <span className="text-fg">Opcional:</span> explora PyroStudio con una base SQLite de ejemplo (una
                tienda con clientes, pedidos y productos). Se crea en la carpeta de datos de la app, solo si la pides.
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
                    setDemoState({ error: typeof err === "string" ? err : (err as Error)?.message || String(err) });
                  }
                }}
              >
                <Database className="w-3.5 h-3.5" />
                <span>{demoState === "busy" ? "Creando…" : "Probar la demo"}</span>
              </button>
            </div>
            {typeof demoState === "object" && <p className="text-danger">{demoState.error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
};
