import type {
  ConnectionConfig,
  DbEngine,
  EnvironmentTag,
  HttpTunnelConfig,
  SavedConnection,
  SshTunnelConfig,
  TlsConfig,
} from "../../types/database";
import { normalizeFolder } from "../../utils/connectionFolders";

/**
 * What the connection form holds, independent of React state. Saving, connecting and
 * testing used to rebuild the profile, the tunnel and the secrets by hand three times;
 * they now share these pure builders.
 */
export interface ConnectionDraft {
  id: string;
  name: string;
  engine: DbEngine;
  filePath?: string;
  host: string;
  port: number;
  user: string;
  /** Typed in this session (empty: use the saved one). */
  password: string;
  hasSavedPassword: boolean;
  database: string;
  environment: EnvironmentTag;
  readOnly: boolean;
  folder: string;
  useTunnel: boolean;
  /** The profile had a tunnel before (kept, disabled, when the user turns it off). */
  hadTunnelConfig: boolean;
  tunnelUrl: string;
  tunnelUser: string;
  tunnelPassword: string;
  tunnelToken: string;
  tunnelEncodeBase64: boolean;
  tunnelTimeoutSec: number;
  tls?: TlsConfig;
  ssh?: SshTunnelConfig;
  ids: CredentialIds;
  /** Creation time of an existing profile (kept on save). */
  createdAt?: number;
}

export interface CredentialIds {
  /** Undefined for SQLite: files have no database password. */
  database?: string;
  tunnel: string;
  token: string;
}

export const clampTunnelTimeout = (sec: number) => Math.min(120, Math.max(1, Math.round(sec) || 30));

/** Vault ids of a profile's secrets (existing ids are reused). */
export function credentialIdsFor(
  id: string,
  isSqlite: boolean,
  current: { database?: string | null; tunnel?: string | null; token?: string | null },
): CredentialIds {
  return {
    database: isSqlite ? undefined : current.database || `cred-${id}`,
    tunnel: current.tunnel || `tunnel-cred-${id}`,
    token: current.token || `tunnel-token-cred-${id}`,
  };
}

/** Tunnel as stored in the profile: never the secrets, only their vault ids. */
function storedTunnel(d: ConnectionDraft): HttpTunnelConfig | undefined {
  if (!((d.useTunnel || d.hadTunnelConfig) && d.tunnelUrl.trim())) return undefined;
  return {
    enabled: d.useTunnel,
    url: d.tunnelUrl.trim(),
    http_user: d.tunnelUser.trim() || undefined,
    tunnel_credential_id: d.ids.tunnel,
    token_credential_id: d.ids.token,
    encode_base64: d.tunnelEncodeBase64,
    timeout_seconds: clampTunnelTimeout(d.tunnelTimeoutSec),
  };
}

/** Saved profile for the connection list (no passwords). */
export function buildProfile(d: ConnectionDraft, defaultName: string, now = Date.now()): SavedConnection {
  const isSqlite = d.engine === "sqlite";
  return {
    id: d.id,
    name: d.name.trim() || defaultName,
    engine: d.engine,
    filePath: isSqlite ? d.filePath : undefined,
    host: d.host,
    port: d.port,
    user: d.user,
    credentialId: d.ids.database,
    database: d.database.trim() || undefined,
    environment: d.environment,
    readOnly: d.readOnly || undefined,
    folder: normalizeFolder(d.folder) ?? undefined,
    tunnel: storedTunnel(d),
    tls: d.tls,
    ssh_tunnel: d.ssh,
    // Editing or connecting used to reset the creation date.
    createdAt: d.createdAt ?? now,
  };
}

/**
 * Configuration sent to the backend: typed secrets travel once, otherwise the vault ids.
 * A test only uses the tunnel when it is on; a real connect also keeps a disabled one.
 */
export function buildConnectConfig(d: ConnectionDraft, purpose: "connect" | "test"): ConnectionConfig {
  const isSqlite = d.engine === "sqlite";
  const tunnelActive = purpose === "test" ? d.useTunnel : (d.useTunnel || d.hadTunnelConfig) && !!d.tunnelUrl.trim();
  return {
    engine: d.engine,
    file_path: isSqlite ? d.filePath : undefined,
    host: d.host,
    port: d.port,
    user: d.user,
    password: d.password || undefined,
    credential_id: !d.password ? d.ids.database : undefined,
    database: d.database.trim() || undefined,
    environment: d.environment,
    read_only: d.readOnly || undefined,
    tunnel: tunnelActive
      ? {
          enabled: purpose === "test" ? true : d.useTunnel,
          url: d.tunnelUrl.trim(),
          http_user: d.tunnelUser.trim() || undefined,
          http_password: d.tunnelPassword || undefined,
          auth_token: d.tunnelToken || undefined,
          tunnel_credential_id: !d.tunnelPassword ? d.ids.tunnel : undefined,
          token_credential_id: !d.tunnelToken ? d.ids.token : undefined,
          encode_base64: d.tunnelEncodeBase64,
          timeout_seconds: clampTunnelTimeout(d.tunnelTimeoutSec),
        }
      : undefined,
    tls: d.tls,
    ssh_tunnel: d.ssh,
    savedConnectionId: d.id,
    savedConnectionName: d.name,
  };
}

export interface SavedSecrets {
  password: boolean;
  tunnelPassword: boolean;
  tunnelToken: boolean;
}

type SaveCredential = (id: string, secret: string) => Promise<unknown>;
type OnSecretError = (title: string, err: unknown) => void;

/**
 * Store the secrets typed in the form. Reports each failure (a password that silently
 * failed to save made later connections fail with no explanation) and returns which
 * ones are stored — only those, not the ones that failed.
 */
export async function saveSecrets(d: ConnectionDraft, save: SaveCredential, onError: OnSecretError): Promise<SavedSecrets> {
  const attempt = async (id: string | undefined, secret: string, title: string) => {
    if (!secret || !id) return false;
    try {
      await save(id, secret);
      return true;
    } catch (err) {
      onError(title, err);
      return false;
    }
  };
  return {
    password: await attempt(d.ids.database, d.password, "No se guardó la contraseña"),
    tunnelPassword: await attempt(d.ids.tunnel, d.tunnelPassword, "No se guardó la contraseña del túnel"),
    tunnelToken: await attempt(d.ids.token, d.tunnelToken, "No se guardó el token del túnel"),
  };
}
