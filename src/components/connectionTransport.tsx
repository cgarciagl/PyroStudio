import React from "react";
import { Globe, KeyRound, Server } from "lucide-react";
import { useConnectionStore } from "../stores/connectionStore";
import { useManualTxStore } from "../stores/manualTxStore";
import { useUIStore } from "../stores/uiStore";
import { connectionEngine, type ConnectionConfig, type ConnectionInfo, type SavedConnection } from "../types/database";
import { errorText } from "../utils/errors";

export type ConnectionTransport = "direct" | "http" | "ssh";

export const connectionTransport = (p: SavedConnection): ConnectionTransport =>
  p.tunnel?.enabled ? "http" : p.ssh_tunnel?.enabled ? "ssh" : "direct";

/**
 * A connection can flip between direct and HTTP tunnel when it keeps a tunnel
 * URL configured (enabled or not). SSH-forwarded connections are left alone:
 * HTTP and SSH tunnels are mutually exclusive.
 */
export const canToggleHttpTunnel = (p: SavedConnection): boolean =>
  !!p.tunnel?.url?.trim() && !p.ssh_tunnel?.enabled;

/** Same connection with the HTTP tunnel switched on/off; the tunnel settings are kept. */
export const withHttpTunnelToggled = (p: SavedConnection): SavedConnection =>
  p.tunnel ? { ...p, tunnel: { ...p.tunnel, enabled: !p.tunnel.enabled } } : p;

/** The query editor's own time limit fired (message built in QueryEditorTab). */
export const isClientTimeoutError = (message: string | null | undefined): boolean =>
  !!message && message.startsWith("Tiempo de espera excedido");

type LiveConfig = ConnectionConfig | ConnectionInfo | undefined;

/** The active config when it carries an HTTP tunnel URL and no SSH tunnel. */
export const liveTunnelConfig = (cfg: LiveConfig): ConnectionConfig | ConnectionInfo | null =>
  cfg && cfg.tunnel?.url?.trim() && !cfg.ssh_tunnel?.enabled ? cfg : null;

/** A live session can switch transport when its config carries a tunnel URL and no SSH tunnel. */
export const canSwitchLiveTunnel = (cfg: LiveConfig): boolean => liveTunnelConfig(cfg) !== null;

/**
 * Errors where the HTTP tunnel gave up waiting (client timeout or a gateway/proxy
 * timeout status), so the same query may still finish over a direct connection.
 */
export const isTunnelTimeoutError = (message: string | null | undefined): boolean =>
  !!message &&
  (/Tiempo agotado en la solicitud HTTP del túnel/i.test(message) ||
    /servidor del túnel respondió con HTTP (408|502|503|504|522|524)\b/i.test(message) ||
    /Maximum execution time/i.test(message));

/**
 * Switches the live session between HTTP tunnel and direct connection.
 * Refuses while an editor tab holds uncommitted manual-transaction statements
 * (reconnecting would roll them back). Returns true when the switch succeeded.
 */
export async function switchLiveTransport(): Promise<boolean> {
  const pending = Object.values(useManualTxStore.getState().pendingByTab).reduce((a, b) => a + b, 0);
  const ui = useUIStore.getState();
  if (pending > 0) {
    ui.showAlert({
      title: "Transacción pendiente",
      message: `Hay ${pending} sentencia(s) sin confirmar en modo transacción manual. Haz COMMIT o ROLLBACK antes de cambiar de conexión.`,
      variant: "warning",
    });
    return false;
  }
  const toDirect = !!liveTunnelConfig(useConnectionStore.getState().connectionStatus.config)?.tunnel?.enabled;
  try {
    await useConnectionStore.getState().switchHttpTunnel();
    return true;
  } catch (err) {
    ui.showAlert({
      title: toDirect ? "No se pudo conectar directamente" : "No se pudo conectar por el túnel",
      message: `${errorText(err)}\n\nLa conexión actual sigue activa.`,
      variant: "danger",
    });
    return false;
  }
}

const urlHost = (url: string | undefined): string => {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Last component of a file path, for both `/` and `\` separators. */
export const fileName = (path: string | undefined): string =>
  (path ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";

/** One-line address: where the client actually connects to, then the DB endpoint. */
export const connectionAddress = (p: SavedConnection): string => {
  const db =
    connectionEngine(p) === "sqlite" ? p.filePath || "" : `${p.user}@${p.host}:${p.port}`;
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
