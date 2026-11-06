import React from "react";
import { Database, Server } from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";
import type { ConnectionConfig, ConnectionInfo } from "../../types/database";

interface DatabaseScopeBarProps {
  /** Base de datos sobre la que opera la herramienta. */
  database: string;
  /** Nombre de la herramienta (p. ej. «Asesor de índices»). */
  tool: string;
  /** Ámbito adicional, p. ej. una tabla concreta. */
  scope?: string;
  /** Acciones alineadas a la derecha. */
  children?: React.ReactNode;
  /** Atributos data-* adicionales para el CSS de cada vista. */
  [dataAttr: `data-${string}`]: string | boolean | undefined;
}

function describeConnection(config?: ConnectionConfig | ConnectionInfo) {
  if (!config) return { label: "Sin conexión", environment: undefined };
  const c = config as ConnectionConfig & ConnectionInfo;
  const name = c.savedConnectionName || c.saved_connection_name;
  const user = c.user || c.username;
  const endpoint = c.file_path || `${user ? `${user}@` : ""}${c.host}:${c.port}`;
  return { label: name ? `${name} · ${endpoint}` : endpoint, environment: c.environment };
}

/**
 * Barra de contexto que deja inequívoco sobre qué conexión y base de datos
 * opera una herramienta de diagnóstico.
 */
export const DatabaseScopeBar: React.FC<DatabaseScopeBarProps> = ({ database, tool, scope, children, ...dataAttrs }) => {
  const { connectionStatus } = useConnectionStore();
  const { label, environment } = describeConnection(
    connectionStatus.connection_info || connectionStatus.config,
  );
  const isProd = environment === "production";

  return (
    <div
      {...dataAttrs}
      data-database-scope
      data-environment={environment || "none"}
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl border-l-4 border border-line bg-surface shrink-0 ${
        isProd ? "border-l-danger" : "border-l-accent"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center text-accent-text shrink-0">
          <Database className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-fg-muted">{tool} · operando sobre la base de datos</div>
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-lg font-semibold text-fg font-mono truncate" title={database}>
              {database}
            </h2>
            {scope && (
              <span className="text-xs text-fg-muted font-mono truncate" title={scope}>
                / {scope}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle font-mono min-w-0">
            <Server className="w-3 h-3 shrink-0" />
            <span className="truncate" title={label}>{label}</span>
            {environment && (
              <span className={`flex items-center gap-1 ${isProd ? "text-danger font-semibold" : ""}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isProd ? "bg-danger" : "bg-fg-subtle"}`} />
                {environment}
              </span>
            )}
          </div>
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
};
