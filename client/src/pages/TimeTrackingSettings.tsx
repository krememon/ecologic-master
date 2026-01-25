import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Clock, Loader2, Check } from "lucide-react";
import { useCan } from "@/hooks/useCan";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { TimeWheelPicker } from "@/components/TimeWheelPicker";
import { useToast } from "@/hooks/use-toast";

interface TimeSettings {
  autoClockOutTime: string;
}

export default function TimeTrackingSettings() {
  const [, navigate] = useLocation();
  const { can } = useCan();
  const { toast } = useToast();
  const [selectedTime, setSelectedTime] = useState<string>("18:00");
  const [saved, setSaved] = useState(false);
  const [previousTime, setPreviousTime] = useState<string>("18:00");

  const { data, isLoading } = useQuery<TimeSettings>({
    queryKey: ["/api/company/time-settings"],
  });

  useEffect(() => {
    if (data?.autoClockOutTime) {
      setSelectedTime(data.autoClockOutTime);
      setPreviousTime(data.autoClockOutTime);
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: async (time: string) => {
      return apiRequest("PATCH", "/api/company/time-settings", { autoClockOutTime: time });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/time-settings"] });
      setPreviousTime(selectedTime);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: () => {
      setSelectedTime(previousTime);
      toast({
        title: "Error",
        description: "Failed to save time setting. Please try again.",
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

  const handleTimeChange = (value: string) => {
    setSelectedTime(value);
    updateMutation.mutate(value);
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
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Time Tracking
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Configure automatic time tracking settings
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3 mb-1">
                <Clock className="h-5 w-5 text-teal-600" />
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                  Auto Clock-Out Time
                </h2>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 ml-8">
                If someone forgets to clock out, EcoLogic will automatically end their shift at this time.
              </p>
            </div>

            <div className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-slate-700 dark:text-slate-300">
                  End shifts at
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-32">
                    <TimeWheelPicker
                      value={selectedTime}
                      onChange={handleTimeChange}
                      label="Auto Clock-Out Time"
                    />
                  </div>
                  {saved && (
                    <div className="flex items-center gap-1 text-teal-600">
                      <Check className="h-4 w-4" />
                      <span className="text-sm">Saved</span>
                    </div>
                  )}
                  {updateMutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
