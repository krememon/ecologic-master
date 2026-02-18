import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Loader2, ArrowLeft } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { apiRequest, queryClient } from "@/lib/queryClient";

type WizardStep = "email" | "password" | "code";

async function safeParseJson(res: Response): Promise<any> {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  
  if (contentType.includes("application/json") && text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return null;
}

async function handleApiResponse(res: Response, defaultError: string): Promise<any> {
  const data = await safeParseJson(res);
  
  if (!res.ok) {
    throw new Error(data?.message || defaultError);
  }
  
  return data;
}

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
    setIsVisible(false);
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

export default function SignInWizard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [step, setStep] = useState<WizardStep>("email");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verificationCode, setVerificationCode] = useState<string[]>(["", "", "", "", "", ""]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  
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
    setError("");
  }, []);
  
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email");
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/login/start", { email });
      const data = await handleApiResponse(res, "We couldn't reach the server. Please try again.");
      
      if (data?.firstName) {
        setFirstName(data.firstName);
      }
      
      goToStep("password");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    if (!password) {
      setError("Password is required");
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/login/password", { email, password });
      await handleApiResponse(res, "We couldn't reach the server. Please try again.");
      
      setResendCooldown(30);
      goToStep("code");
    } catch (err: any) {
      setError(err.message);
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
  
  const isCodeComplete = () => verificationCode.every(d => d !== "");
  const getCodeString = () => verificationCode.join("");
  
  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    if (!isCodeComplete()) {
      setError("Enter the 6-digit code");
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/login/verify-code", {
        email,
        code: getCodeString(),
      });
      await handleApiResponse(res, "We couldn't reach the server. Please try again.");
      
      // Invalidate auth cache and force refresh
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      
      // Small delay to ensure session cookie is set, then redirect
      setTimeout(() => {
        window.location.href = "/";
      }, 100);
    } catch (err: any) {
      setError(err.message);
      setIsLoading(false);
    }
  };
  
  const handleResendCode = async () => {
    if (resendCooldown > 0) return;
    
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/login/resend-code", { email });
      await handleApiResponse(res, "We couldn't reach the server. Please try again.");
      
      setResendCooldown(30);
      setVerificationCode(["", "", "", "", "", ""]);
      toast({ title: "Code sent", description: "Check your email for the new code" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleBack = () => {
    if (step === "password") {
      goToStep("email", "back");
    } else if (step === "code") {
      goToStep("password", "back");
    }
  };
  
  const handleGoogleAuth = () => {
    window.location.href = "/api/auth/google";
  };
  
  const [isAppleLoading, setIsAppleLoading] = useState(false);
  const handleAppleAuth = async () => {
    setIsAppleLoading(true);
    try {
      const res = await fetch("/api/auth/apple/start");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast({ title: "Error", description: data.error || "Apple Sign-In is not available", variant: "destructive" });
        setIsAppleLoading(false);
      }
    } catch {
      toast({ title: "Error", description: "Failed to start Apple Sign-In", variant: "destructive" });
      setIsAppleLoading(false);
    }
  };
  
  const getStepNumber = () => {
    switch (step) {
      case "email": return 1;
      case "password": return 2;
      case "code": return 3;
    }
  };
  
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
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Professional contractor management
            </p>
          </div>
          
          <div className="mb-6">
            <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${(getStepNumber() / 3) * 100}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
              Step {getStepNumber()} of 3
            </p>
          </div>
          
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 min-h-[320px]">
            {step !== "email" && (
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
              {step === "email" && (
                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className={error ? "border-red-500" : ""}
                    />
                    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                  </div>
                  
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
                  </Button>
                  
                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200 dark:border-slate-700" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-white dark:bg-slate-800 px-3 text-slate-500">or</span>
                    </div>
                  </div>
                  
                  <Button 
                    type="button"
                    variant="outline"
                    onClick={handleGoogleAuth}
                    className="w-full"
                  >
                    <SiGoogle className="w-4 h-4 mr-2" />
                    Continue with Google
                  </Button>
                  
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAppleAuth}
                    disabled={isAppleLoading}
                    className="w-full"
                  >
                    {isAppleLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                      </svg>
                    )}
                    Continue with Apple
                  </Button>
                  
                  <p className="text-xs text-center text-slate-500 mt-4">
                    Don't have an account?{" "}
                    <a href="/signup" className="text-blue-600 hover:underline">Create account</a>
                  </p>
                </form>
              )}
              
              {step === "password" && (
                <form onSubmit={handlePasswordSubmit} className="space-y-4">
                  <div className="text-center mb-4">
                    {firstName && (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Welcome back, {firstName}
                      </p>
                    )}
                  </div>
                  
                  <div>
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={error ? "border-red-500 pr-10" : "pr-10"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                  </div>
                  
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
                  </Button>
                  
                  <p className="text-xs text-center text-slate-500">
                    <a href="/forgot-password" className="text-blue-600 hover:underline">
                      Forgot password?
                    </a>
                  </p>
                </form>
              )}
              
              {step === "code" && (
                <form onSubmit={handleCodeSubmit} className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Check your email</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      We sent a 6-digit code to <span className="font-medium">{email}</span>
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
                        className="w-11 h-12 text-center text-xl font-mono border rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-blue-600 dark:bg-slate-700 dark:border-slate-600"
                      />
                    ))}
                  </div>
                  
                  {error && <p className="text-xs text-red-500 text-center">{error}</p>}
                  
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
            </StepTransition>
          </div>
        </div>
      </div>
    </div>
  );
}
