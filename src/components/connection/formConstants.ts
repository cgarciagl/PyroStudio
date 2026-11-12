import { FileText, Globe, KeyRound, Server } from "lucide-react";
import type { DbEngine, EnvironmentTag } from "../../types/database";

/** Shared look and options of the connection form sections. */
export const ENGINE_OPTIONS: { id: DbEngine; label: string; Icon: typeof Server }[] = [
  { id: "mysql", label: "MariaDB / MySQL", Icon: Server },
  { id: "sqlite", label: "SQLite", Icon: FileText },
];

export const DEFAULT_TUNNEL_URL: Record<DbEngine, string> = {
  mysql: "http://localhost/tunnel/pyro_tunnel.php",
  sqlite: "http://localhost/tunnel/pyro_tunnel_sqlite.php",
};

export const ENV_DOTS: Record<EnvironmentTag, { dot: string; label: string }> = {
  local: { dot: "bg-emerald-500", label: "Local" },
  development: { dot: "bg-sky-500", label: "Desarrollo" },
  staging: { dot: "bg-amber-500", label: "Staging" },
  production: { dot: "bg-rose-500", label: "Producción" },
};

export const inputCls =
  "w-full px-2.5 py-1.5 text-xs bg-canvas border border-line rounded-md text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent transition-colors";
export const monoInput = `${inputCls} font-mono`;
export const labelCls = "text-[11px] font-medium text-fg-muted";
export const sectionTitle = "text-[11px] font-medium text-fg-muted";

export type Transport = "direct" | "http" | "ssh";

/** Ways to reach the database, per engine. */
export function transportOptions(isSqlite: boolean) {
  return isSqlite
  ? [
      { id: "direct" as const, label: "Archivo local", Icon: FileText, hint: "Archivo SQLite en este equipo." },
      {
        id: "http" as const,
        label: "Túnel HTTP",
        Icon: Globe,
        hint: "A través del script pyro_tunnel_sqlite.php alojado en el servidor web, que abre el archivo en el servidor.",
      },
    ]
  : [
      { id: "direct" as const, label: "Directa", Icon: Server, hint: "TCP directo al servidor MariaDB/MySQL." },
      {
        id: "http" as const,
        label: "Túnel HTTP",
        Icon: Globe,
        hint: "A través del script pyro_tunnel.php alojado en el servidor web. Host y puerto se resuelven desde el servidor.",
      },
      { id: "ssh" as const, label: "Túnel SSH", Icon: KeyRound, hint: "Reenvío mediante OpenSSH del sistema." },
    ];
}
