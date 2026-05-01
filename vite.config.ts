import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Plugin: prevent browser 304 responses for pre-bundled dep chunks.
// The Vite optimizer uses ETag-based conditional GETs for dep files.
// When the optimizer re-runs (e.g., after a config change), the dep files
// get new content but the same file names. The browser may serve stale 304
// responses if its cached ETag still matches (same mtime), leading to
// mixed-version chunk loading and a duplicate React dispatcher crash.
// Stripping If-None-Match from dep requests forces Vite to always return
// a fresh 200 response with up-to-date cross-version references.
const depCacheBuster = {
  name: "dep-cache-buster",
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      const isDepUrl =
        req.url &&
        (req.url.includes("/.vite/deps/") ||
          req.url.includes("node_modules/.vite/deps/"));
      if (isDepUrl) {
        delete req.headers["if-none-match"];
        delete req.headers["if-modified-since"];

        const origSetHeader = res.setHeader.bind(res);
        res.setHeader = (name: string, value: any) => {
          if (name.toLowerCase() === "cache-control") {
            return origSetHeader(name, "no-store");
          }
          return origSetHeader(name, value);
        };

        const origWriteHead = res.writeHead.bind(res);
        res.writeHead = (statusCode: number, ...args: any[]) => {
          res.setHeader("Cache-Control", "no-store");
          return origWriteHead(statusCode, ...args);
        };
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    depCacheBuster,
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "@capacitor/app",
      "@capacitor/browser",
      "@capacitor/clipboard",
      "@capacitor/core",
      "@capacitor/device",
      "@capacitor/filesystem",
      "@capacitor/geolocation",
      "@capacitor/local-notifications",
      "@capacitor/push-notifications",
      "@capacitor/share",
      "@capacitor/status-bar",
      "@capawesome/capacitor-superwall",
      "@capgo/native-purchases",
      "@googlemaps/markerclusterer",
      "@hookform/resolvers/zod",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-avatar",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-label",
      "@radix-ui/react-popover",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slider",
      "@radix-ui/react-slot",
      "@radix-ui/react-switch",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-tooltip",
      "@react-google-maps/api",
      "@stripe/react-stripe-js",
      "@stripe/stripe-js",
      "@tanstack/react-query",
      "class-variance-authority",
      "clsx",
      "cmdk",
      "date-fns",
      "drizzle-orm",
      "drizzle-orm/pg-core",
      "drizzle-zod",
      "framer-motion",
      "lucide-react",
      "react",
      "react-dom",
      "react-dom/client",
      "react-easy-crop",
      "react-hook-form",
      "react-icons/si",
      "react-plaid-link",
      "react-signature-canvas",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "recharts",
      "tailwind-merge",
      "wouter",
      "zod",
    ],
  },
});
