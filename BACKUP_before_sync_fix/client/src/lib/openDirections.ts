import { isNativePlatform, getPlatform } from "@/lib/capacitor";

interface DirectionsTarget {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  label?: string;
}

export type MapApp = "apple" | "google";

export function getAvailableMapApps(): MapApp[] {
  const platform = getPlatform();
  if (platform === "ios") return ["apple", "google"];
  return ["google"];
}

export function openDirections(target: DirectionsTarget, app: MapApp): void {
  const { lat, lng, address, label } = target;

  if (!lat && !lng && !address) return;

  const hasCoords = lat != null && lng != null && lat !== 0 && lng !== 0;
  const encodedAddr = address ? encodeURIComponent(address) : "";
  const encodedLabel = label ? encodeURIComponent(label) : "";
  const destination = hasCoords ? `${lat},${lng}` : encodedAddr;

  let url: string;

  if (app === "apple") {
    if (hasCoords) {
      url = `http://maps.apple.com/?daddr=${lat},${lng}` + (encodedLabel ? `&q=${encodedLabel}` : "");
    } else {
      url = `http://maps.apple.com/?daddr=${encodedAddr}` + (encodedLabel ? `&q=${encodedLabel}` : "");
    }
  } else {
    const platform = getPlatform();
    if (platform === "android") {
      url = `google.navigation:q=${destination}`;
    } else if (platform === "ios" && isNativePlatform()) {
      url = `comgooglemaps://?daddr=${destination}&directionsmode=driving`;
    } else {
      url = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
    }
  }

  if (isNativePlatform()) {
    openNativeUrl(url, app);
  } else {
    window.open(url, "_blank");
  }
}

async function openNativeUrl(url: string, app: MapApp): Promise<void> {
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url, presentationStyle: "popover" as any });
  } catch {
    if (app === "google") {
      const fallback = url.startsWith("comgooglemaps://")
        ? `https://www.google.com/maps/dir/?api=1&destination=${url.split("daddr=")[1]?.split("&")[0] || ""}`
        : url;
      window.open(fallback, "_blank");
    } else {
      window.open(url, "_blank");
    }
  }
}
