import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  FolderPlus,
  FolderSearch,
  HardDrive,
  RefreshCw,
  CloudOff,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Share2,
  Lock,
  PackageOpen,
  Package,
} from "lucide-react";
import { workspaceService } from "../services/workspaceService";
import { EnvVariablesEditor } from "./EnvVariablesEditor";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useUIStore } from "../stores/uiStore";
import { connectionStorage } from "../services/connectionStorage";
import { favoritesStorage } from "../services/favoritesStorage";
import type { MigrationReport, WorkspaceAvailability } from "../types/workspace";

const MIGRATED_KEY_PREFIX = "pyro_workspace_migrated_v1_";

const AVAILABILITY_CLASS: Record<WorkspaceAvailability, string> = {
  local: "text-fg",
  available: "text-success",
  unavailable: "text-warning",
  incompatible: "text-danger",
  invalid: "text-danger",
};

function wasMigrated(workspaceId: string | null): boolean {
  if (!workspaceId) return false;
  try {
    return localStorage.getItem(MIGRATED_KEY_PREFIX + workspaceId) === "1";
  } catch {
    return false;
  }
}

/** Workspace management panel shown inside Settings. */
export const WorkspaceSettings: React.FC = () => {
  const { t } = useTranslation("settings");
  const { status, loadState, connections, queries, fileErrors, error } = useWorkspaceStore();
  const store = useWorkspaceStore.getState;
  const showAlert = useUIStore((s) => s.showAlert);
  const showConfirm = useUIStore((s) => s.showConfirm);
  const bumpProfilesVersion = useUIStore((s) => s.bumpProfilesVersion);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastReport, setLastReport] = useState<MigrationReport | null>(null);

  const availability = status?.availability ?? "local";
  const label = {
    text: t(`workspaceSettings.availability.${availability}`),
    className: AVAILABILITY_CLASS[availability],
  };
  const legacyConnections = connectionStorage.readLegacyConnections();
  const legacyFavorites = favoritesStorage.readLegacyFavorites();
  const hasLegacyData = legacyConnections.length + legacyFavorites.length > 0;

  const run = async (action: () => Promise<unknown>, errorTitle: string) => {
    setBusy(true);
    try {
      await action();
      bumpProfilesVersion();
    } catch (e) {
      showAlert({
        title: errorTitle,
        message: e instanceof Error ? e.message : String(e),
        variant: "danger",
        icon: "alert",
      });
    } finally {
      setBusy(false);
    }
  };

  const runMigration = () =>
    run(async () => {
      const report = await store().importLegacy(legacyConnections, legacyFavorites);
      setLastReport(report);
      const id = store().status?.workspaceId ?? null;
      if (report.verified && report.conflicts.length === 0 && id) {
        // Source data in localStorage is intentionally kept.
        localStorage.setItem(MIGRATED_KEY_PREFIX + id, "1");
      }
    }, t("workspaceSettings.migrationError"));

  const confirmMigration = () =>
    showConfirm({
      title: t("workspaceSettings.migrationConfirmTitle"),
      message: t("workspaceSettings.migrationConfirmMessage", {
        connections: legacyConnections.length,
        queries: legacyFavorites.length,
      }),
      details: t("workspaceSettings.migrationConfirmDetails"),
      variant: "primary",
      icon: "info",
      confirmText: t("workspaceSettings.migrationConfirmButton"),
      onConfirm: () => void runMigration(),
    });

  const createWorkspace = () =>
    run(async () => {
      const created = await store().createWorkspace(newName);
      if (created && hasLegacyData) confirmMigration();
    }, t("workspaceSettings.createError"));

  const useLocal = () =>
    showConfirm({
      title: t("workspaceSettings.useLocalTitle"),
      message: t("workspaceSettings.useLocalMessage"),
      variant: "warning",
      icon: "alert",
      confirmText: t("workspaceSettings.useLocalButton"),
      onConfirm: () => void run(() => store().useLocalStorage(), t("workspaceSettings.useLocalError")),
    });

  const btn =
    "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors disabled:opacity-50";
  const primaryBtn = `${btn} bg-accent hover:bg-accent-hover border-accent text-accent-fg`;
  const secondaryBtn = `${btn} bg-raised hover:bg-hover border-line text-fg`;

  return (
    <div className="pyro-workspace-settings space-y-6 animate-in fade-in duration-150" data-workspace-settings>
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-fg-muted" /> {t("workspaceSettings.title")}
        </h3>
        <p className="text-xs text-fg-muted mt-1">
          {t("workspaceSettings.subtitle")}
        </p>
      </div>

      {/* Current workspace */}
      <div className="p-4 rounded-lg bg-raised border border-line space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] text-fg-subtle">{t("workspaceSettings.currentLabel")}</div>
            <div className="text-sm font-semibold text-fg truncate">
              {availability === "local"
                ? t("workspaceSettings.localName")
                : status?.name || t("workspaceSettings.unnamed")}
            </div>
            {status?.path && (
              <div className="text-[11px] font-mono text-fg-subtle truncate" title={status.path}>
                {status.path}
              </div>
            )}
          </div>
          <div className={`flex items-center gap-1.5 text-xs font-medium shrink-0 ${label.className}`}>
            {availability === "available" ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : availability === "local" ? (
              <HardDrive className="w-3.5 h-3.5" />
            ) : availability === "unavailable" ? (
              <CloudOff className="w-3.5 h-3.5" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5" />
            )}
            {label.text}
          </div>
        </div>

        {availability === "available" && (
          <div className="text-xs text-fg-muted">
            {loadState === "loading"
              ? t("workspaceSettings.loadingResources")
              : t("workspaceSettings.resourcesSummary", {
                  connections: connections.length,
                  queries: queries.length,
                })}
          </div>
        )}

        {availability !== "local" && availability !== "available" && (
          <div className="p-3 rounded-md border border-line text-xs text-warning space-y-2">
            <p>{status?.error || error}</p>
            <p className="text-warning/80">
              {t("workspaceSettings.unavailableNote")}
            </p>
            <div className="flex flex-wrap gap-2">
              <button className={secondaryBtn} disabled={busy} onClick={() => run(() => store().reload(), t("workspaceSettings.retryError"))}>
                <RefreshCw className="w-3.5 h-3.5" /> {t("workspaceSettings.retry")}
              </button>
              {availability !== "incompatible" && (
                <button className={secondaryBtn} disabled={busy} onClick={() => run(() => store().relocateWorkspace(), t("workspaceSettings.relocateError"))}>
                  <FolderSearch className="w-3.5 h-3.5" /> {t("workspaceSettings.relocate")}
                </button>
              )}
            </div>
          </div>
        )}

        {fileErrors.length > 0 && availability === "available" && (
          <details className="text-xs text-warning">
            <summary className="cursor-pointer">
              {t("workspaceSettings.unreadableFiles", { count: fileErrors.length })}
            </summary>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-fg-muted">
              {fileErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button className={secondaryBtn} disabled={busy} onClick={() => run(() => store().openWorkspace(), t("workspaceSettings.openError"))}>
            <FolderOpen className="w-3.5 h-3.5" /> {t("workspaceSettings.openWorkspace")}
          </button>
          {availability === "available" && (
            <button className={secondaryBtn} disabled={busy} onClick={() => run(() => store().reload(), t("workspaceSettings.reloadError"))}>
              <RefreshCw className="w-3.5 h-3.5" /> {t("workspaceSettings.reload")}
            </button>
          )}
          {availability === "available" && (
            <button
              className={secondaryBtn}
              disabled={busy}
              title={t("workspaceSettings.exportTooltip")}
              onClick={() =>
                run(async () => {
                  const files = await workspaceService.exportPackage();
                  if (files !== null) {
                    showAlert({
                      title: t("workspaceSettings.exportSuccessTitle"),
                      message: t("workspaceSettings.exportSuccessMessage", { files }),
                      variant: "info",
                      icon: "info",
                    });
                  }
                }, t("workspaceSettings.exportError"))
              }
            >
              <Package className="w-3.5 h-3.5" /> {t("workspaceSettings.exportButton")}
            </button>
          )}
          <button
            className={secondaryBtn}
            disabled={busy}
            title={t("workspaceSettings.importTooltip")}
            onClick={() => run(() => store().importPackage(), t("workspaceSettings.importError"))}
          >
            <PackageOpen className="w-3.5 h-3.5" /> {t("workspaceSettings.importButton")}
          </button>
          {availability !== "local" && (
            <button className={secondaryBtn} disabled={busy} onClick={useLocal}>
              <HardDrive className="w-3.5 h-3.5" /> {t("workspaceSettings.useLocalButton")}
            </button>
          )}
        </div>
      </div>

      <EnvVariablesEditor />

      {/* Create */}
      <div className="p-4 rounded-lg bg-raised border border-line space-y-3">
        <div className="text-xs font-semibold text-fg">{t("workspaceSettings.createTitle")}</div>
        <p className="text-xs text-fg-muted">
          {t("workspaceSettings.createDescription")}
        </p>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("workspaceSettings.namePlaceholder")}
            className="flex-1 px-3 py-1.5 text-xs bg-surface border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
          />
          <button className={primaryBtn} disabled={busy} onClick={createWorkspace}>
            <FolderPlus className="w-3.5 h-3.5" /> {t("workspaceSettings.createButton")}
          </button>
        </div>
      </div>

      {/* Migration */}
      {availability === "available" && hasLegacyData && (
        <div className="p-4 rounded-lg bg-raised border border-line space-y-2">
          <div className="text-xs font-semibold text-fg flex items-center gap-2">
            <Upload className="w-3.5 h-3.5 text-fg-muted" /> {t("workspaceSettings.migrationTitle")}
          </div>
          <p className="text-xs text-fg-muted">
            {wasMigrated(status?.workspaceId ?? null)
              ? t("workspaceSettings.migrationAlreadyDone")
              : t("workspaceSettings.migrationPending", {
                  connections: legacyConnections.length,
                  queries: legacyFavorites.length,
                })}
          </p>
          <button className={secondaryBtn} disabled={busy} onClick={confirmMigration}>
            <Upload className="w-3.5 h-3.5" /> {t("workspaceSettings.migrationButton")}
          </button>
          {lastReport && (
            <div className={`text-xs ${lastReport.verified ? "text-success" : "text-warning"}`}>
              {lastReport.verified ? t("workspaceSettings.reportVerified") : t("workspaceSettings.reportIncomplete")}
              {t("workspaceSettings.reportConnections", {
                written: lastReport.connectionsWritten,
                skipped: lastReport.connectionsSkipped,
              })}
              {t("workspaceSettings.reportQueries", {
                written: lastReport.queriesWritten,
                skipped: lastReport.queriesSkipped,
              })}
              {lastReport.conflicts.length > 0 &&
                t("workspaceSettings.reportConflicts", { list: lastReport.conflicts.join(", ") })}
              {lastReport.invalid.length > 0 &&
                t("workspaceSettings.reportInvalid", { list: lastReport.invalid.join("; ") })}
            </div>
          )}
        </div>
      )}

      {/* What is shared */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="p-3 rounded-lg bg-raised border border-line">
          <div className="font-semibold text-fg flex items-center gap-1.5 mb-1.5">
            <Share2 className="w-3.5 h-3.5 text-fg-muted" /> {t("workspaceSettings.sharedTitle")}
          </div>
          <ul className="text-fg-muted space-y-0.5 list-disc list-inside">
            <li>{t("workspaceSettings.sharedItem1")}</li>
            <li>{t("workspaceSettings.sharedItem2")}</li>
            <li>{t("workspaceSettings.sharedItem3")}</li>
          </ul>
        </div>
        <div className="p-3 rounded-lg bg-raised border border-line">
          <div className="font-semibold text-fg flex items-center gap-1.5 mb-1.5">
            <Lock className="w-3.5 h-3.5 text-success" /> {t("workspaceSettings.localOnlyTitle")}
          </div>
          <ul className="text-fg-muted space-y-0.5 list-disc list-inside">
            <li>{t("workspaceSettings.localOnlyItem1")}</li>
            <li>{t("workspaceSettings.localOnlyItem2")}</li>
            <li>{t("workspaceSettings.localOnlyItem3")}</li>
          </ul>
        </div>
      </div>
      <p className="text-[11px] text-fg-subtle">
        {t("workspaceSettings.syncFootnote")}
      </p>
    </div>
  );
};
