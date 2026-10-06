import React from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "../side-panel/styles.css";
import { App } from "../side-panel/App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App mode="full-page" />
  </React.StrictMode>
);
