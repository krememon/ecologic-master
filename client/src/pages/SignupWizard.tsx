import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Loader2, ArrowLeft, Building2, Users, HelpCircle, Check } from "lucide-react";
import logoImage from "@assets/IMG_6171 2_1749763982284.jpg";
import { apiRequest, queryClient } from "@/lib/queryClient";

type WizardStep = 
  | "identity" 
  | "verify" 
  | "password" 
  | "role" 
  | "role-help"
  | "industry" 
  | "company" 
  | "subscription"
  | "invite";

type UserPath = "owner" | "employee" | null;

const INDUSTRIES = [
  { value: "plumbing", label: "Plumbing" },
  { value: "hvac", label: "HVAC" },
  { value: "electrical", label: "Electrical" },
  { value: "general_contractor", label: "General Contractor" },
  { value: "other", label: "Other" },
];

const EMPLOYEE_RANGES = [
  { value: "1", label: "Just me (1)" },
  { value: "2-5", label: "2–5" },
  { value: "6-10", label: "6–10" },
  { value: "11-20", label: "11–20" },
  { value: "20+", label: "20+" },
];

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);
  
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mediaQuery.matches);
    
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);
  
  return reducedMotion;
}

interface StepTransitionProps {
  children: React.ReactNode;
  direction: "forward" | "back";
  stepKey: string;
}

function StepTransition({ children, direction, stepKey }: StepTransitionProps) {
  const reducedMotion = useReducedMotion();
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, [stepKey]);
  
  if (reducedMotion) {
    return <div className="w-full">{children}</div>;
  }
  
  const translateY = direction === "forward" ? "8px" : "-8px";
  
  return (
    <div
      className="w-full transition-all"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : `translateY(${translateY})`,
        transitionDuration: "240ms",
        transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {children}
    </div>
  );
}

export default function SignupWizard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [step, setStep] = useState<WizardStep>("identity");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [userPath, setUserPath] = useState<UserPath>(null);
  
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    industry: "",
    companyName: "",
    employeeRange: "",
    inviteCode: "",
  });
  
  const [verificationCode, setVerificationCode] = useState<string[]>(["", "", "", "", "", ""]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);
  
  const goToStep = useCallback((newStep: WizardStep, dir: "forward" | "back" = "forward") => {
    setDirection(dir);
    setStep(newStep);
    setErrors({});
  }, []);
  
  const getStepInfo = () => {
    const ownerSteps: WizardStep[] = ["identity", "verify", "password", "role", "industry", "company", "subscription"];
    const employeeSteps: WizardStep[] = ["identity", "verify", "password", "role", "invite"];
    
    const steps = userPath === "employee" ? employeeSteps : ownerSteps;
    const currentIndex = steps.indexOf(step);
    
    if (step === "role-help") return { current: 4, total: steps.length };
    
    return {
      current: currentIndex + 1,
      total: steps.length,
    };
  };
  
  const getPasswordStrength = (password: string) => {
    if (!password) return { level: 0, text: "", color: "", bg: "" };
    
    let score = 0;
    if (password.length >= 8) score += 2;
    else if (password.length >= 6) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    
    if (score <= 2) return { level: 1, text: "Weak", color: "text-red-500", bg: "bg-red-500" };
    if (score <= 4) return { level: 2, text: "Medium", color: "text-yellow-500", bg: "bg-yellow-500" };
    return { level: 3, text: "Strong", color: "text-green-500", bg: "bg-green-500" };
  };
  
  const handleStartSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: Record<string, string> = {};
    if (!formData.firstName.trim()) newErrors.firstName = "First name is required";
    if (!formData.lastName.trim()) newErrors.lastName = "Last name is required";
    if (!formData.email.trim()) newErrors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = "Enter a valid email";
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/signup/start", {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to send verification code");
      }
      
      setResendCooldown(30);
      goToStep("verify");
    } catch (error: any) {
      setErrors({ email: error.message });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleCodeInput = (index: number, value: string) => {
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, 6).split("");
      const newCode = [...verificationCode];
      digits.forEach((d, i) => {
        if (i < 6) newCode[i] = d;
      });
      setVerificationCode(newCode);
      
      const focusIndex = Math.min(digits.length, 5);
      codeInputRefs.current[focusIndex]?.focus();
      return;
    }
    
    const digit = value.replace(/\D/g, "");
    const newCode = [...verificationCode];
    newCode[index] = digit;
    setVerificationCode(newCode);
    
    if (digit && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }
  };
  
  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !verificationCode[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
  };
  
  const getCodeString = () => verificationCode.join("");
  const isCodeComplete = () => verificationCode.every(d => d !== "");
  
  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isCodeComplete()) {
      setErrors({ code: "Enter the 6-digit code" });
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/signup/verify-email", {
        email: formData.email,
        code: getCodeString(),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Invalid code");
      }
      
      goToStep("password");
    } catch (error: any) {
      setErrors({ code: error.message });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleResendCode = async () => {
    if (resendCooldown > 0) return;
    
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/signup/resend-code", {
        email: formData.email,
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to resend code");
      }
      
      setResendCooldown(30);
      toast({ title: "Code sent", description: "Check your email for the new code" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: Record<string, string> = {};
    if (!formData.password) newErrors.password = "Password is required";
    else if (formData.password.length < 8) newErrors.password = "At least 8 characters";
    if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = "Passwords don't match";
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/signup/set-password", {
        email: formData.email,
        password: formData.password,
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create account");
      }
      
      // Invalidate and refetch auth state to reflect new login
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      console.log("[signup] Account created, session established");
      
      goToStep("role");
    } catch (error: any) {
      setErrors({ password: error.message });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleRoleSelect = (role: "owner" | "employee") => {
    setUserPath(role);
    localStorage.setItem("onboardingChoice", role);
    console.log("[onboarding] choice saved:", role);
    if (role === "owner") {
      goToStep("industry");
    } else {
      goToStep("invite");
    }
  };
  
  const handleIndustrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.industry) {
      setErrors({ industry: "Select an industry" });
      return;
    }
    goToStep("company");
  };
  
  const handleCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: Record<string, string> = {};
    if (!formData.companyName.trim()) newErrors.companyName = "Company name is required";
    if (!formData.employeeRange) newErrors.employeeRange = "Select team size";
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/companies", {
        name: formData.companyName,
        industry: formData.industry,
        employeeRange: formData.employeeRange,
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create company");
      }
      
      goToStep("subscription");
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
      
      localStorage.removeItem("onboardingChoice");
      setLocation("/");
    } catch (error: any) {
      localStorage.removeItem("onboardingChoice");
      setLocation("/");
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.inviteCode.trim()) {
      setErrors({ inviteCode: "Enter your invite code" });
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/join-company", {
        inviteCode: formData.inviteCode,
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Invalid invite code");
      }
      
      localStorage.removeItem("onboardingChoice");
      setLocation("/");
    } catch (error: any) {
      setErrors({ inviteCode: error.message });
    } finally {
      setIsLoading(false);
    }
  };
  
  const canGoBack = () => {
    return !["identity", "subscription"].includes(step);
  };
  
  const handleBack = () => {
    const backMap: Record<WizardStep, WizardStep> = {
      identity: "identity",
      verify: "identity",
      password: "verify",
      role: "password",
      "role-help": "role",
      industry: "role",
      company: "industry",
      subscription: "company",
      invite: "role",
    };
    goToStep(backMap[step], "back");
  };
  
  const passwordStrength = getPasswordStrength(formData.password);
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
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Create your account</p>
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
            {canGoBack() && (
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-4"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </button>
            )}
            
            <StepTransition direction={direction} stepKey={step}>
              {step === "identity" && (
                <form onSubmit={handleStartSignup} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        value={formData.firstName}
                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                        className={errors.firstName ? "border-red-500" : ""}
                      />
                      {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>}
                    </div>
                    <div>
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                        className={errors.lastName ? "border-red-500" : ""}
                      />
                      {errors.lastName && <p className="text-xs text-red-500 mt-1">{errors.lastName}</p>}
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className={errors.email ? "border-red-500" : ""}
                    />
                    {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
                  </div>
                  
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
                  </Button>
                  
                  <p className="text-xs text-center text-slate-500 mt-4">
                    Already have an account?{" "}
                    <a href="/login" className="text-blue-600 hover:underline">Log in</a>
                  </p>
                </form>
              )}
              
              {step === "verify" && (
                <form onSubmit={handleVerifyEmail} className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Check your email</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      We sent a 6-digit code to <span className="font-medium">{formData.email}</span>
                    </p>
                  </div>
                  
                  <div className="flex justify-center gap-2">
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <input
                        key={index}
                        ref={(el) => (codeInputRefs.current[index] = el)}
                        type="text"
                        inputMode="numeric"
                        maxLength={index === 0 ? 6 : 1}
                        value={verificationCode[index] || ""}
                        onChange={(e) => handleCodeInput(index, e.target.value)}
                        onKeyDown={(e) => handleCodeKeyDown(index, e)}
                        className="w-11 h-12 text-center text-xl font-mono border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600"
                      />
                    ))}
                  </div>
                  
                  {errors.code && <p className="text-xs text-red-500 text-center">{errors.code}</p>}
                  
                  <Button type="submit" className="w-full" disabled={isLoading || !isCodeComplete()}>
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
                  </Button>
                  
                  <p className="text-xs text-center text-slate-500">
                    Didn't receive it?{" "}
                    <button
                      type="button"
                      onClick={handleResendCode}
                      disabled={resendCooldown > 0 || isLoading}
                      className="text-blue-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                    </button>
                  </p>
                </form>
              )}
              
              {step === "password" && (
                <form onSubmit={handleSetPassword} className="space-y-4">
                  <div className="text-center mb-4">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Create a password</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Secure your account</p>
                  </div>
                  
                  <div>
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className={errors.password ? "border-red-500 pr-10" : "pr-10"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {formData.password && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${passwordStrength.bg} transition-all`}
                            style={{ width: `${(passwordStrength.level / 3) * 100}%` }}
                          />
                        </div>
                        <span className={`text-xs ${passwordStrength.color}`}>{passwordStrength.text}</span>
                      </div>
                    )}
                    {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password}</p>}
                  </div>
                  
                  <div>
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <div className="relative">
                      <Input
                        id="confirmPassword"
                        type={showConfirmPassword ? "text" : "password"}
                        value={formData.confirmPassword}
                        onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                        className={errors.confirmPassword ? "border-red-500 pr-10" : "pr-10"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {errors.confirmPassword && <p className="text-xs text-red-500 mt-1">{errors.confirmPassword}</p>}
                  </div>
                  
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
                  </Button>
                </form>
              )}
              
              {step === "role" && (
                <div className="space-y-4">
                  <div className="text-center mb-6">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white">How will you use EcoLogic?</h2>
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => handleRoleSelect("owner")}
                    className="w-full p-4 border-2 rounded-xl hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-left flex items-center gap-4"
                  >
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                      <Building2 className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-800 dark:text-white">I own or manage a company</p>
                      <p className="text-sm text-slate-500">Set up your business on EcoLogic</p>
                    </div>
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => handleRoleSelect("employee")}
                    className="w-full p-4 border-2 rounded-xl hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-left flex items-center gap-4"
                  >
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                      <Users className="w-6 h-6 text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-800 dark:text-white">I'm an employee</p>
                      <p className="text-sm text-slate-500">Join your team with an invite code</p>
                    </div>
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => goToStep("role-help")}
                    className="w-full text-center text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mt-2"
                  >
                    <HelpCircle className="w-4 h-4 inline mr-1" />
                    Not sure yet
                  </button>
                </div>
              )}
              
              {step === "role-help" && (
                <div className="space-y-4 text-center">
                  <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto">
                    <HelpCircle className="w-8 h-8 text-blue-600" />
                  </div>
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Need help deciding?</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    EcoLogic is built for companies and their teams. If you received an invite code from your manager, choose "I'm an employee." Otherwise, set up your company.
                  </p>
                  <div className="flex flex-col gap-2 pt-4">
                    <Button variant="outline" onClick={() => goToStep("role", "back")}>
                      Go back
                    </Button>
                    <a href="mailto:support@ecologic.app" className="text-sm text-blue-600 hover:underline">
                      Contact support
                    </a>
                  </div>
                </div>
              )}
              
              {step === "industry" && (
                <form onSubmit={handleIndustrySubmit} className="space-y-4">
                  <div className="text-center mb-4">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white">What industry are you in?</h2>
                  </div>
                  
                  <div className="space-y-2">
                    {INDUSTRIES.map((industry) => (
                      <button
                        key={industry.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, industry: industry.value })}
                        className={`w-full p-3 border-2 rounded-lg text-left transition-all flex items-center justify-between ${
                          formData.industry === industry.value
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                            : "hover:border-slate-300"
                        }`}
                      >
                        <span className="font-medium">{industry.label}</span>
                        {formData.industry === industry.value && <Check className="w-5 h-5 text-blue-600" />}
                      </button>
                    ))}
                  </div>
                  
                  {errors.industry && <p className="text-xs text-red-500 text-center">{errors.industry}</p>}
                  
                  <Button type="submit" className="w-full" disabled={!formData.industry}>
                    Continue
                  </Button>
                </form>
              )}
              
              {step === "company" && (
                <form onSubmit={handleCompanySubmit} className="space-y-4">
                  <div className="text-center mb-4">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Set up your company</h2>
                  </div>
                  
                  <div>
                    <Label htmlFor="companyName">Company Name</Label>
                    <Input
                      id="companyName"
                      value={formData.companyName}
                      onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                      placeholder="Your Company LLC"
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
                          onClick={() => setFormData({ ...formData, employeeRange: range.value })}
                          className={`p-3 border-2 rounded-lg text-sm font-medium transition-all ${
                            formData.employeeRange === range.value
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
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
                  </Button>
                </form>
              )}
              
              {step === "subscription" && (
                <div className="space-y-4 text-center">
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-white">You're all set!</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Start your free trial and explore all of EcoLogic's features.
                  </p>
                  
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/20 rounded-xl p-6 my-6">
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-400">FREE TRIAL</p>
                    <p className="text-3xl font-bold text-slate-800 dark:text-white mt-1">14 days free</p>
                    <ul className="text-sm text-slate-600 dark:text-slate-300 mt-4 space-y-2 text-left">
                      <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Unlimited jobs</li>
                      <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Team management</li>
                      <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Invoicing & payments</li>
                      <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> AI scheduling</li>
                    </ul>
                  </div>
                  
                  <Button onClick={handleStartTrial} className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Start Free Trial"}
                  </Button>
                </div>
              )}
              
              {step === "invite" && (
                <form onSubmit={handleInviteSubmit} className="space-y-4">
                  <div className="text-center mb-4">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Join your company</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Enter the invite code your manager gave you</p>
                  </div>
                  
                  <div>
                    <Label htmlFor="inviteCode">Invite Code</Label>
                    <Input
                      id="inviteCode"
                      value={formData.inviteCode}
                      onChange={(e) => setFormData({ ...formData, inviteCode: e.target.value.toUpperCase() })}
                      placeholder="XXXX-XXXX"
                      className={`text-center text-lg font-mono tracking-wider ${errors.inviteCode ? "border-red-500" : ""}`}
                    />
                    {errors.inviteCode && <p className="text-xs text-red-500 mt-1">{errors.inviteCode}</p>}
                  </div>
                  
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Join Company"}
                  </Button>
                </form>
              )}
            </StepTransition>
          </div>
        </div>
      </div>
    </div>
  );
}
