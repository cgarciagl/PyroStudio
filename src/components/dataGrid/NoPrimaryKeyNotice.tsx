import React from "react";
import { AlertTriangle, Settings } from "lucide-react";
import { useUIStore } from "../../stores/uiStore";

/** Banner for tables without a primary key, reflecting the configured mode. */
export const NoPrimaryKeyNotice: React.FC<{ noPrimaryKeyMode: string }> = ({ noPrimaryKeyMode }) => (
  <div className="px-4 py-1.5 bg-raised border-b border-line text-xs flex items-center justify-between gap-3 shrink-0 animate-in fade-in duration-150">
    <div className="flex items-center space-x-2 min-w-0">
      <AlertTriangle
        className={`w-3.5 h-3.5 shrink-0 ${
          noPrimaryKeyMode === "use_all_columns" ? "text-warning" : "text-danger"
        }`}
      />
      <span className="text-fg text-[11px] truncate">
        <strong
          className={
            noPrimaryKeyMode === "use_all_columns"
              ? "text-warning font-semibold"
              : "text-danger font-semibold"
          }
        >
          Tabla sin clave primaria:
        </strong>{" "}
        {noPrimaryKeyMode === "use_all_columns"
          ? "Identificación por fila completa activa para edición y borrado."
          : "Edición y borrado bloqueados por seguridad."}
      </span>
    </div>

    <button
      type="button"
      onClick={() => useUIStore.getState().openSettingsModal("database")}
      title="Cambiar comportamiento de tablas sin clave primaria en Configuración"
      className="flex items-center space-x-1.5 px-2.5 py-1 rounded text-[11px] text-fg hover:text-fg bg-raised hover:bg-hover border border-line-strong transition-colors shrink-0 font-medium"
    >
      <Settings className="w-3 h-3 text-fg-muted" />
      <span>Configurar</span>
    </button>
  </div>
);
