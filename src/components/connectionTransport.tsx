import React from "react";
import { Globe, KeyRound, Server } from "lucide-react";
import type { SavedConnection } from "../types/database";

export type ConnectionTransport = "direct" | "http" | "ssh";

export const connectionTransport = (p: SavedConnection): ConnectionTransport =>
  p.tunnel?.enabled ? "http" : p.ssh_tunnel?.enabled ? "ssh" : "direct";

const urlHost = (url: string | undefined): string => {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** One-line address: where the client actually connects to, then the DB endpoint. */
export const connectionAddress = (p: SavedConnection): string => {
  const db = `${p.user}@${p.host}:${p.port}`;
  switch (connectionTransport(p)) {
    case "http":
      return `${urlHost(p.tunnel?.url)} → ${db}`;
    case "ssh":
      return `${p.ssh_tunnel?.ssh_user}@${p.ssh_tunnel?.ssh_host} → ${db}`;
    default:
      return db;
  }
};

const TRANSPORT_META: Record<ConnectionTransport, { label: string; title: string; Icon: typeof Globe }> = {
  direct: { label: "Directa", title: "Conexión TCP directa", Icon: Server },
  http: { label: "Túnel HTTP", title: "Conexión por túnel HTTP (pyro_tunnel.php)", Icon: Globe },
  ssh: { label: "SSH", title: "Conexión reenviada por túnel SSH", Icon: KeyRound },
};

export const TransportIcon: React.FC<{ connection: SavedConnection; className?: string }> = ({
  connection,
  className = "w-3.5 h-3.5",
}) => {
  const { Icon, title } = TRANSPORT_META[connectionTransport(connection)];
  return (
    <span title={title} className="shrink-0 text-fg-muted inline-flex">
      <Icon className={className} />
    </span>
  );
};

/** Outlined chip shown only for tunnelled connections; direct ones stay unmarked. */
export const TransportBadge: React.FC<{ connection: SavedConnection }> = ({ connection }) => {
  const transport = connectionTransport(connection);
  if (transport === "direct") return null;
  const { Icon, label, title } = TRANSPORT_META[transport];
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 shrink-0 px-1.5 py-px rounded border border-line-strong text-[11px] font-medium text-fg leading-none"
    >
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
};
