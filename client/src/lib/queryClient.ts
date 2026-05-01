import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Returns Authorization header ONLY for Capacitor native (iOS/Android).
 * Web always uses session cookies — Bearer is never attached on web.
 * The canvas/picard origin uses exchange-code via relative URL to get a
 * same-domain session cookie, so Bearer is not needed there either.
 */
function isNativeCapacitor(): boolean {
  try {
    const cap = (window as any).Capacitor;
    return !!(cap?.getPlatform?.() && cap.getPlatform() !== "web");
  } catch {
    return false;
  }
}

/**
 * When the WebView is loading bundled JS (origin starts with capacitor://,
 * ionic://, file://, etc.), relative URLs like /api/... resolve to a
 * non-existent capacitor://localhost/api/... and the fetch hangs forever.
 * In that case we MUST use an absolute URL pointing at the real backend.
 *
 * For production iOS builds (server.url=https://app.ecologicc.com in
 * capacitor.config), origin is https://app.ecologicc.com and relative
 * URLs work fine — this helper is a no-op.
 *
 * Override the default backend at build time:
 *   VITE_NATIVE_API_BASE_URL=https://staging.ecologicc.com npm run build
 */
function getNativeApiBase(): string {
  const fromEnv = (import.meta as any).env?.VITE_NATIVE_API_BASE_URL as
    | string
    | undefined;
  return (fromEnv && fromEnv.trim()) || "https://app.ecologicc.com";
}

export function resolveApiUrl(path: string): string {
  // Already absolute — leave it alone.
  if (/^https?:\/\//i.test(path)) return path;
  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    // http(s):* origins → relative URL is fine (web + production native that
    // loads from the real https origin).
    if (/^https?:/i.test(origin)) return path;
    // Non-http origin (capacitor://, ionic://, file://, app://, etc.) →
    // prepend absolute base so the request reaches a real server.
    if (path.startsWith("/")) return getNativeApiBase() + path;
    return getNativeApiBase() + "/" + path;
  } catch {
    return path;
  }
}

function getNativeAuthHeaders(): { headers: Record<string, string>; bearerAttached: boolean } {
  try {
    if (!isNativeCapacitor()) return { headers: {}, bearerAttached: false };
    const sessionId = typeof localStorage !== "undefined"
      ? localStorage.getItem("nativeSessionId")
      : null;
    const headers: Record<string, string> = { "x-client-type": "mobile" };
    if (sessionId) {
      headers["Authorization"] = `Bearer ${sessionId}`;
      return { headers, bearerAttached: true };
    }
    return { headers, bearerAttached: false };
  } catch {
    // localStorage not available (e.g. SSR context)
  }
  return { headers: {}, bearerAttached: false };
}

/** Call on logout to remove the native Bearer token from storage. */
export function clearNativeSession(): void {
  try {
    localStorage.removeItem("nativeSessionId");
  } catch {
    // ignore
  }
}

/**
 * If a Bearer token was attached to a request that came back 401, the
 * stored `nativeSessionId` is invalid/expired/revoked. Clearing it stops
 * the app from re-attaching the dead token on every subsequent request,
 * which would otherwise pin the user in a permanent 401 loop with
 * `hasNativeSession=true attachBearer=true` in the logs.
 */
function clearNativeSessionIfBearerWasAttached(bearerAttached: boolean, status: number): void {
  if (!bearerAttached || status !== 401) return;
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("nativeSessionId")) {
      console.warn(
        "[auth/native] 401 received with Bearer attached — clearing stale nativeSessionId"
      );
      localStorage.removeItem("nativeSessionId");
    }
  } catch {
    // ignore
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    
    // Check for specific deactivation/session revocation errors
    if (res.status === 401) {
      try {
        const errorData = JSON.parse(text);
        
        if (errorData.code === 'ACCOUNT_INACTIVE') {
          // Clear auth state and redirect
          window.location.href = '/?error=account_inactive&message=' + encodeURIComponent(errorData.message || 'Your account was deactivated. Contact your administrator.');
          throw new Error(errorData.message || 'Account deactivated');
        }
        
        if (errorData.code === 'SESSION_REVOKED') {
          // Clear auth state and redirect
          window.location.href = '/?error=session_revoked&message=' + encodeURIComponent(errorData.message || 'Your session has ended. Please sign in again.');
          throw new Error(errorData.message || 'Session revoked');
        }
      } catch (e) {
        // If parsing fails, continue with default error handling
      }
    }
    
    // Check for no company access error
    if (res.status === 403) {
      try {
        const errorData = JSON.parse(text);
        
        if (errorData.code === 'NO_COMPANY') {
          // Redirect to join company page
          window.location.href = '/join-company';
          throw new Error(errorData.message || 'No company access');
        }
      } catch (e) {
        // If parsing fails, continue with default error handling
      }
    }
    
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const { headers: nativeHeaders, bearerAttached } = getNativeAuthHeaders();
  const resolved = resolveApiUrl(url);
  const res = await fetch(resolved, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...nativeHeaders,
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    cache: "no-store",
  });

  clearNativeSessionIfBearerWasAttached(bearerAttached, res.status);
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const { headers, bearerAttached } = getNativeAuthHeaders();
    const res = await fetch(resolveApiUrl(queryKey[0] as string), {
      credentials: "include",
      cache: "no-store",
      headers,
    });

    clearNativeSessionIfBearerWasAttached(bearerAttached, res.status);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
