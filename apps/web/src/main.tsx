import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { AssetInitializer } from "./components/AssetInitializer.js";
import { AdminApp } from "./components/AdminApp.js";
import "./styles.css";

const isAdminPath = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isAdminPath ? (
      <AdminApp />
    ) : (
      <AssetInitializer>
        <App />
      </AssetInitializer>
    )}
  </React.StrictMode>
);
