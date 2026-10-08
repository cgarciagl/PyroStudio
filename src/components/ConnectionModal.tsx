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
    bg: "bg-sky-500/10",
    text: "text-sky-400",
    border: "border-sky-500/30",
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
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(3306);
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");

  // HTTP Tunnel state (Navicat compatible)
  const [useTunnel, setUseTunnel] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("http://localhost/tunnel/ntunnel_mysql.php");
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
  const [hasSavedTunnelPassword, setHasSavedTunnelPassword] = useState(false);
  const [hasSavedTunnelToken, setHasSavedTunnelToken] = useState(false);
  const [currentCredentialId, setCurrentCredentialId] = useState<string | null>(null);
  const [currentTunnelCredentialId, setCurrentTunnelCredentialId] = useState<string | null>(null);
  const [currentTunnelTokenCredentialId, setCurrentTunnelTokenCredentialId] =
    useState<string | null>(null);

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
      setTunnelUrl(profile.tunnel.url || "http://localhost/tunnel/ntunnel_mysql.php");
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
      setTunnelUrl("http://localhost/tunnel/ntunnel_mysql.php");
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
    setHost("127.0.0.1");
    setPort(3306);
    setUser("root");
    setPassword("");
    setHasSavedPassword(false);
    setDatabase("");
    setUseTunnel(false);
    setTunnelUrl("http://localhost/tunnel/ntunnel_mysql.php");
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

    const updated = connectionStorage.saveConnection(newProfile);
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

  const executeDeleteProfile = () => {
    if (!profileToDelete) return;
    const { id } = profileToDelete;
    const updated = connectionStorage.deleteConnection(id);
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

  const handleDuplicateProfile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = connectionStorage.duplicateConnection(id);
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

    connectionStorage.saveConnection(profileToSave);
    connectionStorage.markConnected(id);
    onProfilesUpdated?.();

    const connConfig: ConnectionConfig = {
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
      <div className="w-full max-w-4xl h-[620px] bg-[#10131a] border border-[#262c3e] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-3.5 bg-[#141822] border-b border-[#212638] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-orange-600/20 border border-orange-500/30 flex items-center justify-center">
              <Flame className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Administrador de Conexiones MariaDB & MySQL
              </h2>
              <p className="text-xs text-neutral-400">
                Conexión TCP directa o Túnel HTTP compatible con Navicat (ntunnel_mysql.php)
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

        {/* 2-Column Main Workspace */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Saved Profiles Sidebar */}
          <div className="w-72 bg-[#0c0e14] border-r border-[#1c2230] flex flex-col h-full select-none">
            {/* Toolbar: New Profile & Search */}
            <div className="p-3 border-b border-[#181d29] space-y-2">
              <button
                type="button"
                onClick={resetFormToNew}
                className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-gradient-to-r from-orange-600/30 to-amber-600/30 hover:from-orange-600/40 hover:to-amber-600/40 border border-orange-500/40 rounded-lg text-xs font-semibold text-orange-300 transition-all shadow-xs"
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
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-[#11141c] border border-[#202636] rounded-md text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-orange-500/60"
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
                filteredProfiles.map((p) => {
                  const isSelected = selectedProfileId === p.id;
                  const envInfo = ENV_COLORS[p.environment || "local"];
                  const isTunnel = p.tunnel && p.tunnel.enabled;

                  return (
                    <div
                      key={p.id}
                      onClick={() => selectProfile(p)}
                      className={`group relative flex flex-col p-2.5 rounded-lg cursor-pointer transition-all border ${
                        isSelected
                          ? "bg-[#181d2c] border-orange-500/60 shadow-md"
                          : "bg-[#10131a] border-[#1b202e] hover:bg-[#141824] hover:border-[#283144]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5 truncate max-w-[140px]">
                          {isTunnel ? (
                            <Globe className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          ) : (
                            <Server className="w-3.5 h-3.5 text-orange-400 shrink-0" />
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
                          {isTunnel ? "🌐 ntunnel_mysql" : `${p.user}@${p.host}:${p.port}`}
                        </span>

                        <div className="flex items-center space-x-1">
                          <button
                            type="button"
                            title="Duplicar conexión"
                            onClick={(e) => handleDuplicateProfile(p.id, e)}
                            className="p-1 rounded hover:bg-[#252c3f] text-neutral-400 hover:text-neutral-200 transition-colors"
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
                })
              )}
            </div>
          </div>

          {/* Right Column: Connection Settings Form */}
          <form
            onSubmit={handleSubmit}
            className="flex-1 flex flex-col justify-between p-6 overflow-y-auto bg-[#11141c]"
          >
            <div className="space-y-4">
              {/* Profile Header & Delete Button if Editing */}
              <div className="flex items-center justify-between border-b border-[#1f2434] pb-2">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-semibold text-white">
                    {isEditingExisting ? "✏️ Editando Conexión" : "✨ Nueva Conexión"}
                  </span>
                  {useTunnel && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 font-mono">
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
                    className="w-full px-3 py-2 text-xs bg-[#0b0c10] border border-[#242938] rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-300">
                    Ambiente
                  </label>
                  <select
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value as EnvironmentTag)}
                    className="w-full px-2.5 py-2 text-xs bg-[#0b0c10] border border-[#242938] rounded-md text-white focus:outline-none focus:border-orange-500 transition-colors font-sans"
                  >
                    <option value="local">🟢 Local</option>
                    <option value="development">🔵 Desarrollo</option>
                    <option value="staging">🟡 Staging</option>
                    <option value="production">🔴 Producción</option>
                  </select>
                </div>
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
              <div className="space-y-3 bg-[#0d0f15] p-3.5 rounded-lg border border-[#1f2538]">
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
                      className="w-full px-3 py-1.5 text-xs bg-[#121520] border border-[#242938] rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors font-mono"
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
                      className="w-full px-3 py-1.5 text-xs bg-[#121520] border border-[#242938] rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors font-mono"
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
                      className="w-full px-3 py-1.5 text-xs bg-[#121520] border border-[#242938] rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors font-mono"
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
                        className="w-full px-3 py-1.5 text-xs bg-[#121520] border border-[#242938] rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors font-mono"
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
                    className="w-full px-3 py-1.5 text-xs bg-[#121520] border border-[#242938] rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors font-mono"
                  />
                </div>
              </div>

              {/* Progressive Disclosure: Advanced Network & Security Options */}
              <div className="space-y-2 pt-1">
                <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider font-mono px-0.5">
                  Opciones Avanzadas de Red y Seguridad
                </div>

                {/* 1. SSL / TLS Direct Security Accordion */}
                <div className="rounded-lg border border-[#212738] bg-[#0d1017] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleSection("tls")}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-[#141824] transition-colors text-left text-xs font-medium text-neutral-200"
                  >
                    <div className="flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Seguridad SSL / TLS Directa</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#161a26] text-neutral-400 border border-[#262f44]">
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
                    <div className="p-3.5 border-t border-[#1d2332] bg-[#0a0c12] space-y-3 animate-in fade-in">
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
                          className="rounded-md border border-[#242938] bg-[#121520] px-2 py-1 text-xs text-white"
                        >
                          <option value="auto">Negociación automática</option>
                          <option value="required">Requerir + verificar</option>
                          <option value="disabled">Deshabilitado</option>
                        </select>
                      </div>

                      {tlsEnabled && (
                        <div className="space-y-2 pt-1 border-t border-[#1e2436]">
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
                            className="w-full rounded-md border border-[#242938] bg-[#121520] px-3 py-1.5 font-mono text-xs text-white placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. SSH Tunnel Accordion */}
                <div className="rounded-lg border border-[#212738] bg-[#0d1017] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleSection("ssh")}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-[#141824] transition-colors text-left text-xs font-medium text-neutral-200"
                  >
                    <div className="flex items-center space-x-2">
                      <Server className="w-4 h-4 text-sky-400" />
                      <span>Reenvío por Túnel SSH (OpenSSH)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {useSshTunnel && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
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
                    <div className="p-3.5 border-t border-[#1d2332] bg-[#0a0c12] space-y-3 animate-in fade-in">
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
                        <div className="space-y-2 pt-1 border-t border-[#1e2436]">
                          <p className="text-[11px] text-neutral-400">
                            Usa OpenSSH del sistema para reenviar la conexión de forma segura.
                          </p>
                          <div className="grid grid-cols-[1fr_6rem] gap-2">
                            <input
                              required={useSshTunnel}
                              value={sshHost}
                              onChange={(event) => setSshHost(event.target.value)}
                              placeholder="Host SSH (ej. bastion.midominio.com)"
                              className="w-full rounded-md border border-[#242938] bg-[#121520] px-3 py-1.5 font-mono text-xs text-white placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
                            />
                            <input
                              type="number"
                              min={1}
                              max={65535}
                              required={useSshTunnel}
                              value={sshPort}
                              onChange={(event) => setSshPort(Number(event.target.value) || 22)}
                              aria-label="Puerto SSH"
                              className="w-full rounded-md border border-[#242938] bg-[#121520] px-2 py-1.5 font-mono text-xs text-white"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              required={useSshTunnel}
                              value={sshUser}
                              onChange={(event) => setSshUser(event.target.value)}
                              placeholder="Usuario SSH"
                              className="w-full rounded-md border border-[#242938] bg-[#121520] px-3 py-1.5 font-mono text-xs text-white placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
                            />
                            <select
                              value={sshAuthentication}
                              onChange={(event) =>
                                setSshAuthentication(event.target.value as SshAuthentication)
                              }
                              className="w-full rounded-md border border-[#242938] bg-[#121520] px-2 py-1.5 text-xs text-white"
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
                              className="w-full rounded-md border border-[#242938] bg-[#121520] px-3 py-1.5 font-mono text-xs text-white placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. HTTP Tunnel Navicat Accordion */}
                <div className="rounded-lg border border-[#212738] bg-[#0d1017] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleSection("tunnel")}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-[#141824] transition-colors text-left text-xs font-medium text-neutral-200"
                  >
                    <div className="flex items-center space-x-2">
                      <Globe className="w-4 h-4 text-sky-400" />
                      <span>Túnel HTTP Navicat (ntunnel_mysql.php)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {useTunnel && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
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
                    <div className="p-3.5 border-t border-[#1d2332] bg-[#0a0c12] space-y-3 animate-in fade-in">
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
                        <div className="space-y-3 pt-1 border-t border-[#1e2436]">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-neutral-300">
                              URL del Script del Túnel (ntunnel_mysql.php) *
                            </label>
                            <input
                              type="url"
                              required={useTunnel}
                              value={tunnelUrl}
                              onChange={(e) => setTunnelUrl(e.target.value)}
                              placeholder="http://localhost/tunnel/ntunnel_mysql.php"
                              className="w-full px-3 py-1.5 text-xs bg-[#121520] border border-[#262e42] rounded text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-orange-500"
                            />
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
                                className="w-full px-3 py-1.5 text-xs bg-[#121520] border border-[#262e42] rounded text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-orange-500"
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
                                className="w-full px-3 py-1.5 text-xs bg-[#121520] border border-[#262e42] rounded text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-orange-500"
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
            <div className="pt-4 mt-4 flex items-center justify-between border-t border-[#1f2434]">
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={isTesting || isConnecting}
                  className="flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-[#1a202c] hover:bg-[#252e3e] border border-[#2b3548] text-neutral-200 rounded-lg transition-all disabled:opacity-50"
                >
                  {isTesting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                  )}
                  <span>Probar Conexión</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveProfile}
                  className="flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-[#171b26] hover:bg-[#202636] border border-[#232a3b] text-neutral-300 rounded-lg transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isEditingExisting ? "Guardar Cambios" : "Guardar Perfil"}</span>
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-neutral-400 hover:text-white rounded-lg hover:bg-[#181d29] transition-colors"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isConnecting || isTesting}
                  className="flex items-center space-x-2 px-5 py-2 text-xs font-semibold bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-lg shadow-lg shadow-orange-950/40 transition-all disabled:opacity-50"
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
