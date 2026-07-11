import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { detectDesktopPlatform } from "./lib/platform";
import "@excalidraw/excalidraw/index.css";
import "./index.css";

document.documentElement.dataset.platform = detectDesktopPlatform(
  navigator.userAgent,
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
