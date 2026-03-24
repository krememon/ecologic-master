import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, LogOut } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { getPlanForTeamSize, subscriptionPlans } from "@/config/subscriptionPlans";
import LocationInput, { type Address } from "@/components/LocationInput";
import { formatPhoneInput } from "@shared/phoneUtils";

const EMPLOYEE_RANGES = [
  { value: "1", label: "Just me (1)" },
  { value: "2-5", label: "2–5" },
  { value: "6-10", label: "6–10" },
  { value: "11-15", label: "11–15" },
];

export default function OnboardingCompany() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();

  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [addressText, setAddressText] = useState("");
  const [addressParsed, setAddressParsed] = useState<Address | null>(null);
  const [employeeRange, setEmployeeRange] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onboardingChoice = localStorage.getItem("onboardingChoice");

  const hasCompany = !!user?.company;
  const onboardingCompleted = user?.company?.onboardingCompleted;
  const subscriptionStatus = user?.company?.subscriptionStatus;
  const needsSubscription = hasCompany && !onboardingCompleted &&
    subscriptionStatus !== "active" && subscriptionStatus !== "trialing";

  useEffect(() => {
    if (!authLoading && hasCompany && onboardingCompleted) {
      localStorage.removeItem("onboardingChoice");
      localStorage.removeItem("onboardingIndustry");
      setLocation("/", { replace: true });
    }
  }, [authLoading, hasCompany, onboardingCompleted, setLocation]);

  useEffect(() => {
    if (!authLoading && needsSubscription) {
      setLocation("/onboarding/subscription", { replace: true });
    }
  }, [authLoading, needsSubscription, setLocation]);

  useEffect(() => {
    if (onboardingChoice === "employee") {
      setLocation("/join-company", { replace: true });
    }
  }, [onboardingChoice, setLocation]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const selectedPlanKey = employeeRange ? getPlanForTeamSize(employeeRange) : null;
  const selectedPlan = selectedPlanKey ? subscriptionPlans[selectedPlanKey] : null;

  const handleAddressSelected = (addr: Address) => {
    setAddressText(addr.formatted_address || addr.street);
    setAddressParsed(addr);
  };

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
      const industry = localStorage.getItem("onboardingIndustry") || "other";
      const planKey = getPlanForTeamSize(employeeRange);
      const plan = subscriptionPlans[planKey];

      const res = await apiRequest("POST", "/api/companies", {
        name: companyName,
        industry,
        employeeRange,
        teamSizeRange: employeeRange,
        planKey,
        userLimit: plan.userLimit,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        addressLine1: addressParsed?.street || addressText.trim() || undefined,
        city: addressParsed?.city || undefined,
        state: addressParsed?.state || undefined,
        postalCode: addressParsed?.postalCode || undefined,
        country: addressParsed?.country || undefined,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create company");
      }

      await queryClient.invalidateQueries();
      setLocation("/onboarding/subscription", { replace: true });
    } catch (error: any) {
      setErrors({ companyName: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setLocation("/onboarding/industry");
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

  const isSubmitDisabled = isLoading || !companyName.trim() || !employeeRange;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1
              className="text-5xl md:text-6xl mx-auto mb-2"
              style={{
                fontFamily: "'Plus Jakarta Sans', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
                fontWeight: 800,
                letterSpacing: "-0.02em",
                lineHeight: 1.05,
                color: "#0B0B0D",
              }}
            >
              EcoLogic
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Professional contractor management</p>
          </div>

          <div className="mb-6">
            <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: "50%" }}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
              Step 1 of 2
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </button>

            <form onSubmit={handleCompanySubmit} className="space-y-4">
              <div className="text-center mb-6">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Tell us about your company</h2>
              </div>

              <div>
                <Label htmlFor="companyName">Company Name</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Enter name"
                  className={errors.companyName ? "border-red-500" : ""}
                />
                {errors.companyName && <p className="text-xs text-red-500 mt-1">{errors.companyName}</p>}
              </div>

              <div>
                <Label htmlFor="companyPhone">Phone Number <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Input
                  id="companyPhone"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                  placeholder="Enter phone"
                  inputMode="tel"
                />
              </div>

              <div>
                <Label htmlFor="companyEmail">Company Email <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Input
                  id="companyEmail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter email"
                />
              </div>

              <div>
                <Label>Company Address <span className="text-slate-400 font-normal">(optional)</span></Label>
                <LocationInput
                  value={addressText}
                  onChange={setAddressText}
                  onAddressSelected={handleAddressSelected}
                  placeholder="Search address"
                />
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
                          ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                          : "border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
                {errors.employeeRange && <p className="text-xs text-red-500 mt-1">{errors.employeeRange}</p>}
              </div>

              {selectedPlan && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                    {selectedPlan.label} Plan — 7-day free trial, then ${selectedPlan.price}/mo
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    Up to {selectedPlan.userLimit} {selectedPlan.userLimit === 1 ? "user" : "users"}
                  </p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitDisabled}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Create Company
              </Button>
            </form>
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
