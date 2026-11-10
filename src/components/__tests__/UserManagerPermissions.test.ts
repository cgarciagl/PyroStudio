import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrivilegeScope, ScopeGrant, UserPermissions } from "../../types/database";
import {
  ALL_PRIVILEGES,
  DEFAULT_ATTRIBUTES,
  draftFrom,
  dropUserSql,
  effectivePrivileges,
  isDraftDirty,
  joinPlan,
  listScopes,
  newUserDraft,
  parseRoleInput,
  privilegesForScope,
  setScopePrivileges,
  toChangeRequest,
  togglePrivilege,
  validateNewAccount,
} from "../userManager/permissions";

const shop: PrivilegeScope = { kind: "database", database: "shop" };
const perms = (grants: ScopeGrant[] = []): UserPermissions => ({
  user: "ana",
  host: "%",
  attributes: { ...DEFAULT_ATTRIBUTES },
  grants,
  roles: [],
  unmanaged_grants: [],
  raw_grants: [],
});

describe("matriz de privilegios", () => {
  it("solo ofrece privilegios administrativos en el ámbito global", () => {
    expect(privilegesForScope("global")).toContain("PROCESS");
    expect(privilegesForScope("database")).not.toContain("PROCESS");
    expect(privilegesForScope("table")).not.toContain("EXECUTE");
    expect(privilegesForScope("table")).toContain("SELECT");
  });

  it("marca y desmarca un privilegio conservando el orden del catálogo", () => {
    let grants = togglePrivilege([], shop, "UPDATE");
    grants = togglePrivilege(grants, shop, "SELECT");
    expect(grants[0].privileges).toEqual(["SELECT", "UPDATE"]);
    grants = togglePrivilege(grants, shop, "UPDATE");
    expect(grants[0].privileges).toEqual(["SELECT"]);
  });

  it("al desmarcar dentro de ALL PRIVILEGES lo expande a la lista explícita", () => {
    const grants = setScopePrivileges([], shop, [ALL_PRIVILEGES]);
    expect(effectivePrivileges(grants[0], "database").has("DROP")).toBe(true);
    const next = togglePrivilege(grants, shop, "DROP");
    expect(next[0].privileges).not.toContain(ALL_PRIVILEGES);
    expect(next[0].privileges).not.toContain("DROP");
    expect(next[0].privileges).toContain("SELECT");
  });

  it("lista el ámbito global primero y luego los ámbitos con privilegios", () => {
    const scopes = listScopes([
      { scope: { kind: "table", database: "shop", table: "orders" }, privileges: ["SELECT"], with_grant_option: false },
      { scope: shop, privileges: ["SELECT"], with_grant_option: false },
    ]);
    expect(scopes.map((s) => s.kind)).toEqual(["global", "database", "table"]);
  });
});

describe("borrador de cuenta", () => {
  it("no se considera modificado si solo se añade un ámbito vacío", () => {
    const original = perms();
    const draft = draftFrom(original);
    draft.grants = setScopePrivileges(draft.grants, shop, []);
    expect(isDraftDirty(original, draft)).toBe(false);
    expect(toChangeRequest(draft).grants).toEqual([]);
  });

  it("detecta cambios en privilegios, atributos, roles y contraseña", () => {
    const original = perms([{ scope: shop, privileges: ["SELECT"], with_grant_option: false }]);
    const changed = (edit: (d: ReturnType<typeof draftFrom>) => void) => {
      const d = draftFrom(original);
      edit(d);
      return isDraftDirty(original, d);
    };
    expect(changed((d) => (d.grants = togglePrivilege(d.grants, shop, "INSERT")))).toBe(true);
    expect(changed((d) => (d.attributes.account_locked = true))).toBe(true);
    expect(changed((d) => (d.roles = [{ name: "reader", host: null }]))).toBe(true);
    expect(changed((d) => (d.newPassword = "x"))).toBe(true);
    expect(changed(() => {})).toBe(false);
  });

  it("valida el formulario de cuenta nueva", () => {
    const draft = newUserDraft();
    expect(validateNewAccount(draft, [])).toMatch(/usuario/);
    draft.user = "ana";
    expect(validateNewAccount(draft, [{ user: "ana", host: "%" }])).toMatch(/ya existe/);
    expect(validateNewAccount(draft, [])).toMatch(/contraseña/);
    draft.create!.password = "secreta";
    expect(validateNewAccount(draft, [])).toBeNull();
    expect(toChangeRequest(draft).create).toEqual({ password: "secreta", plugin: null });
  });

  it("interpreta roles con y sin host", () => {
    expect(parseRoleInput("reader")).toEqual({ name: "reader", host: null });
    expect(parseRoleInput("app@%")).toEqual({ name: "app", host: "%" });
    expect(parseRoleInput("  ")).toBeNull();
  });
});

describe("SQL de confirmación", () => {
  it("escapa DROP USER igual que el backend", () => {
    expect(dropUserSql("o'brien", "%")).toBe("DROP USER 'o\\'brien'@'%';");
  });

  it("une el plan con punto y coma por sentencia", () => {
    expect(joinPlan(["REVOKE A", "GRANT B"])).toBe("REVOKE A;\nGRANT B;");
  });

  it("la pestaña nunca usa diálogos nativos y confirma antes de aplicar", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "UserManagerTab.tsx"), "utf8");
    expect(source).not.toMatch(/\b(alert|confirm|prompt)\(/);
    expect(source).toContain("saveUserPermissions(toChangeRequest(draft), joinPlan(preview))");
    expect(source).toContain("showConfirm");
  });
});
