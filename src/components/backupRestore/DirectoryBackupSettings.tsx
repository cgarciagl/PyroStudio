import React from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("backup");
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
            <span>{t("dirSettings.header")}</span>
          </div>

          {/* Destination Directory */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-fg-muted">
              {t("dirSettings.destDir")}
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={backupDir}
                onChange={(e) => setBackupDir(e.target.value)}
                placeholder={t("dirSettings.destDirPlaceholder")}
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
                <span>{t("dirSettings.browse")}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {/* Compression */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-fg-muted">
                {t("dirSettings.compression")}
              </label>
              <select
                value={compression}
                onChange={(e) => setCompression(e.target.value as BackupCompressionFormat)}
                disabled={isBusy}
                className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-accent"
              >
                <option value="zstd">{t("dirSettings.compZstd")}</option>
                <option value="gzip">{t("dirSettings.compGzip")}</option>
                <option value="none">{t("dirSettings.compNone")}</option>
              </select>
            </div>

            {/* Chunk Size */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-fg-muted">
                {t("dirSettings.chunkSize")}
              </label>
              <select
                value={chunkSizeRows}
                onChange={(e) => setChunkSizeRows(Number(e.target.value))}
                disabled={isBusy}
                className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-accent"
              >
                <option value={25000}>{t("dirSettings.chunk25k")}</option>
                <option value={50000}>{t("dirSettings.chunk50k")}</option>
                <option value={100000}>{t("dirSettings.chunk100k")}</option>
                <option value={250000}>{t("dirSettings.chunk250k")}</option>
              </select>
            </div>

            {/* Zstd Level (only if zstd) */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-fg-muted">
                {t("dirSettings.zstdLevel", { level: zstdLevel })}
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
              {t("dirSettings.strategyLabel")}
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
                <div>{t("dirSettings.fullTitle")}</div>
                <div className="text-[10px] text-fg-muted font-normal mt-0.5">
                  {t("dirSettings.fullDesc")}
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
                  <span>{t("dirSettings.diffTitle")}</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-accent-soft text-accent-text border border-accent/30">{t("dirSettings.phase43")}</span>
                </div>
                <div className="text-[10px] text-fg-muted font-normal mt-0.5">
                  {t("dirSettings.diffDesc")}
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
                  <span>{t("dirSettings.incTitle")}</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-accent-soft text-accent-text border border-accent/30">{t("dirSettings.phase42")}</span>
                </div>
                <div className="text-[10px] text-fg-muted font-normal mt-0.5">
                  {t("dirSettings.incDesc")}
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
                    {t("dirSettings.binlogStatusTitle")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCheckBinlogReq}
                  disabled={isLoadingBinlogReq}
                  className="text-[11px] px-2 py-0.5 rounded bg-raised border border-line hover:bg-hover text-accent-text flex items-center space-x-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingBinlogReq ? "animate-spin" : ""}`} />
                  <span>{t("dirSettings.checkBtn")}</span>
                </button>
              </div>

              {isLoadingBinlogReq ? (
                <div className="py-2 flex items-center justify-center space-x-2 text-xs text-fg-muted">
                  <Loader2 className="w-4 h-4 animate-spin text-accent-text" />
                  <span>{t("dirSettings.checkingBinlog")}</span>
                </div>
              ) : binlogReq ? (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[10px] block font-sans">log_bin</span>
                      <span className={`font-bold ${binlogReq.log_bin_enabled ? "text-success" : "text-danger"}`}>
                        {binlogReq.log_bin_enabled ? t("dirSettings.activeOn") : t("dirSettings.inactiveOff")}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[10px] block font-sans">{t("dirSettings.formatLabel")}</span>
                      <span className="font-bold text-fg">{binlogReq.binlog_format}</span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[10px] block font-sans">{t("dirSettings.replPrivs")}</span>
                      <span className={`font-bold ${binlogReq.has_replication_client ? "text-success" : "text-warning"}`}>
                        {binlogReq.has_replication_client ? t("dirSettings.granted") : t("dirSettings.limited")}
                      </span>
                    </div>
                    <div className="bg-canvas p-2 rounded border border-line">
                      <span className="text-fg-muted text-[10px] block font-sans">{t("dirSettings.availableLogs")}</span>
                      <span className="font-bold text-fg">{t("dirSettings.filesCount", { count: binlogReq.available_logs_count })}</span>
                    </div>
                  </div>

                  {binlogReq.current_binlog_file && (
                    <div className="text-[11px] font-mono bg-canvas p-2 rounded border border-line flex items-center justify-between">
                      <span className="text-fg-muted">{t("dirSettings.activeCoords")}</span>
                      <span className="text-accent-text font-bold">
                        {binlogReq.current_binlog_file}:{binlogReq.current_binlog_pos || 0}
                      </span>
                    </div>
                  )}

                  {binlogReq.suggestions.length > 0 && (
                    <div className="p-2.5 rounded bg-canvas border border-line text-[11px] text-warning space-y-1">
                      <span className="font-semibold block">{t("dirSettings.suggestionsTitle")}</span>
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
                  <span>{t("dirSettings.baseBackupDir")}</span>
                  <span className="text-[10px] text-accent-text">{t("dirSettings.baseBackupHint")}</span>
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
                    placeholder={t("dirSettings.baseBackupPlaceholder")}
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
                    <span>{t("dirSettings.browse")}</span>
                  </button>
                </div>

                {/* Chain Verification Status */}
                {isCheckingChain ? (
                  <div className="flex items-center space-x-2 text-[11px] text-fg-muted py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-text" />
                    <span>{t("dirSettings.verifyingChain")}</span>
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
                          ? t("dirSettings.chainValid")
                          : t("dirSettings.chainWarning")}
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
                <span>{t("dirSettings.baseBackupDir")}</span>
                <span className="text-[10px] text-accent-text">{t("dirSettings.diffChecksumHint")}</span>
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={baseBackupDir}
                  onChange={(e) => setBaseBackupDir(e.target.value)}
                  placeholder={t("dirSettings.baseBackupPlaceholder")}
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
                  <span>{t("dirSettings.browse")}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};
