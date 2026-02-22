import { Capacitor } from "@capacitor/core";
import { queryClient } from "@/lib/queryClient";

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getPlatform(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return "web";
  }
}

export function getApiBaseUrl(): string {
  if (isNativePlatform()) {
    const origin = window.location.origin;
    console.log("[capacitor] getApiBaseUrl native, origin:", origin);
    return origin;
  }
  return "";
}

export function generateNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

let activePollInterval: ReturnType<typeof setInterval> | null = null;
let activePollTimeout: ReturnType<typeof setTimeout> | null = null;
let pollInFlight = false;

export function stopPolling(): void {
  if (activePollInterval) {
    clearInterval(activePollInterval);
    activePollInterval = null;
  }
  if (activePollTimeout) {
    clearTimeout(activePollTimeout);
    activePollTimeout = null;
  }
  pollInFlight = false;
}

export async function startGoogleAuthNative(): Promise<void> {
  if (!isNativePlatform()) {
    window.location.href = "/api/auth/google";
    return;
  }

  const nonce = generateNonce();
  const baseUrl = getApiBaseUrl();
  const authUrl = `${baseUrl}/api/auth/google?platform=ios&nonce=${nonce}`;
  console.log("[capacitor] Starting native Google auth, nonce:", nonce.substring(0, 8) + "...");

  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: authUrl, presentationStyle: "popover" as any });

    stopPolling();
    activePollInterval = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const res = await fetch(`${baseUrl}/api/auth/poll-code?nonce=${nonce}`, { credentials: "include" });
        const data = await res.json();
        console.log("[capacitor] Poll result:", data.status);

        if (data.status === "ready" && data.code) {
          stopPolling();
          try { await Browser.close(); } catch {}
          console.log("[capacitor] Got auth code, exchanging...");

          const exchangeRes = await fetch(`${baseUrl}/api/auth/exchange-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: data.code }),
            credentials: "include",
          });

          if (exchangeRes.ok) {
            console.log("[capacitor] Auth exchange successful, refreshing auth state...");
            await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
            window.location.href = "/";
          } else {
            console.error("[capacitor] Auth exchange failed:", exchangeRes.status);
            window.location.href = "/login?error=exchange_failed";
          }
        }
      } catch (err) {
        console.error("[capacitor] Poll error:", err);
      } finally {
        pollInFlight = false;
      }
    }, 2000);

    activePollTimeout = setTimeout(async () => {
      stopPolling();
      console.error("[capacitor] Auth polling timed out after 5 minutes");
      try { await Browser.close(); } catch {}
      window.location.href = "/login?error=timeout";
    }, 5 * 60 * 1000);

  } catch (err) {
    console.error("[capacitor] Browser.open failed:", err);
    throw err;
  }
}

export async function closeSystemBrowser(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch (err) {
    console.error("[capacitor] Browser.close failed:", err);
  }
}
