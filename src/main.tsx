import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import App from "./App";
import "./index.css";
import "./theme/styles.css";
import "./theme/app-glue.css";
import { redirectLegacyPagesHost } from "./utils/legacyPagesRedirect";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root mount node.");
}

if (!redirectLegacyPagesHost(window.location)) {
  createRoot(root).render(<App />);
}
