import React, { useState, useEffect } from "react";
import {
  X,
  Settings,
  Database,
  Code2,
  Sparkles,
  Keyboard,
  Info,
  ShieldAlert,
  Key,
  Lock,
  CheckCircle2,
  FileCode,
  Flame,
  Layers,
} from "lucide-react";
import { usePreferenceStore } from "../stores/preferenceStore";
import { useUIStore } from "../stores/uiStore";
import { AiSettingsForm } from "./AiSettingsModal";
import { ShortcutsList } from "./ShortcutsModal";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = "database" | "editor" | "ai" | "shortcuts" | "about";

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    safeModeEnabled,
    noPrimaryKeyMode,
    defaultPageSize,
    editorFontSize,
    editorLineNumbers,
    editorAutocomplete,
    confirmProductionActions,
    setSafeMode,
    setNoPrimaryKeyMode,
    setDefaultPageSize,
    setEditorFontSize,
    setEditorLineNumbers,
    setEditorAutocomplete,
    setConfirmProductionActions,
  } = usePreferenceStore();

  const settingsModalInitialTab = useUIStore((s) => s.settingsModalInitialTab);

  const [activeTab, setActiveTab] = useState<SettingsTab>(settingsModalInitialTab || "database");
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(settingsModalInitialTab || "database");
    }
  }, [isOpen, settingsModalInitialTab]);

  if (!isOpen) return null;

  const triggerFeedback = () => {
    setShowSavedFeedback(true);
    setTimeout(() => setShowSavedFeedback(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-[#11141c] border border-[#23293a] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-[#141824] border-b border-[#212738] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-orange-600/20 border border-orange-500/30 flex items-center justify-center">
              <Settings className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center space-x-2">
                <span>Configuración y Preferencias</span>
                {showSavedFeedback && (
                  <span className="text-[11px] font-normal text-emerald-400 flex items-center space-x-1 animate-in fade-in">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Guardado</span>
                  </span>
                )}
              </h2>
              <p className="text-xs text-neutral-400">
                Personaliza el comportamiento del editor, la cuadrícula de datos y la seguridad
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white p-1 rounded-md hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Layout: Sidebar Tabs + Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Tabs Navigation Sidebar */}
          <div className="w-52 bg-[#0e1118] border-r border-[#1d2230] p-3 space-y-1 shrink-0">
            <button
              onClick={() => setActiveTab("database")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "database"
                  ? "bg-orange-600/20 text-orange-400 border border-orange-500/30"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-[#161a25]"
              }`}
            >
              <Database className="w-4 h-4 shrink-0" />
              <span>Base de Datos & Tablas</span>
            </button>

            <button
              onClick={() => setActiveTab("editor")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "editor"
                  ? "bg-orange-600/20 text-orange-400 border border-orange-500/30"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-[#161a25]"
              }`}
            >
              <Code2 className="w-4 h-4 shrink-0" />
              <span>Editor SQL & Cuadrícula</span>
            </button>

            <button
              onClick={() => setActiveTab("ai")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "ai"
                  ? "bg-orange-600/20 text-orange-400 border border-orange-500/30"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-[#161a25]"
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>Inteligencia Artificial</span>
            </button>

            <button
              onClick={() => setActiveTab("shortcuts")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "shortcuts"
                  ? "bg-orange-600/20 text-orange-400 border border-orange-500/30"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-[#161a25]"
              }`}
            >
              <Keyboard className="w-4 h-4 shrink-0" />
              <span>Atajos de Teclado</span>
            </button>

            <button
              onClick={() => setActiveTab("about")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "about"
                  ? "bg-orange-600/20 text-orange-400 border border-orange-500/30"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-[#161a25]"
              }`}
            >
              <Info className="w-4 h-4 shrink-0" />
              <span>Acerca de PyroStudio</span>
            </button>
          </div>

          {/* Main Content Area */}
          <div
            className={`flex-1 overflow-y-auto bg-[#11141c] ${
              activeTab === "ai" || activeTab === "shortcuts"
                ? "p-0 flex flex-col min-h-0"
                : "p-6 space-y-6"
            }`}
          >
            {/* Database & Tables Tab */}
            {activeTab === "database" && (
              <div className="space-y-6 animate-in fade-in duration-150">
                {/* No PK Behavior Section */}
                <div>
                  <h3 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider mb-2 flex items-center space-x-2">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    <span>Tablas sin Clave Primaria (Primary Key)</span>
                  </h3>
                  <p className="text-xs text-neutral-400 mb-3">
                    Define cómo debe actuar PyroStudio cuando intentas modificar o eliminar registros en una tabla que no tiene clave primaria.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Option 1: Full Row Mode */}
                    <div
                      onClick={() => {
                        setNoPrimaryKeyMode("use_all_columns");
                        triggerFeedback();
                      }}
                      className={`cursor-pointer p-3.5 rounded-lg border transition-all ${
                        noPrimaryKeyMode === "use_all_columns"
                          ? "bg-amber-950/20 border-amber-500/50 shadow-md shadow-amber-950/20 ring-1 ring-amber-500/30"
                          : "bg-[#141824] border-[#222838] hover:border-neutral-600"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-2">
                          <Key className="w-4 h-4 text-amber-400 shrink-0" />
                          <span className="text-xs font-semibold text-white">
                            Usar Fila Completa (Recomendado)
                          </span>
                        </div>
                        <input
                          type="radio"
                          name="noPkMode"
                          checked={noPrimaryKeyMode === "use_all_columns"}
                          onChange={() => {
                            setNoPrimaryKeyMode("use_all_columns");
                            triggerFeedback();
                          }}
                          className="mt-0.5 text-orange-500 focus:ring-0"
                        />
                      </div>
                      <p className="text-[11px] text-neutral-400 mt-2 leading-relaxed">
                        Trata <strong className="text-neutral-300">todos los campos de la fila</strong> como criterio identificador único con <code className="text-amber-300 font-mono">LIMIT 1</code>. Permite editar y eliminar registros en la cuadrícula de datos de forma interactiva y segura.
                      </p>
                    </div>

                    {/* Option 2: Strict Block Mode */}
                    <div
                      onClick={() => {
                        setNoPrimaryKeyMode("block");
                        triggerFeedback();
                      }}
                      className={`cursor-pointer p-3.5 rounded-lg border transition-all ${
                        noPrimaryKeyMode === "block"
                          ? "bg-rose-950/20 border-rose-500/50 shadow-md shadow-rose-950/20 ring-1 ring-rose-500/30"
                          : "bg-[#141824] border-[#222838] hover:border-neutral-600"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-2">
                          <Lock className="w-4 h-4 text-rose-400 shrink-0" />
                          <span className="text-xs font-semibold text-white">
                            Modo Estricto (Bloquear)
                          </span>
                        </div>
                        <input
                          type="radio"
                          name="noPkMode"
                          checked={noPrimaryKeyMode === "block"}
                          onChange={() => {
                            setNoPrimaryKeyMode("block");
                            triggerFeedback();
                          }}
                          className="mt-0.5 text-orange-500 focus:ring-0"
                        />
                      </div>
                      <p className="text-[11px] text-neutral-400 mt-2 leading-relaxed">
                        Bloquea estrictamente cualquier edición o eliminación en tablas sin clave primaria para evitar modificaciones ambiguas accidentales.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-[#1d2332]" />

                {/* Safe Mode Section */}
                <div>
                  <h3 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider mb-2 flex items-center space-x-2">
                    <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Seguridad y Modo Seguro (Safe Mode)</span>
                  </h3>
                  <div className="space-y-3">
                    <label className="flex items-start space-x-3 p-3 rounded-lg bg-[#141824] border border-[#222838] cursor-pointer hover:border-neutral-600 transition-colors">
                      <input
                        type="checkbox"
                        checked={safeModeEnabled}
                        onChange={(e) => {
                          setSafeMode(e.target.checked);
                          triggerFeedback();
                        }}
                        className="mt-0.5 rounded border-[#2e374d] text-orange-600 focus:ring-0 bg-[#0a0c10]"
                      />
                      <div>
                        <div className="text-xs font-medium text-white">
                          Activar Modo Seguro global
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-0.5">
                          Intercepta y requiere confirmación interactiva para sentencias destructivas como <code className="text-orange-400">DROP</code>, <code className="text-orange-400">TRUNCATE</code>, y <code className="text-orange-400">DELETE/UPDATE</code> sin cláusula <code className="text-orange-400">WHERE</code>.
                        </div>
                      </div>
                    </label>

                    <label className="flex items-start space-x-3 p-3 rounded-lg bg-[#141824] border border-[#222838] cursor-pointer hover:border-neutral-600 transition-colors">
                      <input
                        type="checkbox"
                        checked={confirmProductionActions}
                        onChange={(e) => {
                          setConfirmProductionActions(e.target.checked);
                          triggerFeedback();
                        }}
                        className="mt-0.5 rounded border-[#2e374d] text-orange-600 focus:ring-0 bg-[#0a0c10]"
                      />
                      <div>
                        <div className="text-xs font-medium text-white">
                          Confirmación obligatoria en entornos de Producción
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-0.5">
                          Muestra una advertencia visual de alto riesgo antes de conectar o ejecutar cambios en servidores con la etiqueta <span className="text-rose-400 font-semibold font-mono">PROD</span>.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="border-t border-[#1d2332]" />

                {/* Default Page Size */}
                <div>
                  <h3 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider mb-2 flex items-center space-x-2">
                    <Layers className="w-3.5 h-3.5 text-orange-400" />
                    <span>Límite de filas por página por defecto</span>
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {[50, 100, 250, 500, 1000, 5000].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => {
                          setDefaultPageSize(size);
                          triggerFeedback();
                        }}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
                          defaultPageSize === size
                            ? "bg-orange-600/20 text-orange-400 border-orange-500/40"
                            : "bg-[#141824] text-neutral-300 border-[#222838] hover:border-neutral-600"
                        }`}
                      >
                        {size.toLocaleString()} filas
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Editor Tab */}
            {activeTab === "editor" && (
              <div className="space-y-6 animate-in fade-in duration-150">
                <div>
                  <h3 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider mb-2 flex items-center space-x-2">
                    <FileCode className="w-3.5 h-3.5 text-sky-400" />
                    <span>Tipografía y Vista del Editor SQL</span>
                  </h3>

                  <div className="space-y-4">
                    {/* Font Size */}
                    <div className="p-3.5 rounded-lg bg-[#141824] border border-[#222838] flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-white">Tamaño de fuente del editor</div>
                        <div className="text-[11px] text-neutral-400">
                          Ajusta la escala del texto para el editor CodeMirror y la cuadrícula
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {[12, 13, 14, 15, 16].map((size) => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => {
                              setEditorFontSize(size);
                              triggerFeedback();
                            }}
                            className={`w-8 h-8 rounded border text-xs font-mono transition-colors ${
                              editorFontSize === size
                                ? "bg-sky-600/20 text-sky-400 border-sky-500/40 font-bold"
                                : "bg-[#0d1017] text-neutral-400 border-[#222838] hover:border-neutral-600"
                            }`}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Line Numbers */}
                    <label className="flex items-start space-x-3 p-3.5 rounded-lg bg-[#141824] border border-[#222838] cursor-pointer hover:border-neutral-600 transition-colors">
                      <input
                        type="checkbox"
                        checked={editorLineNumbers}
                        onChange={(e) => {
                          setEditorLineNumbers(e.target.checked);
                          triggerFeedback();
                        }}
                        className="mt-0.5 rounded border-[#2e374d] text-orange-600 focus:ring-0 bg-[#0a0c10]"
                      />
                      <div>
                        <div className="text-xs font-medium text-white">
                          Mostrar números de línea en el editor
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-0.5">
                          Visualiza el número de cada renglón en la barra lateral del editor SQL.
                        </div>
                      </div>
                    </label>

                    {/* Autocomplete */}
                    <label className="flex items-start space-x-3 p-3.5 rounded-lg bg-[#141824] border border-[#222838] cursor-pointer hover:border-neutral-600 transition-colors">
                      <input
                        type="checkbox"
                        checked={editorAutocomplete}
                        onChange={(e) => {
                          setEditorAutocomplete(e.target.checked);
                          triggerFeedback();
                        }}
                        className="mt-0.5 rounded border-[#2e374d] text-orange-600 focus:ring-0 bg-[#0a0c10]"
                      />
                      <div>
                        <div className="text-xs font-medium text-white">
                          Autocompletado de SQL inteligente
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-0.5">
                          Sugerencias automáticas de palabras clave SQL, funciones nativas, tablas y columnas del esquema seleccionado.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* AI Tab */}
            {activeTab === "ai" && (
              <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-150">
                <AiSettingsForm onSaved={triggerFeedback} showCancel={false} />
              </div>
            )}

            {/* Shortcuts Tab */}
            {activeTab === "shortcuts" && (
              <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-150">
                <ShortcutsList />
              </div>
            )}

            {/* About Tab */}
            {activeTab === "about" && (
              <div className="space-y-6 animate-in fade-in duration-150">
                <div className="flex items-center space-x-4 p-4 rounded-lg bg-[#141824] border border-[#222838]">
                  <div className="w-12 h-12 rounded-xl bg-[#10141f] border border-orange-500/30 flex items-center justify-center overflow-hidden">
                    <img
                      src="/logo.png"
                      alt="PyroStudio"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = "none";
                      }}
                    />
                    <Flame className="w-6 h-6 text-orange-500 absolute pointer-events-none opacity-0 only:opacity-100" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white tracking-wide">
                      PYRO <span className="text-orange-500">STUDIO</span>
                    </h3>
                    <p className="text-xs text-neutral-400">
                      Versión 0.1.1 — Cliente Nativo Ultra Rápido para MariaDB & MySQL
                    </p>
                  </div>
                </div>

                <div className="space-y-3 text-xs text-neutral-300 leading-relaxed bg-[#141824]/50 p-4 rounded-lg border border-[#1f2536]">
                  <div className="flex items-center justify-between py-1 border-b border-[#1f2536]">
                    <span className="text-neutral-400">Motor Nativo:</span>
                    <span className="font-mono text-neutral-200">Tauri v2 + Rust 2021 + SQLx</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-[#1f2536]">
                    <span className="text-neutral-400">Frontend UI:</span>
                    <span className="font-mono text-neutral-200">React 19 + TypeScript + Tailwind CSS</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-[#1f2536]">
                    <span className="text-neutral-400">Canvas Grid:</span>
                    <span className="font-mono text-neutral-200">Glide Data Grid Canvas (60 FPS)</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-[#1f2536]">
                    <span className="text-neutral-400">Túnel HTTP PHP:</span>
                    <span className="font-mono text-neutral-200">ntunnel_mysql.php Parser Nativo</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-neutral-400">Bóveda Cifrada:</span>
                    <span className="font-mono text-neutral-200">AES-256-GCM Vault</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#141824] border-t border-[#212738] flex items-center justify-between shrink-0">
          <div className="text-[11px] text-neutral-500 font-mono">
            Las preferencias se guardan automáticamente en tu equipo local.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 rounded-lg shadow-md transition-all active:scale-95"
          >
            <span>Listo</span>
          </button>
        </div>
      </div>
    </div>
  );
};
