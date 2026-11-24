import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import esCommon from "./locales/es/common.json";
import esSettings from "./locales/es/settings.json";
import esModals from "./locales/es/modals.json";
import esShell from "./locales/es/shell.json";
import esConnection from "./locales/es/connection.json";
import esFavorites from "./locales/es/favorites.json";
import esQueryEditor from "./locales/es/queryEditor.json";
import esDataGrid from "./locales/es/dataGrid.json";
import esTableViewer from "./locales/es/tableViewer.json";
import esSchema from "./locales/es/schema.json";
import esObjects from "./locales/es/objects.json";
import esTransfer from "./locales/es/transfer.json";
import esBackup from "./locales/es/backup.json";
import esDiagnostics from "./locales/es/diagnostics.json";
import esCompare from "./locales/es/compare.json";
import esAi from "./locales/es/ai.json";
import esErrors from "./locales/es/errors.json";
import esMessages from "./locales/es/messages.json";
import enCommon from "./locales/en/common.json";
import enSettings from "./locales/en/settings.json";
import enModals from "./locales/en/modals.json";
import enShell from "./locales/en/shell.json";
import enConnection from "./locales/en/connection.json";
import enFavorites from "./locales/en/favorites.json";
import enQueryEditor from "./locales/en/queryEditor.json";
import enDataGrid from "./locales/en/dataGrid.json";
import enTableViewer from "./locales/en/tableViewer.json";
import enSchema from "./locales/en/schema.json";
import enObjects from "./locales/en/objects.json";
import enTransfer from "./locales/en/transfer.json";
import enBackup from "./locales/en/backup.json";
import enDiagnostics from "./locales/en/diagnostics.json";
import enCompare from "./locales/en/compare.json";
import enAi from "./locales/en/ai.json";
import enErrors from "./locales/en/errors.json";
import enMessages from "./locales/en/messages.json";

export type AppLanguage = "es" | "en" | "system";
export type ResolvedLanguage = "es" | "en";

export const resources = {
  es: {
    common: esCommon,
    settings: esSettings,
    modals: esModals,
    shell: esShell,
    connection: esConnection,
    favorites: esFavorites,
    queryEditor: esQueryEditor,
    dataGrid: esDataGrid,
    tableViewer: esTableViewer,
    schema: esSchema,
    objects: esObjects,
    transfer: esTransfer,
    backup: esBackup,
    diagnostics: esDiagnostics,
    compare: esCompare,
    ai: esAi,
    errors: esErrors,
    messages: esMessages,
  },
  en: {
    common: enCommon,
    settings: enSettings,
    modals: enModals,
    shell: enShell,
    connection: enConnection,
    favorites: enFavorites,
    queryEditor: enQueryEditor,
    dataGrid: enDataGrid,
    tableViewer: enTableViewer,
    schema: enSchema,
    objects: enObjects,
    transfer: enTransfer,
    backup: enBackup,
    diagnostics: enDiagnostics,
    compare: enCompare,
    ai: enAi,
    errors: enErrors,
    messages: enMessages,
  },
} as const;

export const detectSystemLanguage = (): ResolvedLanguage => {
  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
  }
  return "es";
};

export const resolveLanguage = (language: AppLanguage): ResolvedLanguage => {
  if (language === "system") {
    return detectSystemLanguage();
  }
  return language === "en" ? "en" : "es";
};

export const applyLanguageToDom = (language: AppLanguage): ResolvedLanguage => {
  const resolved = resolveLanguage(language);
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = resolved;
    document.documentElement.setAttribute("data-lang", resolved);
  }
  if (i18n.isInitialized && i18n.language !== resolved) {
    void i18n.changeLanguage(resolved);
  }
  return resolved;
};

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: "es",
    fallbackLng: "es",
    defaultNS: "common",
    ns: ["common", "settings", "modals", "shell", "connection", "favorites", "queryEditor", "dataGrid", "tableViewer", "schema", "objects", "transfer", "backup", "diagnostics", "compare", "ai", "errors", "messages"],
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });
}

export default i18n;
