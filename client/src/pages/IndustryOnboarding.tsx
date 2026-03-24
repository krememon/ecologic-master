import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { 
  Wrench, 
  Thermometer, 
  Zap, 
  Building2, 
  SprayCanIcon,
  Leaf,
  MonitorSmartphone,
  Bug,
  Droplets,
  Car,
  Sparkles,
  ArrowLeft
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
];

export default function IndustryOnboarding() {
  const [, setLocation] = useLocation();
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  
  const onboardingChoice = localStorage.getItem("onboardingChoice");
  console.log("[industry-onboarding] mounted, choice:", onboardingChoice, "route:", window.location.pathname);
  
  useEffect(() => {
    // Guard: employees should go to join-company instead
    if (onboardingChoice === "employee") {
      console.log("[industry-onboarding] employee path, redirecting to /join-company");
      setLocation("/join-company", { replace: true });
    }
    // If no choice set, assume owner path (they came from /signup)
  }, [onboardingChoice, setLocation]);

  const handleBack = () => {
    // Employee path: go back to join-company
    if (onboardingChoice === "employee") {
      setLocation("/join-company");
    } else {
      // Owner path (both "owner" and null / SignupWizard role-step):
      // always return to the choice screen — never to /signup which resets the wizard.
      setLocation("/onboarding/choice");
    }
  };

  const handleContinue = () => {
    if (selectedIndustry) {
      // Save industry to localStorage for use in company creation
      localStorage.setItem("onboardingIndustry", selectedIndustry);
      console.log("[industry-onboarding] saved industry:", selectedIndustry);
      // Navigate to company details step
      setLocation("/onboarding/company");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-3xl">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </button>

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
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-900/30 ring-2 ring-blue-600/20" 
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
              disabled={!selectedIndustry}
              size="lg"
              className="px-12"
              data-testid="button-continue"
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
