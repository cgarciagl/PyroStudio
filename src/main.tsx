import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import i18n from "./i18n";
import { initPreferencesLanguage, initPreferencesTheme } from "./stores/preferenceStore";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Initialize saved theme and language immediately to prevent FOUC
initPreferencesTheme();
initPreferencesLanguage();

if (!document.getElementById("portal")) {
  const portalDiv = document.createElement("div");
  portalDiv.id = "portal";
  portalDiv.style.cssText = "position: fixed; left: 0; top: 0; z-index: 9999;";
  document.body.appendChild(portalDiv);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle={i18n.t("modals:errorBoundary.criticalTitle")}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
