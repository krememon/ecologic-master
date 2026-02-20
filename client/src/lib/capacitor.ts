export function isNativePlatform(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

export async function openExternalBrowser(url: string): Promise<void> {
  if (isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url, windowName: '_system' });
  } else {
    window.location.href = url;
  }
}

export async function closeExternalBrowser(): Promise<void> {
  if (isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  }
}

export function getGoogleSignInUrl(): string {
  if (isNativePlatform()) {
    const baseUrl = (window as any).__CAPACITOR_SERVER_URL__ ||
      window.location.origin;
    return `${baseUrl}/api/auth/google/native?platform=capacitor`;
  }
  return '/api/auth/google';
}

export async function performLogout(): Promise<void> {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {}
  window.location.replace('/auth');
}
