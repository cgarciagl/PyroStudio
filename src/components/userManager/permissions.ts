import type {
  AccountAttributes,
  PrivilegeScope,
  RoleRef,
  ScopeGrant,
  UserChangeRequest,
  UserPermissions,
} from "../../types/database";

/**
 * Pure model of the user manager: privilege catalogue per scope and the edits
 * the matrix makes on the draft grants. The backend (`user.rs`) owns the SQL;
 * this file only shapes the desired state that is sent to it.
 */

export const ALL_PRIVILEGES = "ALL PRIVILEGES";

export type ScopeKind = PrivilegeScope["kind"];

export interface PrivilegeCategory {
  id: "admin" | "ddl" | "dml";
  label: string;
  privileges: { name: string; scopes: ScopeKind[] }[];
}

const G: ScopeKind[] = ["global"];
const GD: ScopeKind[] = ["global", "database"];
const ALL: ScopeKind[] = ["global", "database", "table"];

export const PRIVILEGE_CATEGORIES: readonly PrivilegeCategory[] = [
  {
    id: "dml",
    label: "Datos (DML)",
    privileges: [
      { name: "SELECT", scopes: ALL },
      { name: "INSERT", scopes: ALL },
      { name: "UPDATE", scopes: ALL },
      { name: "DELETE", scopes: ALL },
      { name: "EXECUTE", scopes: GD },
      { name: "LOCK TABLES", scopes: GD },
    ],
  },
  {
    id: "ddl",
    label: "Estructura (DDL)",
    privileges: [
      { name: "CREATE", scopes: ALL },
      { name: "ALTER", scopes: ALL },
      { name: "DROP", scopes: ALL },
      { name: "INDEX", scopes: ALL },
      { name: "REFERENCES", scopes: ALL },
      { name: "CREATE VIEW", scopes: ALL },
      { name: "SHOW VIEW", scopes: ALL },
      { name: "TRIGGER", scopes: ALL },
      { name: "CREATE TEMPORARY TABLES", scopes: GD },
      { name: "CREATE ROUTINE", scopes: GD },
      { name: "ALTER ROUTINE", scopes: GD },
      { name: "EVENT", scopes: GD },
    ],
  },
  {
    id: "admin",
    label: "Administrativos",
    privileges: [
      { name: "RELOAD", scopes: G },
      { name: "SHUTDOWN", scopes: G },
      { name: "PROCESS", scopes: G },
      { name: "FILE", scopes: G },
      { name: "SHOW DATABASES", scopes: G },
      { name: "SUPER", scopes: G },
      { name: "REPLICATION SLAVE", scopes: G },
      { name: "REPLICATION CLIENT", scopes: G },
      { name: "CREATE USER", scopes: G },
      { name: "CREATE TABLESPACE", scopes: G },
    ],
  },
];

export const READ_ONLY_PRIVILEGES = ["SELECT", "SHOW VIEW"];

/** Catalogue privileges valid on a scope kind, in display order. */
export function privilegesForScope(kind: ScopeKind): string[] {
  return PRIVILEGE_CATEGORIES.flatMap((c) =>
    c.privileges.filter((p) => p.scopes.includes(kind)).map((p) => p.name),
  );
}

export function scopeKey(scope: PrivilegeScope): string {
  switch (scope.kind) {
    case "global":
      return "*.*";
    case "database":
      return `${scope.database}.*`;
    case "table":
      return `${scope.database}.${scope.table}`;
  }
}

export function scopeLabel(scope: PrivilegeScope): string {
  switch (scope.kind) {
    case "global":
      return "Global (todo el servidor)";
    case "database":
      return `${scope.database}.*`;
    case "table":
      return `${scope.database}.${scope.table}`;
  }
}

const sameScope = (a: PrivilegeScope, b: PrivilegeScope) => scopeKey(a) === scopeKey(b) && a.kind === b.kind;

export function findGrant(grants: readonly ScopeGrant[], scope: PrivilegeScope): ScopeGrant | undefined {
  return grants.find((g) => sameScope(g.scope, scope));
}

/** Privileges shown as checked: `ALL PRIVILEGES` expands to the catalogue plus extras. */
export function effectivePrivileges(grant: ScopeGrant | undefined, kind: ScopeKind): Set<string> {
  if (!grant) return new Set();
  if (grant.privileges.includes(ALL_PRIVILEGES)) {
    return new Set([...privilegesForScope(kind), ...grant.privileges.filter((p) => p !== ALL_PRIVILEGES)]);
  }
  return new Set(grant.privileges);
}

/** Privileges held on a scope that the catalogue does not list (dynamic, engine-specific…). */
export function extraPrivileges(grant: ScopeGrant | undefined, kind: ScopeKind): string[] {
  if (!grant) return [];
  const known = new Set(privilegesForScope(kind));
  return grant.privileges.filter((p) => p !== ALL_PRIVILEGES && !known.has(p));
}

function replaceGrant(grants: readonly ScopeGrant[], next: ScopeGrant): ScopeGrant[] {
  const exists = grants.some((g) => sameScope(g.scope, next.scope));
  return exists ? grants.map((g) => (sameScope(g.scope, next.scope) ? next : g)) : [...grants, next];
}

/** Sets the exact privilege list of a scope (keeps the scope even when empty). */
export function setScopePrivileges(
  grants: readonly ScopeGrant[],
  scope: PrivilegeScope,
  privileges: string[],
): ScopeGrant[] {
  const current = findGrant(grants, scope);
  return replaceGrant(grants, {
    scope,
    privileges: [...new Set(privileges)],
    with_grant_option: current?.with_grant_option ?? false,
  });
}

/** Checks or unchecks one privilege; unchecking inside `ALL PRIVILEGES` expands it to a list. */
export function togglePrivilege(
  grants: readonly ScopeGrant[],
  scope: PrivilegeScope,
  privilege: string,
): ScopeGrant[] {
  const checked = effectivePrivileges(findGrant(grants, scope), scope.kind);
  if (checked.has(privilege)) checked.delete(privilege);
  else checked.add(privilege);
  const catalogue = privilegesForScope(scope.kind);
  const list = [...catalogue.filter((p) => checked.has(p)), ...[...checked].filter((p) => !catalogue.includes(p))];
  return setScopePrivileges(grants, scope, list);
}

export function setGrantOption(grants: readonly ScopeGrant[], scope: PrivilegeScope, enabled: boolean): ScopeGrant[] {
  const current = findGrant(grants, scope) ?? { scope, privileges: [], with_grant_option: false };
  return replaceGrant(grants, { ...current, with_grant_option: enabled });
}

export function removeScope(grants: readonly ScopeGrant[], scope: PrivilegeScope): ScopeGrant[] {
  return grants.filter((g) => !sameScope(g.scope, scope));
}

/** Scopes shown in the selector: global first, then the ones with grants, sorted. */
export function listScopes(grants: readonly ScopeGrant[]): PrivilegeScope[] {
  const others = grants
    .map((g) => g.scope)
    .filter((s) => s.kind !== "global")
    .sort((a, b) => scopeKey(a).localeCompare(scopeKey(b)));
  return [{ kind: "global" }, ...others];
}

export const roleKey = (r: RoleRef) => (r.host ? `${r.name}@${r.host}` : r.name);

/** Parses `name` or `name@host` typed by the user. */
export function parseRoleInput(text: string): RoleRef | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return { name: trimmed, host: null };
  return { name: trimmed.slice(0, at), host: trimmed.slice(at + 1) || "%" };
}

/** Editable copy of an account; `create` marks a new one. */
export interface UserDraft {
  user: string;
  host: string;
  attributes: AccountAttributes;
  grants: ScopeGrant[];
  roles: RoleRef[];
  newPassword: string;
  create?: { password: string; plugin: string };
}

export const DEFAULT_ATTRIBUTES: AccountAttributes = {
  plugin: null,
  account_locked: false,
  password_expired: false,
  password_expiry: { kind: "default" },
  tls: "none",
  max_queries_per_hour: 0,
  max_updates_per_hour: 0,
  max_connections_per_hour: 0,
  max_user_connections: 0,
};

export function draftFrom(p: UserPermissions): UserDraft {
  return {
    user: p.user,
    host: p.host,
    attributes: { ...p.attributes },
    grants: p.grants.map((g) => ({ ...g, privileges: [...g.privileges] })),
    roles: p.roles.map((r) => ({ ...r })),
    newPassword: "",
  };
}

export function newUserDraft(): UserDraft {
  return {
    user: "",
    host: "%",
    attributes: { ...DEFAULT_ATTRIBUTES },
    grants: [],
    roles: [],
    newPassword: "",
    create: { password: "", plugin: "" },
  };
}

/** Grants without empty scopes, so an added-then-cleared scope is not a change. */
const meaningful = (grants: readonly ScopeGrant[]) =>
  grants
    .filter((g) => g.privileges.length > 0 || g.with_grant_option)
    .map((g) => ({ k: scopeKey(g.scope), p: [...g.privileges].sort(), o: g.with_grant_option }))
    .sort((a, b) => a.k.localeCompare(b.k));

export function isDraftDirty(original: UserPermissions | null, draft: UserDraft): boolean {
  if (draft.create || !original) return true;
  if (draft.newPassword) return true;
  if (JSON.stringify(original.attributes) !== JSON.stringify(draft.attributes)) return true;
  if (JSON.stringify(meaningful(original.grants)) !== JSON.stringify(meaningful(draft.grants))) return true;
  const roles = (rs: RoleRef[]) => rs.map(roleKey).sort().join("\n");
  return roles(original.roles) !== roles(draft.roles);
}

export function toChangeRequest(draft: UserDraft): UserChangeRequest {
  return {
    user: draft.user.trim(),
    host: draft.host.trim(),
    create: draft.create
      ? { password: draft.create.password || null, plugin: draft.create.plugin || null }
      : null,
    new_password: draft.newPassword || null,
    attributes: draft.attributes,
    grants: draft.grants.filter((g) => g.privileges.length > 0 || g.with_grant_option),
    roles: draft.roles,
  };
}

/** Validation of the new-account form; returns the first problem, if any. */
export function validateNewAccount(draft: UserDraft, existing: readonly { user: string; host: string }[]): string | null {
  const user = draft.user.trim();
  const host = draft.host.trim();
  if (!user) return "Escribe el nombre de usuario.";
  if (user.length > 80) return "El nombre de usuario admite como máximo 80 caracteres.";
  if (!host) return "Escribe el host (por ejemplo %, localhost o 10.0.0.%).";
  if (existing.some((u) => u.user === user && u.host === host)) return `La cuenta '${user}'@'${host}' ya existe.`;
  if (draft.create && !draft.create.password) return "Escribe una contraseña para la cuenta nueva.";
  return null;
}

/** Same escaping as `escape_sql_string` in `sql_utils.rs`. */
export function escapeSqlString(input: string): string {
  const map: Record<string, string> = {
    "\0": "\\0",
    "'": "\\'",
    '"': '\\"',
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    "\\": "\\\\",
    "\x1a": "\\Z",
  };
  return input.replace(/[\0'"\n\r\t\\\x1a]/g, (c) => map[c]);
}

/** Exact statement the backend confirms for `delete_user`. */
export function dropUserSql(user: string, host: string): string {
  return `DROP USER '${escapeSqlString(user)}'@'${escapeSqlString(host)}';`;
}

/** Joined preview the confirmation token is bound to (see `preview_script`). */
export function joinPlan(statements: readonly string[]): string {
  return statements.map((s) => `${s};`).join("\n");
}
