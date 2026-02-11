import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthHeader } from "@/components/AuthHeader";
import { apiRequest } from "@/lib/queryClient";
import type { UserRole } from "@shared/schema";
import { formatPhoneInput, getRawPhoneValue, validatePhone } from "@shared/phoneUtils";

export default function Auth() {
  const [step, setStep] = useState<'user-info' | 'company-setup' | 'join-company'>('user-info');
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    firstName: "",
    lastName: "",
    role: "TECHNICIAN" as UserRole,
    phone: "",
    inviteCode: "",
    company: {
      name: "",
      email: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "US"
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [emailAvailability, setEmailAvailability] = useState<'checking' | 'available' | 'taken' | null>(null);
  const { toast } = useToast();

  // Debounced email availability check
  useEffect(() => {
    const checkEmailAvailability = async () => {
      if (!formData.email || formData.email.length < 3) {
        setEmailAvailability(null);
        return;
      }

      // Basic email format validation
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
        setEmailAvailability(null);
        return;
      }

      setEmailAvailability('checking');

      try {
        const response = await fetch(`/api/auth/email-available?email=${encodeURIComponent(formData.email)}`);
        const data = await response.json();
        
        if (data.available) {
          setEmailAvailability('available');
          // Clear email error if it was about availability
          if (errors.email === "This email is currently in use") {
            setErrors(prev => {
              const newErrors = { ...prev };
              delete newErrors.email;
              return newErrors;
            });
          }
        } else {
          setEmailAvailability('taken');
          setErrors(prev => ({ ...prev, email: "This email is currently in use" }));
        }
      } catch (error) {
        console.error("Email availability check failed:", error);
        setEmailAvailability(null);
      }
    };

    const timeoutId = setTimeout(checkEmailAvailability, 500); // 500ms debounce
    return () => clearTimeout(timeoutId);
  }, [formData.email]);

  // Password strength calculation
  const getPasswordStrength = (password: string) => {
    if (!password) return { level: 0, text: "", color: "" };
    
    let score = 0;
    
    // Length
    if (password.length >= 8) score += 2;
    else if (password.length >= 6) score += 1;
    
    // Character variety
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    
    if (score <= 2) return { level: 1, text: "Weak", color: "text-red-500", bg: "bg-red-500" };
    if (score <= 4) return { level: 2, text: "Medium", color: "text-yellow-500", bg: "bg-yellow-500" };
    return { level: 3, text: "Strong", color: "text-green-500", bg: "bg-green-500" };
  };

  const passwordStrength = getPasswordStrength(formData.password);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = "First name is required";
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = "Last name is required";
    }

    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email";
    } else if (emailAvailability === 'taken') {
      newErrors.email = "This email is currently in use";
    }

    if (formData.phone && !validatePhone(formData.phone)) {
      newErrors.phone = "Please enter a valid phone number";
    }

    if (!formData.password) {
      newErrors.password = "Password is required";
    } else if (formData.password.length < 6) {
      newErrors.password = "Password must be at least 6 characters";
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = "Please confirm your password";
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords don't match";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleUserInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Block submit if email is being checked or is taken
    if (emailAvailability === 'checking') {
      toast({
        title: "Please wait",
        description: "Checking email availability...",
        variant: "default"
      });
      return;
    }

    if (emailAvailability === 'taken') {
      setErrors(prev => ({ ...prev, email: "This email is currently in use" }));
      return;
    }

    if (!validateForm()) {
      return;
    }

    // Proceed to next step based on role
    if (formData.role === "OWNER") {
      setStep('company-setup');
    } else {
      setStep('join-company');
    }
  };

  const handleOwnerRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: Record<string, string> = {};
    if (!formData.company.name.trim()) {
      newErrors.companyName = "Company name is required";
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      const response = await apiRequest("POST", "/api/register/owner", {
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: getRawPhoneValue(formData.phone),
        company: formData.company
      });

      if (response.ok) {
        toast({
          title: "Company created successfully!",
          description: "Your Company Code is available under Settings → Company Info.",
        });
        window.location.href = "/";
      } else {
        let errorData: any = null;
        let errorMessage = "Failed to create account";
        
        try {
          errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
          try {
            errorMessage = await response.text();
          } catch {
            // Keep default message
          }
        }

        // Handle 409 EMAIL_IN_USE error with inline error message
        if (response.status === 409 && (errorData?.code === 'EMAIL_IN_USE' || errorMessage.includes("already in use") || errorMessage.includes("currently in use"))) {
          setErrors({ 
            email: "This email is currently in use"
          });
          // Go back to user info step to show the error
          setStep('user-info');
        } else {
          setErrors({ general: errorMessage });
        }
      }
    } catch (error) {
      console.error("Registration error:", error);
      setErrors({ general: "An error occurred during registration" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMemberRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: Record<string, string> = {};
    if (!formData.inviteCode.trim()) {
      newErrors.inviteCode = "Company code is required";
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      const response = await apiRequest("POST", "/api/register/member", {
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: getRawPhoneValue(formData.phone),
        role: formData.role,
        inviteCode: formData.inviteCode
      });

      if (response.ok) {
        toast({
          title: "Joined company successfully!",
          description: "Welcome to EcoLogic. You're now logged in.",
        });
        window.location.href = "/";
      } else {
        let errorData: any = null;
        let errorMessage = "Failed to join company";
        
        try {
          errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
          try {
            errorMessage = await response.text();
          } catch {
            // Keep default message
          }
        }

        // Handle 409 EMAIL_IN_USE error with inline error message
        if (response.status === 409 && (errorData?.code === 'EMAIL_IN_USE' || errorMessage.includes("already in use") || errorMessage.includes("currently in use"))) {
          setErrors({ 
            email: "This email is currently in use"
          });
          // Go back to user info step to show the error
          setStep('user-info');
        } else {
          setErrors({ general: errorMessage });
          toast({
            title: "Registration failed",
            description: errorMessage,
            variant: "destructive"
          });
        }
      }
    } catch (error) {
      // Only show toast for unexpected errors, not duplicate email
      const errorMessage = error instanceof Error ? error.message : "Something went wrong. Please try again.";
      if (!errorMessage.includes("already exists") && !errorMessage.includes("already in use")) {
        toast({
          title: "Registration failed",
          description: errorMessage,
          variant: "destructive"
        });
      }
      setErrors({ general: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
    // Clear error when user starts typing
    if (errors[e.target.name]) {
      setErrors(prev => ({
        ...prev,
        [e.target.name]: ""
      }));
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneInput(e.target.value);
    setFormData(prev => ({
      ...prev,
      phone: formatted
    }));
    // Clear error when user starts typing
    if (errors.phone) {
      setErrors(prev => ({
        ...prev,
        phone: ""
      }));
    }
  };

  const handleGoogleSignIn = () => {
    try {
      setIsGoogleLoading(true);
      // Redirect to Google OAuth endpoint
      window.location.href = "/auth/google";
    } catch (error) {
      console.error("Google sign-in error:", error);
      setIsGoogleLoading(false);
      toast({
        title: "Sign In Failed",
        description: "Unable to start Google sign-in. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
      <div className="w-full max-w-md mx-auto p-8">
        
        <AuthHeader />

        {/* Registration Form */}
        <form onSubmit={
          step === 'user-info' ? handleUserInfoSubmit :
          step === 'company-setup' ? handleOwnerRegistration :
          handleMemberRegistration
        } className="space-y-4">
          {/* Duplicate Email Error Message */}
          {errors.general && errors.general.includes("already exists") && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    Account Already Exists
                  </h3>
                  <div className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                    An account with this email already exists. Try logging in instead.
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => window.location.href = "/"}
                      className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                    >
                      Go to Sign In Page
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Other General Errors */}
          {errors.general && !errors.general.includes("already exists") && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                    Registration Error
                  </h3>
                  <div className="mt-1 text-sm text-red-700 dark:text-red-300">
                    {errors.general}
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* Step: User Info */}
          {step === 'user-info' && (
            <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                name="firstName"
                type="text"
                value={formData.firstName}
                onChange={handleInputChange}
                className={errors.firstName ? "border-red-500" : ""}
                required
              />
              {errors.firstName && (
                <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>
              )}
            </div>
            <div>
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                name="lastName"
                type="text"
                value={formData.lastName}
                onChange={handleInputChange}
                className={errors.lastName ? "border-red-500" : ""}
                required
              />
              {errors.lastName && (
                <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>
              )}
            </div>
          </div>
          
          <div>
            <Label htmlFor="role">Role</Label>
            <Select 
              value={formData.role} 
              onValueChange={(value: UserRole) => setFormData(prev => ({ ...prev, role: value }))}
            >
              <SelectTrigger data-testid="select-role">
                <SelectValue placeholder="Select your role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OWNER" data-testid="option-owner">Owner</SelectItem>
                <SelectItem value="SUPERVISOR" data-testid="option-supervisor">Supervisor</SelectItem>
                <SelectItem value="TECHNICIAN" data-testid="option-technician">Technician</SelectItem>
                <SelectItem value="DISPATCHER" data-testid="option-dispatcher">Dispatcher</SelectItem>
                <SelectItem value="ESTIMATOR" data-testid="option-estimator">Estimator</SelectItem>
              </SelectContent>
            </Select>
            {errors.role && (
              <p className="text-red-500 text-xs mt-1">{errors.role}</p>
            )}
          </div>
          
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleInputChange}
              className={errors.email ? "border-red-500" : ""}
              required
            />
            {errors.email && (
              <p className="text-red-500 text-xs mt-1">{errors.email}</p>
            )}
          </div>

          <div>
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              name="phone"
              placeholder="555-123-4567"
              value={formData.phone}
              onChange={handlePhoneChange}
              inputMode="numeric"
              autoComplete="tel"
              className={errors.phone ? "border-red-500" : ""}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Used for scheduling and notifications
            </p>
            {errors.phone && (
              <p className="text-red-500 text-xs mt-1">{errors.phone}</p>
            )}
          </div>
          
          <div>
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={formData.password}
                onChange={handleInputChange}
                className={`pr-10 ${errors.password ? "border-red-500" : ""}`}
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
            
            {/* Password Strength Meter */}
            {formData.password && (
              <div className="mt-2 space-y-1">
                <div className="flex space-x-1">
                  <div className={`h-1 w-1/3 rounded ${passwordStrength.level >= 1 ? passwordStrength.bg : 'bg-gray-200'}`}></div>
                  <div className={`h-1 w-1/3 rounded ${passwordStrength.level >= 2 ? passwordStrength.bg : 'bg-gray-200'}`}></div>
                  <div className={`h-1 w-1/3 rounded ${passwordStrength.level >= 3 ? passwordStrength.bg : 'bg-gray-200'}`}></div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs">
                    {passwordStrength.level === 1 && "🔴"}
                    {passwordStrength.level === 2 && "🟡"}
                    {passwordStrength.level === 3 && "🟢"}
                  </span>
                  <span className={`text-xs font-medium ${passwordStrength.color}`}>
                    {passwordStrength.text}
                  </span>
                </div>
              </div>
            )}
            
            {errors.password && (
              <p className="text-red-500 text-xs mt-1">{errors.password}</p>
            )}
          </div>
          
          <div>
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                value={formData.confirmPassword}
                onChange={handleInputChange}
                className={`pr-10 ${errors.confirmPassword ? "border-red-500" : ""}`}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="text-red-500 text-xs mt-1">{errors.confirmPassword}</p>
            )}
          </div>

          <Button 
            type="submit" 
            className="w-full bg-blue-500 hover:bg-blue-600 text-white"
            disabled={isLoading || emailAvailability === 'checking' || emailAvailability === 'taken'}
            data-testid="button-continue"
          >
            {isLoading ? "Creating Account..." : emailAvailability === 'checking' ? "Checking..." : step === 'user-info' ? "Continue" : "Create Account"}
          </Button>
            </>
          )}

          {/* Step: Company Setup (Owner) */}
          {step === 'company-setup' && (
            <>
              <div>
                <Label htmlFor="companyName">Company Name *</Label>
                <Input
                  id="companyName"
                  value={formData.company.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, company: { ...prev.company, name: e.target.value } }))}
                  className={errors.companyName ? "border-red-500" : ""}
                  required
                />
                {errors.companyName && <p className="text-red-500 text-xs mt-1">{errors.companyName}</p>}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="companyEmail">Email</Label>
                  <Input
                    id="companyEmail"
                    type="email"
                    value={formData.company.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, company: { ...prev.company, email: e.target.value } }))}
                  />
                </div>
                <div>
                  <Label htmlFor="companyPhone">Phone</Label>
                  <Input
                    id="companyPhone"
                    value={formData.company.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, company: { ...prev.company, phone: e.target.value } }))}
                  />
                </div>
              </div>

              <div className="flex gap-4">
                <Button type="button" variant="outline" onClick={() => setStep('user-info')}>Back</Button>
                <Button type="submit" className="flex-1 bg-blue-500 hover:bg-blue-600 text-white" disabled={isLoading}>
                  {isLoading ? "Creating Company..." : "Create Company"}
                </Button>
              </div>
            </>
          )}

          {/* Step: Join Company (Member) */}
          {step === 'join-company' && (
            <>
              <div>
                <Label htmlFor="inviteCode">Company Code *</Label>
                <Input
                  id="inviteCode"
                  name="inviteCode"
                  value={formData.inviteCode}
                  onChange={handleInputChange}
                  className={errors.inviteCode ? "border-red-500" : ""}
                  placeholder="Enter company invite code"
                  required
                />
                {errors.inviteCode && <p className="text-red-500 text-xs mt-1">{errors.inviteCode}</p>}
                <p className="text-sm text-gray-500 mt-1">Ask your company owner for the invite code</p>
              </div>

              <div className="flex gap-4">
                <Button type="button" variant="outline" onClick={() => setStep('user-info')}>Back</Button>
                <Button type="submit" className="flex-1 bg-blue-500 hover:bg-blue-600 text-white" disabled={isLoading}>
                  {isLoading ? "Joining Company..." : "Join Company"}
                </Button>
              </div>
            </>
          )}
        </form>

        {/* Back to Sign In */}
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => window.location.href = "/"}
            className="text-sm text-blue-500 hover:text-blue-600"
          >
            Already have an account? Sign in
          </button>
        </div>

        {/* Social Auth Options */}
        <div className="mt-6 space-y-3">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-slate-50 dark:bg-slate-900 text-gray-500">Or continue with</span>
            </div>
          </div>
          
          <Button 
            type="button"
            onClick={() => window.location.href = "/login"}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white"
          >
            Back to Sign In
          </Button>
          
          <Button 
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isGoogleLoading || isLoading}
            className="w-full bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGoogleLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Signing in with Google...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span>Sign In with Google</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}