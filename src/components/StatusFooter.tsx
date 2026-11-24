import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  RotateCcw,
  WifiOff,
  Loader2,
  Lock,
  ArrowLeftRight,
} from "lucide-react";
import { canSwitchLiveTunnel, switchLiveTransport } from "./connectionTransport";
import type { ConnectionConfig, ConnectionStatus, EnvironmentTag } from "../types/database";
import { useConnectionStore } from "../stores/connectionStore";
import { dbService } from "../services/tauriDb";
import { useUIStore } from "../stores/uiStore";
import { errorText } from "../utils/errors";

interface StatusFooterProps {
  connectionStatus: ConnectionStatus;
  activeDatabase?: string;
  activeTable?: string;
}

export const StatusFooter: React.FC<StatusFooterProps> = ({
  connectionStatus,
  activeDatabase,
  activeTable,
}) => {
  const { t } = useTranslation("shell");
  const { connect, isSwitchingTransport } = useConnectionStore();
  const [pingMs, setPingMs] = useState<number | null>(
    connectionStatus.server_info?.ping_ms ?? null,
  );
  const [isPinging, setIsPinging] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [hasPingError, setHasPingError] = useState(false);

  const envTag = (connectionStatus.config?.environment || "local") as EnvironmentTag;
  const envLabel = t(`statusBar.env.${envTag}`);
  const isProd = connectionStatus.config?.environment === "production";

  const cfg = connectionStatus.config as ConnectionConfig | undefined;
  const isSshTunnel = Boolean(cfg && "ssh_tunnel" in cfg && cfg.ssh_tunnel?.enabled);
  const isHttpTunnel = Boolean(
    (cfg && "tunnel" in cfg && cfg.tunnel?.enabled) ||
    (cfg && "tunnel_enabled" in cfg && (cfg as any).tunnel_enabled)
  );

  // Tunnel classification
  const tunnelType = isSshTunnel
    ? t("statusBar.sshTunnel")
    : isHttpTunnel
    ? t("statusBar.httpTunnel")
    : t("statusBar.direct");

  const handlePing = useCallback(async () => {
    if (!connectionStatus.is_connected) return;
    setIsPinging(true);
    try {
      const ms = await dbService.pingDatabase();
      setPingMs(ms);
      setHasPingError(false);
    } catch {
      setHasPingError(true);
    } finally {
      setIsPinging(false);
    }
  }, [connectionStatus.is_connected]);

  // Periodic ping telemetry every 25 seconds
  useEffect(() => {
    if (!connectionStatus.is_connected) {
      setPingMs(null);
      setHasPingError(false);
      return;
    }

    setPingMs(connectionStatus.server_info?.ping_ms ?? null);
    const interval = setInterval(() => {
      handlePing();
    }, 25000);

    return () => clearInterval(interval);
  }, [connectionStatus.is_connected, connectionStatus.server_info?.ping_ms, handlePing]);

  const handleReconnect = async () => {
    if (!connectionStatus.config) return;
    const activeCfg = connectionStatus.config as ConnectionConfig;
    const fullConfig: ConnectionConfig = {
      ...activeCfg,
      user: activeCfg.user || (connectionStatus.config as any).username || "root",
    };
    setIsReconnecting(true);
    try {
      await connect(fullConfig);
      setHasPingError(false);
    } catch (err) {
      console.error("Error al reconectar:", err);
      useUIStore.getState().showAlert({
        title: t("statusBar.reconnectErrorTitle"),
        message: errorText(err),
        variant: "danger",
      });
    } finally {
      setIsReconnecting(false);
    }
  };

  const sep = <span className="text-line-strong">·</span>;
  const pingBad = hasPingError || (pingMs ?? 0) >= 200;

  return (
    <footer className="pyro-statusbar h-6 px-3 flex items-center justify-between gap-3 text-[11px] select-none border-t bg-canvas border-line text-fg-muted">
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            connectionStatus.is_connected && !hasPingError
              ? "bg-success"
              : hasPingError
              ? "bg-warning"
              : "bg-fg-subtle"
          }`}
        />
        {connectionStatus.is_connected && connectionStatus.config ? (
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="truncate text-fg"
            title={`${connectionStatus.config.user}@${connectionStatus.config.host}:${connectionStatus.config.port} — ${tunnelType} — ${envLabel}`}
          >
            {connectionStatus.config.savedConnectionName || connectionStatus.config.host}
          </span>
        ) : (
          <span role="status" aria-live="polite" aria-atomic="true">{t("statusBar.disconnected")}</span>
        )}
        {hasPingError && <span role="status" aria-live="polite" className="text-warning">{t("statusBar.unstableConnection")}</span>}
        {isReconnecting && <span role="status" aria-live="polite" className="text-fg-muted">{t("statusBar.reconnecting")}</span>}
        {connectionStatus.is_connected && canSwitchLiveTunnel(cfg) ? (
          <>
            {sep}
            <button
              type="button"
              disabled={isSwitchingTransport}
              onClick={() => void switchLiveTransport()}
              title={
                isHttpTunnel
                  ? t("statusBar.switchToDirectTitle")
                  : t("statusBar.switchToHttpTitle")
              }
              className="shrink-0 inline-flex items-center gap-1 px-1 rounded hover:bg-hover hover:text-fg disabled:opacity-60"
            >
              {isSwitchingTransport ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ArrowLeftRight className="w-3 h-3" />
              )}
              {isSwitchingTransport ? t("statusBar.switching") : isHttpTunnel ? t("statusBar.httpTunnelShort") : t("statusBar.directShort")}
            </button>
          </>
        ) : (
          connectionStatus.is_connected &&
          tunnelType !== t("statusBar.direct") && (
            <>
              {sep}
              <span className="shrink-0">{tunnelType}</span>
            </>
          )
        )}
        {connectionStatus.is_connected && cfg?.read_only && (
          <>
            {sep}
            <span
              className="flex items-center gap-1 shrink-0"
              title={t("statusBar.readOnlyTitle")}
            >
              <Lock className="w-3 h-3" />
              {t("statusBar.readOnly")}
            </span>
          </>
        )}
        {connectionStatus.is_connected && isProd && (
          <>
            {sep}
            <span className="text-danger font-semibold shrink-0">PROD</span>
          </>
        )}
        {(!connectionStatus.is_connected || hasPingError) && connectionStatus.config && (
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            aria-busy={isReconnecting}
            aria-label={isReconnecting ? t("statusBar.reconnectingAria") : t("statusBar.reconnectAria")}
            className="flex items-center gap-1 text-accent hover:underline shrink-0"
            title={t("statusBar.reconnectAria")}
          >
            {isReconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            {t("statusBar.reconnect")}
          </button>
        )}
        {activeDatabase && (
          <>
            {sep}
            <span className="truncate font-mono">
              {activeDatabase}
              {activeTable ? ` / ${activeTable}` : ""}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 font-mono">
        {connectionStatus.is_connected && connectionStatus.server_info && (
          <>
            <span title={t("statusBar.serverVersionTitle")}>{connectionStatus.server_info.version}</span>
            {sep}
            <button
              onClick={handlePing}
              disabled={isPinging}
              className={`flex items-center gap-1 hover:text-fg ${pingBad ? "text-danger" : ""}`}
              title={t("statusBar.latencyTitle")}
              aria-label={
                isPinging
                  ? t("statusBar.measuringLatency")
                  : hasPingError
                    ? t("statusBar.latencyErrorAria")
                    : t("statusBar.latencyAria", {
                        value: pingMs !== null ? t("statusBar.latencyMs", { ms: pingMs }) : t("statusBar.latencyUnavailable"),
                      })
              }
            >
              {isPinging ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : hasPingError ? (
                <WifiOff className="w-3 h-3" />
              ) : null}
              {hasPingError ? "Timeout" : pingMs !== null ? `${pingMs} ms` : "—"}
            </button>
            {sep}
          </>
        )}
        <span title={t("statusBar.appVersionTitle")}>PyroStudio v{__APP_VERSION__}</span>
      </div>
    </footer>
  );
};
