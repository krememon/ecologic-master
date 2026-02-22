import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff } from "lucide-react";
import logoImage from "@assets/IMG_6171 2_1749763982284.jpg";
import { apiRequest } from "@/lib/queryClient";

export default function Landing() {
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: ""
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  // Handle URL parameters for OAuth errors
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');
    const message = urlParams.get('message');

    if (error && message) {
      let title = "Sign In Error";
      
      switch (error) {
        case 'token_expired':
          title = "Session Expired";
          break;
        case 'account_creation_failed':
          title = "Account Creation Failed";
          break;
        case 'account_processing_failed':
          title = "Account Processing Failed";
          break;
        case 'auth_error':
          title = "Authentication Error";
          break;
        case 'google_auth_failed':
          title = "Google Sign In Failed";
          break;
        case 'account_exists_email_only':
          title = "Account Already Exists";
          break;
      }
      
      toast({
        title: title,
        description: decodeURIComponent(message),
        variant: "destructive",
      });
      
      // Clear URL parameters
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [toast]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrors({});

    try {
      // Login request - this will throw if credentials are invalid
      await apiRequest("POST", "/api/login/email", formData);
      
      // Login successful - now fetch user data to check company status
      let userData;
      try {
        const userResponse = await apiRequest("GET", "/api/auth/user");
        userData = await userResponse.json();
      } catch (fetchError: any) {
        // If we can't fetch user data after successful login, show error and return
        setErrors({
          general: "Login successful but unable to load your profile. Please try refreshing the page."
        });
        return;
      }
      
      // Validate user data has expected structure
      if (!userData || typeof userData !== 'object' || !('id' in userData)) {
        setErrors({
          general: "Received invalid profile data. Please try refreshing the page."
        });
        return;
      }
      
      // Show success toast
      toast({
        title: "Welcome back!",
        description: "You're now logged in.",
      });
      
      // Redirect based on company status (company can be null or an object)
      if (userData.company) {
        window.location.href = "/";
      } else {
        window.location.href = "/join-company";
      }
    } catch (error: any) {
      // Parse error message to show appropriate feedback
      const errorMessage = error?.message || "";
      
      if (errorMessage.includes("401") || errorMessage.includes("Invalid") || errorMessage.includes("password")) {
        setErrors({ 
          general: "Invalid email or password. Please check your credentials and try again." 
        });
      } else if (errorMessage.includes("ACCOUNT_INACTIVE") || errorMessage.includes("deactivated")) {
        setErrors({
          general: "Your account is deactivated. Please contact your company Owner or Supervisor."
        });
      } else {
        setErrors({ 
          general: "Login failed. Please try again." 
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
    // Clear errors when user starts typing
    if (errors[e.target.name] || errors.general) {
      setErrors({});
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
      <div className="w-full max-w-sm mx-auto p-8">
        
        {/* Logo and Branding */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full overflow-hidden bg-white shadow-lg">
            <img 
              src={logoImage} 
              alt="EcoLogic Logo" 
              className="w-full h-full object-cover"
            />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white mb-2 tracking-wider uppercase">
            EcoLogic
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            Construction Management Platform
          </p>
        </div>

        {/* Sign In Options */}
        <div className="space-y-4">
          <Button 
            onClick={() => window.location.href = "/register"}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            Create Account
          </Button>

          {/* Email/Password Login Toggle */}
          <div className="space-y-3">
            <Button 
              type="button"
              onClick={() => setShowEmailLogin(!showEmailLogin)}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white"
            >
              {showEmailLogin ? "Hide" : "Sign In with Email"}
            </Button>

            {/* Email/Password Login Form */}
            {showEmailLogin && (
              <form onSubmit={handleEmailLogin} className="space-y-3 p-4 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
                {errors.general && (
                  <div className="text-red-500 text-sm text-center p-2 bg-red-50 dark:bg-red-900/20 rounded">
                    {errors.general}
                  </div>
                )}
                
                <div>
                  <Label htmlFor="email" className="text-sm">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="mt-1"
                    required
                  />
                </div>
                
                <div>
                  <Label htmlFor="password" className="text-sm">Password</Label>
                  <div className="relative mt-1">
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={formData.password}
                      onChange={handleInputChange}
                      className="pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <Button 
                  type="submit" 
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={isLoading}
                >
                  {isLoading ? "Signing In..." : "Sign In"}
                </Button>

                <div className="text-center mt-3">
                  <button
                    type="button"
                    onClick={() => window.location.href = "/forgot-password"}
                    className="text-sm text-blue-600 hover:text-blue-700 underline focus:outline-none"
                  >
                    Forgot Password?
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Google Login Option */}
          <div className="space-y-2">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-slate-50 dark:bg-slate-900 text-gray-500">Or continue with</span>
              </div>
            </div>
            
            <Button 
              onClick={async () => {
                const { isNativePlatform, getApiBaseUrl, openSystemBrowser } = await import("@/lib/capacitor");
                if (isNativePlatform()) {
                  await openSystemBrowser(`${getApiBaseUrl()}/api/auth/google?platform=ios`);
                } else {
                  window.location.href = "/api/auth/google";
                }
              }}
              className="w-full bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 flex items-center justify-center space-x-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span>Sign In with Google</span>
            </Button>
          </div>
        </div>
        
        <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-4">
          Secure authentication
        </p>
      </div>
    </div>
  );
}