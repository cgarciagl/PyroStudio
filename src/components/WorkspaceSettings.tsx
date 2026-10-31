import React, { useState } from "react";
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

const AVAILABILITY_LABEL: Record<WorkspaceAvailability, { text: string; className: string }> = {
  local: { text: "Almacenamiento local de este equipo", className: "text-fg" },
  available: { text: "Disponible", className: "text-success" },
  unavailable: { text: "No disponible", className: "text-warning" },
  incompatible: { text: "Versión no compatible", className: "text-danger" },
  invalid: { text: "Espacio de trabajo no válido", className: "text-danger" },
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
  const { status, loadState, connections, queries, fileErrors, error } = useWorkspaceStore();
  const store = useWorkspaceStore.getState;
  const showAlert = useUIStore((s) => s.showAlert);
  const showConfirm = useUIStore((s) => s.showConfirm);
  const bumpProfilesVersion = useUIStore((s) => s.bumpProfilesVersion);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastReport, setLastReport] = useState<MigrationReport | null>(null);

  const availability = status?.availability ?? "local";
  const label = AVAILABILITY_LABEL[availability];
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
    }, "La importación no se completó");

  const confirmMigration = () =>
    showConfirm({
      title: "Importar datos locales al espacio de trabajo",
      message: `Se copiarán ${legacyConnections.length} conexiones y ${legacyFavorites.length} consultas guardadas a la carpeta del espacio de trabajo.`,
      details:
        "Las contraseñas y tokens NO se copian: permanecen en el almacén cifrado de este equipo. Los datos originales no se borran. Los elementos que ya existan con otro contenido no se sobrescriben y se informarán como conflicto. Puede repetir la importación con seguridad.",
      variant: "primary",
      icon: "info",
      confirmText: "Importar",
      onConfirm: () => void runMigration(),
    });

  const createWorkspace = () =>
    run(async () => {
      const created = await store().createWorkspace(newName);
      if (created && hasLegacyData) confirmMigration();
    }, "No se pudo crear el espacio de trabajo");

  const useLocal = () =>
    showConfirm({
      title: "Usar almacenamiento local",
      message:
        "PyroStudio volverá a usar las conexiones y consultas guardadas solo en este equipo. La carpeta del espacio de trabajo no se modifica ni se borra.",
      variant: "warning",
      icon: "alert",
      confirmText: "Usar almacenamiento local",
      onConfirm: () => void run(() => store().useLocalStorage(), "No se pudo cambiar el almacenamiento"),
    });

  const btn =
    "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors disabled:opacity-50";
  const primaryBtn = `${btn} bg-accent hover:bg-accent-hover border-accent text-accent-fg`;
  const secondaryBtn = `${btn} bg-raised hover:bg-hover border-line text-fg`;

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-fg-muted" /> Espacio de trabajo
        </h3>
        <p className="text-xs text-fg-muted mt-1">
          Guarde conexiones y consultas en una carpeta que puede sincronizar entre equipos (por
          ejemplo, una carpeta de Google Drive para escritorio).
        </p>
      </div>

      {/* Current workspace */}
      <div className="p-4 rounded-lg bg-raised border border-line space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] text-fg-subtle">Espacio de trabajo actual</div>
            <div className="text-sm font-semibold text-fg truncate">
              {availability === "local" ? "Local (este equipo)" : status?.name || "Sin nombre"}
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
              ? "Cargando recursos…"
              : `${connections.length} conexiones · ${queries.length} consultas guardadas`}
          </div>
        )}

        {availability !== "local" && availability !== "available" && (
          <div className="p-3 rounded-md border border-line text-xs text-warning space-y-2">
            <p>{status?.error || error}</p>
            <p className="text-warning/80">
              No se muestran listas vacías ni se guarda nada en otra ubicación. Si la carpeta se
              movió o la unidad de sincronización aún no está montada, localícela de nuevo o
              reintente.
            </p>
            <div className="flex flex-wrap gap-2">
              <button className={secondaryBtn} disabled={busy} onClick={() => run(() => store().reload(), "Error al reintentar")}>
                <RefreshCw className="w-3.5 h-3.5" /> Reintentar
              </button>
              {availability !== "incompatible" && (
                <button className={secondaryBtn} disabled={busy} onClick={() => run(() => store().relocateWorkspace(), "No se pudo localizar la carpeta")}>
                  <FolderSearch className="w-3.5 h-3.5" /> Localizar carpeta…
                </button>
              )}
            </div>
          </div>
        )}

        {fileErrors.length > 0 && availability === "available" && (
          <details className="text-xs text-warning">
            <summary className="cursor-pointer">
              {fileErrors.length} archivo(s) no se pudieron leer (no se han modificado)
            </summary>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-fg-muted">
              {fileErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button className={secondaryBtn} disabled={busy} onClick={() => run(() => store().openWorkspace(), "No se pudo abrir el espacio de trabajo")}>
            <FolderOpen className="w-3.5 h-3.5" /> Abrir workspace…
          </button>
          {availability === "available" && (
            <button className={secondaryBtn} disabled={busy} onClick={() => run(() => store().reload(), "No se pudo recargar")}>
              <RefreshCw className="w-3.5 h-3.5" /> Recargar desde disco
            </button>
          )}
          {availability === "available" && (
            <button
              className={secondaryBtn}
              disabled={busy}
              title="Paquete .pyrows con conexiones, consultas, carpetas y snippets; nunca incluye contraseñas"
              onClick={() =>
                run(async () => {
                  const files = await workspaceService.exportPackage();
                  if (files !== null) {
                    showAlert({
                      title: "Workspace exportado",
                      message: `Se empaquetaron ${files} archivo(s) sin contraseñas. Quien lo importe tendrá que escribir las credenciales en su equipo.`,
                      variant: "info",
                      icon: "info",
                    });
                  }
                }, "No se pudo exportar el workspace")
              }
            >
              <Package className="w-3.5 h-3.5" /> Exportar .pyrows…
            </button>
          )}
          <button
            className={secondaryBtn}
            disabled={busy}
            title="Elige un paquete .pyrows y una carpeta vacía donde crear el workspace"
            onClick={() => run(() => store().importPackage(), "No se pudo importar el workspace")}
          >
            <PackageOpen className="w-3.5 h-3.5" /> Importar .pyrows…
          </button>
          {availability !== "local" && (
            <button className={secondaryBtn} disabled={busy} onClick={useLocal}>
              <HardDrive className="w-3.5 h-3.5" /> Usar almacenamiento local
            </button>
          )}
        </div>
      </div>

      <EnvVariablesEditor />

      {/* Create */}
      <div className="p-4 rounded-lg bg-raised border border-line space-y-3">
        <div className="text-xs font-semibold text-fg">Crear espacio de trabajo nuevo</div>
        <p className="text-xs text-fg-muted">
          Elija una carpeta vacía (por ejemplo dentro de «Mi unidad» de Google Drive). Si ya
          contiene un espacio de trabajo, use «Abrir workspace».
        </p>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre visible (opcional)"
            className="flex-1 px-3 py-1.5 text-xs bg-surface border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
          />
          <button className={primaryBtn} disabled={busy} onClick={createWorkspace}>
            <FolderPlus className="w-3.5 h-3.5" /> Elegir carpeta y crear
          </button>
        </div>
      </div>

      {/* Migration */}
      {availability === "available" && hasLegacyData && (
        <div className="p-4 rounded-lg bg-raised border border-line space-y-2">
          <div className="text-xs font-semibold text-fg flex items-center gap-2">
            <Upload className="w-3.5 h-3.5 text-fg-muted" /> Importar datos locales existentes
          </div>
          <p className="text-xs text-fg-muted">
            {wasMigrated(status?.workspaceId ?? null)
              ? "Ya se importaron los datos locales a este espacio de trabajo. Repetir la importación es seguro: no duplica elementos."
              : `Hay ${legacyConnections.length} conexiones y ${legacyFavorites.length} consultas guardadas solo en este equipo.`}
          </p>
          <button className={secondaryBtn} disabled={busy} onClick={confirmMigration}>
            <Upload className="w-3.5 h-3.5" /> Importar al espacio de trabajo
          </button>
          {lastReport && (
            <div className={`text-xs ${lastReport.verified ? "text-success" : "text-warning"}`}>
              {lastReport.verified ? "Importación verificada. " : "Importación incompleta. "}
              Conexiones: {lastReport.connectionsWritten} nuevas, {lastReport.connectionsSkipped} ya existentes.
              Consultas: {lastReport.queriesWritten} nuevas, {lastReport.queriesSkipped} ya existentes.
              {lastReport.conflicts.length > 0 && ` Conflictos sin sobrescribir: ${lastReport.conflicts.join(", ")}.`}
              {lastReport.invalid.length > 0 && ` Datos no válidos: ${lastReport.invalid.join("; ")}.`}
            </div>
          )}
        </div>
      )}

      {/* What is shared */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="p-3 rounded-lg bg-raised border border-line">
          <div className="font-semibold text-fg flex items-center gap-1.5 mb-1.5">
            <Share2 className="w-3.5 h-3.5 text-fg-muted" /> Se comparte en la carpeta
          </div>
          <ul className="text-fg-muted space-y-0.5 list-disc list-inside">
            <li>Definiciones de conexión (host, puerto, usuario, TLS, SSH, túnel HTTP)</li>
            <li>Consultas guardadas como archivos .sql</li>
            <li>Nombre e identificador del espacio de trabajo</li>
          </ul>
        </div>
        <div className="p-3 rounded-lg bg-raised border border-line">
          <div className="font-semibold text-fg flex items-center gap-1.5 mb-1.5">
            <Lock className="w-3.5 h-3.5 text-success" /> Permanece en este equipo
          </div>
          <ul className="text-fg-muted space-y-0.5 list-disc list-inside">
            <li>Contraseñas, tokens y claves de IA (almacén cifrado local)</li>
            <li>Ruta de la carpeta del espacio de trabajo</li>
            <li>Historial, pestañas, preferencias y tema</li>
          </ul>
        </div>
      </div>
      <p className="text-[11px] text-fg-subtle">
        Al abrir el espacio de trabajo en otro equipo, las conexiones aparecen con «Credenciales pendientes
        en este equipo» hasta que introduzca la contraseña. La sincronización depende de su
        proveedor (p. ej. Google Drive); si dos equipos editan la misma consulta a la vez, PyroStudio
        detecta el cambio y le pregunta antes de sobrescribir.
      </p>
    </div>
  );
};
