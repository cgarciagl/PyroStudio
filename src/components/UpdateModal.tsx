import React from "react";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal } from "./ui/Modal";
import { cardClass, ghostBtn, primaryBtn, secondaryBtn, sectionLabel } from "./ui/styles";
import { RELEASES_LATEST_URL, useUpdaterStore } from "../stores/updaterStore";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export const UpdateModal: React.FC = () => {
  const {
    status,
    availableUpdate,
    progress,
    error,
    isModalOpen,
    installUpdate,
    skipVersion,
    dismissModal,
  } = useUpdaterStore();

  if (!isModalOpen || !availableUpdate) return null;

  const isDownloading = status === "downloading";
  const isInstalled = status === "installed";
  const isBusy = isDownloading || isInstalled;

  const handleOpenReleasesPage = () => {
    openUrl(RELEASES_LATEST_URL).catch(() => {});
  };

  return (
    <Modal
      isOpen={isModalOpen}
      onClose={isBusy ? () => {} : dismissModal}
      closeOnBackdrop={!isBusy}
      closeOnEscape={!isBusy}
      size="sm"
      icon={<Download className="w-4 h-4" />}
      title="Actualización disponible"
      subtitle={`v${availableUpdate.currentVersion} → v${availableUpdate.version}`}
      footer={
        <div className="w-full flex items-center justify-between gap-2">
          {!isBusy ? (
            <button
              type="button"
              onClick={() => skipVersion(availableUpdate.version)}
              className={ghostBtn}
            >
              Omitir esta versión
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={dismissModal}
              className={secondaryBtn}
            >
              Más tarde
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void installUpdate()}
              className={primaryBtn}
            >
              {isDownloading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Descargando…</span>
                </>
              ) : isInstalled ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Reiniciando…</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Actualizar ahora</span>
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-fg leading-relaxed">
          Hay una nueva versión de <span className="font-semibold">Pyro Studio</span> lista para descargar e instalar.
        </p>

        {availableUpdate.body && availableUpdate.body.trim().length > 0 && (
          <div className="space-y-1.5">
            <div className={sectionLabel}>Novedades de la versión</div>
            <div className={`${cardClass} p-3 max-h-44 overflow-y-auto text-xs text-fg-muted whitespace-pre-wrap leading-relaxed`}>
              {availableUpdate.body.trim()}
            </div>
          </div>
        )}

        {isDownloading && (
          <div className={`${cardClass} p-3 space-y-2`}>
            <div className="flex items-center justify-between text-[11px] text-fg-muted">
              <span>Descargando paquete de actualización…</span>
              <span className="font-mono text-fg">
                {progress.percent !== null ? `${progress.percent}%` : formatBytes(progress.downloaded)}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-raised overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-150"
                style={{ width: `${progress.percent ?? 35}%` }}
              />
            </div>
            {progress.total ? (
              <div className="text-[11px] text-fg-subtle font-mono text-right">
                {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
              </div>
            ) : null}
          </div>
        )}

        {error && (
          <div className={`${cardClass} p-3 space-y-2 border-danger/40`}>
            <div className="flex items-start gap-2 text-xs text-fg">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <p className="font-medium">No se pudo instalar la actualización</p>
                <p className="text-[11px] text-fg-muted break-words">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleOpenReleasesPage}
              className={ghostBtn}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Descargar manualmente desde GitHub</span>
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};
