import { isNativePlatform, getPlatform } from "@/lib/capacitor";

// Bridge to the native Stripe Terminal Capacitor plugin.
// The plugin (StripeTerminalPlugin.swift) will be added as a custom Capacitor
// plugin in Phase 3 once Apple's "Tap to Pay on iPhone" entitlement and Stripe
// Terminal account enablement are approved.
// All functions here safely return false/errors when the plugin is absent so
// no dead UI ever appears.

function getPlugin(): any | null {
  try {
    const cap = (window as any).Capacitor;
    return cap?.Plugins?.StripeTerminal ?? null;
  } catch {
    return null;
  }
}

export function isTerminalAvailable(): boolean {
  if (!isNativePlatform() || getPlatform() !== "ios") return false;
  return getPlugin() !== null;
}

export async function fetchConnectionToken(): Promise<string> {
  const res = await fetch("/api/payments/terminal/connection-token", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to get connection token");
  }
  const data = await res.json();
  return data.secret as string;
}

export async function initTerminal(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin) throw new Error("StripeTerminal plugin not available");
  const secret = await fetchConnectionToken();
  console.log("[Terminal] Initializing with connection token...");
  await plugin.initialize({ connectionTokenSecret: secret });
}

export async function collectTerminalPayment(paymentIntentSecret: string): Promise<void> {
  const plugin = getPlugin();
  if (!plugin) throw new Error("StripeTerminal plugin not available");
  console.log("[Terminal] Collecting payment...");
  await plugin.collectPayment({ paymentIntentSecret });
}

export async function cancelTerminalCollection(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.cancelCollection();
  } catch {}
}
