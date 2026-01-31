import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Mail, Loader2 } from "lucide-react";
import { SiGoogle, SiApple } from "react-icons/si";
import logoImage from "@assets/IMG_6171 2_1749763982284.jpg";

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
  
  const handleGoogleAuth = () => {
    window.location.href = "/api/auth/google";
  };
  
  const handleAppleAuth = () => {
    window.location.href = "/api/auth/apple";
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
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div
          className="w-full max-w-md transition-all"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(12px)",
            transitionDuration: "300ms",
            transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <div className="text-center mb-8">
            <img 
              src={logoImage} 
              alt="EcoLogic" 
              className="w-20 h-20 mx-auto mb-6 rounded-2xl shadow-lg" 
            />
            <h1 className="text-3xl font-bold tracking-wide text-slate-800 dark:text-white mb-2">
              ECOLOGIC
            </h1>
            <p className="text-slate-500 dark:text-slate-400">
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
            
            <div className="space-y-3">
              <Button 
                variant="outline"
                onClick={handleGoogleAuth}
                className="w-full h-11 font-medium rounded-xl border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <SiGoogle className="w-5 h-5 mr-3" />
                Continue with Google
              </Button>
              
              <Button 
                variant="outline"
                onClick={handleAppleAuth}
                className="w-full h-11 font-medium rounded-xl border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <SiApple className="w-5 h-5 mr-3" />
                Continue with Apple
              </Button>
              
              <Button 
                variant="outline"
                onClick={() => setLocation("/signup")}
                className="w-full h-11 font-medium rounded-xl border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Mail className="w-5 h-5 mr-3" />
                Continue with Email
              </Button>
            </div>
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
