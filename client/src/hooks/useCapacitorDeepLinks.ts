import { useEffect } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";

export function useCapacitorDeepLinks() {
  useEffect(() => {
    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
    if (!isNative) return;

    let cleanup: (() => void) | undefined;

    const setup = async () => {
      const { App } = await import("@capacitor/app");
      const { Browser } = await import("@capacitor/browser");

      const listener = await App.addListener("appUrlOpen", async (event) => {
        console.log("[deep-link] Received URL:", event.url);

        try {
          await Browser.close();
        } catch {}

        const url = new URL(event.url);
        if (url.host === "auth" && url.pathname === "/callback") {
          const params = url.searchParams;
          const error = params.get("error");
          const token = params.get("token");

          if (error) {
            console.error("[deep-link] Auth error:", error);
            window.location.href = "/auth?error=" + error;
            return;
          }

          if (token) {
            try {
              console.log("[deep-link] Exchanging auth token for session...");
              const res = await apiRequest("POST", "/api/auth/native-token-exchange", { token });
              const data = await res.json();

              if (data.success) {
                if (data.twoFactor) {
                  window.location.href = "/two-factor";
                  return;
                }
                console.log("[deep-link] Session established, redirecting to dashboard");
                await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
                window.location.href = "/";
                return;
              }
            } catch (err) {
              console.error("[deep-link] Token exchange failed:", err);
              window.location.href = "/auth?error=token_exchange_failed";
              return;
            }
          }
        }
      });

      cleanup = () => listener.remove();
    };

    setup();

    return () => {
      cleanup?.();
    };
  }, []);
}
