import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChevronLeft, FileText, Loader2 } from "lucide-react";
import { useCan } from "@/hooks/useCan";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface EstimateSettingsData {
  hideConvertedEstimates: boolean;
}

export default function EstimateSettings() {
  const [, navigate] = useLocation();
  const { can } = useCan();
  const { toast } = useToast();
  const [hideConverted, setHideConverted] = useState(true);

  const { data, isLoading } = useQuery<EstimateSettingsData>({
    queryKey: ["/api/settings/estimates"],
  });

  useEffect(() => {
    if (data) {
      setHideConverted(data.hideConvertedEstimates);
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: async (value: boolean) => {
      return apiRequest("PUT", "/api/settings/estimates", { hideConvertedEstimates: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
    },
    onError: () => {
      setHideConverted(!hideConverted);
      toast({
        title: "Error",
        description: "Failed to save estimate setting. Please try again.",
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

  const handleToggle = (checked: boolean) => {
    setHideConverted(checked);
    updateMutation.mutate(checked);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/customize">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Estimates
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Configure how estimates behave after conversion
            </p>
          </div>
        </div>

        <Card className="border-slate-200 dark:border-slate-700">
          <CardContent className="p-0">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    Hide converted estimates
                  </div>
                  <div className="text-sm text-slate-500 dark:text-slate-400 max-w-xs">
                    When enabled, estimates that have been converted to jobs will be hidden from the main estimates list
                  </div>
                </div>
              </div>
              <Switch
                checked={hideConverted}
                onCheckedChange={handleToggle}
                disabled={updateMutation.isPending}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}