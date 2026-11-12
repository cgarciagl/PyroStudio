import type { SshAuthentication } from "../../types/database";
import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Copy,
} from "lucide-react";
import { ghostBtn } from "../ui/styles";
import { inputCls, monoInput, labelCls, sectionTitle } from "./formConstants";
import type { ConnectionForm } from "./useConnectionForm";

/** Tipo de conexión: directa, túnel HTTP o túnel SSH, con sus opciones. */
export function TransportSection({ tunnelUrl, setTunnelUrl, tunnelUser, setTunnelUser, tunnelPassword, setTunnelPassword, tunnelToken, setTunnelToken, tunnelEncodeBase64, setTunnelEncodeBase64, tunnelTimeoutSec, setTunnelTimeoutSec, generatedTokenSnippet, setGeneratedTokenSnippet, copiedItem, handleGenerateTunnelToken, copyToClipboard, sshHost, setSshHost, sshPort, setSshPort, sshUser, setSshUser, sshAuthentication, setSshAuthentication, sshPrivateKeyPath, setSshPrivateKeyPath, showTunnelPassword, setShowTunnelPassword, hasSavedTunnelToken, isSqlite, transport, setTransport, TRANSPORT_OPTIONS }: Pick<ConnectionForm, "tunnelUrl" | "setTunnelUrl" | "tunnelUser" | "setTunnelUser" | "tunnelPassword" | "setTunnelPassword" | "tunnelToken" | "setTunnelToken" | "tunnelEncodeBase64" | "setTunnelEncodeBase64" | "tunnelTimeoutSec" | "setTunnelTimeoutSec" | "generatedTokenSnippet" | "setGeneratedTokenSnippet" | "copiedItem" | "handleGenerateTunnelToken" | "copyToClipboard" | "sshHost" | "setSshHost" | "sshPort" | "setSshPort" | "sshUser" | "setSshUser" | "sshAuthentication" | "setSshAuthentication" | "sshPrivateKeyPath" | "setSshPrivateKeyPath" | "showTunnelPassword" | "setShowTunnelPassword" | "hasSavedTunnelToken" | "isSqlite" | "transport" | "setTransport" | "TRANSPORT_OPTIONS">) {
  return (
    <>
    <section className="space-y-2.5">
      <div className={sectionTitle}>Tipo de conexión</div>
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
            <label className={labelCls}>
              URL del script ({isSqlite ? "pyro_tunnel_sqlite.php" : "pyro_tunnel.php"})
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
              <span>Token del túnel</span>
              <span className="flex items-center gap-1">
                {tunnelToken && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(tunnelToken, "token")}
                    className={ghostBtn}
                  >
                    <Copy className="w-3 h-3" />
                    {copiedItem === "token" ? "Copiado" : "Copiar token"}
                  </button>
                )}
                <button type="button" onClick={handleGenerateTunnelToken} className={ghostBtn}>
                  <KeyRound className="w-3 h-3" />
                  Generar token
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
                  ? "Guardado en el almacén seguro (vacío = conservar)"
                  : "Mismo valor que PYRO_TUNNEL_TOKEN en el servidor"
              }
              className={monoInput}
            />
            <p className="text-[11px] text-fg-muted leading-snug">
              Mínimo 16 caracteres.
              {hasSavedTunnelToken &&
                !tunnelToken &&
                " El token guardado no se puede mostrar ni copiar: si lo necesita, genere uno nuevo."}
            </p>
            {generatedTokenSnippet && (
              <div className="space-y-1.5 rounded-md border border-line p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-fg-muted">
                    Configúrelo en el servidor (una de las dos formas):
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(generatedTokenSnippet, "snippet")}
                    className={ghostBtn}
                  >
                    <Copy className="w-3 h-3" />
                    {copiedItem === "snippet" ? "Copiado" : "Copiar"}
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-fg whitespace-pre-wrap break-all select-all">
                  {generatedTokenSnippet}
                </pre>
                <p className="text-[11px] text-fg-muted leading-snug">
                  Si lo pierdes, genera uno nuevo y actualízalo en el servidor y aquí; el
                  token solo autoriza el túnel y no hay recuperación.
                </p>
              </div>
            )}
          </div>
          {isSqlite ? (
            <p className="text-[11px] text-fg-muted leading-snug">
              El archivo debe existir en el servidor. Para limitar los archivos accesibles,
              defina <code>PYRO_TUNNEL_SQLITE_DIR</code> con la carpeta permitida.
            </p>
          ) : (
          <details className="text-[11px] text-fg-muted">
            <summary className="cursor-pointer select-none hover:text-fg">
              ¿Qué bases de datos puede alcanzar el túnel? (allowlist)
            </summary>
            <div className="mt-1.5 space-y-1.5 leading-snug">
              <p>
                Por defecto, solo localhost (<code>localhost</code>, <code>127.0.0.1</code>,{" "}
                <code>::1</code>). Para ampliarlo, defina en el servidor{" "}
                <code>PYRO_TUNNEL_ALLOWED_DB_HOSTS</code> (separado por comas) o{" "}
                <code>$allowedDbHosts</code>. Una lista explícita sustituye al valor por
                defecto: incluya <code>localhost</code> si lo sigue necesitando.
              </p>
              <ul className="space-y-0.5 font-mono">
                <li>
                  db.miempresa.com <span className="font-sans">— host exacto</span>
                </li>
                <li>
                  *.miempresa.com{" "}
                  <span className="font-sans">— subdominios (no el dominio raíz)</span>
                </li>
                <li>
                  10.0.0.0/8, fd00::/8 <span className="font-sans">— rangos CIDR</span>
                </li>
                <li className="flex items-start gap-1">
                  <AlertCircle className="w-3 h-3 mt-0.5 text-danger shrink-0" />
                  <span>
                    * <span className="font-sans">— cualquier host (mayor riesgo)</span>
                  </span>
                </li>
              </ul>
              <p>
                Con <code>*</code> el túnel puede alcanzar cualquier host que vea el servidor
                PHP, incluida su red interna: quien tenga el token puede usarlo como puente.
                Protéjalo con un token fuerte y HTTPS. Aun así, 169.254.0.0/16 (metadatos de
                la nube), 0.0.0.0/8, fe80::/10 y multicast siempre se bloquean, y los nombres
                se validan por la IP a la que resuelven.
              </p>
              <p>
                Puertos: por defecto solo <code>3306,3307</code>. Para otros, defina{" "}
                <code>PYRO_TUNNEL_ALLOWED_DB_PORTS</code> (o <code>$allowedDbPorts</code>), p. ej.{" "}
                <code>3306,3300-3310</code>; <code>*</code> admite cualquiera.
              </p>
            </div>
          </details>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={labelCls}>Usuario HTTP (opcional)</label>
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
                <span>Contraseña HTTP</span>
                <button
                  type="button"
                  onClick={() => setShowTunnelPassword(!showTunnelPassword)}
                  className="text-fg-muted hover:text-fg"
                  title={showTunnelPassword ? "Ocultar" : "Mostrar"}
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
            Codificar consultas en Base64 <span className="text-fg-muted">(recomendado)</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg">
            Tiempo de espera por solicitud
            <input
              type="number"
              min={1}
              max={120}
              value={tunnelTimeoutSec}
              onChange={(e) => setTunnelTimeoutSec(Number(e.target.value))}
              aria-label="Tiempo de espera del túnel en segundos"
              className={`${monoInput} w-20`}
            />
            <span className="text-fg-muted">s (máx. 120; el servidor PHP puede cortar antes)</span>
          </label>
        </div>
      )}

      {transport === "ssh" && (
        <div className="space-y-2 pl-3 border-l-2 border-line">
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <div className="space-y-1">
              <label className={labelCls}>Host SSH</label>
              <input
                required
                value={sshHost}
                onChange={(event) => setSshHost(event.target.value)}
                placeholder="bastion.midominio.com"
                className={monoInput}
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Puerto</label>
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
              <label className={labelCls}>Usuario SSH</label>
              <input
                required
                value={sshUser}
                onChange={(event) => setSshUser(event.target.value)}
                className={monoInput}
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Autenticación</label>
              <select
                value={sshAuthentication}
                onChange={(event) => setSshAuthentication(event.target.value as SshAuthentication)}
                className={inputCls}
              >
                <option value="agent">Agente SSH</option>
                <option value="private_key">Clave privada local</option>
              </select>
            </div>
          </div>
          {sshAuthentication === "private_key" && (
            <input
              required
              value={sshPrivateKeyPath}
              onChange={(event) => setSshPrivateKeyPath(event.target.value)}
              placeholder="Ruta de clave privada (p. ej. ~/.ssh/id_ed25519)"
              className={monoInput}
            />
          )}
        </div>
      )}
    </section>
    </>
  );
}
