import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ChevronLeft, CreditCard, Loader2 } from "lucide-react";
import { useCan } from "@/hooks/useCan";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PaymentSettingsData {
  requireSignatureAfterPayment: boolean;
}

export default function PaymentSettings() {
  const [, navigate] = useLocation();
  const { can } = useCan();
  const { toast } = useToast();
  const [requireSignature, setRequireSignature] = useState(false);

  const { data, isLoading } = useQuery<PaymentSettingsData>({
    queryKey: ["/api/settings/payments"],
  });

  useEffect(() => {
    if (data) {
      setRequireSignature(data.requireSignatureAfterPayment);
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: async (value: boolean) => {
      return apiRequest("PUT", "/api/settings/payments", { requireSignatureAfterPayment: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/payments"] });
    },
    onError: () => {
      setRequireSignature(!requireSignature);
      toast({
        title: "Error",
        description: "Failed to save payment setting. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (!can("customize.manage")) {
    navigate("/customize");
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <button
        onClick={() => navigate("/customize")}
        className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Customize
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
            <CreditCard className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Payment Settings
          </h1>
        </div>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Configure payment and signature collection settings
        </p>
      </div>

      <Card className="border border-slate-200 dark:border-slate-700 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 mr-4">
              <div className="font-medium text-slate-900 dark:text-slate-100">
                Require signature after payment
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                When enabled, a signature capture screen will appear immediately after every successful payment.
              </p>
            </div>
            <Switch
              checked={requireSignature}
              onCheckedChange={(checked) => {
                setRequireSignature(checked);
                updateMutation.mutate(checked);
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
