import React, { useState, useEffect } from "react";
import {
  X,
  Database,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Zap,
  Eye,
  EyeOff,
  Flame,
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

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: ConnectionConfig) => Promise<void>;
  onTest: (config: ConnectionConfig) => Promise<ServerInfo>;
  isConnecting: boolean;
  initialProfile?: SavedConnection;
  onProfilesUpdated?: () => void;
}

const ENV_COLORS: Record<
  EnvironmentTag,
  { bg: string; text: string; border: string; label: string }
> = {
  local: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    label: "Local",
  },
  development: {
    bg: "bg-raised",
    text: "text-fg-muted",
    border: "border-line",
    label: "Dev",
  },
  staging: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/30",
    label: "Staging",
  },
  production: {
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/30",
    label: "Prod",
  },
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

    await onConnect(connConfig);
  };

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-4xl h-[620px] bg-surface border border-line rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-3.5 bg-raised border-b border-line flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-orange-600/20 border border-orange-500/30 flex items-center justify-center">
              <Flame className="w-4 h-4 text-fg-muted" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Administrador de Conexiones MariaDB & MySQL
              </h2>
              <p className="text-xs text-neutral-400">
                Conexión TCP directa o Túnel HTTP mediante script PHP (pyro_tunnel.php)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white p-1.5 rounded-md hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {vaultFallbackReason && (
          <div className="px-6 py-2 border-b border-line flex items-start gap-2 text-xs text-fg-muted">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" />
            <span>
              No hay llavero del sistema disponible ({vaultFallbackReason}). La clave del almacén de
              contraseñas se guarda en un archivo junto a él, con permisos restringidos, lo que
              protege menos. En Linux, instale y active un servicio Secret Service (GNOME Keyring o
              KWallet) y reinicie PyroStudio.
            </span>
          </div>
        )}

        {/* 2-Column Main Workspace */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Saved Profiles Sidebar */}
          <div className="w-72 bg-canvas border-r border-line flex flex-col h-full select-none">
            {/* Toolbar: New Profile & Search */}
            <div className="p-3 border-b border-line space-y-2">
              <button
                type="button"
                onClick={resetFormToNew}
                className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-raised hover:bg-hover border border-orange-500/40 rounded-lg text-xs font-semibold text-orange-300 transition-all shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nueva Conexión</span>
              </button>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Buscar conexiones..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-surface border border-line rounded-md text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-orange-500/60"
                />
              </div>
            </div>

            {/* Profiles List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredProfiles.length === 0 ? (
                <div className="text-center py-8 px-3 text-xs text-neutral-500">
                  No hay conexiones guardadas.
                </div>
              ) : (
                groupByFolder(filteredProfiles).map((group) => (
                <div key={group.folder ?? "__none__"} className="space-y-1">
                  {(group.folder !== null || folderNames(filteredProfiles).length > 0) && (
                    <div className="px-1 pt-2 pb-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-muted">
                      <Folder className="w-3 h-3" />
                      <span className="truncate">{group.folder ?? "Sin carpeta"}</span>
                      <span className="ml-auto">{group.connections.length}</span>
                    </div>
                  )}
                  {group.connections.map((p) => {
                  const isSelected = selectedProfileId === p.id;
                  const envInfo = ENV_COLORS[p.environment || "local"];
                  const isTunnel = p.tunnel && p.tunnel.enabled;

                  return (
                    <div
                      key={p.id}
                      onClick={() => selectProfile(p)}
                      className={`group relative flex flex-col p-2.5 rounded-lg cursor-pointer transition-all border ${
                        isSelected
                          ? "bg-elevated border-orange-500/60 shadow-md"
                          : "bg-surface border-line hover:bg-hover hover:border-line-strong"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5 truncate max-w-[140px]">
                          {isTunnel ? (
                            <Globe className="w-3.5 h-3.5 shrink-0 text-fg-muted" />
                          ) : (
                            <Server className="w-3.5 h-3.5 shrink-0 text-fg-muted" />
                          )}
                          <span className="font-semibold text-xs text-white truncate">
                            {p.name}
                          </span>
                        </div>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${envInfo.bg} ${envInfo.text} ${envInfo.border}`}
                        >
                          {envInfo.label}
                        </span>
                      </div>

                      <div className="flex items-center justify-between mt-1 text-[11px] text-neutral-400 font-mono">
                        <span className="truncate max-w-[130px]">
                          {isTunnel ? "🌐 PyroTunnel" : `${p.user}@${p.host}:${p.port}`}
                        </span>

                        <div className="flex items-center space-x-1">
                          <button
                            type="button"
                            title="Duplicar conexión"
                            onClick={(e) => handleDuplicateProfile(p.id, e)}
                            className="p-1 rounded hover:bg-hover text-neutral-400 hover:text-neutral-200 transition-colors"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            title="Eliminar perfil"
                            onClick={(e) => handleDeleteProfile(p.id, p.name, e)}
                            className="p-1 rounded hover:bg-red-950/50 text-neutral-400 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {p.lastConnectedAt && (
                        <div className="flex items-center space-x-1 mt-1 text-[10px] text-neutral-500">
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

          {/* Right Column: Connection Settings Form */}
          <form
            onSubmit={handleSubmit}
            className="flex-1 flex flex-col justify-between p-6 overflow-y-auto bg-surface"
          >
            <div className="space-y-4">
              {/* Profile Header & Delete Button if Editing */}
              <div className="flex items-center justify-between border-b border-line pb-2">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-semibold text-white">
                    {isEditingExisting ? "✏️ Editando Conexión" : "✨ Nueva Conexión"}
                  </span>
                  {useTunnel && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-raised text-fg-muted border border-line font-mono">
                      🌐 Túnel HTTP
                    </span>
                  )}
                </div>

                {isEditingExisting && selectedProfileId && (
                  <button
                    type="button"
                    onClick={() => handleDeleteProfile(selectedProfileId)}
                    className="flex items-center space-x-1 px-2.5 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded border border-red-900/40 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Eliminar Perfil</span>
                  </button>
                )}
              </div>

              {/* Profile Name & Environment */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-medium text-neutral-300">
                    Nombre del Perfil
                  </label>
                  <input
                    type="text"
                    required
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="ej. MariaDB Producción o Servidor Laragon"
                    className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-300">
                    Ambiente
                  </label>
                  <select
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value as EnvironmentTag)}
                    className="w-full px-2.5 py-2 text-xs bg-canvas border border-line rounded-md text-white focus:outline-none focus:border-orange-500 transition-colors font-sans"
                  >
                    <option value="local">🟢 Local</option>
                    <option value="development">🔵 Desarrollo</option>
                    <option value="staging">🟡 Staging</option>
                    <option value="production">🔴 Producción</option>
                  </select>
                </div>
              </div>

              {/* Folder */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-300">Carpeta</label>
                <input
                  type="text"
                  list="connection-folders"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="Sin carpeta (p. ej. UV, Examenes IDEAS)"
                  className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors"
                />
                <datalist id="connection-folders">
                  {folderNames(savedProfiles).map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>

              {/* Environment Alert when Production */}
              {environment === "production" && (
                <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-200 text-xs flex items-center space-x-2 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="text-[11px] leading-relaxed">
                    <strong>⚠️ Modo Producción:</strong> Operando sobre base de datos en vivo. Las consultas destructivas y modificaciones masivas requerirán confirmación explícita.
                  </span>
                </div>
              )}

              {/* Basic Connection Settings */}
              <div className="space-y-3 bg-surface p-3.5 rounded-lg border border-line">
                <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider font-mono">
                  Configuración del Servidor
                </div>

                {/* Host & Port */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs font-medium text-neutral-300 flex items-center space-x-1.5">
                      <Server className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Host / Dirección IP</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="127.0.0.1 o localhost"
                      className="w-full px-3 py-1.5 text-xs bg-raised border border-line rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-300">
                      Puerto DB
                    </label>
                    <input
                      type="number"
                      required
                      value={port}
                      onChange={(e) =>
                        setPort(parseInt(e.target.value, 10) || 3306)
                      }
                      className="w-full px-3 py-1.5 text-xs bg-raised border border-line rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors font-mono"
                    />
                  </div>
                </div>

                {/* User & Password */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-300">
                      Usuario DB
                    </label>
                    <input
                      type="text"
                      required
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                      placeholder="root"
                      className="w-full px-3 py-1.5 text-xs bg-raised border border-line rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-300 flex items-center justify-between">
                      <span className="flex items-center space-x-1.5">
                        <span>Contraseña DB</span>
                        {hasSavedPassword && !password && (
                          <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-0.5">
                            <ShieldCheck className="w-3 h-3 text-emerald-400" /> Vault AES-256
                          </span>
                        )}
                        {!hasSavedPassword && !password && isEditingExisting && workspaceActive && (
                          <span
                            className="text-[10px] text-amber-400 font-mono"
                            title="La conexión viene del workspace compartido; la contraseña se guarda solo en este equipo."
                          >
                            Credenciales pendientes en este equipo
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="text-neutral-500 hover:text-neutral-300 transition-colors"
                      >
                        {showPassword ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={hasSavedPassword ? "•••••••• (Guardada en Almacén Cifrado)" : "••••••••"}
                        className="w-full px-3 py-1.5 text-xs bg-raised border border-line rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors font-mono"
                      />
                      <KeyRound className="w-3.5 h-3.5 text-neutral-600 absolute right-3 top-2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Default Database (optional) */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-neutral-300 flex items-center justify-between">
                    <span className="flex items-center space-x-1.5">
                      <Database className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Base de Datos Inicial (Opcional)</span>
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      Dejar vacío para explorar todas
                    </span>
                  </label>
                  <input
                    type="text"
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                    placeholder="ej. produccion_ventas o app_db"
                    className="w-full px-3 py-1.5 text-xs bg-raised border border-line rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors font-mono"
                  />
                </div>
              </div>

              {/* Progressive Disclosure: Advanced Network & Security Options */}
              <div className="space-y-2 pt-1">
                <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider font-mono px-0.5">
                  Opciones Avanzadas de Red y Seguridad
                </div>

                {/* 1. SSL / TLS Direct Security Accordion */}
                <div className="rounded-lg border border-line bg-surface overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleSection("tls")}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-hover transition-colors text-left text-xs font-medium text-neutral-200"
                  >
                    <div className="flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Seguridad SSL / TLS Directa</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-raised text-neutral-400 border border-line-strong">
                        {!tlsConfigured ? "Auto" : tlsEnabled ? "Requerido" : "Deshabilitado"}
                      </span>
                      {advancedSections.tls ? (
                        <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                      )}
                    </div>
                  </button>

                  {advancedSections.tls && (
                    <div className="p-3.5 border-t border-line bg-canvas space-y-3 animate-in fade-in">
                      <div className="flex items-center justify-between">
                        <label htmlFor="direct-tls-mode" className="text-xs text-neutral-300">
                          Modo de negociación TLS:
                        </label>
                        <select
                          id="direct-tls-mode"
                          value={
                            !tlsConfigured
                              ? "auto"
                              : tlsEnabled
                                ? "required"
                                : "disabled"
                          }
                          onChange={(event) => {
                            setTlsConfigured(event.target.value !== "auto");
                            setTlsEnabled(event.target.value === "required");
                          }}
                          className="rounded-md border border-line bg-raised px-2 py-1 text-xs text-white"
                        >
                          <option value="auto">Negociación automática</option>
                          <option value="required">Requerir + verificar</option>
                          <option value="disabled">Deshabilitado</option>
                        </select>
                      </div>

                      {tlsEnabled && (
                        <div className="space-y-2 pt-1 border-t border-line">
                          <label className="flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={tlsVerifyCertificate}
                              onChange={(event) =>
                                setTlsVerifyCertificate(event.target.checked)
                              }
                              className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-900 text-emerald-600"
                            />
                            <span>Verificar certificado y nombre del servidor</span>
                          </label>
                          <input
                            type="text"
                            value={tlsCaCertPath}
                            onChange={(event) => setTlsCaCertPath(event.target.value)}
                            placeholder="Ruta del certificado CA (opcional)"
                            className="w-full rounded-md border border-line bg-raised px-3 py-1.5 font-mono text-xs text-white placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. SSH Tunnel Accordion */}
                <div className="rounded-lg border border-line bg-surface overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleSection("ssh")}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-hover transition-colors text-left text-xs font-medium text-neutral-200"
                  >
                    <div className="flex items-center space-x-2">
                      <Server className="w-4 h-4 text-fg-muted" />
                      <span>Reenvío por Túnel SSH (OpenSSH)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {useSshTunnel && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-raised text-fg border border-line">
                          Habilitado
                        </span>
                      )}
                      {advancedSections.ssh ? (
                        <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                      )}
                    </div>
                  </button>

                  {advancedSections.ssh && (
                    <div className="p-3.5 border-t border-line bg-canvas space-y-3 animate-in fade-in">
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-white">
                        <input
                          type="checkbox"
                          checked={useSshTunnel}
                          onChange={(event) => {
                            setUseSshTunnel(event.target.checked);
                            if (event.target.checked) setUseTunnel(false);
                          }}
                          className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-orange-600 focus:ring-orange-500"
                        />
                        <span>Habilitar Túnel SSH</span>
                      </label>

                      {useSshTunnel && (
                        <div className="space-y-2 pt-1 border-t border-line">
                          <p className="text-[11px] text-neutral-400">
                            Usa OpenSSH del sistema para reenviar la conexión de forma segura.
                          </p>
                          <div className="grid grid-cols-[1fr_6rem] gap-2">
                            <input
                              required={useSshTunnel}
                              value={sshHost}
                              onChange={(event) => setSshHost(event.target.value)}
                              placeholder="Host SSH (ej. bastion.midominio.com)"
                              className="w-full rounded-md border border-line bg-raised px-3 py-1.5 font-mono text-xs text-white placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
                            />
                            <input
                              type="number"
                              min={1}
                              max={65535}
                              required={useSshTunnel}
                              value={sshPort}
                              onChange={(event) => setSshPort(Number(event.target.value) || 22)}
                              aria-label="Puerto SSH"
                              className="w-full rounded-md border border-line bg-raised px-2 py-1.5 font-mono text-xs text-white"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              required={useSshTunnel}
                              value={sshUser}
                              onChange={(event) => setSshUser(event.target.value)}
                              placeholder="Usuario SSH"
                              className="w-full rounded-md border border-line bg-raised px-3 py-1.5 font-mono text-xs text-white placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
                            />
                            <select
                              value={sshAuthentication}
                              onChange={(event) =>
                                setSshAuthentication(event.target.value as SshAuthentication)
                              }
                              className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs text-white"
                            >
                              <option value="agent">Agente SSH</option>
                              <option value="private_key">Clave privada local</option>
                            </select>
                          </div>
                          {sshAuthentication === "private_key" && (
                            <input
                              required={useSshTunnel}
                              value={sshPrivateKeyPath}
                              onChange={(event) => setSshPrivateKeyPath(event.target.value)}
                              placeholder="Ruta de clave privada (p. ej. ~/.ssh/id_ed25519)"
                              className="w-full rounded-md border border-line bg-raised px-3 py-1.5 font-mono text-xs text-white placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. HTTP Tunnel PHP Accordion */}
                <div className="rounded-lg border border-line bg-surface overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleSection("tunnel")}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-hover transition-colors text-left text-xs font-medium text-neutral-200"
                  >
                    <div className="flex items-center space-x-2">
                      <Globe className="w-4 h-4 text-fg-muted" />
                      <span>Túnel HTTP PHP (pyro_tunnel.php)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {useTunnel && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-raised text-fg border border-line">
                          Habilitado
                        </span>
                      )}
                      {advancedSections.tunnel ? (
                        <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                      )}
                    </div>
                  </button>

                  {advancedSections.tunnel && (
                    <div className="p-3.5 border-t border-line bg-canvas space-y-3 animate-in fade-in">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useTunnel}
                          onChange={(e) => {
                            setUseTunnel(e.target.checked);
                            if (e.target.checked) setUseSshTunnel(false);
                          }}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-orange-600 focus:ring-orange-500"
                        />
                        <span className="text-xs font-semibold text-white">
                          Habilitar Conexión por Túnel HTTP
                        </span>
                      </label>

                      {useTunnel && (
                        <div className="space-y-3 pt-1 border-t border-line">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-neutral-300">
                              URL del Script del Túnel (pyro_tunnel.php) *
                            </label>
                            <input
                              type="url"
                              required={useTunnel}
                              value={tunnelUrl}
                              onChange={(e) => setTunnelUrl(e.target.value)}
                              placeholder="http://localhost/tunnel/pyro_tunnel.php"
                              className="w-full px-3 py-1.5 text-xs bg-raised border border-line rounded text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-orange-500"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs font-medium text-neutral-300">
                              Token del túnel *
                            </label>
                            <input
                              type="password"
                              autoComplete="off"
                              value={tunnelToken}
                              onChange={(e) => setTunnelToken(e.target.value)}
                              placeholder={
                                hasSavedTunnelToken
                                  ? "Guardado en el almacén seguro (vacío = conservar)"
                                  : "Mismo valor que PYRO_TUNNEL_TOKEN en el servidor"
                              }
                              className="w-full px-3 py-1.5 text-xs bg-raised border border-line rounded text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-orange-500"
                            />
                            <p className="text-[11px] text-fg-muted leading-snug">
                              El script rechaza toda petición si no tiene token configurado (mínimo 16
                              caracteres). Defina <code>PYRO_TUNNEL_TOKEN</code> en el servidor; por
                              defecto solo permite bases de datos en localhost (amplíelo con{" "}
                              <code>PYRO_TUNNEL_ALLOWED_DB_HOSTS</code>).
                            </p>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-neutral-300">
                                HTTP Usuario (.htaccess)
                              </label>
                              <input
                                type="text"
                                value={tunnelUser}
                                onChange={(e) => setTunnelUser(e.target.value)}
                                placeholder="Opcional"
                                className="w-full px-3 py-1.5 text-xs bg-raised border border-line rounded text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-orange-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-neutral-300 flex items-center justify-between">
                                <span>HTTP Contraseña</span>
                                <button
                                  type="button"
                                  onClick={() => setShowTunnelPassword(!showTunnelPassword)}
                                  className="text-neutral-500 hover:text-neutral-300 transition-colors"
                                >
                                  {showTunnelPassword ? (
                                    <EyeOff className="w-3 h-3" />
                                  ) : (
                                    <Eye className="w-3 h-3" />
                                  )}
                                </button>
                              </label>
                              <input
                                type={showTunnelPassword ? "text" : "password"}
                                value={tunnelPassword}
                                onChange={(e) => setTunnelPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full px-3 py-1.5 text-xs bg-raised border border-line rounded text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-orange-500"
                              />
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 pt-1">
                            <input
                              type="checkbox"
                              id="encodeBase64"
                              checked={tunnelEncodeBase64}
                              onChange={(e) => setTunnelEncodeBase64(e.target.checked)}
                              className="w-3.5 h-3.5 rounded border-neutral-700 bg-neutral-900 text-orange-600 focus:ring-orange-500"
                            />
                            <label htmlFor="encodeBase64" className="text-xs text-neutral-300 cursor-pointer">
                              Codificar consultas en Base64 (Recomendado)
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Success / Test Result Messages */}
              {saveSuccessMsg && (
                <div className="p-2.5 rounded-lg border border-emerald-800/50 bg-emerald-950/30 text-emerald-300 text-xs flex items-center space-x-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{saveSuccessMsg}</span>
                </div>
              )}

              {testResult && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-start space-x-2.5 ${
                    testResult.success
                      ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-300"
                      : "bg-red-950/30 border-red-800/50 text-red-300"
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium">{testResult.message}</p>
                    {testResult.serverInfo && (
                      <div className="mt-1 flex items-center space-x-3 text-[11px] text-emerald-400/80">
                        <span className="flex items-center space-x-1">
                          <Zap className="w-3 h-3" />
                          <span>{testResult.serverInfo.ping_ms} ms</span>
                        </span>
                        <span>•</span>
                        <span>Usuario: {testResult.serverInfo.current_user}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions Footer */}
            <div className="pt-4 mt-4 flex items-center justify-between border-t border-line">
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={isTesting || isConnecting}
                  className="flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-elevated hover:bg-hover border border-line-strong text-neutral-200 rounded-lg transition-all disabled:opacity-50"
                >
                  {isTesting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5 text-fg-muted" />
                  )}
                  <span>Probar Conexión</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveProfile}
                  className="flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-raised hover:bg-hover border border-line text-neutral-300 rounded-lg transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isEditingExisting ? "Guardar Cambios" : "Guardar Perfil"}</span>
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-neutral-400 hover:text-white rounded-lg hover:bg-hover transition-colors"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isConnecting || isTesting}
                  className="flex items-center space-x-2 px-5 py-2 text-xs font-semibold bg-accent hover:bg-accent-hover text-accent-fg rounded-lg shadow-sm transition-all disabled:opacity-50"
                >
                  {isConnecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Flame className="w-4 h-4" />
                  )}
                  <span>Conectar Servidor</span>
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
