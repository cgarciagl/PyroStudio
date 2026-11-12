import {
  Plus,
  Trash2,
  Copy,
  Clock,
  Search,
  Folder,
} from "lucide-react";
import { iconBtn } from "../ui/styles";
import { ENV_DOTS, inputCls } from "./formConstants";
import { TransportBadge, TransportIcon, connectionAddress } from "../connectionTransport";
import { folderNames, groupByFolder } from "../../utils/connectionFolders";
import { MissingPasswordIcon } from "../missingCredential";
import type { ConnectionForm } from "./useConnectionForm";

/** Lista de conexiones guardadas, agrupadas por carpeta, con búsqueda. */
export function ProfileList({ selectedProfileId, searchFilter, setSearchFilter, selectProfile, resetFormToNew, handleDeleteProfile, handleDuplicateProfile, missingCredentials, filteredProfiles, formatLastConnected }: Pick<ConnectionForm, "selectedProfileId" | "searchFilter" | "setSearchFilter" | "selectProfile" | "resetFormToNew" | "handleDeleteProfile" | "handleDuplicateProfile" | "missingCredentials" | "filteredProfiles" | "formatLastConnected">) {
  return (
    <>
    <div className="w-72 bg-canvas border-r border-line flex flex-col h-full select-none">
      <div className="p-2.5 border-b border-line flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-fg-muted absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar…"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className={`${inputCls} pl-7 bg-surface`}
          />
        </div>
        <button type="button" onClick={resetFormToNew} className={iconBtn} title="Nueva conexión">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {filteredProfiles.length === 0 ? (
          <div className="text-center py-8 px-3 text-xs text-fg-muted">
            {searchFilter ? "Sin coincidencias." : "No hay conexiones guardadas."}
          </div>
        ) : (
          groupByFolder(filteredProfiles).map((group) => (
            <div key={group.folder ?? "__none__"} className="mb-1">
              {(group.folder !== null || folderNames(filteredProfiles).length > 0) && (
                <div className="px-2 pt-2 pb-1 flex items-center gap-1.5 text-[11px] text-fg-muted">
                  <Folder className="w-3 h-3" />
                  <span className="truncate font-medium">{group.folder ?? "Sin carpeta"}</span>
                  <span className="ml-auto">{group.connections.length}</span>
                </div>
              )}
              {group.connections.map((p) => {
                const isSelected = selectedProfileId === p.id;
                const env = p.environment || "local";

                return (
                  <div
                    key={p.id}
                    onClick={() => selectProfile(p)}
                    className={`group relative px-2.5 py-2 rounded-md cursor-pointer transition-colors border-l-2 ${
                      isSelected ? "bg-hover border-accent" : "border-transparent hover:bg-hover"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${ENV_DOTS[env].dot}`}
                        title={ENV_DOTS[env].label}
                      />
                      <span className="font-medium text-xs text-fg truncate">{p.name}</span>
                      {env === "production" && (
                        <span className="text-[11px] text-danger font-semibold">PROD</span>
                      )}
                      {missingCredentials.has(p.id) && <MissingPasswordIcon />}
                      <span className="ml-auto flex items-center">
                        <span className="group-hover:hidden">
                          <TransportBadge connection={p} />
                        </span>
                        <span className="hidden group-hover:flex items-center">
                          <button
                            type="button"
                            title="Duplicar"
                            onClick={(e) => handleDuplicateProfile(p.id, e)}
                            className="p-1 rounded text-fg-muted hover:text-fg hover:bg-surface"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            title="Eliminar"
                            onClick={(e) => handleDeleteProfile(p.id, p.name, e)}
                            className="p-1 rounded text-fg-muted hover:text-danger hover:bg-surface"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </span>
                      </span>
                    </div>
                    <div className="mt-0.5 pl-3 flex items-center gap-1.5 text-[11px] text-fg-muted font-mono min-w-0">
                      <TransportIcon connection={p} className="w-3 h-3" />
                      <span className="truncate" title={p.tunnel?.enabled ? p.tunnel.url : undefined}>
                        {connectionAddress(p)}
                      </span>
                    </div>
                    {p.lastConnectedAt && (
                      <div className="pl-3 mt-0.5 flex items-center gap-1 text-[11px] text-fg-muted/80">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{formatLastConnected(p.lastConnectedAt)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
    </>
  );
}
