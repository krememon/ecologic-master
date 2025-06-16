import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { CreditCard, Crown, Users, Calendar, AlertTriangle } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

export function BillingSection() {
  const { subscriptionStatus, refetch, hasActiveSubscription, isTrialing, planName, maxUsers, trialEndsAt } = useSubscription();
  const { toast } = useToast();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const cancelSubscriptionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/subscription/cancel');
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Subscription Canceled",
        description: "Your subscription will remain active until the end of your current billing period.",
      });
      refetch();
      setCancelDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Cancellation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const reactivateSubscriptionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/subscription/reactivate');
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Subscription Reactivated",
        description: "Your subscription has been reactivated successfully.",
      });
      refetch();
    },
    onError: (error: Error) => {
      toast({
        title: "Reactivation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = () => {
    switch (subscriptionStatus?.subscriptionStatus) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">Active</Badge>;
      case 'trialing':
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400">Free Trial</Badge>;
      case 'past_due':
        return <Badge variant="destructive">Past Due</Badge>;
      case 'canceled':
        return <Badge variant="secondary">Canceled</Badge>;
      default:
        return <Badge variant="outline">Inactive</Badge>;
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const getPlanIcon = () => {
    switch (planName) {
      case 'starter':
        return <Users className="h-5 w-5 text-blue-600" />;
      case 'professional':
        return <CreditCard className="h-5 w-5 text-purple-600" />;
      case 'enterprise':
        return <Crown className="h-5 w-5 text-yellow-600" />;
      default:
        return <Users className="h-5 w-5 text-gray-600" />;
    }
  };

  const getPlanPrice = () => {
    switch (planName) {
      case 'starter': return '$29';
      case 'professional': return '$79';
      case 'enterprise': return '$199';
      default: return '$0';
    }
  };

  if (!subscriptionStatus?.hasCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <CreditCard className="h-5 w-5" />
            <span>Billing & Subscription</span>
          </CardTitle>
          <CardDescription>
            Manage your subscription and billing information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Company Found</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              You need to set up your company before managing billing.
            </p>
            <Button onClick={() => window.location.href = '/choose-plan'}>
              Choose Plan
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <CreditCard className="h-5 w-5" />
          <span>Billing & Subscription</span>
        </CardTitle>
        <CardDescription>
          Manage your subscription and billing information
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Plan */}
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-center space-x-3">
            {getPlanIcon()}
            <div>
              <h3 className="font-semibold capitalize">{planName || 'No Plan'} Plan</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {getPlanPrice()}/month • Up to {maxUsers} users
              </p>
            </div>
          </div>
          <div className="text-right">
            {getStatusBadge()}
            {isTrialing && trialEndsAt && (
              <p className="text-xs text-gray-500 mt-1">
                Trial ends {formatDate(trialEndsAt)}
              </p>
            )}
          </div>
        </div>

        {/* Trial Warning */}
        {isTrialing && trialEndsAt && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex items-center space-x-2">
              <Calendar className="h-4 w-4 text-blue-600" />
              <span className="font-medium text-blue-900 dark:text-blue-100">Free Trial Active</span>
            </div>
            <p className="text-sm text-blue-800 dark:text-blue-200 mt-1">
              Your free trial ends on {formatDate(trialEndsAt)}. Add a payment method to continue using EcoLogic.
            </p>
          </div>
        )}

        <Separator />

        {/* Actions */}
        <div className="space-y-3">
          <h4 className="font-medium">Manage Subscription</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={() => window.location.href = '/choose-plan'}
              className="w-full"
            >
              Change Plan
            </Button>
            
            {hasActiveSubscription && (
              <>
                {subscriptionStatus?.subscriptionStatus !== 'canceled' ? (
                  <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="w-full">
                        Cancel Subscription
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel Subscription</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to cancel your subscription? You'll continue to have access until the end of your current billing period.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => cancelSubscriptionMutation.mutate()}
                          disabled={cancelSubscriptionMutation.isPending}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          {cancelSubscriptionMutation.isPending ? 'Canceling...' : 'Cancel Subscription'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Button
                    onClick={() => reactivateSubscriptionMutation.mutate()}
                    disabled={reactivateSubscriptionMutation.isPending}
                    className="w-full"
                  >
                    {reactivateSubscriptionMutation.isPending ? 'Reactivating...' : 'Reactivate Subscription'}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <Separator />

        {/* Support */}
        <div className="text-center text-sm text-gray-600 dark:text-gray-400">
          <p>Need help with your subscription?</p>
          <p>Contact our support team for assistance.</p>
        </div>
      </CardContent>
    </Card>
  );
}