import { createRoot } from "react-dom/client";
import App from "./App";
import PublicSignApp from "./public/PublicSignApp";
import "./index.css";
import "./i18n/config";

// Check if this is a public signing route - render standalone component
const isPublicSignRoute = window.location.pathname.startsWith('/sign/');

if (isPublicSignRoute) {
  console.log("[main.tsx] Public sign route detected, rendering PublicSignApp");
  createRoot(document.getElementById("root")!).render(<PublicSignApp />);
} else {
  createRoot(document.getElementById("root")!).render(<App />);
}
