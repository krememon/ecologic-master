import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, Clock, Loader2, Check } from "lucide-react";
import { useCan } from "@/hooks/useCan";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface TimeSettings {
  autoClockOutTime: string;
}

const TIME_OPTIONS = [
  { value: "12:00", label: "12:00 PM" },
  { value: "12:30", label: "12:30 PM" },
  { value: "13:00", label: "1:00 PM" },
  { value: "13:30", label: "1:30 PM" },
  { value: "14:00", label: "2:00 PM" },
  { value: "14:30", label: "2:30 PM" },
  { value: "15:00", label: "3:00 PM" },
  { value: "15:30", label: "3:30 PM" },
  { value: "16:00", label: "4:00 PM" },
  { value: "16:30", label: "4:30 PM" },
  { value: "17:00", label: "5:00 PM" },
  { value: "17:30", label: "5:30 PM" },
  { value: "18:00", label: "6:00 PM" },
  { value: "18:30", label: "6:30 PM" },
  { value: "19:00", label: "7:00 PM" },
  { value: "19:30", label: "7:30 PM" },
  { value: "20:00", label: "8:00 PM" },
  { value: "20:30", label: "8:30 PM" },
  { value: "21:00", label: "9:00 PM" },
  { value: "21:30", label: "9:30 PM" },
  { value: "22:00", label: "10:00 PM" },
];

export default function TimeTrackingSettings() {
  const [, navigate] = useLocation();
  const { can } = useCan();
  const [selectedTime, setSelectedTime] = useState<string>("18:00");
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery<TimeSettings>({
    queryKey: ["/api/company/time-settings"],
  });

  useEffect(() => {
    if (data?.autoClockOutTime) {
      setSelectedTime(data.autoClockOutTime);
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: async (time: string) => {
      return apiRequest("PATCH", "/api/company/time-settings", { autoClockOutTime: time });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/time-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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

  const getTimeLabel = (value: string) => {
    const option = TIME_OPTIONS.find((o) => o.value === value);
    return option?.label || value;
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
                  <Select value={selectedTime} onValueChange={handleTimeChange}>
                    <SelectTrigger className="w-32">
                      <SelectValue>{getTimeLabel(selectedTime)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
