import React from "react";
import {
  CheckCircle2,
  AlertCircle,
  FolderOpen,
} from "lucide-react";


import type { BackupRestoreState } from "./useBackupRestore";

export const VerifyTab: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const {
    handlePickVerifyDir,
    isBusy,
    setVerifyDir,
    verifyDir,
    verifyError,
    verifyResult,
  } = state;

  return (
    <>
      <div className="space-y-5">
        {/* Verification Error */}
        {verifyError && (
          <div className="p-3.5 rounded-lg border border-line text-danger text-xs flex items-start space-x-2.5">
            <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block mb-0.5">Error en la verificación</span>
              <span className="font-mono text-[11px] break-all">{verifyError}</span>
            </div>
          </div>
        )}

        {/* Verify Result */}
        {verifyResult && (
          <div className="p-4 rounded-xl border border-line text-fg text-xs space-y-3">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <div className="flex items-center space-x-2">
                {verifyResult.valid ? (
                  <CheckCircle2 className="w-4 h-4 text-success" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-danger" />
                )}
                <span className={`font-bold text-sm ${verifyResult.valid ? "text-success" : "text-danger"}`}>
                  {verifyResult.valid ? "¡Respaldo íntegro y verificado!" : "Respaldo con inconsistencias o archivos corruptos"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
              <div className="bg-canvas p-2.5 rounded border border-line">
                <span className="text-fg-muted block">Total Archivos</span>
                <span className="font-bold text-fg text-sm">{verifyResult.total_files}</span>
              </div>
              <div className="bg-canvas p-2.5 rounded border border-line">
                <span className="text-fg-muted block">Archivos Verificados</span>
                <span className="font-bold text-success text-sm">{verifyResult.verified_files}</span>
              </div>
              <div className="bg-canvas p-2.5 rounded border border-line">
                <span className="text-fg-muted block">Corruptos / Faltantes</span>
                <span
                  className={`font-bold text-sm ${
                    verifyResult.corrupted_files.length + verifyResult.missing_files.length > 0
                      ? "text-danger"
                      : "text-fg"
                  }`}
                >
                  {verifyResult.corrupted_files.length + verifyResult.missing_files.length}
                </span>
              </div>
            </div>

            {verifyResult.corrupted_files.length > 0 && (
              <div className="p-2.5 bg-canvas rounded border border-line text-danger space-y-1">
                <span className="font-semibold block">Archivos con hash SHA-256 alterado:</span>
                <ul className="list-disc list-inside font-mono text-[11px]">
                  {verifyResult.corrupted_files.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </div>
            )}

            {verifyResult.decompression_errors.length > 0 && (
              <div className="p-2.5 bg-canvas rounded border border-line text-danger space-y-1">
                <span className="font-semibold block">Errores de descompresión:</span>
                <ul className="list-disc list-inside font-mono text-[11px]">
                  {verifyResult.decompression_errors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {verifyResult.missing_files.length > 0 && (
              <div className="p-2.5 bg-canvas rounded border border-line text-danger space-y-1">
                <span className="font-semibold block">Archivos declarados en el manifest no encontrados en disco:</span>
                <ul className="list-disc list-inside font-mono text-[11px]">
                  {verifyResult.missing_files.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Directory Selector */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-fg">Directorio del Respaldo a Verificar</label>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={verifyDir}
              onChange={(e) => setVerifyDir(e.target.value)}
              placeholder="Ruta absoluta de la carpeta que contiene manifest.json..."
              disabled={isBusy}
              className="flex-1 bg-surface border border-line rounded-lg px-3 py-2 text-xs text-fg font-mono focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={handlePickVerifyDir}
              disabled={isBusy}
              className="px-3 py-2 rounded-lg bg-raised border border-line hover:bg-hover text-fg text-xs font-medium flex items-center space-x-1.5 shrink-0"
            >
              <FolderOpen className="w-4 h-4 text-fg-muted" />
              <span>Examinar...</span>
            </button>
          </div>
          <p className="text-[11px] text-fg-muted">
            PyroStudio leerá el <span className="font-mono text-fg">manifest.json</span>, recalculará los hashes criptográficos SHA-256 de cada bloque particionado y verificará la integridad de la descompresión Zstandard o Gzip sin cargar los datos en el motor.
          </p>
        </div>
      </div>
    </>
  );
};
