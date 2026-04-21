// Subscription system removed - app is now free to use
export function useSubscription() {
  return {
    subscriptionStatus: null,
    isLoading: false,
    error: null,
    refetch: () => {},
    hasActiveSubscription: true, // Always true now
    requiresSubscription: false, // Never required
    isTrialing: false,
    planName: 'free',
    maxUsers: 999, // Unlimited
    trialEndsAt: null,
  };
}

// Subscription guard removed - all components are now accessible
export function withSubscriptionGuard<P extends object>(
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  return Component; // Just return the component directly
}