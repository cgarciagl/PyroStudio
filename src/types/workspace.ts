// Contracts for the Rust `workspace` module (src-tauri/src/workspace/models.rs).

export type WorkspaceAvailability =
  | "local"
  | "available"
  | "unavailable"
  | "incompatible"
  | "invalid";

export interface WorkspaceStatus {
  availability: WorkspaceAvailability;
  workspaceId: string | null;
  name: string | null;
  path: string | null;
  formatVersion: number | null;
  error: string | null;
}

export interface WorkspaceQuery {
  id: string;
  title: string;
  category: string;
  sql: string;
  description?: string | null;
  connectionId?: string | null;
  database?: string | null;
  createdAt: number;
  updatedAt: number;
  relPath: string;
  contentHash: string;
  hasHeader: boolean;
}

export interface SaveQueryInput {
  id?: string;
  title: string;
  category: string;
  sql: string;
  description?: string;
  connectionId?: string;
  database?: string;
  createdAt?: number;
  updatedAt?: number;
  expectedHash?: string;
  force?: boolean;
}

export interface ConnectionListing<T> {
  connections: T[];
  errors: string[];
}

export interface QueryListing {
  queries: WorkspaceQuery[];
  errors: string[];
}

export interface MigrationReport {
  connectionsWritten: number;
  connectionsSkipped: number;
  queriesWritten: number;
  queriesSkipped: number;
  conflicts: string[];
  invalid: string[];
  verified: boolean;
}

export type WorkspaceErrorCode =
  | "WS_NO_ACTIVE"
  | "WS_UNAVAILABLE"
  | "WS_INVALID_MANIFEST"
  | "WS_INCOMPATIBLE"
  | "WS_ALREADY_EXISTS"
  | "WS_NOT_A_WORKSPACE"
  | "WS_INVALID_ID"
  | "WS_PATH_ESCAPE"
  | "WS_NOT_FOUND"
  | "WS_CONFLICT"
  | "WS_DUPLICATE"
  | "WS_INVALID_DATA"
  | "WS_IO"
  | "UNKNOWN";
