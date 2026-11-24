import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Lock, Plus, RefreshCw, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import type { DatabaseSchema, DatabaseUserMetadata, PrivilegeScope, UserPermissions } from "../types/database";
import { dbService } from "../services/tauriDb";
import { useUIStore } from "../stores/uiStore";
import { Modal, Spinner, EmptyState } from "./ui/Modal";
import { StagedChangesActionBar } from "./StagedChangesActionBar";
import {
  cardClass,
  dangerGhostBtn,
  fieldLabel,
  ghostBtn,
  iconBtn,
  inputClass,
  mutedText,
  primaryBtn,
  secondaryBtn,
  sectionLabel,
  selectClass,
} from "./ui/styles";
import {
  ALL_PRIVILEGES,
  PRIVILEGE_CATEGORIES,
  READ_ONLY_PRIVILEGES,
  draftFrom,
  dropUserSql,
  effectivePrivileges,
  extraPrivileges,
  findGrant,
  isDraftDirty,
  joinPlan,
  listScopes,
  newUserDraft,
  parseRoleInput,
  removeScope,
  roleKey,
  scopeKey,
  scopeLabel,
  setGrantOption,
  setScopePrivileges,
  toChangeRequest,
  togglePrivilege,
  validateNewAccount,
  type UserDraft,
} from "./userManager/permissions";

interface UserManagerTabProps {
  /** Database preselected when adding a privilege scope. */
  database?: string;
}

const accountId = (u: { user: string; host: string }) => `${u.user}@${u.host}`;

const LIMIT_KEYS = [
  "max_queries_per_hour",
  "max_updates_per_hour",
  "max_connections_per_hour",
  "max_user_connections",
] as const;

export const UserManagerTab: React.FC<UserManagerTabProps> = ({ database }) => {
  const { t } = useTranslation("compare");
  const [users, setUsers] = useState<DatabaseUserMetadata[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const [selected, setSelected] = useState<string | null>(null);
  const [original, setOriginal] = useState<UserPermissions | null>(null);
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  const [scope, setScope] = useState<PrivilegeScope>({ kind: "global" });
  const [databases, setDatabases] = useState<DatabaseSchema[]>([]);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = draft ? isDraftDirty(original, draft) : false;

  const loadUsers = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      setUsers(await dbService.listDatabaseUsers());
    } catch (err) {
      setListError(String(err));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadUser = useCallback(async (user: string, host: string) => {
    setLoadingUser(true);
    setUserError(null);
    try {
      const perms = await dbService.getUserPermissions(user, host);
      setOriginal(perms);
      setDraft(draftFrom(perms));
      setScope({ kind: "global" });
    } catch (err) {
      setOriginal(null);
      setDraft(null);
      setUserError(String(err));
    } finally {
      setLoadingUser(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    dbService.listDatabases().then(setDatabases).catch(() => setDatabases([]));
  }, [loadUsers]);

  /** Runs `proceed` right away, or after confirming that pending edits are discarded. */
  const guardDirty = (proceed: () => void) => {
    if (!dirty) return proceed();
    useUIStore.getState().showConfirm({
      title: t("users.dirtyTitle"),
      message: t("users.dirtyMessage"),
      variant: "warning",
      icon: "alert",
      confirmText: t("users.discard"),
      onConfirm: proceed,
    });
  };

  const selectUser = (u: DatabaseUserMetadata) => {
    if (selected === accountId(u)) return;
    guardDirty(() => {
      setSelected(accountId(u));
      void loadUser(u.user, u.host);
    });
  };

  const startNewUser = () =>
    guardDirty(() => {
      setSelected(null);
      setOriginal(null);
      setUserError(null);
      setDraft(newUserDraft());
      setScope({ kind: "global" });
    });

  const discard = () => {
    if (!draft) return;
    if (draft.create) {
      setDraft(null);
      return;
    }
    if (original) setDraft(draftFrom(original));
  };

  const update = (patch: Partial<UserDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const updateAttrs = (patch: Partial<UserDraft["attributes"]>) =>
    setDraft((d) => (d ? { ...d, attributes: { ...d.attributes, ...patch } } : d));

  const openPreview = async () => {
    if (!draft) return;
    if (draft.create) {
      const problem = validateNewAccount(draft, users);
      if (problem) {
        useUIStore.getState().showAlert({ title: t("users.incompleteTitle"), message: problem, variant: "warning" });
        return;
      }
    }
    setBusy(true);
    try {
      const plan = await dbService.planUserChanges(toChangeRequest(draft));
      if (plan.length === 0) {
        useUIStore.getState().showAlert({
          title: t("users.noChangesTitle"),
          message: t("users.noChangesMessage"),
          variant: "info",
        });
        if (original) setDraft(draftFrom(original));
        return;
      }
      setPreview(plan);
    } catch (err) {
      useUIStore.getState().showAlert({ title: t("users.planErrorTitle"), message: String(err), variant: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const applyPreview = async () => {
    if (!draft || !preview) return;
    setBusy(true);
    try {
      await dbService.saveUserPermissions(toChangeRequest(draft), joinPlan(preview));
      setPreview(null);
      const user = draft.user.trim();
      const host = draft.host.trim();
      setSelected(accountId({ user, host }));
      await Promise.all([loadUsers(), loadUser(user, host)]);
    } catch (err) {
      setPreview(null);
      useUIStore.getState().showAlert({ title: t("users.applyErrorTitle"), message: String(err), variant: "danger" });
      await loadUsers();
      if (!draft.create) await loadUser(draft.user, draft.host);
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = () => {
    if (!original) return;
    const { user, host } = original;
    const sql = dropUserSql(user, host);
    useUIStore.getState().showConfirm({
      title: t("users.deleteTitle"),
      message: t("users.deleteMessage", { user, host }),
      details: sql,
      variant: "danger",
      icon: "trash",
      confirmText: t("users.deleteTitle"),
      onConfirm: async () => {
        try {
          await dbService.deleteUser(user, host, sql);
          setSelected(null);
          setOriginal(null);
          setDraft(null);
          await loadUsers();
        } catch (err) {
          useUIStore.getState().showAlert({ title: t("users.deleteErrorTitle"), message: String(err), variant: "danger" });
        }
      },
    });
  };

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? users.filter((u) => accountId(u).toLowerCase().includes(q)) : users;
  }, [users, filter]);

  return (
    <div className="flex h-full min-h-0 bg-surface text-fg text-xs" data-view="user-manager">
      {/* Account list */}
      <aside className="w-64 shrink-0 border-r border-line flex flex-col min-h-0" data-region="accounts">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-line">
          <span className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-fg-muted" /> {t("users.accounts")}
          </span>
          <div className="flex items-center gap-0.5">
            <button type="button" className={iconBtn} onClick={() => void loadUsers()} title={t("users.reloadAccounts")} aria-label={t("users.reloadAccounts")}>
              <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? "animate-spin" : ""}`} />
            </button>
            <button type="button" className={iconBtn} onClick={startNewUser} title={t("users.newAccount")} aria-label={t("users.newAccount")}>
              <UserPlus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="px-3 py-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input
              className={`${inputClass} pl-7`}
              placeholder={t("users.filterPlaceholder")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto pb-2" role="listbox" aria-label={t("users.accountsAria")}>
          {listError && <p className="px-3 text-danger">{listError}</p>}
          {!listError && !loadingList && filteredUsers.length === 0 && (
            <p className={`px-3 ${mutedText}`}>{t("users.noVisibleAccounts")}</p>
          )}
          {filteredUsers.map((u) => {
            const id = accountId(u);
            const active = id === selected;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => selectUser(u)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
                  active ? "bg-accent-soft text-accent-text" : "hover:bg-hover"
                }`}
              >
                <span className="truncate flex-1">
                  {u.user}
                  <span className="text-fg-subtle">@{u.host}</span>
                </span>
                {u.account_locked && <Lock className="w-3 h-3 text-warning shrink-0" aria-label={t("users.lockedAria")} />}
                {u.password_expired && <KeyRound className="w-3 h-3 text-danger shrink-0" aria-label={t("users.expiredAria")} />}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Account detail */}
      <section className="flex-1 min-w-0 min-h-0 relative flex flex-col" data-region="account-detail">
        {loadingUser ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner />
          </div>
        ) : userError ? (
          <EmptyState title={t("users.readErrorTitle")} description={userError} />
        ) : !draft ? (
          <EmptyState
            icon={<Users className="w-6 h-6 text-fg-subtle" />}
            title={t("users.emptyTitle")}
            description={t("users.emptyDesc")}
            action={
              <button type="button" className={primaryBtn} onClick={startNewUser}>
                <UserPlus className="w-3.5 h-3.5" /> {t("users.newAccount")}
              </button>
            }
          />
        ) : (
          <AccountEditor
            draft={draft}
            original={original}
            databases={databases}
            defaultDatabase={database}
            scope={scope}
            onScope={setScope}
            update={update}
            updateAttrs={updateAttrs}
            onDelete={deleteAccount}
          />
        )}

        <StagedChangesActionBar
          changeCount={draft && dirty ? 1 : 0}
          onPreviewSql={() => void openPreview()}
          onApplyChanges={() => void openPreview()}
          onDiscardChanges={discard}
          isApplying={busy}
        />
      </section>

      <Modal
        isOpen={preview !== null}
        onClose={() => !busy && setPreview(null)}
        title={t("users.previewTitle")}
        subtitle={draft ? `'${draft.user}'@'${draft.host}'` : undefined}
        size="lg"
        footer={
          <>
            <button type="button" className={secondaryBtn} onClick={() => setPreview(null)} disabled={busy}>
              {t("users.cancel")}
            </button>
            <button type="button" className={primaryBtn} onClick={() => void applyPreview()} disabled={busy}>
              {busy && <Spinner className="w-3.5 h-3.5" />} {t("users.applyBtn", { count: preview?.length ?? 0 })}
            </button>
          </>
        }
      >
        <p className={`${mutedText} mb-2`}>
          {t("users.previewNote")}
        </p>
        <pre className="font-mono text-[11px] bg-raised border border-line rounded-md p-3 overflow-auto max-h-[50vh] whitespace-pre-wrap">
          {preview ? joinPlan(preview) : ""}
        </pre>
      </Modal>
    </div>
  );
};

// ─── Editor ──────────────────────────────────────────────────────────────────

interface AccountEditorProps {
  draft: UserDraft;
  original: UserPermissions | null;
  databases: DatabaseSchema[];
  defaultDatabase?: string;
  scope: PrivilegeScope;
  onScope: (s: PrivilegeScope) => void;
  update: (patch: Partial<UserDraft>) => void;
  updateAttrs: (patch: Partial<UserDraft["attributes"]>) => void;
  onDelete: () => void;
}

const AccountEditor: React.FC<AccountEditorProps> = ({
  draft,
  original,
  databases,
  defaultDatabase,
  scope,
  onScope,
  update,
  updateAttrs,
  onDelete,
}) => {
  const { t } = useTranslation("compare");
  const attrs = draft.attributes;
  const [roleInput, setRoleInput] = useState("");
  const expiry = attrs.password_expiry;

  const addRole = () => {
    const role = parseRoleInput(roleInput);
    if (!role || draft.roles.some((r) => roleKey(r) === roleKey(role))) return;
    update({ roles: [...draft.roles, role] });
    setRoleInput("");
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 pb-24 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">
            {draft.create ? t("users.newAccount") : `${draft.user}@${draft.host}`}
          </h2>
          {!draft.create && (
            <p className={mutedText}>
              {t("users.authSummary", { plugin: attrs.plugin || t("users.defaultPlugin") })}
              {attrs.account_locked ? t("users.lockedSuffix") : ""}
              {attrs.password_expired ? t("users.expiredSuffix") : ""}
            </p>
          )}
        </div>
        {!draft.create && original && (
          <button type="button" className={`${ghostBtn} hover:text-danger`} onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" /> {t("users.deleteAccount")}
          </button>
        )}
      </header>

      {/* Identity / authentication */}
      <div className={`${cardClass} p-4 space-y-3`} data-section="authentication">
        <h3 className={sectionLabel}>{t("users.authSection")}</h3>
        {draft.create ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label>
              <span className={fieldLabel}>{t("users.userLabel")}</span>
              <input className={inputClass} value={draft.user} onChange={(e) => update({ user: e.target.value })} autoFocus />
            </label>
            <label>
              <span className={fieldLabel}>{t("users.hostLabel")}</span>
              <input
                className={inputClass}
                value={draft.host}
                placeholder="%, localhost, 10.0.0.%"
                onChange={(e) => update({ host: e.target.value })}
              />
            </label>
            <label>
              <span className={fieldLabel}>{t("users.passwordLabel")}</span>
              <input
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={draft.create.password}
                onChange={(e) => update({ create: { ...draft.create!, password: e.target.value } })}
              />
            </label>
            <label>
              <span className={fieldLabel}>{t("users.pluginLabel")}</span>
              <select
                className={selectClass}
                value={draft.create.plugin}
                onChange={(e) => update({ create: { ...draft.create!, plugin: e.target.value } })}
              >
                <option value="">{t("users.pluginServerDefault")}</option>
                <option value="caching_sha2_password">caching_sha2_password (MySQL 8)</option>
                <option value="mysql_native_password">mysql_native_password</option>
                <option value="ed25519">ed25519 (MariaDB)</option>
              </select>
            </label>
          </div>
        ) : (
          <label className="block max-w-sm">
            <span className={fieldLabel}>{t("users.newPasswordLabel")}</span>
            <input
              type="password"
              autoComplete="new-password"
              className={inputClass}
              value={draft.newPassword}
              onChange={(e) => update({ newPassword: e.target.value })}
            />
          </label>
        )}
      </div>

      {/* Account policies */}
      <div className={`${cardClass} p-4 space-y-3`} data-section="policies">
        <h3 className={sectionLabel}>{t("users.policiesSection")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label>
            <span className={fieldLabel}>{t("users.expiryLabel")}</span>
            <select
              className={selectClass}
              value={expiry.kind}
              onChange={(e) => {
                const kind = e.target.value as typeof expiry.kind;
                updateAttrs({
                  password_expiry: kind === "interval" ? { kind, days: 90 } : { kind },
                });
              }}
            >
              <option value="default">{t("users.expiryDefault")}</option>
              <option value="never">{t("users.expiryNever")}</option>
              <option value="interval">{t("users.expiryInterval")}</option>
            </select>
          </label>
          {expiry.kind === "interval" && (
            <label>
              <span className={fieldLabel}>{t("users.daysLabel")}</span>
              <input
                type="number"
                min={1}
                max={65535}
                className={inputClass}
                value={expiry.days}
                onChange={(e) =>
                  updateAttrs({ password_expiry: { kind: "interval", days: Math.max(1, Number(e.target.value) || 1) } })
                }
              />
            </label>
          )}
          <label>
            <span className={fieldLabel}>{t("users.tlsLabel")}</span>
            <select
              className={selectClass}
              value={attrs.tls}
              disabled={attrs.tls === "specified"}
              onChange={(e) => updateAttrs({ tls: e.target.value as typeof attrs.tls })}
            >
              <option value="none">{t("users.tlsNone")}</option>
              <option value="ssl">REQUIRE SSL</option>
              <option value="x509">REQUIRE X509</option>
              {attrs.tls === "specified" && <option value="specified">{t("users.tlsSpecified")}</option>}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={attrs.account_locked}
              onChange={(e) => updateAttrs({ account_locked: e.target.checked })}
            />
            {t("users.accountLocked")}
          </label>
          {!draft.create && (
            <label className="flex items-center gap-2" title={t("users.expireNowTitle")}>
              <input
                type="checkbox"
                checked={attrs.password_expired}
                disabled={original?.attributes.password_expired}
                onChange={(e) => updateAttrs({ password_expired: e.target.checked })}
              />
              {t("users.expireNow")}
            </label>
          )}
        </div>
        <div>
          <span className={fieldLabel}>{t("users.resourceLimits")}</span>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {LIMIT_KEYS.map((key) => (
              <label key={key}>
                <span className="block text-[11px] text-fg-subtle mb-1">{t(`users.limits.${key}` as any)}</span>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={attrs[key]}
                  onChange={(e) => updateAttrs({ [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Roles */}
      <div className={`${cardClass} p-4 space-y-2`} data-section="roles">
        <h3 className={sectionLabel}>{t("users.rolesSection")}</h3>
        {draft.roles.length === 0 && <p className={mutedText}>{t("users.noRoles")}</p>}
        <ul className="flex flex-wrap gap-1.5">
          {draft.roles.map((r) => (
            <li key={roleKey(r)} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md border border-line">
              {roleKey(r)}
              <button
                type="button"
                className={dangerGhostBtn}
                aria-label={t("users.removeRoleAria", { role: roleKey(r) })}
                onClick={() => update({ roles: draft.roles.filter((x) => roleKey(x) !== roleKey(r)) })}
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 max-w-sm">
          <input
            className={inputClass}
            placeholder={t("users.rolePlaceholder")}
            value={roleInput}
            onChange={(e) => setRoleInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRole()}
          />
          <button type="button" className={ghostBtn} onClick={addRole} disabled={!roleInput.trim()}>
            <Plus className="w-3.5 h-3.5" /> {t("users.assignRole")}
          </button>
        </div>
      </div>

      <PrivilegeMatrix
        draft={draft}
        databases={databases}
        defaultDatabase={defaultDatabase}
        scope={scope}
        onScope={onScope}
        onGrants={(grants) => update({ grants })}
      />

      {original && original.unmanaged_grants.length > 0 && (
        <div className={`${cardClass} p-4 space-y-2`} data-section="unmanaged-grants">
          <h3 className={sectionLabel}>{t("users.otherPrivilegesTitle")}</h3>
          <p className={mutedText}>{t("users.otherPrivilegesDesc")}</p>
          <pre className="font-mono text-[11px] whitespace-pre-wrap text-fg-muted">
            {original.unmanaged_grants.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
};

// ─── Privilege matrix ────────────────────────────────────────────────────────

interface PrivilegeMatrixProps {
  draft: UserDraft;
  databases: DatabaseSchema[];
  defaultDatabase?: string;
  scope: PrivilegeScope;
  onScope: (s: PrivilegeScope) => void;
  onGrants: (grants: UserDraft["grants"]) => void;
}

const PrivilegeMatrix: React.FC<PrivilegeMatrixProps> = ({
  draft,
  databases,
  defaultDatabase,
  scope,
  onScope,
  onGrants,
}) => {
  const { t } = useTranslation("compare");
  const [newDb, setNewDb] = useState(defaultDatabase ?? "");
  const [newTable, setNewTable] = useState("");
  const [tables, setTables] = useState<string[]>([]);

  useEffect(() => {
    if (!newDb) return setTables([]);
    let cancelled = false;
    dbService
      .listTables(newDb)
      .then((ts) => !cancelled && setTables(ts.map((tbl) => tbl.name)))
      .catch(() => !cancelled && setTables([]));
    return () => {
      cancelled = true;
    };
  }, [newDb]);

  const scopes = listScopes(draft.grants);
  const grant = findGrant(draft.grants, scope);
  const checked = effectivePrivileges(grant, scope.kind);
  const extras = extraPrivileges(grant, scope.kind);
  const hasAll = grant?.privileges.includes(ALL_PRIVILEGES) ?? false;

  const addScope = () => {
    if (!newDb) return;
    const next: PrivilegeScope = newTable
      ? { kind: "table", database: newDb, table: newTable }
      : { kind: "database", database: newDb };
    if (!findGrant(draft.grants, next)) onGrants(setScopePrivileges(draft.grants, next, []));
    onScope(next);
    setNewTable("");
  };

  return (
    <div className={`${cardClass} p-4 space-y-3`} data-section="privileges">
      <h3 className={sectionLabel}>{t("users.privilegesSection")}</h3>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px]">
          <span className={fieldLabel}>{t("users.scopeLabel")}</span>
          <select
            className={selectClass}
            value={scopeKey(scope)}
            onChange={(e) => {
              const next = scopes.find((s) => scopeKey(s) === e.target.value);
              if (next) onScope(next);
            }}
          >
            {scopes.map((s) => (
              <option key={scopeKey(s)} value={scopeKey(s)}>
                {scopeLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <label>
            <span className={fieldLabel}>{t("users.databaseLabel")}</span>
            <select className={selectClass} value={newDb} onChange={(e) => setNewDb(e.target.value)}>
              <option value="">—</option>
              {databases.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={fieldLabel}>{t("users.tableOptionalLabel")}</span>
            <select className={selectClass} value={newTable} onChange={(e) => setNewTable(e.target.value)} disabled={!newDb}>
              <option value="">{t("users.allDatabase")}</option>
              {tables.map((tbl) => (
                <option key={tbl} value={tbl}>
                  {tbl}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={ghostBtn} onClick={addScope} disabled={!newDb}>
            <Plus className="w-3.5 h-3.5" /> {t("users.addScope")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-y border-line py-1.5">
        <button type="button" className={ghostBtn} onClick={() => onGrants(setScopePrivileges(draft.grants, scope, [ALL_PRIVILEGES]))}>
          {t("users.selectAll")}
        </button>
        <button type="button" className={ghostBtn} onClick={() => onGrants(setScopePrivileges(draft.grants, scope, READ_ONLY_PRIVILEGES))}>
          {t("users.readOnly")}
        </button>
        <button type="button" className={ghostBtn} onClick={() => onGrants(setScopePrivileges(draft.grants, scope, []))}>
          {t("users.none")}
        </button>
        <label className="flex items-center gap-2 ml-auto pr-1">
          <input
            type="checkbox"
            checked={grant?.with_grant_option ?? false}
            onChange={(e) => onGrants(setGrantOption(draft.grants, scope, e.target.checked))}
          />
          WITH GRANT OPTION
        </label>
        {scope.kind !== "global" && (
          <button
            type="button"
            className={`${ghostBtn} hover:text-danger`}
            onClick={() => {
              onGrants(removeScope(draft.grants, scope));
              onScope({ kind: "global" });
            }}
          >
            <Trash2 className="w-3.5 h-3.5" /> {t("users.removeScope")}
          </button>
        )}
      </div>

      {hasAll && <p className={mutedText}>{t("users.hasAllPrivileges")}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="group" aria-label={t("users.privilegesGroupAria", { scope: scopeLabel(scope) })}>
        {PRIVILEGE_CATEGORIES.map((cat) => {
          const items = cat.privileges.filter((p) => p.scopes.includes(scope.kind));
          if (items.length === 0) return null;
          return (
            <fieldset key={cat.id} data-category={cat.id}>
              <legend className={`${sectionLabel} mb-1.5`}>{cat.label}</legend>
              <div className="space-y-1">
                {items.map((p) => (
                  <label key={p.name} className="flex items-center gap-2 font-mono text-[11px]">
                    <input
                      type="checkbox"
                      checked={checked.has(p.name)}
                      onChange={() => onGrants(togglePrivilege(draft.grants, scope, p.name))}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
        {extras.length > 0 && (
          <fieldset data-category="other">
            <legend className={`${sectionLabel} mb-1.5`}>{t("users.otherCategory")}</legend>
            <div className="space-y-1">
              {extras.map((name) => (
                <label key={name} className="flex items-center gap-2 font-mono text-[11px]">
                  <input
                    type="checkbox"
                    checked
                    onChange={() => onGrants(togglePrivilege(draft.grants, scope, name))}
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </div>
  );
};
