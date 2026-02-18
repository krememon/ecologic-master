import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";

export default function Welcome() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      setLocation("/");
    }
  }, [isAuthenticated, isLoading, setLocation]);
  
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);
  
  const { toast } = useToast();
  const [appleLoading, setAppleLoading] = useState(false);

  const handleGoogleAuth = () => {
    window.location.href = "/api/auth/google";
  };

  const handleAppleAuth = async () => {
    setAppleLoading(true);
    try {
      const res = await fetch("/api/auth/apple/start");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No URL returned");
      }
    } catch {
      toast({ title: "Apple Sign-In failed. Please try again.", variant: "destructive" });
      setAppleLoading(false);
    }
  };
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }
  
  if (isAuthenticated) {
    return null;
  }
  
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 overflow-auto">
      <div 
        className="flex-1 flex flex-col items-center justify-center px-6"
        style={{ 
          minHeight: "100vh",
          transform: "translateY(clamp(10px, 2vh, 28px))"
        }}
      >
        <div
          className="w-full max-w-md transition-all"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(12px)",
            transitionDuration: "300ms",
            transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <div className="text-center mb-5">
            <h1 
              className="text-5xl md:text-6xl mx-auto"
              style={{
                fontFamily: "'Plus Jakarta Sans', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
                fontWeight: 800,
                letterSpacing: "-0.02em",
                lineHeight: 1.05,
                marginBottom: "-2px",
                color: "#0B0B0D",
              }}
            >
              EcoLogic
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm font-light mt-1">
              Professional contractor management
            </p>
          </div>
          
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 space-y-4">
            <Button 
              onClick={() => setLocation("/signup")}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl"
            >
              Create account
            </Button>
            
            <Button 
              variant="outline"
              onClick={() => setLocation("/login")}
              className="w-full h-12 font-medium rounded-xl border-slate-200 dark:border-slate-700"
            >
              Sign in
            </Button>
            
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-700" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white dark:bg-slate-800 px-4 text-slate-500 dark:text-slate-400">
                  or continue with
                </span>
              </div>
            </div>
            
            <Button 
              variant="outline"
              onClick={handleGoogleAuth}
              className="w-full h-11 font-medium rounded-xl border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <SiGoogle className="w-5 h-5 mr-3" />
              Continue with Google
            </Button>

            <Button
              onClick={handleAppleAuth}
              disabled={appleLoading}
              className="w-full h-11 font-medium rounded-xl text-white mt-3"
              style={{ backgroundColor: appleLoading ? '#333' : '#000' }}
              onMouseEnter={(e) => { if (!appleLoading) e.currentTarget.style.backgroundColor = '#111'; }}
              onMouseLeave={(e) => { if (!appleLoading) e.currentTarget.style.backgroundColor = '#000'; }}
            >
              {appleLoading ? (
                <Loader2 className="w-5 h-5 mr-3 animate-spin" />
              ) : (
                <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
              )}
              Continue with Apple
            </Button>
          </div>
          
          <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-6">
            By continuing, you agree to our{" "}
            <a href="/terms" className="text-blue-600 hover:underline">Terms of Service</a>
            {" "}and{" "}
            <a href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
}
