import {
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { inputCls, monoInput } from "./formConstants";
import type { ConnectionForm } from "./useConnectionForm";

/** Cifrado TLS y verificación del certificado. */
export function TlsSection({ tlsConfigured, setTlsConfigured, tlsEnabled, setTlsEnabled, tlsCaCertPath, setTlsCaCertPath, tlsVerifyCertificate, setTlsVerifyCertificate, advancedSections, toggleSection, saveSuccessMsg, testResult, isSqlite, transport }: Pick<ConnectionForm, "tlsConfigured" | "setTlsConfigured" | "tlsEnabled" | "setTlsEnabled" | "tlsCaCertPath" | "setTlsCaCertPath" | "tlsVerifyCertificate" | "setTlsVerifyCertificate" | "advancedSections" | "toggleSection" | "saveSuccessMsg" | "testResult" | "isSqlite" | "transport">) {
  return (
    <>
    {transport !== "http" && !isSqlite && (
      <section className="border-t border-line pt-3">
        <button
          type="button"
          onClick={() => toggleSection("tls")}
          className="w-full flex items-center justify-between text-left text-[11px] font-medium text-fg-muted hover:text-fg"
        >
          <span className="flex items-center gap-1.5">
            {advancedSections.tls ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Seguridad SSL / TLS
          </span>
          <span className="font-normal">
            {!tlsConfigured ? "Automático" : tlsEnabled ? "Requerido" : "Deshabilitado"}
          </span>
        </button>

        {advancedSections.tls && (
          <div className="mt-2.5 space-y-2 pl-5">
            <select
              aria-label="Modo TLS"
              value={!tlsConfigured ? "auto" : tlsEnabled ? "required" : "disabled"}
              onChange={(event) => {
                setTlsConfigured(event.target.value !== "auto");
                setTlsEnabled(event.target.value === "required");
              }}
              className={inputCls}
            >
              <option value="auto">Negociación automática</option>
              <option value="required">Requerir + verificar</option>
              <option value="disabled">Deshabilitado</option>
            </select>

            {tlsEnabled && (
              <>
                <label className="flex items-center gap-2 text-xs text-fg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tlsVerifyCertificate}
                    onChange={(event) => setTlsVerifyCertificate(event.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                  />
                  Verificar certificado y nombre del servidor
                </label>
                <input
                  type="text"
                  value={tlsCaCertPath}
                  onChange={(event) => setTlsCaCertPath(event.target.value)}
                  placeholder="Ruta del certificado CA (opcional)"
                  className={monoInput}
                />
              </>
            )}
          </div>
        )}
      </section>
    )}

    {saveSuccessMsg && (
      <div className="flex items-center gap-2 text-xs text-fg animate-in fade-in">
        <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
        <span>{saveSuccessMsg}</span>
      </div>
    )}

    {testResult && (
      <div className="flex items-start gap-2 text-xs text-fg p-2.5 rounded-md border border-line bg-canvas">
        {testResult.success ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
        ) : (
          <AlertCircle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="break-words">{testResult.message}</p>
          {testResult.serverInfo && (
            <p className="mt-0.5 text-[11px] text-fg-muted">
              {testResult.serverInfo.ping_ms} ms · {testResult.serverInfo.current_user}
            </p>
          )}
          {testResult.serverInfo?.warnings?.map((warning) => (
            <p key={warning} className="mt-1 flex items-start gap-1 text-[11px] text-fg-muted">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0 text-warning" />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      </div>
    )}
    </>
  );
}
