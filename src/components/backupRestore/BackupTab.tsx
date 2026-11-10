import React from "react";
import {
  Database,
  Table as TableIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderOpen,
  ShieldCheck,
  Layers,
  Sparkles,
  Settings2,
  Save,
  HardDrive,
  RefreshCw,
  GitBranch,
} from "lucide-react";
import type {
  BackupCompressionFormat,
} from "../../types/database";


import type { BackupRestoreState } from "./useBackupRestore";

export const BackupTab: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const {
    addDropTable,
    backupDb,
    backupDir,
    backupError,
    backupFormat,
    backupScope,
    backupSummary,
    baseBackupDir,
    binlogBackupSummary,
    binlogChainCheck,
    binlogReq,
    chunkSizeRows,
    compression,
    contentMode,
    currentDbTables,
    databases,
    dirBackupSummary,
    disableFkChecks,
    formatBytes,
    handleCheckBinlogReq,
    handlePickBackupDir,
    handlePickBaseBackupDir,
    handleVerifyChain,
    includeCreateDb,
    includeReplicationCoords,
    includeRoutines,
    includeTriggers,
    includeViews,
    insertBatchSize,
    isBusy,
    isCheckingChain,
    isLoadingBinlogReq,
    isSqlite,
    selectedTables,
    setActiveTab,
    setAddDropTable,
    setBackupDb,
    setBackupDir,
    setBackupFormat,
    setBackupScope,
    setBaseBackupDir,
    setChunkSizeRows,
    setCompression,
    setContentMode,
    setDisableFkChecks,
    setIncludeCreateDb,
    setIncludeReplicationCoords,
    setIncludeRoutines,
    setIncludeTriggers,
    setIncludeViews,
    setInsertBatchSize,
    setSelectedTables,
    setStructuredBackupType,
    setVerifyDir,
    setZstdLevel,
    sqliteBackupSuccessPath,
    structuredBackupType,
    zstdLevel,
  } = state;

  return (
    <>
          <div className="space-y-5">
            {/* Backup Error */}
            {backupError && (
              <div className="p-3.5 rounded-lg border border-line text-danger text-xs flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="font-semibold block mb-0.5">Error en el respaldo</span>
                  <span className="font-mono text-[11px] break-all">{backupError}</span>
                </div>
              </div>
            )}

            {/* Backup Success Summary */}
            {backupSummary && (
              <div className="p-4 rounded-lg border border-line text-fg text-xs space-y-2.5">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="font-bold text-success text-sm">
                      ¡Respaldo completado con éxito!
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-success/80">
                    {backupSummary.duration_ms} ms
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Tablas</span>
                    <span className="font-bold text-fg text-sm">
                      {backupSummary.total_tables}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Vistas / Rutinas</span>
                    <span className="font-bold text-fg text-sm">
                      {backupSummary.total_views + backupSummary.total_routines}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Filas Volcadas</span>
                    <span className="font-bold text-fg text-sm">
                      {backupSummary.total_rows_exported.toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Tamaño Archivo</span>
                    <span className="font-bold text-fg text-sm">
                      {formatBytes(backupSummary.file_size_bytes)}
                    </span>
                  </div>
                </div>

                {backupSummary.file_path && (
                  <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted block text-[11px]">Guardado en:</span>
                    <span className="text-success select-all">{backupSummary.file_path}</span>
                  </div>
                )}

                {/* Snapshot status and Binlog coordinates */}
                {backupSummary.consistent_snapshot && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium bg-accent-soft text-accent-text border border-accent/20">
                      <ShieldCheck className="w-3 h-3 text-accent-text" />
                      Snapshot consistente (InnoDB)
                    </span>
                    {backupSummary.binlog_coordinates && (
                      <span className="font-mono text-fg-muted truncate max-w-full" title={backupSummary.binlog_coordinates}>
                        Binlog: {backupSummary.binlog_coordinates}
                      </span>
                    )}
                  </div>
                )}

                {/* Non-transactional tables warning */}
                {backupSummary.non_transactional_tables && backupSummary.non_transactional_tables.length > 0 && (
                  <div className="p-2.5 rounded-lg border border-line bg-surface text-warning text-xs flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <span className="font-semibold block mb-0.5">Tablas no transaccionales detectadas</span>
                      <span className="text-[11px] text-fg-muted block">
                        Las tablas <span className="font-mono text-fg font-medium">{backupSummary.non_transactional_tables.join(", ")}</span> usan motores sin soporte transaccional (MyISAM/Aria). Sus datos se exportaron pero no participan en el snapshot consistente.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Phase 4 Directory Backup Success Summary */}
            {dirBackupSummary && (
              <div className="p-4 rounded-lg border border-line text-fg text-xs space-y-2.5">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="font-bold text-success text-sm">
                      ¡Respaldo estructurado completado con éxito!
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-success/80">
                    {dirBackupSummary.duration_ms} ms
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Tablas</span>
                    <span className="font-bold text-fg text-sm">
                      {dirBackupSummary.total_tables}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Bloques (Chunks)</span>
                    <span className="font-bold text-fg text-sm">
                      {dirBackupSummary.total_chunks}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Filas Volcadas</span>
                    <span className="font-bold text-fg text-sm">
                      {dirBackupSummary.total_rows.toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Compresión</span>
                    <span className="font-bold text-fg text-sm uppercase">
                      {dirBackupSummary.compression} ({dirBackupSummary.compression_ratio.toFixed(2)}x)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted block text-[11px]">Tamaño Comprimido:</span>
                    <span className="font-bold text-fg">{formatBytes(dirBackupSummary.total_bytes)}</span>
                    <span className="text-fg-muted text-[10px] ml-1">
                      (de {formatBytes(dirBackupSummary.total_uncompressed_bytes)} sin comprimir)
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line flex items-center justify-between">
                    <div>
                      <span className="text-fg-muted block text-[11px]">Manifest ID:</span>
                      <span className="text-fg font-medium truncate max-w-[140px] block" title={dirBackupSummary.manifest_id}>
                        {dirBackupSummary.manifest_id}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setVerifyDir(dirBackupSummary.target_dir);
                        setActiveTab("verify");
                      }}
                      className="text-[11px] px-2 py-1 rounded bg-raised border border-line hover:bg-hover text-accent-text shrink-0"
                    >
                      Verificar integridad
                    </button>
                  </div>
                </div>

                <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2 rounded border border-line">
                  <span className="text-fg-muted block text-[11px]">Directorio de respaldo:</span>
                  <span className="text-success select-all">{dirBackupSummary.target_dir}</span>
                </div>

                {dirBackupSummary.consistent_snapshot && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium bg-accent-soft text-accent-text border border-accent/20">
                      <ShieldCheck className="w-3 h-3 text-accent-text" />
                      Snapshot consistente (InnoDB)
                    </span>
                    {dirBackupSummary.binlog_coordinates && (
                      <span className="font-mono text-fg-muted truncate max-w-full" title={dirBackupSummary.binlog_coordinates}>
                        Binlog: {dirBackupSummary.binlog_coordinates}
                      </span>
                    )}
                  </div>
                )}

                {dirBackupSummary.non_transactional_tables && dirBackupSummary.non_transactional_tables.length > 0 && (
                  <div className="p-2.5 rounded-lg border border-line bg-surface text-warning text-xs flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <span className="font-semibold block mb-0.5">Tablas no transaccionales detectadas</span>
                      <span className="text-[11px] text-fg-muted block">
                        Las tablas <span className="font-mono text-fg font-medium">{dirBackupSummary.non_transactional_tables.join(", ")}</span> usan motores sin soporte transaccional (MyISAM/Aria). Sus datos se exportaron pero no participan en el snapshot consistente.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Phase 4.2 Binlog Incremental Backup Success Summary */}
            {binlogBackupSummary && (
              <div className="p-4 rounded-lg border border-line text-fg text-xs space-y-2.5">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="font-bold text-success text-sm">
                      ¡Respaldo incremental binlog completado!
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-success/80">
                    {binlogBackupSummary.duration_ms} ms
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Base de Datos</span>
                    <span className="font-bold text-fg text-sm">{binlogBackupSummary.database}</span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Eventos Binlog</span>
                    <span className="font-bold text-fg text-sm">{binlogBackupSummary.total_events.toLocaleString()}</span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted text-[11px] block">Tamaño Comprimido</span>
                    <span className="font-bold text-fg text-sm">{formatBytes(binlogBackupSummary.total_compressed_bytes)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted block text-[11px]">Coordenadas Iniciales:</span>
                    <span className="text-fg font-medium truncate block" title={binlogBackupSummary.start_coordinates}>
                      {binlogBackupSummary.start_coordinates}
                    </span>
                  </div>
                  <div className="bg-canvas p-2 rounded border border-line">
                    <span className="text-fg-muted block text-[11px]">Coordenadas Finales:</span>
                    <span className="text-fg font-medium truncate block" title={binlogBackupSummary.end_coordinates}>
                      {binlogBackupSummary.end_coordinates}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2 rounded border border-line flex items-center justify-between">
                  <div>
                    <span className="text-fg-muted block text-[11px]">Backup ID:</span>
                    <span className="text-success select-all">{binlogBackupSummary.backup_id}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVerifyDir(binlogBackupSummary.target_dir);
                      setActiveTab("verify");
                    }}
                    className="text-[11px] px-2 py-1 rounded bg-raised border border-line hover:bg-hover text-accent-text shrink-0"
                  >
                    Verificar integridad
                  </button>
                </div>
              </div>
            )}

            {/* SQLite Backup Success Summary */}
            {sqliteBackupSuccessPath && (
              <div className="p-4 rounded-lg border border-line text-fg text-xs space-y-2.5">
                <div className="flex items-center space-x-2 border-b border-line pb-2">
                  <CheckCircle2 className="w-4 h-4 text-success" />
                  <span className="font-semibold text-fg text-sm">
                    Copia de seguridad SQLite completada
                  </span>
                </div>

                <div className="text-[11px] text-fg font-mono break-all pt-1 bg-canvas p-2.5 rounded border border-line">
                  <span className="text-fg-muted block text-[11px]">Guardado en:</span>
                  <span className="text-fg select-all">{sqliteBackupSuccessPath}</span>
                </div>

                <p className="text-[11px] text-fg-muted pt-1 leading-relaxed">
                  El comando <code className="text-accent-text font-mono">VACUUM INTO</code> generó una copia limpia, idéntica y defragmentada de la base de datos sin alterar la base de datos activa ni bloquear lecturas.
                </p>
              </div>
            )}

            {isSqlite ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-line bg-raised space-y-3">
                  <div className="flex items-center space-x-2.5">
                    <Database className="w-5 h-5 text-accent-text shrink-0" />
                    <div>
                      <h4 className="text-xs font-semibold text-fg">Respaldo en caliente</h4>
                      <p className="text-[11px] text-fg-muted">
                        SQLite produce una instantánea consistente y optimizada de toda la base de datos.
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-fg-muted space-y-2 border-t border-line pt-3 leading-relaxed">
                    <p>
                      A diferencia de los volcados SQL tradicionales, <strong className="text-fg">VACUUM INTO</strong> genera directamente un archivo de base de datos SQLite binario completo y optimizado.
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-[11px]">
                      <li>No bloquea lecturas concurrentes durante la copia.</li>
                      <li>Incluye automáticamente todas las tablas ({currentDbTables.length}), índices, vistas y esquemas.</li>
                      <li>Desfragmenta el archivo resultante para un tamaño mínimo en disco.</li>
                    </ul>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-fg">Base de Datos de Origen</label>
                  <div className="p-3 bg-surface border border-line rounded-lg font-mono text-xs text-fg flex items-center justify-between">
                    <span className="truncate">{backupDb || "main"}</span>
                    <span className="text-[11px] text-fg-muted font-sans shrink-0 ml-2">
                      {currentDbTables.length} tablas detectadas
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <>

            {/* Source Database Picker */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-fg flex items-center justify-between">
                <span>Base de Datos de Origen</span>
                <span className="text-[11px] text-fg-muted">
                  Total disponibles: {databases.length}
                </span>
              </label>
              <select
                value={backupDb}
                onChange={(e) => {
                  setBackupDb(e.target.value);
                  setSelectedTables([]);
                }}
                disabled={isBusy}
                className="w-full bg-raised border border-line rounded-lg px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-accent"
              >
                {databases.map((db) => (
                  <option key={db.name} value={db.name}>
                    {db.name} {db.tables_count ? `(${db.tables_count} tablas)` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Backup Format: Single SQL File vs High-Performance Directory */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-fg">
                Formato del Respaldo
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setBackupFormat("file")}
                  disabled={isBusy}
                  className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                    backupFormat === "file"
                      ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                      : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <Save
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      backupFormat === "file" ? "text-accent-text" : "text-fg-subtle"
                    }`}
                  />
                  <div>
                    <div className="font-semibold text-xs text-fg">
                      Archivo SQL Único (.sql)
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      Volcado estándar en un solo archivo de texto SQL plano.
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setBackupFormat("directory")}
                  disabled={isBusy}
                  className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                    backupFormat === "directory"
                      ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                      : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <HardDrive
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      backupFormat === "directory" ? "text-accent-text" : "text-fg-subtle"
                    }`}
                  />
                  <div>
                    <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                      <span>Directorio Estructurado</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-accent-soft text-accent-text border border-accent/20">Fase 4</span>
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      Particionado en bloques, compresión Zstandard y verificación SHA-256 por bloque.
                    </div>
                  </div>
                </button>
              </div>
            </div>

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

            {/* Backup Scope: Full vs Selected Tables */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-fg">
                Alcance del Respaldo
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setBackupScope("database")}
                  disabled={isBusy}
                  className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                    backupScope === "database"
                      ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                      : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <Database
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      backupScope === "database" ? "text-accent-text" : "text-fg-subtle"
                    }`}
                  />
                  <div>
                    <div className="font-semibold text-xs text-fg">
                      Toda la Base de Datos
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      Incluye todas las tablas ({currentDbTables.length}), vistas, rutinas y triggers.
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setBackupScope("tables")}
                  disabled={isBusy}
                  className={`p-3 rounded-lg border text-left flex items-start space-x-3 transition-all ${
                    backupScope === "tables"
                      ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                      : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <TableIcon
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      backupScope === "tables" ? "text-accent-text" : "text-fg-subtle"
                    }`}
                  />
                  <div>
                    <div className="font-semibold text-xs text-fg">
                      Tablas Específicas ({selectedTables.length} selec.)
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5">
                      Elige manualmente las tablas individuales a respaldar.
                    </div>
                  </div>
                </button>
              </div>

              {/* Table Picker if Scope is 'tables' */}
              {backupScope === "tables" && (
                <div className="p-3 bg-raised rounded-lg border border-line space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs pb-1 border-b border-line">
                    <span className="text-fg font-semibold">Seleccionar tablas:</span>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setSelectedTables(currentDbTables.map((t) => t.name))}
                        className="text-[11px] text-accent-text hover:underline"
                      >
                        Seleccionar todas
                      </button>
                      <span className="text-fg-subtle">•</span>
                      <button
                        type="button"
                        onClick={() => setSelectedTables([])}
                        className="text-[11px] text-fg-muted hover:underline"
                      >
                        Deseleccionar
                      </button>
                    </div>
                  </div>

                  <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                    {currentDbTables.length === 0 ? (
                      <div className="text-xs text-fg-subtle italic py-2">
                        No hay tablas disponibles en esta base de datos.
                      </div>
                    ) : (
                      currentDbTables.map((tbl) => {
                        const isChecked = selectedTables.includes(tbl.name);
                        return (
                          <label
                            key={tbl.name}
                            className="flex items-center justify-between p-1.5 rounded hover:bg-hover cursor-pointer text-xs"
                          >
                            <div className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedTables([...selectedTables, tbl.name]);
                                  } else {
                                    setSelectedTables(
                                      selectedTables.filter((n) => n !== tbl.name)
                                    );
                                  }
                                }}
                                className="w-3.5 h-3.5 rounded bg-canvas border-line-strong text-accent-text focus:ring-accent"
                              />
                              <span className="text-fg font-mono">{tbl.name}</span>
                            </div>
                            <span className="text-[11px] text-fg-muted font-mono">
                              {tbl.rows_count !== null && tbl.rows_count !== undefined
                                ? `${tbl.rows_count.toLocaleString()} filas`
                                : ""}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Content Mode Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-fg">
                Tipo de Contenido a Respaldar
              </label>
              <div className="grid grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setContentMode("structure_and_data")}
                  disabled={isBusy}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    contentMode === "structure_and_data"
                      ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                      : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Estructura y Datos</span>
                  </div>
                  <div className="text-[11px] text-fg-muted mt-1">
                    Esquema completo DDL + sentencias INSERT optimizadas.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setContentMode("structure_only")}
                  disabled={isBusy}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    contentMode === "structure_only"
                      ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                      : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                    <Settings2 className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Solo Estructura (DDL)</span>
                  </div>
                  <div className="text-[11px] text-fg-muted mt-1">
                    Solo tablas, vistas, índices, funciones y triggers sin registros.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setContentMode("data_only")}
                  disabled={isBusy}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    contentMode === "data_only"
                      ? "bg-accent-soft border-accent/60 text-fg shadow-sm ring-1 ring-accent/30"
                      : "bg-raised border-line text-fg-muted hover:border-line-strong hover:text-fg"
                  }`}
                >
                  <div className="font-semibold text-xs text-fg flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Solo Datos</span>
                  </div>
                  <div className="text-[11px] text-fg-muted mt-1">
                    Solo sentencias INSERT múltiples sin definiciones DDL.
                  </div>
                </button>
              </div>
            </div>

            {/* Advanced SQL Options */}
            <div className="space-y-3 bg-raised p-4 rounded-xl border border-line">
              <div className="flex items-center space-x-2 text-xs font-semibold text-fg pb-2 border-b border-line">
                <Save className="w-4 h-4 text-fg-muted" />
                <span>Opciones Avanzadas del Respaldo</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {backupScope === "database" && (
                  <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                    <input
                      type="checkbox"
                      checked={includeCreateDb}
                      onChange={(e) => setIncludeCreateDb(e.target.checked)}
                      disabled={isBusy}
                      className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
                    />
                    <span>
                      Incluir <code className="text-accent-text text-[11px]">CREATE DATABASE IF NOT EXISTS</code>
                    </span>
                  </label>
                )}

                {contentMode !== "data_only" && (
                  <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                    <input
                      type="checkbox"
                      checked={addDropTable}
                      onChange={(e) => setAddDropTable(e.target.checked)}
                      disabled={isBusy}
                      className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
                    />
                    <span>
                      Agregar <code className="text-accent-text text-[11px]">DROP TABLE IF EXISTS</code>
                    </span>
                  </label>
                )}

                {backupScope === "database" && contentMode !== "data_only" && (
                  <>
                    <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                      <input
                        type="checkbox"
                        checked={includeViews}
                        onChange={(e) => setIncludeViews(e.target.checked)}
                        disabled={isBusy}
                        className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
                      />
                      <span>Incluir Vistas</span>
                    </label>

                    <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                      <input
                        type="checkbox"
                        checked={includeRoutines}
                        onChange={(e) => setIncludeRoutines(e.target.checked)}
                        disabled={isBusy}
                        className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
                      />
                      <span>Incluir Procedimientos y Funciones</span>
                    </label>
                  </>
                )}

                {contentMode !== "data_only" && (
                  <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                    <input
                      type="checkbox"
                      checked={includeTriggers}
                      onChange={(e) => setIncludeTriggers(e.target.checked)}
                      disabled={isBusy}
                      className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
                    />
                    <span>Incluir Triggers</span>
                  </label>
                )}

                <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg">
                  <input
                    type="checkbox"
                    checked={disableFkChecks}
                    onChange={(e) => setDisableFkChecks(e.target.checked)}
                    disabled={isBusy}
                    className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
                  />
                  <span>Desactivar las claves foráneas temporalmente en el script</span>
                </label>

                <label className="flex items-center space-x-2.5 cursor-pointer text-fg hover:text-fg col-span-1 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={includeReplicationCoords}
                    onChange={(e) => setIncludeReplicationCoords(e.target.checked)}
                    disabled={isBusy}
                    className="w-4 h-4 rounded bg-surface border-line-strong text-accent-text focus:ring-accent"
                  />
                  <span>Incluir coordenadas de replicación (requiere un bloqueo global breve en MySQL)</span>
                </label>
              </div>

              {contentMode !== "structure_only" && (
                <div className="pt-2 border-t border-line flex items-center justify-between text-xs">
                  <span className="text-fg-muted">Filas por sentencia INSERT múltiple:</span>
                  <select
                    value={insertBatchSize}
                    onChange={(e) => setInsertBatchSize(Number(e.target.value))}
                    disabled={isBusy}
                    className="bg-surface border border-line rounded px-2.5 py-1 text-xs text-fg font-mono focus:outline-none focus:border-accent"
                  >
                    <option value={100}>100 filas / INSERT</option>
                    <option value={250}>250 filas / INSERT (Recomendado)</option>
                    <option value={500}>500 filas / INSERT</option>
                    <option value={1000}>1,000 filas / INSERT (Máxima velocidad)</option>
                  </select>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
};
