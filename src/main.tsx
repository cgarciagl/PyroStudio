import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/maple-mono/400.css";
import "@fontsource/maple-mono/400-italic.css";
import "@fontsource/maple-mono/500.css";
import "@fontsource/maple-mono/600.css";
import "@fontsource/maple-mono/700.css";
import App from "./App";
import "./App.css";
import { initPreferencesThemeAndFont } from "./stores/preferenceStore";

// Initialize saved theme & font immediately to prevent FOUC
initPreferencesThemeAndFont();

if (!document.getElementById("portal")) {
  const portalDiv = document.createElement("div");
  portalDiv.id = "portal";
  portalDiv.style.cssText = "position: fixed; left: 0; top: 0; z-index: 9999;";
  document.body.appendChild(portalDiv);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
