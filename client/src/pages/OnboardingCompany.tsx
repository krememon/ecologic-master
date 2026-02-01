import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Building2, LogOut } from "lucide-react";
import logoImage from "@assets/IMG_6171 2_1749763982284.jpg";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

const EMPLOYEE_RANGES = [
  { value: "1", label: "Just me (1)" },
  { value: "2-5", label: "2–5" },
  { value: "6-10", label: "6–10" },
  { value: "11-20", label: "11–20" },
  { value: "20+", label: "20+" },
];

type Step = "company" | "subscription";

export default function OnboardingCompany() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();

  const [step, setStep] = useState<Step>("company");
  const [companyName, setCompanyName] = useState("");
  const [employeeRange, setEmployeeRange] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onboardingChoice = localStorage.getItem("onboardingChoice");
  console.log("[onboarding-company] choice:", onboardingChoice, "step:", step, "hasCompany:", !!user?.company);

  useEffect(() => {
    if (!authLoading && user?.company) {
      localStorage.removeItem("onboardingChoice");
      setLocation("/", { replace: true });
    }
  }, [user, authLoading, setLocation]);

  useEffect(() => {
    if (onboardingChoice !== "owner") {
      setLocation("/onboarding/choice", { replace: true });
    }
  }, [onboardingChoice, setLocation]);

  if (authLoading || user?.company) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const handleCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: Record<string, string> = {};
    if (!companyName.trim()) newErrors.companyName = "Company name is required";
    if (!employeeRange) newErrors.employeeRange = "Select team size";
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/companies", {
        name: companyName,
        employeeRange,
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create company");
      }
      
      await queryClient.invalidateQueries();
      setStep("subscription");
    } catch (error: any) {
      setErrors({ companyName: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartTrial = async () => {
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/subscriptions/start-trial", {});
      
      if (!res.ok) {
        const data = await res.json();
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
          return;
        }
        throw new Error(data.message || "Failed to start trial");
      }
      
      // Don't clear onboardingChoice yet - still need it for /onboarding/industry
      setLocation("/");
    } catch (error: any) {
      // Don't clear onboardingChoice - let the flow continue
      setLocation("/");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (step === "company") {
      setLocation("/onboarding/choice");
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/logout", {});
      localStorage.removeItem("onboardingChoice");
      await queryClient.invalidateQueries();
      setLocation("/");
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to log out",
        variant: "destructive",
      });
    }
  };

  const getStepInfo = () => {
    const steps: Step[] = ["company", "subscription"];
    return { current: steps.indexOf(step) + 1, total: steps.length };
  };

  const stepInfo = getStepInfo();

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img src={logoImage} alt="EcoLogic" className="w-16 h-16 mx-auto mb-4 rounded-xl" />
            <h1 className="text-2xl font-bold tracking-wide text-slate-800 dark:text-white">
              ECOLOGIC
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Set up your company</p>
          </div>
          
          <div className="mb-6">
            <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${(stepInfo.current / stepInfo.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
              Step {stepInfo.current} of {stepInfo.total}
            </p>
          </div>
          
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 min-h-[400px]">
            {step !== "subscription" && (
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-4"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </button>
            )}
            
            {step === "company" && (
              <form onSubmit={handleCompanySubmit} className="space-y-6">
                <div className="text-center mb-6">
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Tell us about your company</h2>
                </div>
                
                <div>
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input
                    id="companyName"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Your company name"
                    className={errors.companyName ? "border-red-500" : ""}
                  />
                  {errors.companyName && <p className="text-xs text-red-500 mt-1">{errors.companyName}</p>}
                </div>
                
                <div>
                  <Label>Team Size</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {EMPLOYEE_RANGES.map((range) => (
                      <button
                        key={range.value}
                        type="button"
                        onClick={() => setEmployeeRange(range.value)}
                        className={`p-3 border-2 rounded-lg text-sm font-medium transition-all ${
                          employeeRange === range.value
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                            : "hover:border-slate-300"
                        }`}
                      >
                        {range.label}
                      </button>
                    ))}
                  </div>
                  {errors.employeeRange && <p className="text-xs text-red-500 mt-1">{errors.employeeRange}</p>}
                </div>
                
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Create Company
                </Button>
              </form>
            )}
            
            {step === "subscription" && (
              <div className="space-y-6 text-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto">
                  <Building2 className="w-8 h-8 text-green-600 dark:text-green-400" />
                </div>
                
                <div>
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Company Created!</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                    Start your free trial to explore all features
                  </p>
                </div>
                
                <Button onClick={handleStartTrial} className="w-full" disabled={isLoading}>
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Start Free Trial
                </Button>
              </div>
            )}
          </div>
          
          <div className="mt-6 text-center">
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-500">
              <LogOut className="w-4 h-4 mr-2" />
              Log out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
