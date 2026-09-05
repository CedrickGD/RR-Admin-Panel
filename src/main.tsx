import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import App from "./App";
import "./index.css";
import "./theme/styles.css";
import "./theme/app-glue.css";
import "./theme/workspace.css";
import "./theme/operations.css";
import { redirectLegacyPagesHost } from "./utils/legacyPagesRedirect";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root mount node.");
}

// A tab left open across a deployment may still request a removed lazy chunk.
// Vite exposes this event specifically so the new entry document can recover it.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  window.location.reload();
});

if (!redirectLegacyPagesHost(window.location)) {
  createRoot(root).render(<App />);
}
