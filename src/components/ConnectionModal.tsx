import React from "react";
import {
  X,
  AlertCircle,
  Loader2,
  Zap,
  Trash2,
  Save,
  ArrowRight,
} from "lucide-react";
import {
  type ConnectionConfig,
  type SavedConnection,
  type ServerInfo,
} from "../types/database";
import { ConfirmModal } from "./ConfirmModal";
import { ghostBtn, iconBtn, modalHeader, modalTitle, primaryBtn } from "./ui/styles";

import { useConnectionForm } from "./connection/useConnectionForm";
import { ProfileList } from "./connection/ProfileList";
import { GeneralSection } from "./connection/GeneralSection";
import { EngineSection } from "./connection/EngineSection";
import { TransportSection } from "./connection/TransportSection";
import { SqliteFileSection } from "./connection/SqliteFileSection";
import { ServerSection } from "./connection/ServerSection";
import { TlsSection } from "./connection/TlsSection";

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: ConnectionConfig) => Promise<void>;
  onTest: (config: ConnectionConfig) => Promise<ServerInfo>;
  isConnecting: boolean;
  initialProfile?: SavedConnection;
  onProfilesUpdated?: () => void;
}



export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  onConnect,
  onTest,
  isConnecting,
  initialProfile,
  onProfilesUpdated,
}) => {
  const form = useConnectionForm({ isOpen, onConnect, onTest, initialProfile, onProfilesUpdated });
  const { savedProfiles, selectedProfileId, isEditingExisting, isTesting, vaultFallbackReason, handleSaveProfile, profileToDelete, setProfileToDelete, handleDeleteProfile, executeDeleteProfile, handleTest, handleSubmit } = form;

  if (!isOpen) return null;

  return (
    <div className="pyro-connection-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
      <div className="pyro-connection-modal w-full max-w-4xl h-[640px] bg-surface border border-line rounded-xl shadow-modal overflow-hidden flex flex-col">
        {/* Header */}
        <div className={modalHeader}>
          <div>
            <h2 className={modalTitle}>Conexiones</h2>
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
              No hay llavero del sistema disponible. La clave del almacén de contraseñas se guarda en
              un archivo junto a él, con permisos restringidos, lo que protege menos. En Linux, instale
              y active un servicio Secret Service (GNOME Keyring o KWallet) y reinicie PyroStudio.
              <details className="mt-1">
                <summary className="cursor-pointer text-fg-subtle hover:text-fg">Detalle técnico</summary>
                <code className="block mt-1 font-mono text-[11px] text-fg-subtle break-all">{vaultFallbackReason}</code>
              </details>
            </span>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {/* Left column: saved profiles */}
          <ProfileList selectedProfileId={form.selectedProfileId} searchFilter={form.searchFilter} setSearchFilter={form.setSearchFilter} selectProfile={form.selectProfile} resetFormToNew={form.resetFormToNew} handleDeleteProfile={form.handleDeleteProfile} handleDuplicateProfile={form.handleDuplicateProfile} missingCredentials={form.missingCredentials} filteredProfiles={form.filteredProfiles} formatLastConnected={form.formatLastConnected} />

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
              <GeneralSection savedProfiles={form.savedProfiles} profileName={form.profileName} setProfileName={form.setProfileName} environment={form.environment} setEnvironment={form.setEnvironment} readOnly={form.readOnly} setReadOnly={form.setReadOnly} folder={form.folder} setFolder={form.setFolder} />

              {/* Engine */}
              <EngineSection engine={form.engine} selectEngine={form.selectEngine} />

              {/* Transport */}
              <TransportSection tunnelUrl={form.tunnelUrl} setTunnelUrl={form.setTunnelUrl} tunnelUser={form.tunnelUser} setTunnelUser={form.setTunnelUser} tunnelPassword={form.tunnelPassword} setTunnelPassword={form.setTunnelPassword} tunnelToken={form.tunnelToken} setTunnelToken={form.setTunnelToken} tunnelEncodeBase64={form.tunnelEncodeBase64} setTunnelEncodeBase64={form.setTunnelEncodeBase64} tunnelTimeoutSec={form.tunnelTimeoutSec} setTunnelTimeoutSec={form.setTunnelTimeoutSec} generatedTokenSnippet={form.generatedTokenSnippet} setGeneratedTokenSnippet={form.setGeneratedTokenSnippet} copiedItem={form.copiedItem} handleGenerateTunnelToken={form.handleGenerateTunnelToken} copyToClipboard={form.copyToClipboard} sshHost={form.sshHost} setSshHost={form.setSshHost} sshPort={form.sshPort} setSshPort={form.setSshPort} sshUser={form.sshUser} setSshUser={form.setSshUser} sshAuthentication={form.sshAuthentication} setSshAuthentication={form.setSshAuthentication} sshPrivateKeyPath={form.sshPrivateKeyPath} setSshPrivateKeyPath={form.setSshPrivateKeyPath} showTunnelPassword={form.showTunnelPassword} setShowTunnelPassword={form.setShowTunnelPassword} hasSavedTunnelToken={form.hasSavedTunnelToken} isSqlite={form.isSqlite} transport={form.transport} setTransport={form.setTransport} TRANSPORT_OPTIONS={form.TRANSPORT_OPTIONS} />

              {/* SQLite file */}
              <SqliteFileSection filePath={form.filePath} setFilePath={form.setFilePath} isSqlite={form.isSqlite} transport={form.transport} pickSqliteFile={form.pickSqliteFile} />

              {/* Server */}
              <ServerSection isEditingExisting={form.isEditingExisting} host={form.host} setHost={form.setHost} port={form.port} setPort={form.setPort} user={form.user} setUser={form.setUser} password={form.password} setPassword={form.setPassword} database={form.database} setDatabase={form.setDatabase} showPassword={form.showPassword} setShowPassword={form.setShowPassword} hasSavedPassword={form.hasSavedPassword} workspaceActive={form.workspaceActive} isSqlite={form.isSqlite} transport={form.transport} />

              {/* TLS */}
              <TlsSection tlsConfigured={form.tlsConfigured} setTlsConfigured={form.setTlsConfigured} tlsEnabled={form.tlsEnabled} setTlsEnabled={form.setTlsEnabled} tlsCaCertPath={form.tlsCaCertPath} setTlsCaCertPath={form.setTlsCaCertPath} tlsVerifyCertificate={form.tlsVerifyCertificate} setTlsVerifyCertificate={form.setTlsVerifyCertificate} advancedSections={form.advancedSections} toggleSection={form.toggleSection} saveSuccessMsg={form.saveSuccessMsg} testResult={form.testResult} isSqlite={form.isSqlite} transport={form.transport} />
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
