import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SshAuthentication } from "../../types/database";
import {
  AlertCircle,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Copy,
} from "lucide-react";
import { SaveTunnelScriptModal } from "../SaveTunnelScriptModal";
import { ghostBtn } from "../ui/styles";
import { inputCls, monoInput, labelCls, sectionTitle } from "./formConstants";
import type { ConnectionForm } from "./useConnectionForm";

/** Tipo de conexión: directa, túnel HTTP o túnel SSH, con sus opciones. */
export function TransportSection({ tunnelUrl, setTunnelUrl, tunnelUser, setTunnelUser, tunnelPassword, setTunnelPassword, tunnelToken, setTunnelToken, tunnelEncodeBase64, setTunnelEncodeBase64, tunnelTimeoutSec, setTunnelTimeoutSec, generatedTokenSnippet, setGeneratedTokenSnippet, copiedItem, handleGenerateTunnelToken, copyToClipboard, sshHost, setSshHost, sshPort, setSshPort, sshUser, setSshUser, sshAuthentication, setSshAuthentication, sshPrivateKeyPath, setSshPrivateKeyPath, showTunnelPassword, setShowTunnelPassword, hasSavedTunnelToken, isSqlite, transport, setTransport, TRANSPORT_OPTIONS }: Pick<ConnectionForm, "tunnelUrl" | "setTunnelUrl" | "tunnelUser" | "setTunnelUser" | "tunnelPassword" | "setTunnelPassword" | "tunnelToken" | "setTunnelToken" | "tunnelEncodeBase64" | "setTunnelEncodeBase64" | "tunnelTimeoutSec" | "setTunnelTimeoutSec" | "generatedTokenSnippet" | "setGeneratedTokenSnippet" | "copiedItem" | "handleGenerateTunnelToken" | "copyToClipboard" | "sshHost" | "setSshHost" | "sshPort" | "setSshPort" | "sshUser" | "setSshUser" | "sshAuthentication" | "setSshAuthentication" | "sshPrivateKeyPath" | "setSshPrivateKeyPath" | "showTunnelPassword" | "setShowTunnelPassword" | "hasSavedTunnelToken" | "isSqlite" | "transport" | "setTransport" | "TRANSPORT_OPTIONS">) {
  const { t } = useTranslation("connection");
  const [showSaveScriptModal, setShowSaveScriptModal] = useState(false);

  return (
    <>
    <section className="space-y-2.5">
      <div className={sectionTitle}>{t("transport.title")}</div>
      <div
        className={`grid ${isSqlite ? "grid-cols-2" : "grid-cols-3"} gap-1 p-0.5 rounded-lg bg-canvas border border-line`}
      >
        {TRANSPORT_OPTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTransport(id)}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs transition-colors ${
              transport === id
                ? "bg-surface text-fg font-medium shadow-sm border border-line"
                : "text-fg-muted hover:text-fg border border-transparent"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-fg-muted">
        {TRANSPORT_OPTIONS.find((o) => o.id === transport)?.hint}
      </p>

      {transport === "http" && (
        <div className="space-y-3 pl-3 border-l-2 border-line">
          <div className="space-y-1">
            <label className={`${labelCls} flex items-center justify-between gap-2`}>
              <span>
                {t("transport.http.scriptUrl", { script: isSqlite ? "pyro_tunnel_sqlite.php" : "pyro_tunnel.php" })}
              </span>
              <button
                type="button"
                onClick={() => setShowSaveScriptModal(true)}
                className={ghostBtn}
              >
                <Download className="w-3 h-3" />
                {t("transport.http.saveScript")}
              </button>
            </label>
            <input
              type="url"
              required
              value={tunnelUrl}
              onChange={(e) => setTunnelUrl(e.target.value)}
              placeholder={`https://midominio.com/${isSqlite ? "pyro_tunnel_sqlite.php" : "pyro_tunnel.php"}`}
              className={monoInput}
            />
          </div>
          <div className="space-y-1">
            <label className={`${labelCls} flex items-center justify-between`}>
              <span>{t("transport.http.tunnelToken")}</span>
              <span className="flex items-center gap-1">
                {tunnelToken && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(tunnelToken, "token")}
                    className={ghostBtn}
                  >
                    <Copy className="w-3 h-3" />
                    {copiedItem === "token" ? t("transport.http.copied") : t("transport.http.copyToken")}
                  </button>
                )}
                <button type="button" onClick={handleGenerateTunnelToken} className={ghostBtn}>
                  <KeyRound className="w-3 h-3" />
                  {t("transport.http.generateToken")}
                </button>
              </span>
            </label>
            <input
              type="password"
              autoComplete="off"
              value={tunnelToken}
              onChange={(e) => {
                setTunnelToken(e.target.value);
                setGeneratedTokenSnippet(null);
              }}
              placeholder={
                hasSavedTunnelToken
                  ? t("transport.http.tokenSavedPlaceholder")
                  : t("transport.http.tokenDefaultPlaceholder")
              }
              className={monoInput}
            />
            <p className="text-[11px] text-fg-muted leading-snug">
              {t("transport.http.tokenMinLength")}
              {hasSavedTunnelToken && !tunnelToken && t("transport.http.tokenSavedNotice")}
            </p>
            {generatedTokenSnippet && (
              <div className="space-y-1.5 rounded-md border border-line p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-fg-muted">
                    {t("transport.http.snippetLabel")}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(generatedTokenSnippet, "snippet")}
                    className={ghostBtn}
                  >
                    <Copy className="w-3 h-3" />
                    {copiedItem === "snippet" ? t("transport.http.copied") : t("transport.http.copy")}
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-fg whitespace-pre-wrap break-all select-all">
                  {generatedTokenSnippet}
                </pre>
                <p className="text-[11px] text-fg-muted leading-snug">
                  {t("transport.http.snippetLostWarning")}
                </p>
              </div>
            )}
          </div>
          {isSqlite ? (
            <p className="text-[11px] text-fg-muted leading-snug">
              {t("transport.http.sqliteServerHintPrefix")}
              <code>PYRO_TUNNEL_SQLITE_DIR</code>
              {t("transport.http.sqliteServerHintSuffix")}
            </p>
          ) : (
          <details className="text-[11px] text-fg-muted">
            <summary className="cursor-pointer select-none hover:text-fg">
              {t("transport.http.allowlistSummary")}
            </summary>
            <div className="mt-1.5 space-y-1.5 leading-snug">
              <p>
                {t("transport.http.allowlistIntro1")}<code>localhost</code>, <code>127.0.0.1</code>,{" "}
                <code>::1</code>{t("transport.http.allowlistIntro2")}
                <code>PYRO_TUNNEL_ALLOWED_DB_HOSTS</code>{t("transport.http.allowlistIntro3")}
                <code>$allowedDbHosts</code>{t("transport.http.allowlistIntro4")}
                <code>localhost</code>{t("transport.http.allowlistIntro5")}
              </p>
              <ul className="space-y-0.5 font-mono">
                <li>
                  db.miempresa.com <span className="font-sans">{t("transport.http.allowlistExactHost")}</span>
                </li>
                <li>
                  *.miempresa.com{" "}
                  <span className="font-sans">{t("transport.http.allowlistSubdomains")}</span>
                </li>
                <li>
                  10.0.0.0/8, fd00::/8 <span className="font-sans">{t("transport.http.allowlistCidr")}</span>
                </li>
                <li className="flex items-start gap-1">
                  <AlertCircle className="w-3 h-3 mt-0.5 text-danger shrink-0" />
                  <span>
                    * <span className="font-sans">{t("transport.http.allowlistWildcard")}</span>
                  </span>
                </li>
              </ul>
              <p>
                {t("transport.http.allowlistWildcardNote1")}<code>*</code>{t("transport.http.allowlistWildcardNote2")}
              </p>
              <p>
                {t("transport.http.allowlistPorts1")}<code>3306,3307</code>{t("transport.http.allowlistPorts2")}
                <code>PYRO_TUNNEL_ALLOWED_DB_PORTS</code>{t("transport.http.allowlistPorts3")}<code>$allowedDbPorts</code>{t("transport.http.allowlistPorts4")}
                <code>3306,3300-3310</code>{t("transport.http.allowlistPorts5")}<code>*</code>{t("transport.http.allowlistPorts6")}
              </p>
            </div>
          </details>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={labelCls}>{t("transport.http.httpUser")}</label>
              <input
                type="text"
                value={tunnelUser}
                onChange={(e) => setTunnelUser(e.target.value)}
                placeholder=".htaccess"
                className={monoInput}
              />
            </div>
            <div className="space-y-1">
              <label className={`${labelCls} flex items-center justify-between`}>
                <span>{t("transport.http.httpPassword")}</span>
                <button
                  type="button"
                  onClick={() => setShowTunnelPassword(!showTunnelPassword)}
                  className="text-fg-muted hover:text-fg"
                  title={showTunnelPassword ? t("server.hide") : t("server.show")}
                >
                  {showTunnelPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </label>
              <input
                type={showTunnelPassword ? "text" : "password"}
                value={tunnelPassword}
                onChange={(e) => setTunnelPassword(e.target.value)}
                placeholder="••••••••"
                className={monoInput}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={tunnelEncodeBase64}
              onChange={(e) => setTunnelEncodeBase64(e.target.checked)}
              className="w-3.5 h-3.5 accent-[var(--color-accent)]"
            />
            {t("transport.http.encodeBase64")} <span className="text-fg-muted">{t("transport.http.recommended")}</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg">
            {t("transport.http.timeoutLabel")}
            <input
              type="number"
              min={1}
              max={120}
              value={tunnelTimeoutSec}
              onChange={(e) => setTunnelTimeoutSec(Number(e.target.value))}
              aria-label={t("transport.http.timeoutAriaLabel")}
              className={`${monoInput} w-20`}
            />
            <span className="text-fg-muted">{t("transport.http.timeoutUnit")}</span>
          </label>
        </div>
      )}

      {transport === "ssh" && (
        <div className="space-y-2 pl-3 border-l-2 border-line">
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <div className="space-y-1">
              <label className={labelCls}>{t("transport.ssh.host")}</label>
              <input
                required
                value={sshHost}
                onChange={(event) => setSshHost(event.target.value)}
                placeholder="bastion.midominio.com"
                className={monoInput}
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>{t("transport.ssh.port")}</label>
              <input
                type="number"
                min={1}
                max={65535}
                required
                value={sshPort}
                onChange={(event) => setSshPort(Number(event.target.value) || 22)}
                className={monoInput}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>{t("transport.ssh.user")}</label>
              <input
                required
                value={sshUser}
                onChange={(event) => setSshUser(event.target.value)}
                className={monoInput}
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>{t("transport.ssh.auth")}</label>
              <select
                value={sshAuthentication}
                onChange={(event) => setSshAuthentication(event.target.value as SshAuthentication)}
                className={inputCls}
              >
                <option value="agent">{t("transport.ssh.authAgent")}</option>
                <option value="private_key">{t("transport.ssh.authPrivateKey")}</option>
              </select>
            </div>
          </div>
          {sshAuthentication === "private_key" && (
            <input
              required
              value={sshPrivateKeyPath}
              onChange={(event) => setSshPrivateKeyPath(event.target.value)}
              placeholder={t("transport.ssh.privateKeyPlaceholder")}
              className={monoInput}
            />
          )}
        </div>
      )}
    </section>
    <SaveTunnelScriptModal
      isOpen={showSaveScriptModal}
      onClose={() => setShowSaveScriptModal(false)}
      kind={isSqlite ? "sqlite" : "mysql"}
      initialToken={tunnelToken}
      onTokenUsed={(token) => {
        setTunnelToken(token);
        setGeneratedTokenSnippet(null);
      }}
    />
    </>
  );
}
