import React, { useState, useEffect, useId, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
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
  Palette,
  Sun,
  Moon,
  Monitor,
  Type,
  FolderOpen,
} from "lucide-react";
import { CSV_PART_ROWS, GRID_DENSITY_METRICS, LONG_TRANSACTION_MINUTES, usePreferenceStore } from "../stores/preferenceStore";
import { useUIStore } from "../stores/uiStore";
import { AiSettingsForm } from "./AiSettingsModal";
import { ShortcutsList } from "./ShortcutsModal";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { iconBtn, modalHeader, modalTitle, primaryBtn, secondaryBtn } from "./ui/styles";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = "appearance" | "database" | "workspace" | "editor" | "ai" | "shortcuts" | "about";

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    theme,
    fontFamily,
    safeModeEnabled,
    noPrimaryKeyMode,
    defaultPageSize,
    infiniteScroll,
    setInfiniteScroll,
    editorFontSize,
    editorLineNumbers,
    editorAutocomplete,
    confirmProductionActions,
    setTheme,
    setFontFamily,
    setSafeMode,
    setNoPrimaryKeyMode,
    setDefaultPageSize,
    gridDensity,
    setGridDensity,
    setEditorFontSize,
    setEditorLineNumbers,
    setEditorAutocomplete,
    setConfirmProductionActions,
    logLevel,
    setLogLevel,
    longTransactionMinutes,
    setLongTransactionMinutes,
    csvPartRows,
    setCsvPartRows,
    seenHints,
    resetHints,
  } = usePreferenceStore();

  const settingsModalInitialTab = useUIStore((s) => s.settingsModalInitialTab);

  const [activeTab, setActiveTab] = useState<SettingsTab>(settingsModalInitialTab || "appearance");
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const [runtimeVersion, setRuntimeVersion] = useState(__APP_VERSION__);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (isOpen) {
      setActiveTab(settingsModalInitialTab || "appearance");
    }
  }, [isOpen, settingsModalInitialTab]);

  useEffect(() => {
    let isMounted = true;
    void getVersion()
      .then((version) => {
        if (isMounted) setRuntimeVersion(version);
      })
      .catch(() => {
        // En navegador/Vite se conserva la versión de package.json inyectada por Vite.
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const target = dialog?.querySelector<HTMLElement>('[data-settings-navigation] button[aria-current="page"]');
      (target ?? dialog)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (previousFocusRef.current?.isConnected && !previousFocusRef.current.hasAttribute("disabled")) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen]);

  // Escape también debe funcionar si el foco quedó fuera del panel
  // (p. ej. el botón enfocado se deshabilitó). Solo atiende el diálogo superior.
  useEffect(() => {
    if (!isOpen || !(true)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const panel = dialogRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panel) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const triggerFeedback = () => {
    setShowSavedFeedback(true);
    setTimeout(() => setShowSavedFeedback(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150 pyro-settings-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="pyro-settings-modal w-full max-w-3xl bg-surface border border-line rounded-xl shadow-modal overflow-hidden flex flex-col max-h-[90vh] zoom-in-95"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key !== "Tab") return;
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          )).filter((el) => el.offsetParent !== null);
          if (!items.length) {
            e.preventDefault();
            e.currentTarget.focus();
          } else if (!e.currentTarget.contains(document.activeElement)) {
            e.preventDefault();
            (e.shiftKey ? items[items.length - 1] : items[0]).focus();
          } else if (e.shiftKey && document.activeElement === items[0]) {
            e.preventDefault();
            items[items.length - 1].focus();
          } else if (!e.shiftKey && document.activeElement === items[items.length - 1]) {
            e.preventDefault();
            items[0].focus();
          }
        }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        {/* Header */}
        <div className={modalHeader}>
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-accent-soft border border-accent/30 flex items-center justify-center">
              <Settings className="w-4 h-4 text-fg-muted" />
            </div>
            <div>
              <h2 id={titleId} className={modalTitle}>
                <span>Configuración y Preferencias</span>
                {showSavedFeedback && (
                  <span role="status" aria-live="polite" className="text-[11px] font-normal text-success flex items-center space-x-1 animate-in fade-in">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Guardado</span>
                  </span>
                )}
              </h2>
              <p id={descriptionId} className="text-xs text-fg-muted">
                Personaliza el comportamiento del editor, la cuadrícula de datos y la seguridad
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={iconBtn}
            aria-label="Cerrar configuración"
            title="Cerrar configuración"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Layout: Sidebar Tabs + Content */}
        <div className="flex-1 flex overflow-hidden" data-settings-layout>
          {/* Tabs Navigation Sidebar */}
          <nav className="pyro-settings-nav w-52 bg-surface border-r border-line p-3 space-y-1 shrink-0" data-settings-navigation aria-label="Secciones de configuración">
            <button
              type="button"
              aria-current={activeTab === "appearance" ? "page" : undefined}
              onClick={() => setActiveTab("appearance")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "appearance"
                  ? "bg-hover text-fg font-medium"
                  : "text-fg-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <Palette className="w-4 h-4 shrink-0 text-fg-muted" />
              <span>Apariencia & Tema</span>
            </button>

            <button
              type="button"
              aria-current={activeTab === "database" ? "page" : undefined}
              onClick={() => setActiveTab("database")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "database"
                  ? "bg-hover text-fg font-medium"
                  : "text-fg-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <Database className="w-4 h-4 shrink-0" />
              <span>Base de Datos & Tablas</span>
            </button>

            <button
              type="button"
              aria-current={activeTab === "workspace" ? "page" : undefined}
              onClick={() => setActiveTab("workspace")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "workspace"
                  ? "bg-hover text-fg font-medium"
                  : "text-fg-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <FolderOpen className="w-4 h-4 shrink-0" />
              <span>Espacio de trabajo</span>
            </button>

            <button
              type="button"
              aria-current={activeTab === "editor" ? "page" : undefined}
              onClick={() => setActiveTab("editor")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "editor"
                  ? "bg-hover text-fg font-medium"
                  : "text-fg-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <Code2 className="w-4 h-4 shrink-0" />
              <span>Editor SQL y cuadrícula</span>
            </button>

            <button
              type="button"
              aria-current={activeTab === "ai" ? "page" : undefined}
              onClick={() => setActiveTab("ai")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "ai"
                  ? "bg-hover text-fg font-medium"
                  : "text-fg-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>Inteligencia Artificial</span>
            </button>

            <button
              type="button"
              aria-current={activeTab === "shortcuts" ? "page" : undefined}
              onClick={() => setActiveTab("shortcuts")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "shortcuts"
                  ? "bg-hover text-fg font-medium"
                  : "text-fg-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <Keyboard className="w-4 h-4 shrink-0" />
              <span>Atajos de Teclado</span>
            </button>

            <button
              type="button"
              aria-current={activeTab === "about" ? "page" : undefined}
              onClick={() => setActiveTab("about")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                activeTab === "about"
                  ? "bg-hover text-fg font-medium"
                  : "text-fg-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <Info className="w-4 h-4 shrink-0" />
              <span>Acerca de PyroStudio</span>
            </button>
          </nav>

          {/* Main Content Area */}
          <div
            className={`pyro-settings-content flex-1 overflow-y-auto bg-surface ${
              activeTab === "ai" || activeTab === "shortcuts"
                ? "p-0 flex flex-col min-h-0"
                : "p-6 space-y-6"
            }`}
          >
            {/* Appearance & Theme Tab */}
            {activeTab === "appearance" && (
              <div className="space-y-6 animate-in fade-in duration-150">
                {/* Theme Mode Selector */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-1 flex items-center space-x-2">
                    <Palette className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Tema Visual de la Interfaz</span>
                  </h3>
                  <p className="text-xs text-fg-muted mb-3">
                    Elige el estilo visual de la UI. Puedes alternar libremente entre Modo Oscuro y Modo Claro.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Dark Mode */}
                    <div
                      onClick={() => {
                        setTheme("dark");
                        triggerFeedback();
                      }}
                      className={`cursor-pointer p-3.5 rounded-lg border transition-all ${
                        theme === "dark"
                          ? "bg-accent-soft border-accent/60 shadow-sm ring-1 ring-accent/40"
                          : "bg-raised border-line hover:border-line-strong"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <Moon className="w-4 h-4 text-fg-muted" />
                          <span className="text-xs font-semibold text-fg">Modo Oscuro</span>
                        </div>
                        <input
                          type="radio"
                          name="themeMode"
                          checked={theme === "dark"}
                          onChange={() => {
                            setTheme("dark");
                            triggerFeedback();
                          }}
                          className="mt-0.5 text-accent-text focus:ring-0"
                        />
                      </div>
                      <p className="text-[11px] text-fg-muted leading-relaxed">
                        Fondo obsidiana con acentos fuego Pyro. Ideal para concentración y descanso visual.
                      </p>
                    </div>

                    {/* Light Mode */}
                    <div
                      onClick={() => {
                        setTheme("light");
                        triggerFeedback();
                      }}
                      className={`cursor-pointer p-3.5 rounded-lg border transition-all ${
                        theme === "light"
                          ? "border-accent/60 shadow-sm ring-1 ring-accent/40"
                          : "bg-raised border-line hover:border-line-strong"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <Sun className="w-4 h-4 text-fg-muted" />
                          <span className="text-xs font-semibold text-fg">Modo Claro</span>
                        </div>
                        <input
                          type="radio"
                          name="themeMode"
                          checked={theme === "light"}
                          onChange={() => {
                            setTheme("light");
                            triggerFeedback();
                          }}
                          className="mt-0.5 text-accent-text focus:ring-0"
                        />
                      </div>
                      <p className="text-[11px] text-fg-muted leading-relaxed">
                        Fondo luminoso nítido y alto contraste con acentos naranja. Perfecto para entornos iluminados.
                      </p>
                    </div>

                    {/* System Mode */}
                    <div
                      onClick={() => {
                        setTheme("system");
                        triggerFeedback();
                      }}
                      className={`cursor-pointer p-3.5 rounded-lg border transition-all ${
                        theme === "system"
                          ? "bg-raised border-line shadow-sm ring-1 "
                          : "bg-raised border-line hover:border-line-strong"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <Monitor className="w-4 h-4 text-fg-muted" />
                          <span className="text-xs font-semibold text-fg">Sistema</span>
                        </div>
                        <input
                          type="radio"
                          name="themeMode"
                          checked={theme === "system"}
                          onChange={() => {
                            setTheme("system");
                            triggerFeedback();
                          }}
                          className="mt-0.5 text-accent-text focus:ring-0"
                        />
                      </div>
                      <p className="text-[11px] text-fg-muted leading-relaxed">
                        Se sincroniza dinámicamente con la preferencia de tema claro u oscuro de tu sistema operativo.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-line" />

                {/* Typography: Maple Mono Section */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-1 flex items-center space-x-2">
                    <Type className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Tipografía: Maple Mono</span>
                  </h3>
                  <p className="text-xs text-fg-muted mb-3">
                    Maple Mono es una fuente monoespaciada moderna open-source creada para desarrolladores, con soporte elegante para ligaduras tipográficas.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    {/* Maple Mono Option */}
                    <div
                      onClick={() => {
                        setFontFamily("maple-mono");
                        triggerFeedback();
                      }}
                      className={`cursor-pointer p-3.5 rounded-lg border transition-all ${
                        fontFamily === "maple-mono"
                          ? "border-line ring-1 ring-accent/30"
                          : "bg-raised border-line hover:border-line-strong"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-2">
                          <Type className="w-4 h-4 shrink-0 text-fg-muted" />
                          <span className="text-xs font-semibold text-fg font-mono">
                            Maple Mono (Recomendada)
                          </span>
                        </div>
                        <input
                          type="radio"
                          name="fontFamilyMode"
                          checked={fontFamily === "maple-mono"}
                          onChange={() => {
                            setFontFamily("maple-mono");
                            triggerFeedback();
                          }}
                          className="mt-0.5 text-accent-text focus:ring-0"
                        />
                      </div>
                      <p className="text-[11px] text-fg-muted mt-2 leading-relaxed">
                        Activa Maple Mono en toda la aplicación, incluyendo el editor SQL, la cuadrícula de datos y las etiquetas de la interfaz.
                      </p>
                    </div>

                    {/* System Font Option */}
                    <div
                      onClick={() => {
                        setFontFamily("system");
                        triggerFeedback();
                      }}
                      className={`cursor-pointer p-3.5 rounded-lg border transition-all ${
                        fontFamily === "system"
                          ? "bg-raised/40 border-line-strong ring-1 ring-accent/30"
                          : "bg-raised border-line hover:border-line-strong"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-2">
                          <Monitor className="w-4 h-4 text-fg-muted shrink-0" />
                          <span className="text-xs font-semibold text-fg">
                            Tipografía del Sistema
                          </span>
                        </div>
                        <input
                          type="radio"
                          name="fontFamilyMode"
                          checked={fontFamily === "system"}
                          onChange={() => {
                            setFontFamily("system");
                            triggerFeedback();
                          }}
                          className="mt-0.5 text-accent-text focus:ring-0"
                        />
                      </div>
                      <p className="text-[11px] text-fg-muted mt-2 leading-relaxed">
                        Utiliza las fuentes nativas de la plataforma (Segoe UI, SF Pro, Roboto y monospace estándar).
                      </p>
                    </div>
                  </div>

                  {/* Font Live Preview Box */}
                  <div className="p-3.5 rounded-lg bg-surface border border-line">
                    <div className="text-[11px] font-medium text-fg-muted mb-1.5 flex items-center justify-between">
                      <span>Vista previa de ligaduras y código:</span>
                      <span className="font-mono text-warning">Maple Mono Active</span>
                    </div>
                    <div className="font-mono text-xs text-fg bg-canvas p-3 rounded border border-line overflow-x-auto space-y-1">
                      <div className="text-success">
                        <span className="text-fg-muted font-semibold">SELECT</span> id, username, email, created_at
                      </div>
                      <div>
                        <span className="text-fg-muted font-semibold">FROM</span> `users`
                      </div>
                      <div>
                        <span className="text-fg-muted font-semibold">WHERE</span> status != <span className="text-warning">&apos;banned&apos;</span> <span className="text-fg-muted font-semibold">AND</span> role &lt;=&gt; <span className="text-fg-muted">NULL</span>;
                      </div>
                      <div className="text-fg-subtle text-[11px]">
                        -- Ligaduras: &lt;=&gt; != !== &lt;= &gt;= -&gt; =&gt; // 0123456789
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-line" />

                {/* Editor Font Size Quick Access */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-2 flex items-center space-x-2">
                    <FileCode className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Tamaño de Escala de Texto</span>
                  </h3>
                  <div className="flex items-center justify-between p-3.5 rounded-lg bg-raised border border-line">
                    <div className="text-xs text-fg">
                      Tamaño de fuente para el editor SQL y la cuadrícula:
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
                              ? "bg-accent-soft text-accent-text border-accent/40 font-bold"
                              : "bg-surface text-fg-muted border-line hover:border-line-strong"
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Database & Tables Tab */}
            {activeTab === "database" && (
              <div className="space-y-6 animate-in fade-in duration-150">
                {/* Long manual transaction warning */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-2">Aviso de transacción manual abierta</h3>
                  <p className="text-xs text-fg-muted mb-3">
                    Con auto-commit desactivado, la barra de la transacción avisa cuando lleva este tiempo abierta con
                    cambios sin confirmar (mantiene bloqueos en las filas modificadas).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {LONG_TRANSACTION_MINUTES.map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() => {
                          setLongTransactionMinutes(minutes);
                          triggerFeedback();
                        }}
                        className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                          longTransactionMinutes === minutes
                            ? "bg-hover text-fg border-accent"
                            : "bg-raised text-fg-muted border-line hover:text-fg"
                        }`}
                      >
                        {minutes} min
                      </button>
                    ))}
                  </div>
                </div>

                {/* CSV export split */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-2">Exportación CSV por partes</h3>
                  <p className="text-xs text-fg-muted mb-3">
                    Al exportar a CSV o CSV.gz, divide el resultado en varios archivos numerados
                    (<span className="font-mono">nombre_part001.csv</span>, …), cada uno con la fila de encabezados.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {CSV_PART_ROWS.map((rows) => (
                      <button
                        key={rows}
                        type="button"
                        onClick={() => {
                          setCsvPartRows(rows);
                          triggerFeedback();
                        }}
                        className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                          csvPartRows === rows
                            ? "bg-hover text-fg border-accent"
                            : "bg-raised text-fg-muted border-line hover:text-fg"
                        }`}
                      >
                        {rows === 0 ? "Un solo archivo" : `${rows.toLocaleString()} filas`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* No PK Behavior Section */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-2 flex items-center space-x-2">
                    <Key className="w-3.5 h-3.5 text-warning" />
                    <span>Tablas sin Clave Primaria (Primary Key)</span>
                  </h3>
                  <p className="text-xs text-fg-muted mb-3">
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
                          ? "border-line shadow-sm ring-1 ring-accent/30"
                          : "bg-raised border-line hover:border-line-strong"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-2">
                          <Key className="w-4 h-4 text-warning shrink-0" />
                          <span className="text-xs font-semibold text-fg">
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
                          className="mt-0.5 text-accent-text focus:ring-0"
                        />
                      </div>
                      <p className="text-[11px] text-fg-muted mt-2 leading-relaxed">
                        Trata <strong className="text-fg">todos los campos de la fila</strong> como criterio identificador único con <code className="text-warning font-mono">LIMIT 1</code>. Permite editar y eliminar registros en la cuadrícula de datos de forma interactiva y segura.
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
                          ? "border-line shadow-sm ring-1 ring-accent/30"
                          : "bg-raised border-line hover:border-line-strong"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-2">
                          <Lock className="w-4 h-4 text-danger shrink-0" />
                          <span className="text-xs font-semibold text-fg">
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
                          className="mt-0.5 text-accent-text focus:ring-0"
                        />
                      </div>
                      <p className="text-[11px] text-fg-muted mt-2 leading-relaxed">
                        Bloquea estrictamente cualquier edición o eliminación en tablas sin clave primaria para evitar modificaciones ambiguas accidentales.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-line" />

                {/* Safe Mode Section */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-2 flex items-center space-x-2">
                    <ShieldAlert className="w-3.5 h-3.5 text-success" />
                    <span>Seguridad y Modo Seguro</span>
                  </h3>
                  <div className="space-y-3">
                    <label className="flex items-start space-x-3 p-3 rounded-lg bg-raised border border-line cursor-pointer hover:border-line-strong transition-colors">
                      <input
                        type="checkbox"
                        checked={safeModeEnabled}
                        onChange={(e) => {
                          setSafeMode(e.target.checked);
                          triggerFeedback();
                        }}
                        className="mt-0.5 rounded border-line-strong text-accent-text focus:ring-0 bg-canvas"
                      />
                      <div>
                        <div className="text-xs font-medium text-fg">
                          Activar Modo Seguro global
                        </div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          Intercepta y requiere confirmación interactiva para sentencias destructivas como <code className="text-accent-text">DROP</code>, <code className="text-accent-text">TRUNCATE</code>, y <code className="text-accent-text">DELETE/UPDATE</code> sin cláusula <code className="text-accent-text">WHERE</code>.
                        </div>
                      </div>
                    </label>

                    <label className="flex items-start space-x-3 p-3 rounded-lg bg-raised border border-line cursor-pointer hover:border-line-strong transition-colors">
                      <input
                        type="checkbox"
                        checked={confirmProductionActions}
                        onChange={(e) => {
                          setConfirmProductionActions(e.target.checked);
                          triggerFeedback();
                        }}
                        className="mt-0.5 rounded border-line-strong text-accent-text focus:ring-0 bg-canvas"
                      />
                      <div>
                        <div className="text-xs font-medium text-fg">
                          Confirmación obligatoria en entornos de Producción
                        </div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          Muestra una advertencia visual de alto riesgo antes de conectar o ejecutar cambios en servidores con la etiqueta <span className="text-danger font-semibold font-mono">PROD</span>.
                        </div>
                      </div>
                    </label>

                    <label className="flex items-start space-x-3 p-3 rounded-lg bg-raised border border-line cursor-pointer hover:border-line-strong transition-colors">
                      <input
                        type="checkbox"
                        checked={infiniteScroll}
                        onChange={(e) => {
                          setInfiniteScroll(e.target.checked);
                          triggerFeedback();
                        }}
                        className="mt-0.5 rounded border-line-strong text-accent-text focus:ring-0 bg-canvas"
                      />
                      <div>
                        <div className="text-xs font-medium text-fg">
                          Virtualización continua (Scroll infinito en el Grid)
                        </div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          Carga los registros de forma progresiva en bloques dinámicos a medida que te desplazas hacia abajo mediante paginación keyset indexada.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="border-t border-line" />

                {/* Default Page Size */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-2 flex items-center space-x-2">
                    <Layers className="w-3.5 h-3.5 text-fg-muted" />
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
                            ? "bg-accent-soft text-accent-text border-accent/40"
                            : "bg-raised text-fg border-line hover:border-line-strong"
                        }`}
                      >
                        {size.toLocaleString()} filas
                      </button>
                    ))}
                  </div>
                </div>

                {/* Grid density */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-2">
                    Densidad de la cuadrícula
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        ["compact", "Compacta"],
                        ["normal", "Normal"],
                        ["comfortable", "Cómoda"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setGridDensity(value);
                          triggerFeedback();
                        }}
                        className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                          gridDensity === value
                            ? "bg-hover text-fg border-accent"
                            : "bg-raised text-fg-muted border-line hover:text-fg"
                        }`}
                      >
                        {label} · {GRID_DENSITY_METRICS[value].row}px
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
                  <h3 className="text-xs font-medium text-fg mb-2 flex items-center space-x-2">
                    <FileCode className="w-3.5 h-3.5 text-fg-muted" />
                    <span>Tipografía y Vista del Editor SQL</span>
                  </h3>

                  <div className="space-y-4">
                    {/* Font Size */}
                    <div className="p-3.5 rounded-lg bg-raised border border-line flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-fg">Tamaño de fuente del editor</div>
                        <div className="text-[11px] text-fg-muted">
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
                                ? "bg-raised text-fg-muted border-line font-bold"
                                : "bg-surface text-fg-muted border-line hover:border-line-strong"
                            }`}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Line Numbers */}
                    <label className="flex items-start space-x-3 p-3.5 rounded-lg bg-raised border border-line cursor-pointer hover:border-line-strong transition-colors">
                      <input
                        type="checkbox"
                        checked={editorLineNumbers}
                        onChange={(e) => {
                          setEditorLineNumbers(e.target.checked);
                          triggerFeedback();
                        }}
                        className="mt-0.5 rounded border-line-strong text-accent-text focus:ring-0 bg-canvas"
                      />
                      <div>
                        <div className="text-xs font-medium text-fg">
                          Mostrar números de línea en el editor
                        </div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          Visualiza el número de cada renglón en la barra lateral del editor SQL.
                        </div>
                      </div>
                    </label>

                    {/* Autocomplete */}
                    <label className="flex items-start space-x-3 p-3.5 rounded-lg bg-raised border border-line cursor-pointer hover:border-line-strong transition-colors">
                      <input
                        type="checkbox"
                        checked={editorAutocomplete}
                        onChange={(e) => {
                          setEditorAutocomplete(e.target.checked);
                          triggerFeedback();
                        }}
                        className="mt-0.5 rounded border-line-strong text-accent-text focus:ring-0 bg-canvas"
                      />
                      <div>
                        <div className="text-xs font-medium text-fg">
                          Autocompletado de SQL inteligente
                        </div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
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

            {/* Workspace Tab */}
            {activeTab === "workspace" && <WorkspaceSettings />}

            {/* Shortcuts Tab */}
            {activeTab === "shortcuts" && (
              <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-150">
                <ShortcutsList />
              </div>
            )}

            {/* About Tab */}
            {activeTab === "about" && (
              <div className="space-y-6 animate-in fade-in duration-150">
                <div>
                  <h3 className="text-xs font-medium text-fg mb-1">Nivel de log</h3>
                  <p className="text-[11px] text-fg-muted mb-2">
                    Un archivo por día en la carpeta de datos de la app (se guardan 14 días). Use «Diagnóstico» en la
                    paleta para ver la carpeta y los últimos errores.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        ["error", "Errores"],
                        ["warn", "Avisos"],
                        ["info", "Información"],
                        ["debug", "Depuración"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setLogLevel(value);
                          triggerFeedback();
                        }}
                        className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                          logLevel === value
                            ? "bg-hover text-fg border-accent"
                            : "bg-raised text-fg-muted border-line hover:text-fg"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-fg-muted">
                    Consejos de primera vez en el grid, el editor, el Modo Seguro y los cambios pendientes.
                  </p>
                  <button
                    type="button"
                    disabled={seenHints.length === 0}
                    onClick={() => {
                      resetHints();
                      triggerFeedback();
                    }}
                    className={secondaryBtn}
                  >
                    Volver a mostrar consejos
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-fg-muted">Introducción de primer arranque: workspace, contraseñas y conexión.</p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      useUIStore.getState().openOnboarding();
                    }}
                    className={secondaryBtn}
                  >
                    Ver introducción
                  </button>
                </div>
                <div className="flex items-center space-x-4 p-4 rounded-lg bg-raised border border-line">
                  <div className="w-12 h-12 rounded-xl bg-raised border border-accent/30 flex items-center justify-center overflow-hidden">
                    <img
                      src="/logo.png"
                      alt="PyroStudio"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = "none";
                      }}
                    />
                    <Flame className="w-6 h-6 absolute pointer-events-none opacity-0 only:opacity-100 text-fg-muted" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-fg">
                      PYRO <span className="text-accent-text">STUDIO</span>
                    </h3>
                    <p className="text-xs text-fg-muted">
                      Versión {runtimeVersion} — Cliente Nativo Ultra Rápido para MariaDB & MySQL
                    </p>
                  </div>
                </div>

                <div className="space-y-3 text-xs text-fg leading-relaxed bg-raised/50 p-4 rounded-lg border border-line">
                  <div className="flex items-center justify-between py-1 border-b border-line">
                    <span className="text-fg-muted">Motor Nativo:</span>
                    <span className="font-mono text-fg">Tauri v2 + Rust 2021 + SQLx</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-line">
                    <span className="text-fg-muted">Frontend UI:</span>
                    <span className="font-mono text-fg">React 19 + TypeScript + Tailwind CSS</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-line">
                    <span className="text-fg-muted">Cuadrícula:</span>
                    <span className="font-mono text-fg">Glide Data Grid (canvas, 60 FPS)</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-line">
                    <span className="text-fg-muted">Túnel HTTP PHP:</span>
                    <span className="font-mono text-fg">PyroTunnel v1 (pyro_tunnel.php)</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-fg-muted">Bóveda Cifrada:</span>
                    <span className="font-mono text-fg">AES-256-GCM Vault</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-raised border-t border-line flex items-center justify-between shrink-0">
          <div className="text-[11px] text-fg-subtle font-mono">
            Las preferencias se guardan automáticamente en tu equipo local.
          </div>
          <button
            type="button"
            onClick={onClose}
            className={primaryBtn}
          >
            <span>Listo</span>
          </button>
        </div>
      </div>
    </div>
  );
};
