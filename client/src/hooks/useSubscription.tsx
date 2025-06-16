import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation } from 'wouter';

interface SubscriptionStatus {
  hasCompany: boolean;
  subscriptionStatus: string;
  subscriptionPlan: string;
  maxUsers: number;
  hasActiveSubscription: boolean;
  trialEndsAt: string | null;
  requiresSubscription: boolean;
  redirectTo: string | null;
}

export function useSubscription() {
  const [, setLocation] = useLocation();

  const {
    data: subscriptionStatus,
    error,
    isLoading,
    refetch
  } = useQuery<SubscriptionStatus>({
    queryKey: ['/api/subscription/status'],
    retry: false,
  });

  // Automatically redirect if subscription is required
  useEffect(() => {
    if (subscriptionStatus?.requiresSubscription && subscriptionStatus.redirectTo) {
      setLocation(subscriptionStatus.redirectTo);
    }
  }, [subscriptionStatus, setLocation]);

  return {
    subscriptionStatus,
    isLoading,
    error,
    refetch,
    hasActiveSubscription: subscriptionStatus?.hasActiveSubscription ?? false,
    requiresSubscription: subscriptionStatus?.requiresSubscription ?? false,
    isTrialing: subscriptionStatus?.subscriptionStatus === 'trialing',
    planName: subscriptionStatus?.subscriptionPlan,
    maxUsers: subscriptionStatus?.maxUsers,
    trialEndsAt: subscriptionStatus?.trialEndsAt,
  };
}

// Higher-order component for protecting routes that require active subscription
export function withSubscriptionGuard<P extends object>(
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  return function ProtectedComponent(props: P) {
    const { isLoading, requiresSubscription, hasActiveSubscription } = useSubscription();

    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      );
    }

    if (requiresSubscription || !hasActiveSubscription) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="max-w-md w-full mx-auto text-center p-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
              <div className="w-16 h-16 mx-auto mb-4 bg-yellow-100 dark:bg-yellow-900/20 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                Subscription Required
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                You need an active subscription to access this feature. Choose a plan to continue.
              </p>
              <button
                onClick={() => window.location.href = '/choose-plan'}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                Choose Plan
              </button>
            </div>
          </div>
        </div>
      );
    }

    return <Component {...props} />;
  };
}