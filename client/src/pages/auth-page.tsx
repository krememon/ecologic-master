import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, UserCheck, Shield } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
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
        {/* Left Side - Sign In Form */}
        <div className="flex justify-center">
          <Card className="w-full max-w-md shadow-2xl border-0 bg-white/80 backdrop-blur-sm dark:bg-slate-800/80">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 bg-gradient-to-br from-blue-500 to-emerald-500 rounded-2xl flex items-center justify-center mb-4">
                <Building2 className="h-8 w-8 text-white" />
              </div>
              <CardTitle className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                Welcome to EcoLogic
              </CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-300">
                Sign in to manage your contracting business
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Replit Authentication */}
              <Button
                onClick={() => window.location.href = "/api/login"}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                <Shield className="mr-2 h-5 w-5" />
                Continue with Replit
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-300 dark:border-slate-600" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white dark:bg-slate-800 px-2 text-slate-500 dark:text-slate-400">
                    Or continue with
                  </span>
                </div>
              </div>

              {/* Google Authentication */}
              <Button
                onClick={() => window.location.href = "/auth/google"}
                variant="outline"
                className="w-full h-12 border-2 border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
              >
                <FcGoogle className="mr-2 h-5 w-5" />
                Continue with Google
              </Button>

              <div className="text-center pt-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  By signing in, you agree to our Terms of Service and Privacy Policy
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Side - Hero Section */}
        <div className="text-center lg:text-left space-y-6 px-4">
          <div className="space-y-4">
            <h1 className="text-4xl lg:text-5xl font-bold text-slate-800 dark:text-slate-100 leading-tight">
              Streamline Your
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-emerald-600">
                Contracting Business
              </span>
            </h1>
            <p className="text-xl text-slate-600 dark:text-slate-300 leading-relaxed">
              Complete project management platform designed specifically for trade contractors. 
              Manage jobs, subcontractors, clients, and invoicing all in one place.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6">
            <div className="flex items-start space-x-3 p-4 bg-white/60 dark:bg-slate-800/60 rounded-lg backdrop-blur-sm">
              <UserCheck className="h-6 w-6 text-blue-500 mt-1 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Job Management</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Track projects from start to finish with AI-powered scheduling
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-4 bg-white/60 dark:bg-slate-800/60 rounded-lg backdrop-blur-sm">
              <Building2 className="h-6 w-6 text-emerald-500 mt-1 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Client Portal</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Keep clients informed with real-time project updates
                </p>
              </div>
            </div>
          </div>

          <div className="pt-6">
            <div className="inline-flex items-center space-x-2 text-sm text-slate-500 dark:text-slate-400">
              <Shield className="h-4 w-4" />
              <span>Secure, reliable, and built for contractors</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}