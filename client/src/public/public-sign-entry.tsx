import { createRoot } from "react-dom/client";
import PublicSignApp from "./PublicSignApp";
import "../index.css";

console.log("[PublicSign] Entry point loaded");

const container = document.getElementById("public-sign-root");
if (container) {
  const root = createRoot(container);
  root.render(<PublicSignApp />);
} else {
  console.error("[PublicSign] Could not find #public-sign-root element");
}
