import React, { useState, useEffect } from "react";
import {
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Zap,
  Eye,
  EyeOff,
  KeyRound,
  Server,
  Plus,
  Trash2,
  Copy,
  Save,
  Clock,
  Search,
  Globe,
  ShieldCheck,
  ChevronDown,
  Folder,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import type {
  ConnectionConfig,
  EnvironmentTag,
  HttpTunnelConfig,
  SavedConnection,
  ServerInfo,
  SshAuthentication,
  SshTunnelConfig,
  TlsConfig,
} from "../types/database";
import { connectionStorage } from "../services/connectionStorage";
import { folderNames, groupByFolder, normalizeFolder } from "../utils/connectionFolders";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useUIStore } from "../stores/uiStore";
import { dbService } from "../services/tauriDb";
import { ConfirmModal } from "./ConfirmModal";
import { generateTunnelToken, tunnelTokenServerSnippet } from "../utils/tunnelToken";
import { TransportBadge, TransportIcon, connectionAddress } from "./connectionTransport";
import { ghostBtn, iconBtn, primaryBtn } from "./ui/styles";
import { MISSING_PASSWORD_HINT, MissingPasswordIcon, useMissingCredentials } from "./missingCredential";

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: ConnectionConfig) => Promise<void>;
  onTest: (config: ConnectionConfig) => Promise<ServerInfo>;
  isConnecting: boolean;
  initialProfile?: SavedConnection;
  onProfilesUpdated?: () => void;
}

const ENV_DOTS: Record<EnvironmentTag, { dot: string; label: string }> = {
  local: { dot: "bg-emerald-500", label: "Local" },
  development: { dot: "bg-sky-500", label: "Desarrollo" },
  staging: { dot: "bg-amber-500", label: "Staging" },
  production: { dot: "bg-rose-500", label: "Producción" },
};

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  onConnect,
  onTest,
  isConnecting,
  initialProfile,
  onProfilesUpdated,
}) => {
  const [savedProfiles, setSavedProfiles] = useState<SavedConnection[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");

  // Form state
  const [profileName, setProfileName] = useState("Nueva Conexión");
  const [environment, setEnvironment] = useState<EnvironmentTag>("local");
  const [folder, setFolder] = useState("");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(3306);
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");

  // HTTP Tunnel state (PyroTunnel v1 PHP)
  const [useTunnel, setUseTunnel] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("http://localhost/tunnel/pyro_tunnel.php");
  const [tunnelUser, setTunnelUser] = useState("");
  const [tunnelPassword, setTunnelPassword] = useState("");
  const [tunnelToken, setTunnelToken] = useState("");
  const [tunnelEncodeBase64, setTunnelEncodeBase64] = useState(true);
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
  const [hasSavedTunnelPassword, setHasSavedTunnelPassword] = useState(false);
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
    setEnvironment(profile.environment || "local");
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

    if (profile.tunnel && profile.tunnel.enabled) {
      setUseTunnel(true);
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
      setAdvancedSections({
        tunnel: true,
        ssh: !!(profile.ssh_tunnel && profile.ssh_tunnel.enabled),
        tls: !!(profile.tls && (profile.tls.enabled || profile.tls.ca_cert_path)),
      });
    } else {
      setUseTunnel(false);
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
    const newId = `conn-${Date.now()}`;
    setSelectedProfileId(newId);
    setCurrentCredentialId(`cred-${newId}`);
    setCurrentTunnelCredentialId(`tunnel-cred-${newId}`);
    setCurrentTunnelTokenCredentialId(`tunnel-token-cred-${newId}`);
    setIsEditingExisting(false);
    setProfileName("Servidor MariaDB");
    setEnvironment("local");
    setFolder("");
    setHost("127.0.0.1");
    setPort(3306);
    setUser("root");
    setPassword("");
    setHasSavedPassword(false);
    setDatabase("");
    setUseTunnel(false);
    setTunnelUrl("http://localhost/tunnel/pyro_tunnel.php");
    setTunnelUser("");
    setTunnelPassword("");
    setTunnelToken("");
    setGeneratedTokenSnippet(null);
    setHasSavedTunnelPassword(false);
    setHasSavedTunnelToken(false);
    setTunnelEncodeBase64(true);
    setAdvancedSections({ tls: false, ssh: false, tunnel: false });
    setTestResult(null);
    setSaveSuccessMsg(null);
  };

  const getTunnelConfig = (): HttpTunnelConfig | undefined => {
    if (!useTunnel) return undefined;
    const tCredId =
      currentTunnelCredentialId ||
      `tunnel-cred-${selectedProfileId || "default"}`;
    const tokenCredId =
      currentTunnelTokenCredentialId ||
      `tunnel-token-cred-${selectedProfileId || "default"}`;
    return {
      enabled: true,
      url: tunnelUrl.trim(),
      http_user: tunnelUser.trim() || undefined,
      http_password: tunnelPassword ? tunnelPassword : undefined,
      auth_token: tunnelToken || undefined,
      tunnel_credential_id: !tunnelPassword && hasSavedTunnelPassword ? tCredId : undefined,
      token_credential_id:
        !tunnelToken && hasSavedTunnelToken ? tokenCredId : undefined,
      encode_base64: tunnelEncodeBase64,
    };
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

  const currentConfig: ConnectionConfig = {
    host,
    port,
    user,
    password: password ? password : undefined,
    credential_id: !password && hasSavedPassword
      ? currentCredentialId || (selectedProfileId ? `cred-${selectedProfileId}` : undefined)
      : undefined,
    database: database.trim() || undefined,
    environment,
    tunnel: getTunnelConfig(),
    tls: getTlsConfig(),
    ssh_tunnel: getSshConfig(),
    savedConnectionId: selectedProfileId || undefined,
    savedConnectionName: profileName,
  };

  const handleSaveProfile = async () => {
    const id = selectedProfileId || `conn-${Date.now()}`;
    const credId = currentCredentialId || `cred-${id}`;
    const tCredId = currentTunnelCredentialId || `tunnel-cred-${id}`;
    const tokenCredId =
      currentTunnelTokenCredentialId || `tunnel-token-cred-${id}`;

    if (password) {
      try {
        await dbService.saveCredential(credId, password);
        setHasSavedPassword(true);
      } catch (err) {
        console.error("Error guardando credencial segura en vault:", err);
      }
    }
    if (tunnelPassword) {
      try {
        await dbService.saveCredential(tCredId, tunnelPassword);
        setHasSavedTunnelPassword(true);
      } catch (err) {
        console.error("Error guardando credencial de túnel en vault:", err);
      }
    }
    if (tunnelToken) {
      try {
        await dbService.saveCredential(tokenCredId, tunnelToken);
        setHasSavedTunnelToken(true);
      } catch (err) {
        console.error("Error guardando el token del túnel en el Vault:", err);
      }
    }

    const newProfile: SavedConnection = {
      id,
      name: profileName.trim() || `${host}:${port}`,
      host,
      port,
      user,
      credentialId: credId,
      database: database.trim() || undefined,
      environment,
      folder: normalizeFolder(folder) ?? undefined,
      tunnel: useTunnel
        ? {
            enabled: true,
            url: tunnelUrl.trim(),
            http_user: tunnelUser.trim() || undefined,
            tunnel_credential_id: tCredId,
            token_credential_id: tokenCredId,
            encode_base64: tunnelEncodeBase64,
          }
        : undefined,
      tls: getTlsConfig(),
      ssh_tunnel: getSshConfig(),
      createdAt: Date.now(),
    };

    let updated: SavedConnection[];
    try {
      updated = await connectionStorage.persistConnection(newProfile);
    } catch (e) {
      useUIStore.getState().showAlert({
        title: "No se pudo guardar en el workspace",
        message: e instanceof Error ? e.message : String(e),
        variant: "danger",
        icon: "alert",
      });
      return;
    }
    setSavedProfiles(updated);
    setSelectedProfileId(id);
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
        title: "No se pudo guardar en el workspace",
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

    const id = selectedProfileId || `conn-${Date.now()}`;
    const credId = currentCredentialId || `cred-${id}`;
    const tCredId = currentTunnelCredentialId || `tunnel-cred-${id}`;
    const tokenCredId =
      currentTunnelTokenCredentialId || `tunnel-token-cred-${id}`;

    // Ensure newly entered secrets are preserved in vault immediately
    if (password) {
      await dbService.saveCredential(credId, password).catch(() => {});
      setHasSavedPassword(true);
    }
    if (tunnelPassword) {
      await dbService.saveCredential(tCredId, tunnelPassword).catch(() => {});
      setHasSavedTunnelPassword(true);
    }
    if (tunnelToken) {
      await dbService.saveCredential(tokenCredId, tunnelToken).catch(() => {});
      setHasSavedTunnelToken(true);
    }

    const testConfig: ConnectionConfig = {
      ...currentConfig,
      savedConnectionId: id,
      credential_id: !password ? credId : undefined,
      password: password || undefined,
      tunnel: useTunnel
        ? {
            enabled: true,
            url: tunnelUrl.trim(),
            http_user: tunnelUser.trim() || undefined,
            http_password: tunnelPassword || undefined,
            auth_token: tunnelToken || undefined,
            tunnel_credential_id: !tunnelPassword ? tCredId : undefined,
            token_credential_id: !tunnelToken ? tokenCredId : undefined,
            encode_base64: tunnelEncodeBase64,
          }
        : undefined,
    };

    try {
      const info = await onTest(testConfig);
      setTestResult({
        success: true,
        message: useTunnel
          ? `¡Conexión exitosa vía Túnel HTTP! (v${info.version})`
          : `¡Conexión exitosa con MariaDB! (v${info.version})`,
        serverInfo: info,
      });
    } catch (err: unknown) {
      const errorMsg =
        typeof err === "string" ? err : (err as Error)?.message || "Fallo al conectar";
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

    const id = selectedProfileId || `conn-${Date.now()}`;
    const credId = currentCredentialId || `cred-${id}`;
    const tCredId = currentTunnelCredentialId || `tunnel-cred-${id}`;
    const tokenCredId =
      currentTunnelTokenCredentialId || `tunnel-token-cred-${id}`;

    if (password) {
      try {
        await dbService.saveCredential(credId, password);
        setHasSavedPassword(true);
      } catch (err) {
        console.error("Error guardando credencial:", err);
      }
    }
    if (tunnelPassword) {
      try {
        await dbService.saveCredential(tCredId, tunnelPassword);
        setHasSavedTunnelPassword(true);
      } catch (err) {
        console.error("Error guardando credencial de túnel:", err);
      }
    }
    if (tunnelToken) {
      try {
        await dbService.saveCredential(tokenCredId, tunnelToken);
        setHasSavedTunnelToken(true);
      } catch (err) {
        console.error("Error guardando el token de túnel:", err);
      }
    }

    const profileToSave: SavedConnection = {
      id,
      name: profileName.trim() || `${host}:${port}`,
      host,
      port,
      user,
      credentialId: credId,
      database: database.trim() || undefined,
      environment,
      folder: normalizeFolder(folder) ?? undefined,
      tunnel: useTunnel
        ? {
            enabled: true,
            url: tunnelUrl.trim(),
            http_user: tunnelUser.trim() || undefined,
            tunnel_credential_id: tCredId,
            token_credential_id: tokenCredId,
            encode_base64: tunnelEncodeBase64,
          }
        : undefined,
      tls: getTlsConfig(),
      ssh_tunnel: getSshConfig(),
      createdAt: Date.now(),
      lastConnectedAt: Date.now(),
    };

    // Connecting must not be blocked by an unreachable workspace folder.
    await connectionStorage.persistConnection(profileToSave).catch((e) => {
      console.warn("Profile not persisted before connecting:", e);
    });
    connectionStorage.markConnected(id);
    onProfilesUpdated?.();

    const connConfig: ConnectionConfig = {
      ...currentConfig,
      environment,
      savedConnectionId: id,
      credential_id: !password ? credId : undefined,
      password: password || undefined,
      tunnel: useTunnel
        ? {
            enabled: true,
            url: tunnelUrl.trim(),
            http_user: tunnelUser.trim() || undefined,
            http_password: tunnelPassword || undefined,
            auth_token: tunnelToken || undefined,
            tunnel_credential_id: !tunnelPassword ? tCredId : undefined,
            token_credential_id: !tunnelToken ? tokenCredId : undefined,
            encode_base64: tunnelEncodeBase64,
          }
        : undefined,
      tls: getTlsConfig(),
      ssh_tunnel: getSshConfig(),
    };

    setTestResult(null);
    try {
      await onConnect(connConfig);
    } catch (err: unknown) {
      const errorMsg =
        typeof err === "string" ? err : (err as Error)?.message || "Fallo al conectar";
      setTestResult({
        success: false,
        message:
          !password && !hasSavedPassword ? `${errorMsg} — ${MISSING_PASSWORD_HINT}` : errorMsg,
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
      (p.database && p.database.toLowerCase().includes(q))
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

  if (!isOpen) return null;

  const inputCls =
    "w-full px-2.5 py-1.5 text-xs bg-canvas border border-line rounded-md text-fg placeholder:text-fg-muted/60 focus:outline-none focus:border-accent transition-colors";
  const monoInput = `${inputCls} font-mono`;
  const labelCls = "text-[11px] font-medium text-fg-muted";
  const sectionTitle = "text-[11px] font-medium text-fg-muted";
  const transport: "direct" | "http" | "ssh" = useTunnel ? "http" : useSshTunnel ? "ssh" : "direct";
  const setTransport = (t: "direct" | "http" | "ssh") => {
    setUseTunnel(t === "http");
    setUseSshTunnel(t === "ssh");
  };
  const TRANSPORT_OPTIONS = [
    { id: "direct" as const, label: "Directa", Icon: Server, hint: "TCP directo al servidor MariaDB/MySQL." },
    {
      id: "http" as const,
      label: "Túnel HTTP",
      Icon: Globe,
      hint: "A través del script pyro_tunnel.php alojado en el servidor web. Host y puerto se resuelven desde el servidor.",
    },
    { id: "ssh" as const, label: "Túnel SSH", Icon: KeyRound, hint: "Reenvío mediante OpenSSH del sistema." },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-4xl h-[640px] bg-surface border border-line rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-line flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-fg">Conexiones</h2>
            <p className="text-[11px] text-fg-muted">
              {savedProfiles.length} guardadas · directa, túnel HTTP o túnel SSH
            </p>
          </div>
          <button onClick={onClose} className={iconBtn} title="Cerrar">
            <X className="w-4 h-4" />
          </button>
        </div>

        {vaultFallbackReason && (
          <div className="px-5 py-2 border-b border-line flex items-start gap-2 text-xs text-fg-muted">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" />
            <span>
              No hay llavero del sistema disponible ({vaultFallbackReason}). La clave del almacén de
              contraseñas se guarda en un archivo junto a él, con permisos restringidos, lo que
              protege menos. En Linux, instale y active un servicio Secret Service (GNOME Keyring o
              KWallet) y reinicie PyroStudio.
            </span>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {/* Left column: saved profiles */}
          <div className="w-72 bg-canvas border-r border-line flex flex-col h-full select-none">
            <div className="p-2.5 border-b border-line flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-fg-muted absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar…"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className={`${inputCls} pl-7 bg-surface`}
                />
              </div>
              <button type="button" onClick={resetFormToNew} className={iconBtn} title="Nueva conexión">
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-1.5">
              {filteredProfiles.length === 0 ? (
                <div className="text-center py-8 px-3 text-xs text-fg-muted">
                  {searchFilter ? "Sin coincidencias." : "No hay conexiones guardadas."}
                </div>
              ) : (
                groupByFolder(filteredProfiles).map((group) => (
                  <div key={group.folder ?? "__none__"} className="mb-1">
                    {(group.folder !== null || folderNames(filteredProfiles).length > 0) && (
                      <div className="px-2 pt-2 pb-1 flex items-center gap-1.5 text-[11px] text-fg-muted">
                        <Folder className="w-3 h-3" />
                        <span className="truncate font-medium">{group.folder ?? "Sin carpeta"}</span>
                        <span className="ml-auto">{group.connections.length}</span>
                      </div>
                    )}
                    {group.connections.map((p) => {
                      const isSelected = selectedProfileId === p.id;
                      const env = p.environment || "local";

                      return (
                        <div
                          key={p.id}
                          onClick={() => selectProfile(p)}
                          className={`group relative px-2.5 py-2 rounded-md cursor-pointer transition-colors border-l-2 ${
                            isSelected ? "bg-hover border-accent" : "border-transparent hover:bg-hover"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${ENV_DOTS[env].dot}`}
                              title={ENV_DOTS[env].label}
                            />
                            <span className="font-medium text-xs text-fg truncate">{p.name}</span>
                            {env === "production" && (
                              <span className="text-[10px] text-danger font-semibold">PROD</span>
                            )}
                            {missingCredentials.has(p.id) && <MissingPasswordIcon />}
                            <span className="ml-auto flex items-center">
                              <span className="group-hover:hidden">
                                <TransportBadge connection={p} />
                              </span>
                              <span className="hidden group-hover:flex items-center">
                                <button
                                  type="button"
                                  title="Duplicar"
                                  onClick={(e) => handleDuplicateProfile(p.id, e)}
                                  className="p-1 rounded text-fg-muted hover:text-fg hover:bg-surface"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  title="Eliminar"
                                  onClick={(e) => handleDeleteProfile(p.id, p.name, e)}
                                  className="p-1 rounded text-fg-muted hover:text-danger hover:bg-surface"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </span>
                            </span>
                          </div>
                          <div className="mt-0.5 pl-3 flex items-center gap-1.5 text-[11px] text-fg-muted font-mono min-w-0">
                            <TransportIcon connection={p} className="w-3 h-3" />
                            <span className="truncate" title={p.tunnel?.enabled ? p.tunnel.url : undefined}>
                              {connectionAddress(p)}
                            </span>
                          </div>
                          {p.lastConnectedAt && (
                            <div className="pl-3 mt-0.5 flex items-center gap-1 text-[10px] text-fg-muted/80">
                              <Clock className="w-2.5 h-2.5" />
                              <span>{formatLastConnected(p.lastConnectedAt)}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right column: form */}
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-w-0 bg-surface">
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-fg">
                  {isEditingExisting ? "Editar conexión" : "Nueva conexión"}
                </span>
                {isEditingExisting && selectedProfileId && (
                  <button
                    type="button"
                    onClick={() => handleDeleteProfile(selectedProfileId)}
                    className={`${ghostBtn} hover:text-danger`}
                  >
                    <Trash2 className="w-3 h-3" />
                    Eliminar
                  </button>
                )}
              </div>

              {/* General */}
              <section className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <label className={labelCls}>Nombre</label>
                    <input
                      type="text"
                      required
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="p. ej. MariaDB Producción"
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>Ambiente</label>
                    <select
                      value={environment}
                      onChange={(e) => setEnvironment(e.target.value as EnvironmentTag)}
                      className={inputCls}
                    >
                      <option value="local">Local</option>
                      <option value="development">Desarrollo</option>
                      <option value="staging">Staging</option>
                      <option value="production">Producción</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className={labelCls}>Carpeta</label>
                  <input
                    type="text"
                    list="connection-folders"
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                    placeholder="Sin carpeta"
                    className={inputCls}
                  />
                  <datalist id="connection-folders">
                    {folderNames(savedProfiles).map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </div>

                {environment === "production" && (
                  <div className="flex items-start gap-2 text-[11px] text-fg-muted leading-relaxed">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-danger shrink-0" />
                    <span>
                      Producción: las consultas destructivas y modificaciones masivas pedirán
                      confirmación explícita.
                    </span>
                  </div>
                )}
              </section>

              {/* Transport */}
              <section className="space-y-2.5">
                <div className={sectionTitle}>Tipo de conexión</div>
                <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-canvas border border-line">
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
                      <label className={labelCls}>URL del script (pyro_tunnel.php)</label>
                      <input
                        type="url"
                        required
                        value={tunnelUrl}
                        onChange={(e) => setTunnelUrl(e.target.value)}
                        placeholder="https://midominio.com/pyro_tunnel.php"
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

              {/* Server */}
              <section className="space-y-3">
                <div className={sectionTitle}>
                  {transport === "http" ? "Servidor de base de datos (visto desde el túnel)" : "Servidor"}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <label className={labelCls}>Host</label>
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
                    <label className={labelCls}>Puerto</label>
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
                    <label className={labelCls}>Usuario</label>
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
                        <span>Contraseña</span>
                        {hasSavedPassword && !password && (
                          <span className="flex items-center gap-0.5 text-[10px] font-normal" title="Guardada en el almacén cifrado AES-256">
                            <ShieldCheck className="w-3 h-3 text-success" /> guardada
                          </span>
                        )}
                        {!hasSavedPassword && !password && isEditingExisting && (
                          <span
                            className="flex items-center gap-0.5 text-[10px] font-normal truncate"
                            title={
                              workspaceActive
                                ? "La conexión viene del workspace compartido; la contraseña se guarda solo en este equipo."
                                : "No hay contraseña guardada para esta conexión en este equipo."
                            }
                          >
                            <AlertCircle className="w-3 h-3 text-warning shrink-0" />{" "}
                            {workspaceActive ? "pendiente en este equipo" : "sin guardar"}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="text-fg-muted hover:text-fg"
                        title={showPassword ? "Ocultar" : "Mostrar"}
                      >
                        {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </label>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={hasSavedPassword ? "•••••••• (sin cambios)" : "••••••••"}
                      className={monoInput}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className={labelCls}>
                    Base de datos inicial <span className="font-normal">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                    placeholder="Vacío para explorar todas"
                    className={monoInput}
                  />
                </div>
              </section>

              {/* TLS */}
              {transport !== "http" && (
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
            </div>

            {/* Footer */}
            <div className="px-5 py-3 flex items-center justify-between border-t border-line">
              <div className="flex items-center gap-1">
                <button type="button" onClick={handleTest} disabled={isTesting || isConnecting} className={ghostBtn}>
                  {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  Probar
                </button>
                <button type="button" onClick={handleSaveProfile} className={ghostBtn}>
                  <Save className="w-3.5 h-3.5" />
                  {isEditingExisting ? "Guardar cambios" : "Guardar"}
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={onClose} className={ghostBtn}>
                  Cancelar
                </button>
                <button type="submit" disabled={isConnecting || isTesting} className={primaryBtn}>
                  {isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                  Conectar
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!profileToDelete}
        title="Eliminar Perfil de Conexión"
        message={`¿Estás seguro de eliminar el perfil "${profileToDelete?.name}"?`}
        details="Esta acción eliminará el perfil de la lista de conexiones guardadas."
        confirmText="Eliminar Perfil"
        variant="danger"
        onConfirm={executeDeleteProfile}
        onClose={() => setProfileToDelete(null)}
      />
    </div>
  );
};
