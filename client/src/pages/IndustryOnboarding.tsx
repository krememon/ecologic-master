import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { 
  Wrench, 
  Thermometer, 
  Zap, 
  Hammer, 
  Building2, 
  SprayCanIcon,
  Leaf,
  MonitorSmartphone,
  Bug,
  Droplets,
  Car,
  MoreHorizontal,
  Sparkles
} from "lucide-react";

const INDUSTRIES = [
  { id: "Plumbing", label: "Plumbing", icon: Droplets },
  { id: "Heating & Air Conditioning (HVAC)", label: "Heating & Air Conditioning", icon: Thermometer },
  { id: "Electrical", label: "Electrical", icon: Zap },
  { id: "Handyman", label: "Handyman", icon: Wrench },
  { id: "General Contractor", label: "General Contractor", icon: Building2 },
  { id: "Home Cleaning", label: "Home Cleaning", icon: Sparkles },
  { id: "Carpet Cleaning", label: "Carpet Cleaning", icon: SprayCanIcon },
  { id: "Landscaping & Lawn", label: "Landscaping & Lawn", icon: Leaf },
  { id: "Appliances", label: "Appliances", icon: MonitorSmartphone },
  { id: "Pest Control", label: "Pest Control", icon: Bug },
  { id: "Window & Exterior Cleaning", label: "Window & Exterior Cleaning", icon: Droplets },
  { id: "Automotive", label: "Automotive", icon: Car },
  { id: "Other", label: "Other", icon: MoreHorizontal },
];

export default function IndustryOnboarding() {
  const [, setLocation] = useLocation();
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const queryClient = useQueryClient();
  
  console.log("[industry-onboarding] mounted, route:", window.location.pathname);

  const industryMutation = useMutation({
    mutationFn: async (industry: string) => {
      const res = await apiRequest("PATCH", "/api/company/industry", { industry });
      return res.json();
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-catalog"] });
      // Wait for auth user refetch to complete before navigating
      // This ensures onboardingCompleted is updated in state before routing
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
      console.log("Industry saved, redirecting to /customize/price-book");
      setLocation("/customize/price-book");
    },
  });

  const handleContinue = () => {
    if (selectedIndustry) {
      industryMutation.mutate(selectedIndustry);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-3xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
              What industry are you in?
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-lg">
              Select an industry to preload a starter price book. You can fully edit or delete items anytime.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">
            {INDUSTRIES.map((industry) => {
              const Icon = industry.icon;
              const isSelected = selectedIndustry === industry.id;
              
              return (
                <button
                  key={industry.id}
                  onClick={() => setSelectedIndustry(industry.id)}
                  className={`
                    flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all
                    ${isSelected 
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 ring-2 ring-blue-500/20" 
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600"
                    }
                  `}
                  data-testid={`industry-${industry.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                >
                  <Icon 
                    className={`h-8 w-8 mb-2 ${isSelected ? "text-blue-600" : "text-slate-500 dark:text-slate-400"}`} 
                  />
                  <span 
                    className={`text-sm font-medium text-center leading-tight ${
                      isSelected ? "text-blue-700 dark:text-blue-300" : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {industry.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex justify-center">
            <Button
              onClick={handleContinue}
              disabled={!selectedIndustry || industryMutation.isPending}
              size="lg"
              className="px-12"
              data-testid="button-continue"
            >
              {industryMutation.isPending ? "Setting up..." : "Continue"}
            </Button>
          </div>

          {industryMutation.isError && (
            <p className="text-center text-red-500 mt-4">
              Failed to save industry. Please try again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
