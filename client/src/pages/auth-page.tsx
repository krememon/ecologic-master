import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn, Zap, Shield, Users, BarChart3 } from "lucide-react";
import { AuthHeader } from "@/components/AuthHeader";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function AuthPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      setLocation("/");
    }
  }, [isAuthenticated, isLoading, setLocation]);

  const handleLogin = () => {
    // Redirect to custom login page
    window.location.href = "/login";
  };

  if (isLoading || isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 p-4">
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        {/* Left Side - Auth Form */}
        <div className="flex justify-center">
          <Card className="w-full max-w-md shadow-2xl border-0 bg-white/80 backdrop-blur-sm dark:bg-slate-800/80">
            <CardHeader className="text-center pb-2">
              <AuthHeader />
            </CardHeader>
            <CardContent className="space-y-6">
              <Button
                onClick={handleLogin}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                <LogIn className="mr-2 h-5 w-5" />
                Sign In
              </Button>
              
              <p className="text-xs text-center text-slate-500 dark:text-slate-400">
                Continue to sign in
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right Side - Hero Section */}
        <div className="hidden lg:block space-y-8">
          <div className="text-center lg:text-left">
            <h1 className="text-4xl lg:text-5xl font-bold text-slate-800 dark:text-slate-100 leading-tight">
              Streamline Your
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-emerald-600">
                {" "}Contracting Business
              </span>
            </h1>
            <p className="text-xl text-slate-600 dark:text-slate-300 mt-6 leading-relaxed">
              AI-powered project management, intelligent scheduling, and comprehensive business operations in one powerful platform.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-slate-200/50 dark:border-slate-700/50">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-4">
                <Zap className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-2">AI-Powered Scheduling</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Optimize project timelines with intelligent resource allocation
              </p>
            </div>

            <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-slate-200/50 dark:border-slate-700/50">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center mb-4">
                <Users className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-2">Team Management</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Coordinate contractors and track project progress
              </p>
            </div>

            <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-slate-200/50 dark:border-slate-700/50">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center mb-4">
                <Shield className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-2">Secure Operations</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Role-based access control and encrypted data protection
              </p>
            </div>

            <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-slate-200/50 dark:border-slate-700/50">
              <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center mb-4">
                <BarChart3 className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-2">Business Analytics</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Real-time insights and performance tracking
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}