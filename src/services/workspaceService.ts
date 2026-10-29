import { invoke } from "@tauri-apps/api/core";
import { databaseCredentialId, type SavedConnection, type SqlFavorite } from "../types/database";
import type {
  ConnectionListing,
  MigrationReport,
  QueryListing,
  SaveQueryInput,
  WorkspaceErrorCode,
  WorkspaceQuery,
  WorkspaceStatus,
} from "../types/workspace";

/** Error raised by workspace commands; `code` comes from the Rust `[CODE] message` format. */
export class WorkspaceError extends Error {
  constructor(public code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export function toWorkspaceError(e: unknown): WorkspaceError {
  if (e instanceof WorkspaceError) return e;
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  const match = /^\[(WS_[A-Z_]+)\]\s*(.*)$/s.exec(raw);
  return match
    ? new WorkspaceError(match[1] as WorkspaceErrorCode, match[2])
    : new WorkspaceError("UNKNOWN", raw);
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toWorkspaceError(e);
  }
}

/**
 * Explicit safe serialization of a connection for the shared folder.
 * Rust re-applies an equivalent filter (defense in depth); this one drops the
 * known secret and machine-local fields of `SavedConnection`.
 */
export function toSharedConnection(conn: SavedConnection): Record<string, unknown> {
  const { password: _pw, lastConnectedAt: _last, ...rest } = conn;
  const shared: Record<string, unknown> = {
    ...rest,
    credentialId: databaseCredentialId(conn),
  };
  if (conn.tunnel) {
    const { http_password: _hp, auth_token: _tok, ...tunnel } = conn.tunnel;
    shared.tunnel = {
      ...tunnel,
      tunnel_credential_id: tunnel.tunnel_credential_id || `tunnel-cred-${conn.id}`,
      token_credential_id: tunnel.token_credential_id || `tunnel-token-cred-${conn.id}`,
    };
  }
  return shared;
}

export function queryToFavorite(q: WorkspaceQuery): SqlFavorite {
  return {
    id: q.id,
    title: q.title,
    category: q.category,
    sql: q.sql,
    description: q.description ?? undefined,
    connectionId: q.connectionId ?? undefined,
    database: q.database ?? undefined,
    folder: q.folder ?? undefined,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

export const workspaceService = {
  getStatus: () => call<WorkspaceStatus>("workspace_get_status"),
  /** Each `*Dialog` resolves `null` when the user cancels the folder picker. */
  createDialog: (name: string) => call<WorkspaceStatus | null>("workspace_create_dialog", { name }),
  openDialog: () => call<WorkspaceStatus | null>("workspace_open_dialog"),
  relocateDialog: () => call<WorkspaceStatus | null>("workspace_relocate_dialog"),
  useLocal: () => call<WorkspaceStatus>("workspace_use_local"),

  listConnections: () =>
    call<ConnectionListing<SavedConnection>>("workspace_list_connections"),
  saveConnection: (conn: SavedConnection) =>
    call<SavedConnection>("workspace_save_connection", { connection: toSharedConnection(conn) }),
  deleteConnection: (id: string) => call<void>("workspace_delete_connection", { id }),

  listQueries: () => call<QueryListing>("workspace_list_queries"),
  readQuery: (id: string) => call<WorkspaceQuery>("workspace_read_query", { id }),
  saveQuery: (query: SaveQueryInput) => call<WorkspaceQuery>("workspace_save_query", { query }),
  deleteQuery: (id: string, expectedHash?: string) =>
    call<void>("workspace_delete_query", { id, expectedHash: expectedHash ?? null }),

  importLegacy: (connections: SavedConnection[], favorites: SqlFavorite[]) =>
    call<MigrationReport>("workspace_import_legacy", {
      data: {
        connections: connections.map(toSharedConnection),
        queries: favorites.map((f) => ({
          id: f.id,
          title: f.title,
          category: f.category,
          sql: f.sql,
          description: f.description,
          connectionId: f.connectionId,
          database: f.database,
          folder: f.folder,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
        })),
      },
    }),
};
