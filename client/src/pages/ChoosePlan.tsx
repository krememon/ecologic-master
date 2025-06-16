import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Crown, Users, Zap } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY!);

interface Plan {
  name: string;
  maxUsers: number;
  monthlyPrice: number;
  features: string[];
}

interface Plans {
  starter: Plan;
  professional: Plan;
  enterprise: Plan;
}

const PlanCard = ({ planKey, plan, onSelect, isSelected, isPopular }: {
  planKey: string;
  plan: Plan;
  onSelect: (plan: string) => void;
  isSelected: boolean;
  isPopular?: boolean;
}) => {
  const getIcon = () => {
    switch (planKey) {
      case 'starter': return <Users className="h-8 w-8 text-blue-600" />;
      case 'professional': return <Zap className="h-8 w-8 text-purple-600" />;
      case 'enterprise': return <Crown className="h-8 w-8 text-yellow-600" />;
      default: return <Users className="h-8 w-8 text-blue-600" />;
    }
  };

  return (
    <Card className={`relative transition-all duration-200 hover:shadow-lg ${
      isSelected ? 'ring-2 ring-blue-500 shadow-lg' : ''
    } ${isPopular ? 'border-purple-500' : ''}`}>
      {isPopular && (
        <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-purple-600 hover:bg-purple-700">
          Most Popular
        </Badge>
      )}
      <CardHeader className="text-center pb-4">
        <div className="flex justify-center mb-2">
          {getIcon()}
        </div>
        <CardTitle className="text-2xl font-bold">{plan.name}</CardTitle>
        <CardDescription>
          <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            ${plan.monthlyPrice}
          </span>
          <span className="text-gray-600 dark:text-gray-400">/month</span>
        </CardDescription>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Up to {plan.maxUsers} team members
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-3">
          {plan.features.map((feature, index) => (
            <li key={index} className="flex items-center space-x-2">
              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
              <span className="text-sm">{feature}</span>
            </li>
          ))}
        </ul>
        <Button
          onClick={() => onSelect(planKey)}
          variant={isSelected ? "default" : "outline"}
          className="w-full mt-6"
          size="lg"
        >
          {isSelected ? 'Selected' : 'Choose Plan'}
        </Button>
      </CardContent>
    </Card>
  );
};

const PaymentForm = ({ selectedPlan, clientSecret }: { selectedPlan: string; clientSecret: string }) => {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/dashboard`,
        },
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: error.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Payment Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
        <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
          🎉 7-Day Free Trial Included!
        </h3>
        <p className="text-sm text-blue-800 dark:text-blue-200">
          Your trial starts immediately. You won't be charged until after 7 days.
        </p>
      </div>
      
      <PaymentElement />
      
      <Button 
        type="submit" 
        disabled={!stripe || isProcessing}
        className="w-full"
        size="lg"
      >
        {isProcessing ? 'Processing...' : 'Start Free Trial'}
      </Button>
    </form>
  );
};

export default function ChoosePlan() {
  const [selectedPlan, setSelectedPlan] = useState<string>('professional');
  const [showPayment, setShowPayment] = useState(false);
  const [clientSecret, setClientSecret] = useState<string>('');
  const { toast } = useToast();

  const { data: plans, isLoading } = useQuery<Plans>({
    queryKey: ['/api/subscription/plans'],
  });

  const createSubscriptionMutation = useMutation({
    mutationFn: async (plan: string) => {
      const res = await apiRequest('POST', '/api/subscription/create', { plan });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
        setShowPayment(true);
      } else {
        // Trial started without payment required
        toast({
          title: "Trial Started!",
          description: "Your 7-day free trial has begun.",
        });
        window.location.href = '/dashboard';
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Setup Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSelectPlan = (plan: string) => {
    setSelectedPlan(plan);
    createSubscriptionMutation.mutate(plan);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (showPayment && clientSecret) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold">Complete Your Setup</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Add a payment method to continue with your free trial
            </p>
          </div>

          <Card>
            <CardContent className="p-6">
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <PaymentForm selectedPlan={selectedPlan} clientSecret={clientSecret} />
              </Elements>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Choose Your Plan
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Start with a 7-day free trial. Scale your construction business with the right plan for your team.
          </p>
        </div>

        {plans && (
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <PlanCard
              planKey="starter"
              plan={plans.starter}
              onSelect={handleSelectPlan}
              isSelected={selectedPlan === 'starter'}
            />
            <PlanCard
              planKey="professional"
              plan={plans.professional}
              onSelect={handleSelectPlan}
              isSelected={selectedPlan === 'professional'}
              isPopular={true}
            />
            <PlanCard
              planKey="enterprise"
              plan={plans.enterprise}
              onSelect={handleSelectPlan}
              isSelected={selectedPlan === 'enterprise'}
            />
          </div>
        )}

        <div className="text-center mt-12">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            All plans include a 7-day free trial. Cancel anytime.
          </p>
        </div>
      </div>
    </div>
  );
}