import React from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("settings");
  const {
    status,
    availableUpdate,
    isPortable,
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
      title={t("updateModal.title")}
      subtitle={`v${availableUpdate.currentVersion} → v${availableUpdate.version}`}
      footer={
        <div className="w-full flex items-center justify-between gap-2">
          {!isBusy ? (
            <button
              type="button"
              onClick={() => skipVersion(availableUpdate.version)}
              className={ghostBtn}
            >
              {t("updateModal.skipVersion")}
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
              {t("updateModal.later")}
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
                  <span>{t("updateModal.downloading")}</span>
                </>
              ) : isInstalled ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{t("updateModal.restarting")}</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>{t("updateModal.updateNow")}</span>
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs text-fg leading-relaxed">
            {t("updateModal.availableBody")}
          </p>
          {isPortable && (
            <p className="text-[11px] text-fg-muted leading-relaxed">
              {t("updateModal.portableNote")}
            </p>
          )}
        </div>

        {availableUpdate.body && availableUpdate.body.trim().length > 0 && (
          <div className="space-y-1.5">
            <div className={sectionLabel}>{t("updateModal.releaseNotes")}</div>
            <div className={`${cardClass} p-3 max-h-44 overflow-y-auto text-xs text-fg-muted whitespace-pre-wrap leading-relaxed`}>
              {availableUpdate.body.trim()}
            </div>
          </div>
        )}

        {isDownloading && (
          <div className={`${cardClass} p-3 space-y-2`}>
            <div className="flex items-center justify-between text-[11px] text-fg-muted">
              <span>{t("updateModal.downloadingPackage")}</span>
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
                <p className="font-medium">{t("updateModal.installErrorTitle")}</p>
                <p className="text-[11px] text-fg-muted break-words">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleOpenReleasesPage}
              className={ghostBtn}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{t("updateModal.downloadManually")}</span>
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};
