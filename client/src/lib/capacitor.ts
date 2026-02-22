export function isNativePlatform(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

export function getApiBaseUrl(): string {
  if (isNativePlatform()) {
    return "https://app.ecologicc.com";
  }
  return "";
}

export async function openSystemBrowser(url: string): Promise<void> {
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url, presentationStyle: "popover" as any });
}

export async function closeSystemBrowser(): Promise<void> {
  const { Browser } = await import("@capacitor/browser");
  await Browser.close();
}
