import React from "react";
import {
  Database,
  Save,
  HardDrive,
} from "lucide-react";


import { BackupContentOptions } from "./BackupContentOptions";
import { DirectoryBackupSettings } from "./DirectoryBackupSettings";
import { BackupResults } from "./BackupResults";
import type { BackupRestoreState } from "./useBackupRestore";

export const BackupTab: React.FC<{ state: BackupRestoreState }> = ({ state }) => {
  const {
    backupDb,
    backupFormat,
    currentDbTables,
    databases,
    isBusy,
    isSqlite,
    setBackupDb,
    setBackupFormat,
    setSelectedTables,
  } = state;

  return (
    <>
          <div className="space-y-5">
            <BackupResults state={state} />

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

            <DirectoryBackupSettings state={state} />

            <BackupContentOptions state={state} />
          </>
        )}
      </div>
    </>
  );
};
