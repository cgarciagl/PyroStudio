import {
  AlertCircle,
  Eye,
  EyeOff,
  ShieldCheck,
} from "lucide-react";
import { monoInput, labelCls, sectionTitle } from "./formConstants";
import type { ConnectionForm } from "./useConnectionForm";

/** Servidor, usuario, contraseña y base de datos. */
export function ServerSection({ isEditingExisting, host, setHost, port, setPort, user, setUser, password, setPassword, database, setDatabase, showPassword, setShowPassword, hasSavedPassword, workspaceActive, isSqlite, transport }: Pick<ConnectionForm, "isEditingExisting" | "host" | "setHost" | "port" | "setPort" | "user" | "setUser" | "password" | "setPassword" | "database" | "setDatabase" | "showPassword" | "setShowPassword" | "hasSavedPassword" | "workspaceActive" | "isSqlite" | "transport">) {
  return (
    <>
    {!isSqlite && (
    <section className="space-y-3">
      <div className={sectionTitle}>
        {transport === "http" ? "Servidor de base de datos (visto desde el túnel)" : "Servidor"}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1">
          <label className={labelCls}>Host</label>
          <input
            type="text"
            required
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="127.0.0.1"
            className={monoInput}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Puerto</label>
          <input
            type="number"
            required
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value, 10) || 3306)}
            className={monoInput}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={labelCls}>Usuario</label>
          <input
            type="text"
            required
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="root"
            className={monoInput}
          />
        </div>
        <div className="space-y-1">
          <label className={`${labelCls} flex items-center justify-between gap-2`}>
            <span className="flex items-center gap-1.5 min-w-0">
              <span>Contraseña</span>
              {hasSavedPassword && !password && (
                <span className="flex items-center gap-0.5 text-[11px] font-normal" title="Guardada en el almacén cifrado AES-256">
                  <ShieldCheck className="w-3 h-3 text-success" /> guardada
                </span>
              )}
              {!hasSavedPassword && !password && isEditingExisting && (
                <span
                  className="flex items-center gap-0.5 text-[11px] font-normal truncate"
                  title={
                    workspaceActive
                      ? "La conexión viene del espacio de trabajo compartido; la contraseña se guarda solo en este equipo."
                      : "No hay contraseña guardada para esta conexión en este equipo."
                  }
                >
                  <AlertCircle className="w-3 h-3 text-warning shrink-0" />{" "}
                  {workspaceActive ? "pendiente en este equipo" : "sin guardar"}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-fg-muted hover:text-fg"
              title={showPassword ? "Ocultar" : "Mostrar"}
            >
              {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </label>
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={hasSavedPassword ? "•••••••• (sin cambios)" : "••••••••"}
            className={monoInput}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className={labelCls}>
          Base de datos inicial <span className="font-normal">(opcional)</span>
        </label>
        <input
          type="text"
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          placeholder="Vacío para explorar todas"
          className={monoInput}
        />
      </div>
    </section>
    )}
    </>
  );
}
