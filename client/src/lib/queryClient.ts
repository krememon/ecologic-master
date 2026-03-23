import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Returns Authorization header if a native session token is stored in localStorage AND
 * we're in a context that actually requires Bearer auth:
 *   • Capacitor native (iOS / Android)
 *   • Cross-domain web preview (canvas / picard origin ≠ production origin)
 * On same-origin production web, session cookies handle auth — attaching a stale
 * nativeSessionId as Bearer would force every request through the MobileAuth path and
 * return 401 if that session expired, breaking all API calls.
 */
function getNativeAuthHeaders(): Record<string, string> {
  try {
    const cap = (window as any).Capacitor;
    const isNative = cap?.getPlatform?.() && cap.getPlatform() !== "web";
    if (!isNative) {
      // On web: only attach Bearer when the current origin differs from the production server.
      const prodBase = ((import.meta.env as any).VITE_APP_BASE_URL || "").replace(/\/$/, "");
      if (!prodBase || window.location.origin === prodBase) return {};
    }
    const sessionId = typeof localStorage !== "undefined"
      ? localStorage.getItem("nativeSessionId")
      : null;
    if (sessionId) return { Authorization: `Bearer ${sessionId}` };
  } catch {
    // localStorage not available (e.g. SSR context)
  }
  return {};
}

/** Call on logout to remove the native Bearer token from storage. */
export function clearNativeSession(): void {
  try {
    localStorage.removeItem("nativeSessionId");
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
  const nativeHeaders = getNativeAuthHeaders();
  const res = await fetch(url, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...nativeHeaders,
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    cache: "no-store",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
      cache: "no-store",
      headers: getNativeAuthHeaders(),
    });

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
