import { QueryClient, QueryFunction } from "@tanstack/react-query";

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
    
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
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
