import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

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
