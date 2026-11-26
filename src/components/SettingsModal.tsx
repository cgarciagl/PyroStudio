import React, { useState, useEffect, useId, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
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
  Layers,
  Palette,
  Sun,
  Moon,
  Monitor,
  FolderOpen,
  RefreshCw,
  Languages,
  Download,
  ZoomIn,
} from "lucide-react";
import { detectSystemLanguage } from "../i18n";
import { CSV_PART_ROWS, DEFAULT_UI_SCALE, MAX_UI_SCALE, MIN_UI_SCALE, UI_SCALE_OPTIONS, DEFAULT_EDITOR_FONT_SIZE, DEFAULT_GRID_FONT_SIZE, FONT_SIZE_OPTIONS, LONG_TRANSACTION_MINUTES, gridMetricsFor, usePreferenceStore } from "../stores/preferenceStore";
import { useUIStore } from "../stores/uiStore";
import { FontSizeCombo } from "./ui/FontSizeCombo";
import { useUpdaterStore } from "../stores/updaterStore";
import { AiSettingsForm } from "./AiSettingsModal";
import { SaveTunnelScriptModal, type TunnelScriptKind } from "./SaveTunnelScriptModal";
import { ShortcutsList } from "./ShortcutsModal";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { cardClass, iconBtn, modalHeader, modalTitle, primaryBtn, secondaryBtn } from "./ui/styles";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = "appearance" | "database" | "workspace" | "editor" | "ai" | "shortcuts" | "about";

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation(["settings", "common"]);
  const {
    theme,
    language,
    safeModeEnabled,
    noPrimaryKeyMode,
    defaultPageSize,
    infiniteScroll,
    setInfiniteScroll,
    autoCheckUpdates,
    setAutoCheckUpdates,
    editorFontSize,
    gridFontSize,
    setGridFontSize,
    uiScale,
    setUiScale,
    editorLineNumbers,
    editorAutocomplete,
    confirmProductionActions,
    setTheme,
    setLanguage,
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

  const {
    status: updateStatus,
    availableUpdate,
    error: updateError,
    checkForUpdatesManual,
    openUpdateModal,
  } = useUpdaterStore();

  const settingsModalInitialTab = useUIStore((s) => s.settingsModalInitialTab);

  const [activeTab, setActiveTab] = useState<SettingsTab>(settingsModalInitialTab || "appearance");
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const [tunnelScriptModalKind, setTunnelScriptModalKind] = useState<TunnelScriptKind | null>(null);
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
                <span>{t("settings:title")}</span>
                {showSavedFeedback && (
                  <span role="status" aria-live="polite" className="text-[11px] font-normal text-success flex items-center space-x-1 animate-in fade-in">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{t("common:status.saved")}</span>
                  </span>
                )}
              </h2>
              <p id={descriptionId} className="text-xs text-fg-muted">
                {t("settings:subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={iconBtn}
            aria-label={t("settings:closeLabel")}
            title={t("settings:closeLabel")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Layout: Sidebar Tabs + Content */}
        <div className="flex-1 flex overflow-hidden" data-settings-layout>
          {/* Tabs Navigation Sidebar */}
          <nav className="pyro-settings-nav w-52 bg-surface border-r border-line p-3 space-y-1 shrink-0" data-settings-navigation aria-label={t("settings:navAriaLabel")}>
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
              <span>{t("settings:tabs.appearance")}</span>
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
              <span>{t("settings:tabs.database")}</span>
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
              <span>{t("settings:tabs.workspace")}</span>
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
              <span>{t("settings:tabs.editor")}</span>
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
              <span>{t("settings:tabs.ai")}</span>
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
              <span>{t("settings:tabs.shortcuts")}</span>
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
              <span>{t("settings:tabs.about")}</span>
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
                    <span>{t("settings:appearance.themeTitle")}</span>
                  </h3>
                  <p className="text-xs text-fg-muted mb-3">
                    {t("settings:appearance.themeDescription")}
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
                          <span className="text-xs font-semibold text-fg">{t("settings:appearance.darkTitle")}</span>
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
                        {t("settings:appearance.darkDescription")}
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
                          <span className="text-xs font-semibold text-fg">{t("settings:appearance.lightTitle")}</span>
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
                        {t("settings:appearance.lightDescription")}
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
                          <span className="text-xs font-semibold text-fg">{t("settings:appearance.systemTitle")}</span>
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
                        {t("settings:appearance.systemDescription")}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-line" />

                {/* Interface Language Selector */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-1 flex items-center space-x-2">
                    <Languages className="w-3.5 h-3.5 text-fg-muted" />
                    <span>{t("settings:appearance.languageTitle")}</span>
                  </h3>
                  <p className="text-xs text-fg-muted mb-3">
                    {t("settings:appearance.languageDescription")}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(["es", "en", "system"] as const).map((langOption) => {
                      const isSelected = language === langOption;
                      const detectedCode = detectSystemLanguage();
                      const detectedLabel = t(`common:languages.${detectedCode}`);
                      return (
                        <button
                          key={langOption}
                          type="button"
                          onClick={() => {
                            setLanguage(langOption);
                            triggerFeedback();
                          }}
                          className={`text-left p-3.5 rounded-lg border transition-all ${
                            isSelected
                              ? "bg-accent-soft border-accent/60 shadow-sm ring-1 ring-accent/40"
                              : "bg-raised border-line hover:border-line-strong"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-fg">
                              {t(`common:languages.${langOption}`)}
                            </span>
                            <span
                              className={`w-2 h-2 rounded-full ${
                                isSelected ? "bg-accent" : "bg-line-strong"
                              }`}
                            />
                          </div>
                          <p className="text-[11px] text-fg-muted leading-relaxed">
                            {langOption === "system"
                              ? t("settings:appearance.languageSystemDescription", {
                                  detected: detectedLabel,
                                })
                              : langOption === "es"
                                ? "ES"
                                : "EN"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-line" />

                {/* Interface scale (webview zoom) */}
                <div data-settings-ui-scale>
                  <h3 className="text-xs font-medium text-fg mb-2 flex items-center space-x-2">
                    <ZoomIn className="w-3.5 h-3.5 text-fg-muted" />
                    <span>{t("settings:appearance.uiScaleTitle")}</span>
                  </h3>
                  <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg bg-raised border border-line">
                    <div className="text-xs text-fg">
                      {t("settings:appearance.uiScaleDescription")}
                    </div>
                    <FontSizeCombo
                      value={uiScale}
                      presets={UI_SCALE_OPTIONS}
                      defaultSize={DEFAULT_UI_SCALE}
                      min={MIN_UI_SCALE}
                      max={MAX_UI_SCALE}
                      unit="%"
                      inputLabel={t("settings:appearance.uiScaleInput", { min: MIN_UI_SCALE, max: MAX_UI_SCALE })}
                      onChange={(scale) => {
                        setUiScale(scale);
                        triggerFeedback();
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Database & Tables Tab */}
            {activeTab === "database" && (
              <div className="space-y-6 animate-in fade-in duration-150">
                {/* Long manual transaction warning */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-2">{t("settings:database.longTxTitle")}</h3>
                  <p className="text-xs text-fg-muted mb-3">
                    {t("settings:database.longTxDescription")}
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
                  <h3 className="text-xs font-medium text-fg mb-2">{t("settings:database.csvSplitTitle")}</h3>
                  <p className="text-xs text-fg-muted mb-3">
                    {t("settings:database.csvSplitBefore")}
                    <span className="font-mono">nombre_part001.csv</span>, …
                    {t("settings:database.csvSplitAfter")}
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
                        {rows === 0 ? t("settings:database.csvSingleFile") : t("settings:database.csvRows", { count: rows.toLocaleString() as unknown as number })}
                      </button>
                    ))}
                  </div>
                </div>

                {/* No PK Behavior Section */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-2 flex items-center space-x-2">
                    <Key className="w-3.5 h-3.5 text-warning" />
                    <span>{t("settings:database.noPkTitle")}</span>
                  </h3>
                  <p className="text-xs text-fg-muted mb-3">
                    {t("settings:database.noPkDescription")}
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
                            {t("settings:database.noPkFullRowTitle")}
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
                        {t("settings:database.noPkFullRowBefore")} <strong className="text-fg">{t("settings:database.noPkFullRowStrong")}</strong> {t("settings:database.noPkFullRowMiddle")} <code className="text-warning font-mono">LIMIT 1</code>{t("settings:database.noPkFullRowAfter")}
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
                            {t("settings:database.noPkBlockTitle")}
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
                        {t("settings:database.noPkBlockDescription")}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-line" />

                {/* Safe Mode Section */}
                <div>
                  <h3 className="text-xs font-medium text-fg mb-2 flex items-center space-x-2">
                    <ShieldAlert className="w-3.5 h-3.5 text-success" />
                    <span>{t("settings:database.safetyTitle")}</span>
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
                          {t("settings:database.safeModeTitle")}
                        </div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          {t("settings:database.safeModeDescription")}
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
                          {t("settings:database.prodConfirmTitle")}
                        </div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          {t("settings:database.prodConfirmDescription")}
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
                          {t("settings:database.infiniteScrollTitle")}
                        </div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          {t("settings:database.infiniteScrollDescription")}
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
                    <span>{t("settings:database.defaultPageSizeTitle")}</span>
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
                        {t("settings:database.pageSizeRows", { count: size.toLocaleString() as unknown as number })}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Data grid: font size and density both shape the same grid */}
                <div data-settings-grid>
                  <h3 className="text-xs font-medium text-fg mb-1">
                    {t("settings:database.gridSectionTitle")}
                  </h3>
                  <p className="text-[11px] text-fg-muted mb-3">
                    {t("settings:database.gridSectionDescription")}
                  </p>
                  <div className={`${cardClass} divide-y divide-line`}>
                    <div className="flex items-center justify-between gap-3 p-3.5">
                      <div>
                        <div className="text-xs font-medium text-fg">{t("settings:database.gridFontSizeTitle")}</div>
                        <div className="text-[11px] text-fg-muted">{t("settings:database.gridFontSizeHint")}</div>
                      </div>
                      <FontSizeCombo
                        value={gridFontSize}
                        presets={FONT_SIZE_OPTIONS}
                        defaultSize={DEFAULT_GRID_FONT_SIZE}
                        onChange={(size) => {
                          setGridFontSize(size);
                          triggerFeedback();
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                      <div>
                        <div className="text-xs font-medium text-fg">{t("settings:database.gridDensityTitle")}</div>
                        <div className="text-[11px] text-fg-muted">{t("settings:database.gridDensityHint")}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {(["compact", "normal", "comfortable"] as const).map((value) => (
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
                            {t(`settings:database.densities.${value}`)} · {gridMetricsFor(value, gridFontSize).row}px
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* HTTP Tunnel PHP scripts */}
                <div className={`${cardClass} space-y-2.5`}>
                  <div>
                    <h3 className="text-xs font-medium text-fg">
                      {t("settings:database.tunnelScriptsTitle")}
                    </h3>
                    <p className="text-[11px] text-fg-muted mt-0.5 leading-snug">
                      {t("settings:database.tunnelScriptsDescription")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTunnelScriptModalKind("mysql")}
                      className={secondaryBtn}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t("settings:database.saveMysqlTunnelScript")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTunnelScriptModalKind("sqlite")}
                      className={secondaryBtn}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t("settings:database.saveSqliteTunnelScript")}
                    </button>
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
                    <span>{t("settings:editor.sectionTitle")}</span>
                  </h3>

                  <div className="space-y-4">
                    {/* Font Size */}
                    <div className="p-3.5 rounded-lg bg-raised border border-line flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-fg">{t("settings:editor.fontSizeTitle")}</div>
                        <div className="text-[11px] text-fg-muted">
                          {t("settings:editor.fontSizeSubtitle")}
                        </div>
                      </div>
                      <FontSizeCombo
                        value={editorFontSize}
                        presets={FONT_SIZE_OPTIONS}
                        defaultSize={DEFAULT_EDITOR_FONT_SIZE}
                        onChange={(size) => {
                          setEditorFontSize(size);
                          triggerFeedback();
                        }}
                      />
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
                          {t("settings:editor.lineNumbersTitle")}
                        </div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          {t("settings:editor.lineNumbersSubtitle")}
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
                          {t("settings:editor.autocompleteTitle")}
                        </div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          {t("settings:editor.autocompleteSubtitle")}
                        </div>
                      </div>
                    </label>

                    {/* Snippets */}
                    <div className="p-3.5 rounded-lg bg-raised border border-line flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-fg">{t("settings:editor.snippetsTitle")}</div>
                        <div className="text-[11px] text-fg-muted mt-0.5">
                          {t("settings:editor.snippetsSubtitle")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          useUIStore.getState().openSnippetsModal();
                        }}
                        className={secondaryBtn}
                      >
                        {t("settings:editor.manageSnippets")}
                      </button>
                    </div>
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
                  <h3 className="text-xs font-medium text-fg mb-1">{t("settings:about.logLevelTitle")}</h3>
                  <p className="text-[11px] text-fg-muted mb-2">
                    {t("settings:about.logLevelDescription")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {(["error", "warn", "info", "debug"] as const).map((value) => (
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
                        {t(`settings:about.logLevels.${value}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-fg-muted">
                    {t("settings:about.hintsDescription")}
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
                    {t("settings:about.resetHints")}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-fg-muted">{t("settings:about.onboardingDescription")}</p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      useUIStore.getState().openOnboarding();
                    }}
                    className={secondaryBtn}
                  >
                    {t("settings:about.openOnboarding")}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-fg-muted">{t("settings:about.aboutDescription", { version: runtimeVersion })}</p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      useUIStore.getState().openAboutModal();
                    }}
                    className={secondaryBtn}
                  >
                    {t("settings:about.openAbout")}
                  </button>
                </div>

                <div className={`${cardClass} p-4 space-y-3`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium text-fg">{t("settings:about.autoUpdatesTitle")}</div>
                      <p className="text-[11px] text-fg-muted">
                        {t("settings:about.autoUpdatesDescription")}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={autoCheckUpdates}
                      onChange={(e) => {
                        setAutoCheckUpdates(e.target.checked);
                        triggerFeedback();
                      }}
                      aria-label={t("settings:about.autoUpdatesAriaLabel")}
                      className="h-4 w-4 accent-[var(--accent)] rounded cursor-pointer shrink-0"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-line">
                    <div className="text-[11px] text-fg-muted min-w-0">
                      {updateStatus === "checking" && t("settings:about.updateChecking")}
                      {updateStatus === "up-to-date" && t("settings:about.updateUpToDate")}
                      {updateStatus === "available" && availableUpdate && (
                        <span>
                          {t("settings:about.updateAvailable")} <span className="font-mono text-fg">v{availableUpdate.version}</span>
                        </span>
                      )}
                      {updateStatus === "error" && (
                        <span className="text-danger">{updateError || t("settings:about.updateErrorFallback")}</span>
                      )}
                      {updateStatus === "idle" && t("settings:about.updateIdle")}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {updateStatus === "available" && availableUpdate && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            openUpdateModal();
                          }}
                          className={primaryBtn}
                        >
                          <span>{t("settings:about.updateNowButton", { version: availableUpdate.version })}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={updateStatus === "checking" || updateStatus === "downloading"}
                        onClick={() => void checkForUpdatesManual()}
                        className={secondaryBtn}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${updateStatus === "checking" ? "animate-spin" : ""}`} />
                        <span>{t("settings:about.checkUpdatesButton")}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-raised border-t border-line flex items-center justify-between shrink-0">
          <div className="text-[11px] text-fg-subtle font-mono">
            {t("settings:footer.autoSaveNote")}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={primaryBtn}
          >
            <span>{t("settings:footer.done")}</span>
          </button>
        </div>
      </div>
      <SaveTunnelScriptModal
        isOpen={tunnelScriptModalKind !== null}
        onClose={() => setTunnelScriptModalKind(null)}
        kind={tunnelScriptModalKind ?? "mysql"}
      />
    </div>
  );
};
