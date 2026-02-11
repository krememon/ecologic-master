import { useState } from "react";
import { useLocation } from "wouter";
import { Building2, Users, HelpCircle, LogOut, Loader2 } from "lucide-react";
import logoImage from "@assets/IMG_6171 2_1749763982284.jpg";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function OnboardingChoice() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChoice = async (choice: "owner" | "employee") => {
    setIsSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/auth/onboarding-choice", { choice });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to save choice");
      }
      
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      
      if (choice === "owner") {
        setLocation("/onboarding/industry");
      } else {
        setLocation("/join-company");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save your choice",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/logout", {});
      localStorage.removeItem("onboardingChoice");
      localStorage.removeItem("onboardingIndustry");
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

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img src={logoImage} alt="EcoLogic" className="w-16 h-16 mx-auto mb-4 rounded-xl" />
            <h1 className="text-2xl font-bold tracking-wide text-slate-800 dark:text-white">
              ECOLOGIC
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Welcome! Let's get you set up</p>
          </div>
          
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6">
            <div className="space-y-4">
              <div className="text-center mb-6">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-white">How will you use EcoLogic?</h2>
              </div>
              
              <button
                type="button"
                onClick={() => handleChoice("owner")}
                disabled={isSubmitting}
                className="w-full p-4 border-2 rounded-xl hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-left flex items-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  {isSubmitting ? (
                    <Loader2 className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin" />
                  ) : (
                    <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-slate-800 dark:text-white">I'm a business owner</p>
                  <p className="text-sm text-slate-500">Set up my company on EcoLogic</p>
                </div>
              </button>
              
              <button
                type="button"
                onClick={() => handleChoice("employee")}
                disabled={isSubmitting}
                className="w-full p-4 border-2 rounded-xl hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-left flex items-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                  {isSubmitting ? (
                    <Loader2 className="w-6 h-6 text-green-600 dark:text-green-400 animate-spin" />
                  ) : (
                    <Users className="w-6 h-6 text-green-600 dark:text-green-400" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-slate-800 dark:text-white">I'm an employee</p>
                  <p className="text-sm text-slate-500">Join your team with an invite code</p>
                </div>
              </button>
              
              <div className="flex items-center gap-2 text-xs text-slate-400 pt-4">
                <HelpCircle className="w-4 h-4" />
                <span>
                  If you received an invite code from your manager, choose "I'm an employee."
                </span>
              </div>
            </div>
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
