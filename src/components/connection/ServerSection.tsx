import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("connection");

  return (
    <>
    {!isSqlite && (
    <section className="space-y-3">
      <div className={sectionTitle}>
        {transport === "http" ? t("server.titleHttp") : t("server.title")}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1">
          <label className={labelCls}>{t("server.host")}</label>
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
          <label className={labelCls}>{t("server.port")}</label>
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
          <label className={labelCls}>{t("server.user")}</label>
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
              <span>{t("server.password")}</span>
              {hasSavedPassword && !password && (
                <span className="flex items-center gap-0.5 text-[11px] font-normal" title={t("server.savedTooltip")}>
                  <ShieldCheck className="w-3 h-3 text-success" /> {t("server.savedBadge")}
                </span>
              )}
              {!hasSavedPassword && !password && isEditingExisting && (
                <span
                  className="flex items-center gap-0.5 text-[11px] font-normal truncate"
                  title={
                    workspaceActive
                      ? t("server.pendingWorkspaceTooltip")
                      : t("server.unsavedTooltip")
                  }
                >
                  <AlertCircle className="w-3 h-3 text-warning shrink-0" />{" "}
                  {workspaceActive ? t("server.pendingWorkspace") : t("server.unsaved")}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-fg-muted hover:text-fg"
              title={showPassword ? t("server.hide") : t("server.show")}
            >
              {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </label>
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={hasSavedPassword ? t("server.passwordUnchangedPlaceholder") : "••••••••"}
            className={monoInput}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className={labelCls}>
          {t("server.initialDatabase")} <span className="font-normal">{t("server.optional")}</span>
        </label>
        <input
          type="text"
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          placeholder={t("server.initialDatabasePlaceholder")}
          className={monoInput}
        />
      </div>
    </section>
    )}
    </>
  );
}
