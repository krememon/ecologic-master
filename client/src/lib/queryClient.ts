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

function getNativeAuthHeaders(): Record<string, string> {
  try {
    if (!isNativeCapacitor()) return {};
    const sessionId = typeof localStorage !== "undefined"
      ? localStorage.getItem("nativeSessionId")
      : null;
    const headers: Record<string, string> = { "x-client-type": "mobile" };
    if (sessionId) headers["Authorization"] = `Bearer ${sessionId}`;
    return headers;
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
