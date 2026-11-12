import type { EnvironmentTag } from "../../types/database";
import {
  AlertCircle,
} from "lucide-react";
import { inputCls, labelCls } from "./formConstants";
import { folderNames } from "../../utils/connectionFolders";
import type { ConnectionForm } from "./useConnectionForm";

/** Nombre, entorno, carpeta y modo de solo lectura. */
export function GeneralSection({ savedProfiles, profileName, setProfileName, environment, setEnvironment, readOnly, setReadOnly, folder, setFolder }: Pick<ConnectionForm, "savedProfiles" | "profileName" | "setProfileName" | "environment" | "setEnvironment" | "readOnly" | "setReadOnly" | "folder" | "setFolder">) {
  return (
    <>
    <section className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1">
          <label className={labelCls}>Nombre</label>
          <input
            type="text"
            required
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="p. ej. MariaDB Producción"
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Ambiente</label>
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as EnvironmentTag)}
            className={inputCls}
          >
            <option value="local">Local</option>
            <option value="development">Desarrollo</option>
            <option value="staging">Staging</option>
            <option value="production">Producción</option>
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className={labelCls}>Carpeta</label>
        <input
          type="text"
          list="connection-folders"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="Sin carpeta"
          className={inputCls}
        />
        <datalist id="connection-folders">
          {folderNames(savedProfiles).map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </div>

      <label className="flex items-start gap-2 text-xs text-fg cursor-pointer">
        <input
          type="checkbox"
          checked={readOnly}
          onChange={(e) => setReadOnly(e.target.checked)}
          className="mt-0.5 rounded border-line-strong text-accent-text focus:ring-0 bg-raised"
        />
        <span>
          Solo lectura
          <span className="block text-[11px] text-fg-muted">
            Bloquea cualquier escritura (INSERT, UPDATE, DELETE, DDL, edición en el grid).
            Recomendado para producción.
          </span>
        </span>
      </label>

      {environment === "production" && (
        <div className="flex items-start gap-2 text-[11px] text-fg-muted leading-relaxed">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-danger shrink-0" />
          <span>
            Producción: las consultas destructivas y modificaciones masivas pedirán
            confirmación explícita.
          </span>
        </div>
      )}
    </section>
    </>
  );
}
