import React from "react";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderOpen,
  HardDrive,
  RefreshCw,
  GitBranch,
} from "lucide-react";
import type {
  BackupCompressionFormat,
} from "../../types/database";


import type { BackupRestoreState } from "./useBackupRestore";

/** Settings of the structured directory backup: compression, parallelism, binlog incremental and verification. */
export const DirectoryBackupSettings: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const {
    backupDir,
    backupFormat,
    baseBackupDir,
    binlogChainCheck,
    binlogReq,
    chunkSizeRows,
    compression,
    handleCheckBinlogReq,
    handlePickBackupDir,
    handlePickBaseBackupDir,
    handleVerifyChain,
    isBusy,
    isCheckingChain,
    isLoadingBinlogReq,
    setBackupDir,
    setBaseBackupDir,
    setChunkSizeRows,
    setCompression,
    setStructuredBackupType,
    setZstdLevel,
    structuredBackupType,
    zstdLevel,
  } = state;

  return (
    <>
      {/* Directory-specific settings */}
      {backupFormat === "directory" && (
        <div className="p-3.5 bg-raised rounded-xl border border-line space-y-3">
          <div className="flex items-center space-x-2 text-xs font-semibold text-fg pb-2 border-b border-line">
            <HardDrive className="w-4 h-4 text-accent-text" />
            <span>Configuración de Respaldo Estructurado</span>
          </div>

          {/* Destination Directory */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-fg-muted">
              Directorio de Destino
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={backupDir}
                onChange={(e) => setBackupDir(e.target.value)}
                placeholder="Ruta absoluta de la carpeta de destino..."
                disabled={isBusy}
                className="flex-1 bg-surface border border-line rounded-lg px-3 py-1.5 text-xs text-fg font-mono focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={handlePickBackupDir}
                disabled={isBusy}
                className="px-3 py-1.5 rounded-lg bg-surface border border-line hover:bg-hover text-fg text-xs font-medium flex items-center space-x-1.5 shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5 text-fg-muted" />
                <span>Examinar...</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {/* Compression */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-fg-muted">
                Compresión de Bloques
              </label>
              <select
                value={compression}
                onChange={(e) => setCompression(e.target.value as BackupCompressionFormat)}
                disabled={isBusy}
                className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-accent"
              >
                <option value="zstd">Zstandard (Ultra rápido)</option>
                <option value="gzip">Gzip (Estándar)</option>
                <option value="none">Sin compresión</option>
              </select>
            </div>

            {/* Chunk Size */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-fg-muted">
                Tamaño de Bloque
              </label>
              <select
                value={chunkSizeRows}
                onChange={(e) => setChunkSizeRows(Number(e.target.value))}
                disabled={isBusy}
                className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-accent"
              >
                <option value={25000}>25,000 filas / chunk</option>
                <option value={50000}>50,000 filas / chunk (Recomendado)</option>
                <option value={100000}>100,000 filas / chunk</option>
                <option value={250000}>250,000 filas / chunk</option>
              </select>
            </div>

            {/* Zstd Level (only if zstd) */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-fg-muted">
                Nivel Zstd ({zstdLevel})
              </label>
              <input
                type="range"
                min={1}
                max={19}
                value={zstdLevel}
                onChange={(e) => setZstdLevel(Number(e.target.value))}
                disabled={isBusy || compression !== "zstd"}
                className="w-full mt-2 accent-accent"
              />
            </div>
          </div>

          {/* Structured Backup Strategy: Full vs Differential */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-semibold text-fg-muted">
              Estrategia de Respaldo Estructurado
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setStructuredBackupType("full")}
                disabled={isBusy}
                className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                  structuredBackupType === "full"
                    ? "bg-accent-soft border-accent/60 text-fg ring-1 ring-accent/30 font-semibold"
                    : "bg-surface border-line text-fg-muted hover:text-fg"
                }`}
              >
                <div>Completo (Full)</div>
                <div className="text-[10px] text-fg-muted font-normal mt-0.5">
                  Vuelca todas las tablas y sus datos en bloques nuevos.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setStructuredBackupType("differential")}
                disabled={isBusy}
                className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                  structuredBackupType === "differential"
                    ? "bg-accent-soft border-accent/60 text-fg ring-1 ring-accent/30 font-semibold"
                    : "bg-surface border-line text-fg-muted hover:text-fg"
                }`}
              >
                <div className="flex items-center gap-1">
                  <span>Diferencial</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-accent-soft text-accent-text border border-accent/30">Fase 4.3</span>
                </div>
                <div className="text-[10px] text-fg-muted font-normal mt-0.5">
                  Calcula CHECKSUM TABLE y solo exporta tablas modificadas.
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setStructuredBackupType("incremental_binlog");
                  if (!binlogReq) {
                    void handleCheckBinlogReq();
                  }
                }}
                disabled={isBusy}
                className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                  structuredBackupType === "incremental_binlog"
                    ? "bg-accent-soft border-accent/60 text-fg ring-1 ring-accent/30 font-semibold"
                    : "bg-surface border-line text-fg-muted hover:text-fg"
                }`}
              >
                <div className="flex items-center gap-1">
                  <span>Incremental (Binlog)</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-accent-soft text-accent-text border border-accent/30">Fase 4.2</span>
                </div>
                <div className="text-[10px] text-fg-muted font-normal mt-0.5">
                  Captura eventos del binary log para point-in-time recovery.
                </div>
              </button>
            </div>
          </div>

          {/* Binlog Requirements Status & Base Backup Picker for Incremental Binlog */}
          {structuredBackupType === "incremental_binlog" && (
            <div className="space-y-3 pt-1 bg-surface p-3 rounded-lg border border-line">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <div className="flex items-center space-x-2">
                  <GitBranch className="w-4 h-4 text-accent-text" />
                  <span className="font-semibold text-xs text-fg">
                    Estado del Binary Log en el Servidor
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCheckBinlogReq}
                  disabled={isLoadingBinlogReq}
                  className="text-[11px] px-2 py-0.5 rounded bg-raised border border-line hover:bg-hover text-accent-text flex items-center space-x-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingBinlogReq ? "animate-spin" : ""}`} />
                  <span>Comprobar</span>
                </button>
              </div>

              {isLoadingBinlogReq ? (
                <div className="py-2 flex items-center justify-center space-x-2 text-xs text-fg-muted">
                  <Loader2 className="w-4 h-4 animate-spin text-accent-text" />
                  <span>Consultando variables del servidor binlog...</span>
                </div>
              ) : binlogReq ? (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[10px] block font-sans">log_bin</span>
                      <span className={`font-bold ${binlogReq.log_bin_enabled ? "text-success" : "text-danger"}`}>
                        {binlogReq.log_bin_enabled ? "Activo (ON)" : "Inactivo (OFF)"}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[10px] block font-sans">Formato</span>
                      <span className="font-bold text-fg">{binlogReq.binlog_format}</span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[10px] block font-sans">Privilegios Repl</span>
                      <span className={`font-bold ${binlogReq.has_replication_client ? "text-success" : "text-warning"}`}>
                        {binlogReq.has_replication_client ? "Otorgados" : "Limitados"}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[10px] block font-sans">Logs Disponibles</span>
                      <span className="font-bold text-fg">{binlogReq.available_logs_count} archivos</span>
                    </div>
                  </div>

                  {binlogReq.current_binlog_file && (
                    <div className="text-[11px] font-mono bg-canvas p-2 rounded border border-line flex items-center justify-between">
                      <span className="text-fg-muted">Coordenadas activas:</span>
                      <span className="text-accent-text font-bold">
                        {binlogReq.current_binlog_file}:{binlogReq.current_binlog_pos || 0}
                      </span>
                    </div>
                  )}

                  {binlogReq.suggestions.length > 0 && (
                    <div className="p-2.5 rounded bg-canvas border border-line text-[11px] text-warning space-y-1">
                      <span className="font-semibold block">Recomendaciones de configuración:</span>
                      <ul className="list-disc list-inside space-y-0.5 text-fg-muted">
                        {binlogReq.suggestions.map((s, idx) => (
                          <li key={idx}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Base Backup Dir Picker */}
              <div className="space-y-1.5 pt-2 border-t border-line">
                <label className="text-[11px] font-semibold text-fg-muted flex items-center justify-between">
                  <span>Directorio del Respaldo Base</span>
                  <span className="text-[10px] text-accent-text">Origen para continuar la cadena binlog</span>
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={baseBackupDir}
                    onChange={(e) => {
                      setBaseBackupDir(e.target.value);
                      if (e.target.value.trim()) {
                        void handleVerifyChain(e.target.value);
                      }
                    }}
                    placeholder="Carpeta del respaldo base (contiene manifest.json)..."
                    disabled={isBusy}
                    className="flex-1 bg-raised border border-line rounded-lg px-3 py-1.5 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={handlePickBaseBackupDir}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg bg-raised border border-line hover:bg-hover text-fg text-xs font-medium flex items-center space-x-1.5 shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Examinar...</span>
                  </button>
                </div>

                {/* Chain Verification Status */}
                {isCheckingChain ? (
                  <div className="flex items-center space-x-2 text-[11px] text-fg-muted py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-text" />
                    <span>Verificando continuidad de la cadena binlog...</span>
                  </div>
                ) : binlogChainCheck ? (
                  <div
                    className={`p-2 rounded text-[11px] font-mono flex items-start space-x-2 border ${
                      binlogChainCheck.is_valid
                        ? "bg-canvas border-line text-success"
                        : "bg-canvas border-line text-warning"
                    }`}
                  >
                    {binlogChainCheck.is_valid ? (
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-semibold block font-sans">
                        {binlogChainCheck.is_valid
                          ? "Cadena de replicación continua e íntegra"
                          : "Atención con la cadena binlog"}
                      </span>
                      <span className="text-[10px] text-fg-muted block">
                        {binlogChainCheck.message}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Base Backup Dir for Differential */}
          {structuredBackupType === "differential" && (
            <div className="space-y-1.5 pt-1 bg-surface p-2.5 rounded-lg border border-line">
              <label className="text-[11px] font-semibold text-fg-muted flex items-center justify-between">
                <span>Directorio del Respaldo Base</span>
                <span className="text-[10px] text-accent-text">Requerido para comparar checksums</span>
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={baseBackupDir}
                  onChange={(e) => setBaseBackupDir(e.target.value)}
                  placeholder="Carpeta del respaldo base (contiene manifest.json)..."
                  disabled={isBusy}
                  className="flex-1 bg-raised border border-line rounded-lg px-3 py-1.5 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={handlePickBaseBackupDir}
                  disabled={isBusy}
                  className="px-3 py-1.5 rounded-lg bg-raised border border-line hover:bg-hover text-fg text-xs font-medium flex items-center space-x-1.5 shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-fg-muted" />
                  <span>Examinar...</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};
