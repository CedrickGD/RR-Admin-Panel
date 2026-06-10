import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import App from "./App";
import "./index.css";
import "./theme-v2.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root mount node.");
}

createRoot(root).render(<App />);
