import React, { useEffect, useState } from "react";
import {
  connectionEngine,
  type ConnectionConfig,
  type DbEngine,
  type EnvironmentTag,
  type SavedConnection,
  type ServerInfo,
  type SshAuthentication,
  type SshTunnelConfig,
  type TlsConfig,
} from "../../types/database";
import { connectionStorage } from "../../services/connectionStorage";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUIStore } from "../../stores/uiStore";
import { dbService } from "../../services/tauriDb";
import { generateTunnelToken, tunnelTokenServerSnippet } from "../../utils/tunnelToken";
import { fileName } from "../connectionTransport";
import { MISSING_PASSWORD_HINT, useMissingCredentials } from "../missingCredential";
import { uid } from "../../utils/uid";
import { errorText, reportError } from "../../utils/errors";
import {
  buildConnectConfig,
  buildProfile,
  credentialIdsFor,
  saveSecrets,
  type ConnectionDraft,
} from "../connection/connectionDraft";

import { DEFAULT_TUNNEL_URL, transportOptions } from "./formConstants";

export interface ConnectionFormProps {
  isOpen: boolean;
  onConnect: (config: ConnectionConfig) => Promise<void>;
  onTest: (config: ConnectionConfig) => Promise<ServerInfo>;
  initialProfile?: SavedConnection;
  onProfilesUpdated?: () => void;
}

/**
 * State and actions of the connection dialog: saved profiles, the form, secrets,
 * testing and connecting. The sections are views over it and take only what they use.
 */
export function useConnectionForm({ isOpen, onConnect, onTest, initialProfile, onProfilesUpdated }: ConnectionFormProps) {
  const [savedProfiles, setSavedProfiles] = useState<SavedConnection[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");

  // Form state
  const [profileName, setProfileName] = useState("Nueva Conexión");
  const [engine, setEngine] = useState<DbEngine>("mysql");
  const [filePath, setFilePath] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentTag>("local");
  const [readOnly, setReadOnly] = useState(false);
  const [folder, setFolder] = useState("");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(3306);
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");

  // HTTP Tunnel state (PyroTunnel v1 PHP)
  const [useTunnel, setUseTunnel] = useState(false);
  /** The profile already had a tunnel configured: keep it (disabled) when switching to direct. */
  const [hadTunnelConfig, setHadTunnelConfig] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("http://localhost/tunnel/pyro_tunnel.php");
  const [tunnelUser, setTunnelUser] = useState("");
  const [tunnelPassword, setTunnelPassword] = useState("");
  const [tunnelToken, setTunnelToken] = useState("");
  const [tunnelEncodeBase64, setTunnelEncodeBase64] = useState(true);
  /** Seconds the client waits for each tunnel request (backend clamps to 1-120). */
  const [tunnelTimeoutSec, setTunnelTimeoutSec] = useState(30);
  const [generatedTokenSnippet, setGeneratedTokenSnippet] = useState<string | null>(null);
  const [copiedItem, setCopiedItem] = useState<"token" | "snippet" | null>(null);

  const handleGenerateTunnelToken = () => {
    const token = generateTunnelToken();
    setTunnelToken(token);
    setGeneratedTokenSnippet(tunnelTokenServerSnippet(token));
  };

  const copyToClipboard = async (text: string, item: "token" | "snippet") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(item);
      window.setTimeout(() => setCopiedItem(null), 1500);
    } catch {
      useUIStore.getState().showAlert({
        title: "Portapapeles",
        message: "No se pudo copiar al portapapeles.",
        variant: "warning",
      });
    }
  };
  const [tlsConfigured, setTlsConfigured] = useState(false);
  const [tlsEnabled, setTlsEnabled] = useState(false);
  const [tlsCaCertPath, setTlsCaCertPath] = useState("");
  const [tlsVerifyCertificate, setTlsVerifyCertificate] = useState(true);
  const [allowInsecureTls, setAllowInsecureTls] = useState(false);
  const [useSshTunnel, setUseSshTunnel] = useState(false);
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState(22);
  const [sshUser, setSshUser] = useState("");
  const [sshRemoteHost, setSshRemoteHost] = useState("127.0.0.1");
  const [sshRemotePort, setSshRemotePort] = useState(3306);
  const [sshAuthentication, setSshAuthentication] =
    useState<SshAuthentication>("agent");
  const [sshPrivateKeyPath, setSshPrivateKeyPath] = useState("");

  // Progressive Disclosure Accordions
  const [advancedSections, setAdvancedSections] = useState<{
    tls: boolean;
    ssh: boolean;
    tunnel: boolean;
  }>({
    tls: false,
    ssh: false,
    tunnel: false,
  });

  const toggleSection = (section: "tls" | "ssh" | "tunnel") => {
    setAdvancedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const [showPassword, setShowPassword] = useState(false);
  const [showTunnelPassword, setShowTunnelPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    serverInfo?: ServerInfo;
  } | null>(null);

  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const workspaceActive = useWorkspaceStore((s) => !!s.status && s.status.availability !== "local");
  // Only written: the tunnel always sends its vault id when no password is typed.
  const [, setHasSavedTunnelPassword] = useState(false);
  const [hasSavedTunnelToken, setHasSavedTunnelToken] = useState(false);
  const [currentCredentialId, setCurrentCredentialId] = useState<string | null>(null);
  const [currentTunnelCredentialId, setCurrentTunnelCredentialId] = useState<string | null>(null);
  const [currentTunnelTokenCredentialId, setCurrentTunnelTokenCredentialId] =
    useState<string | null>(null);
  // Set when the vault master key could not be stored in the OS keychain
  const [vaultFallbackReason, setVaultFallbackReason] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    dbService
      .getVaultStatus()
      .then((status) =>
        setVaultFallbackReason(status.storage === "file_fallback" ? status.reason : null),
      )
      .catch(() => setVaultFallbackReason(null));
  }, [isOpen]);

  // Load profiles on mount or open
  useEffect(() => {
    if (isOpen) {
      const list = connectionStorage.getSavedConnections();
      setSavedProfiles(list);

      if (initialProfile) {
        selectProfile(initialProfile);
      } else {
        const lastId = connectionStorage.getLastActiveProfileId();
        const target = list.find((c) => c.id === lastId) || list[0];

        if (target) {
          selectProfile(target);
        } else {
          resetFormToNew();
        }
      }
    }
  }, [isOpen, initialProfile]);

  const selectProfile = async (profile: SavedConnection) => {
    setSelectedProfileId(profile.id);
    setIsEditingExisting(true);
    setProfileName(profile.name);
    setEngine(connectionEngine(profile));
    setFilePath(profile.filePath || "");
    setEnvironment(profile.environment || "local");
    setReadOnly(Boolean(profile.readOnly));
    setFolder(profile.folder || "");
    setHost(profile.host);
    setPort(profile.port);
    setUser(profile.user);
    setPassword("");
    setDatabase(profile.database || "");
    setTlsConfigured(profile.tls !== undefined);
    setTlsEnabled(profile.tls?.enabled ?? false);
    setTlsCaCertPath(profile.tls?.ca_cert_path || "");
    setTlsVerifyCertificate(profile.tls?.verify_certificate ?? true);
    setAllowInsecureTls(profile.tls?.allow_insecure_tls ?? false);
    setUseSshTunnel(profile.ssh_tunnel?.enabled ?? false);
    setSshHost(profile.ssh_tunnel?.ssh_host || "");
    setSshPort(profile.ssh_tunnel?.ssh_port || 22);
    setSshUser(profile.ssh_tunnel?.ssh_user || "");
    setSshRemoteHost(profile.ssh_tunnel?.remote_host || "127.0.0.1");
    setSshRemotePort(profile.ssh_tunnel?.remote_port || profile.port || 3306);
    setSshAuthentication(profile.ssh_tunnel?.authentication || "agent");
    setSshPrivateKeyPath(profile.ssh_tunnel?.private_key_path || "");

    const credId = profile.credentialId || `cred-${profile.id}`;
    setCurrentCredentialId(credId);
    let hasCred = false;
    try {
      hasCred = await dbService.hasCredential(credId);
    } catch {
      hasCred = false;
    }
    setHasSavedPassword(hasCred);

    if (profile.tunnel && (profile.tunnel.enabled || profile.tunnel.url?.trim())) {
      setUseTunnel(!!profile.tunnel.enabled);
      setHadTunnelConfig(true);
      setTunnelUrl(profile.tunnel.url || "http://localhost/tunnel/pyro_tunnel.php");
      setTunnelUser(profile.tunnel.http_user || "");
      setTunnelPassword("");
      setTunnelToken("");
      setGeneratedTokenSnippet(null);
      const tCredId =
        profile.tunnel.tunnel_credential_id ||
        profile.tunnelCredentialId ||
        `tunnel-cred-${profile.id}`;
      setCurrentTunnelCredentialId(tCredId);
      let hasTCred = false;
      try {
        hasTCred = await dbService.hasCredential(tCredId);
      } catch {
        hasTCred = false;
      }
      setHasSavedTunnelPassword(hasTCred);
      const tokenCredentialId =
        profile.tunnel.token_credential_id || `tunnel-token-cred-${profile.id}`;
      setCurrentTunnelTokenCredentialId(tokenCredentialId);
      const hasToken = await dbService.hasCredential(tokenCredentialId).catch(() => false);
      setHasSavedTunnelToken(hasToken);
      setTunnelEncodeBase64(profile.tunnel.encode_base64 ?? true);
      setTunnelTimeoutSec(profile.tunnel.timeout_seconds ?? 30);
      setAdvancedSections({
        tunnel: true,
        ssh: !!(profile.ssh_tunnel && profile.ssh_tunnel.enabled),
        tls: !!(profile.tls && (profile.tls.enabled || profile.tls.ca_cert_path)),
      });
    } else {
      setUseTunnel(false);
      setHadTunnelConfig(false);
      setTunnelUrl("http://localhost/tunnel/pyro_tunnel.php");
      setTunnelUser("");
      setTunnelPassword("");
      setTunnelToken("");
      setGeneratedTokenSnippet(null);
      setHasSavedTunnelPassword(false);
      setHasSavedTunnelToken(false);
      setCurrentTunnelCredentialId(null);
      setCurrentTunnelTokenCredentialId(null);
      setTunnelEncodeBase64(true);
    setTunnelTimeoutSec(30);
      setTlsConfigured(false);
      setTlsEnabled(false);
      setTlsCaCertPath("");
      setTlsVerifyCertificate(true);
      setAllowInsecureTls(false);
      setUseSshTunnel(false);
      setSshHost("");
      setSshPort(22);
      setSshUser("");
      setSshRemoteHost("127.0.0.1");
      setSshRemotePort(3306);
      setSshAuthentication("agent");
      setSshPrivateKeyPath("");
      setAdvancedSections({
        tunnel: false,
        ssh: !!(profile.ssh_tunnel && profile.ssh_tunnel.enabled),
        tls: !!(profile.tls && (profile.tls.enabled || profile.tls.ca_cert_path)),
      });
    }

    setTestResult(null);
    setSaveSuccessMsg(null);
  };

  const resetFormToNew = () => {
    const newId = `conn-${uid()}`;
    setSelectedProfileId(newId);
    setCurrentCredentialId(`cred-${newId}`);
    setCurrentTunnelCredentialId(`tunnel-cred-${newId}`);
    setCurrentTunnelTokenCredentialId(`tunnel-token-cred-${newId}`);
    setIsEditingExisting(false);
    setProfileName("Servidor MariaDB");
    setEngine("mysql");
    setFilePath("");
    setEnvironment("local");
    setReadOnly(false);
    setFolder("");
    setHost("127.0.0.1");
    setPort(3306);
    setUser("root");
    setPassword("");
    setHasSavedPassword(false);
    setDatabase("");
    setUseTunnel(false);
    setHadTunnelConfig(false);
    setTunnelUrl("http://localhost/tunnel/pyro_tunnel.php");
    setTunnelUser("");
    setTunnelPassword("");
    setTunnelToken("");
    setGeneratedTokenSnippet(null);
    setHasSavedTunnelPassword(false);
    setHasSavedTunnelToken(false);
    setTunnelEncodeBase64(true);
    setTunnelTimeoutSec(30);
    setAdvancedSections({ tls: false, ssh: false, tunnel: false });
    setTestResult(null);
    setSaveSuccessMsg(null);
  };

  const getTlsConfig = (): TlsConfig | undefined =>
    tlsConfigured
      ? {
          enabled: tlsEnabled,
          ca_cert_path: tlsCaCertPath.trim() || undefined,
          verify_certificate: tlsVerifyCertificate,
          allow_insecure_tls: allowInsecureTls,
        }
      : undefined;

  const getSshConfig = (): SshTunnelConfig | undefined => {
    if (!useSshTunnel) return undefined;
    return {
      enabled: true,
      ssh_host: sshHost.trim(),
      ssh_port: sshPort,
      ssh_user: sshUser.trim(),
      remote_host: sshRemoteHost.trim(),
      remote_port: sshRemotePort,
      authentication: sshAuthentication,
      private_key_path: sshPrivateKeyPath.trim() || undefined,
    };
  };

  const isSqlite = engine === "sqlite";
  const defaultProfileName = () => (isSqlite ? fileName(filePath) : `${host}:${port}`);

  /** Snapshot of the form for the pure builders (save, connect and test share it). */
  const makeDraft = (): ConnectionDraft => {
    const id = selectedProfileId || `conn-${uid()}`;
    return {
      id,
      name: profileName,
      engine,
      filePath: filePath.trim() || undefined,
      host,
      port,
      user,
      password,
      hasSavedPassword,
      database,
      environment,
      readOnly,
      folder,
      useTunnel,
      hadTunnelConfig,
      tunnelUrl,
      tunnelUser,
      tunnelPassword,
      tunnelToken,
      tunnelEncodeBase64,
      tunnelTimeoutSec,
      tls: getTlsConfig(),
      ssh: getSshConfig(),
      ids: credentialIdsFor(id, isSqlite, {
        database: currentCredentialId,
        tunnel: currentTunnelCredentialId,
        token: currentTunnelTokenCredentialId,
      }),
      createdAt: savedProfiles.find((p) => p.id === id)?.createdAt,
    };
  };

  /** Store typed secrets and reflect only the ones that really were stored. */
  const storeSecrets = async (draft: ConnectionDraft) => {
    const saved = await saveSecrets(draft, dbService.saveCredential, (title, err) =>
      reportError(
        title,
        err,
        title === "No se guardó la contraseña"
          ? "La contraseña no se pudo guardar en el almacén seguro. Revise el llavero del sistema o intente guardar de nuevo; sin esto tendrá que escribirla en cada conexión."
          : undefined,
      ),
    );
    if (saved.password) setHasSavedPassword(true);
    if (saved.tunnelPassword) setHasSavedTunnelPassword(true);
    if (saved.tunnelToken) setHasSavedTunnelToken(true);
  };

  const handleSaveProfile = async () => {
    const draft = makeDraft();
    await storeSecrets(draft);
    let updated: SavedConnection[];
    try {
      updated = await connectionStorage.persistConnection(buildProfile(draft, defaultProfileName()));
    } catch (e) {
      reportError("No se pudo guardar en el espacio de trabajo", e);
      return;
    }
    setSavedProfiles(updated);
    setSelectedProfileId(draft.id);
    setIsEditingExisting(true);
    onProfilesUpdated?.();
    setSaveSuccessMsg("¡Perfil guardado en el almacén seguro (Vault AES-256)!");
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const [profileToDelete, setProfileToDelete] = useState<{ id: string; name: string } | null>(null);

  const handleDeleteProfile = (id: string, name?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setProfileToDelete({ id, name: name || profileName || "este perfil" });
  };

  const executeDeleteProfile = async () => {
    if (!profileToDelete) return;
    const { id } = profileToDelete;
    let updated: SavedConnection[];
    try {
      updated = await connectionStorage.removeConnection(id);
    } catch (e) {
      useUIStore.getState().showAlert({
        title: "No se pudo guardar en el espacio de trabajo",
        message: e instanceof Error ? e.message : String(e),
        variant: "danger",
        icon: "alert",
      });
      setProfileToDelete(null);
      return;
    }
    setSavedProfiles(updated);
    onProfilesUpdated?.();
    if (selectedProfileId === id) {
      if (updated.length > 0) {
        selectProfile(updated[0]);
      } else {
        resetFormToNew();
      }
    }
    setProfileToDelete(null);
  };

  const handleDuplicateProfile = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    let updated: SavedConnection[];
    try {
      updated = await connectionStorage.duplicateConnectionAsync(id);
    } catch (err) {
      useUIStore.getState().showAlert({
        title: "No se pudo duplicar la conexión",
        message: err instanceof Error ? err.message : String(err),
        variant: "danger",
        icon: "alert",
      });
      return;
    }
    setSavedProfiles(updated);
    onProfilesUpdated?.();
    if (updated.length > 0) {
      selectProfile(updated[0]);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    // Newly typed secrets are stored right away (failures are reported, not hidden).
    const draft = makeDraft();
    await storeSecrets(draft);
    const testConfig = buildConnectConfig(draft, "test");

    try {
      const info = await onTest(testConfig);
      setTestResult({
        success: true,
        message: useTunnel
          ? `¡Conexión exitosa vía Túnel HTTP! (${info.version})`
          : `¡Conexión exitosa! (${info.version})`,
        serverInfo: info,
      });
    } catch (err: unknown) {
      const errorMsg =
        errorText(err, "Fallo al conectar");
      setTestResult({
        success: false,
        message: errorMsg,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const draft = makeDraft();
    await storeSecrets(draft);

    // Connecting must not be blocked by an unreachable workspace folder.
    await connectionStorage
      .persistConnection({ ...buildProfile(draft, defaultProfileName()), lastConnectedAt: Date.now() })
      .catch((e) => {
        console.warn("Profile not persisted before connecting:", e);
      });
    connectionStorage.markConnected(draft.id);
    onProfilesUpdated?.();

    const connConfig = buildConnectConfig(draft, "connect");

    setTestResult(null);
    try {
      await onConnect(connConfig);
    } catch (err: unknown) {
      const errorMsg =
        errorText(err, "Fallo al conectar");
      setTestResult({
        success: false,
        message:
          !isSqlite && !password && !hasSavedPassword
            ? `${errorMsg} — ${MISSING_PASSWORD_HINT}`
            : errorMsg,
      });
    }
  };

  const missingCredentials = useMissingCredentials(savedProfiles);

  const filteredProfiles = savedProfiles.filter((p) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.host.toLowerCase().includes(q) ||
      p.user.toLowerCase().includes(q) ||
      (p.database && p.database.toLowerCase().includes(q)) ||
      (p.filePath && p.filePath.toLowerCase().includes(q))
    );
  });

  const formatLastConnected = (timestamp?: number) => {
    if (!timestamp) return "Nunca";
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Reciente";
    if (mins < 60) return `Hace ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Hace ${hours}h`;
    const days = Math.floor(hours / 24);
    return `Hace ${days}d`;
  };

  const transport: "direct" | "http" | "ssh" = useTunnel ? "http" : useSshTunnel ? "ssh" : "direct";
  const setTransport = (t: "direct" | "http" | "ssh") => {
    setUseTunnel(t === "http");
    setUseSshTunnel(t === "ssh");
  };
  const selectEngine = (next: DbEngine) => {
    setEngine(next);
    if (next === "sqlite") setUseSshTunnel(false);
    // Ajusta el nombre sugerido mientras el usuario no lo haya personalizado.
    if (!isEditingExisting && (profileName === "Servidor MariaDB" || profileName === "Base SQLite")) {
      setProfileName(next === "sqlite" ? "Base SQLite" : "Servidor MariaDB");
    }
    if (tunnelUrl === DEFAULT_TUNNEL_URL[engine]) setTunnelUrl(DEFAULT_TUNNEL_URL[next]);
  };
  const pickSqliteFile = async (create: boolean) => {
    try {
      const chosen = create
        ? await dbService.createSqliteFileDialog()
        : await dbService.openSqliteFileDialog();
      if (!chosen) return;
      setFilePath(chosen);
      if (!isEditingExisting && (profileName === "Servidor MariaDB" || profileName === "Base SQLite")) setProfileName(fileName(chosen));
    } catch (err) {
      useUIStore.getState().showAlert({
        title: create ? "No se pudo crear la base SQLite" : "No se pudo abrir el archivo",
        message: err instanceof Error ? err.message : String(err),
        variant: "danger",
        icon: "alert",
      });
    }
  };
  const TRANSPORT_OPTIONS = transportOptions(isSqlite);

  return {
    savedProfiles,
    setSavedProfiles,
    selectedProfileId,
    setSelectedProfileId,
    isEditingExisting,
    setIsEditingExisting,
    searchFilter,
    setSearchFilter,
    profileName,
    setProfileName,
    engine,
    setEngine,
    filePath,
    setFilePath,
    environment,
    setEnvironment,
    readOnly,
    setReadOnly,
    folder,
    setFolder,
    host,
    setHost,
    port,
    setPort,
    user,
    setUser,
    password,
    setPassword,
    database,
    setDatabase,
    useTunnel,
    setUseTunnel,
    hadTunnelConfig,
    setHadTunnelConfig,
    tunnelUrl,
    setTunnelUrl,
    tunnelUser,
    setTunnelUser,
    tunnelPassword,
    setTunnelPassword,
    tunnelToken,
    setTunnelToken,
    tunnelEncodeBase64,
    setTunnelEncodeBase64,
    tunnelTimeoutSec,
    setTunnelTimeoutSec,
    generatedTokenSnippet,
    setGeneratedTokenSnippet,
    copiedItem,
    setCopiedItem,
    handleGenerateTunnelToken,
    copyToClipboard,
    tlsConfigured,
    setTlsConfigured,
    tlsEnabled,
    setTlsEnabled,
    tlsCaCertPath,
    setTlsCaCertPath,
    tlsVerifyCertificate,
    setTlsVerifyCertificate,
    allowInsecureTls,
    setAllowInsecureTls,
    useSshTunnel,
    setUseSshTunnel,
    sshHost,
    setSshHost,
    sshPort,
    setSshPort,
    sshUser,
    setSshUser,
    sshRemoteHost,
    setSshRemoteHost,
    sshRemotePort,
    setSshRemotePort,
    sshAuthentication,
    setSshAuthentication,
    sshPrivateKeyPath,
    setSshPrivateKeyPath,
    advancedSections,
    setAdvancedSections,
    toggleSection,
    showPassword,
    setShowPassword,
    showTunnelPassword,
    setShowTunnelPassword,
    isTesting,
    setIsTesting,
    saveSuccessMsg,
    setSaveSuccessMsg,
    testResult,
    setTestResult,
    hasSavedPassword,
    setHasSavedPassword,
    workspaceActive,
    setHasSavedTunnelPassword,
    hasSavedTunnelToken,
    setHasSavedTunnelToken,
    currentCredentialId,
    setCurrentCredentialId,
    currentTunnelCredentialId,
    setCurrentTunnelCredentialId,
    currentTunnelTokenCredentialId,
    setCurrentTunnelTokenCredentialId,
    vaultFallbackReason,
    setVaultFallbackReason,
    selectProfile,
    resetFormToNew,
    getTlsConfig,
    getSshConfig,
    isSqlite,
    defaultProfileName,
    makeDraft,
    storeSecrets,
    handleSaveProfile,
    profileToDelete,
    setProfileToDelete,
    handleDeleteProfile,
    executeDeleteProfile,
    handleDuplicateProfile,
    handleTest,
    handleSubmit,
    missingCredentials,
    filteredProfiles,
    formatLastConnected,
    transport,
    setTransport,
    selectEngine,
    pickSqliteFile,
    TRANSPORT_OPTIONS,
  };
}

export type ConnectionForm = ReturnType<typeof useConnectionForm>;
