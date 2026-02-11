import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AuthHeader } from "@/components/AuthHeader";
import { apiRequest } from "@/lib/queryClient";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await apiRequest("POST", "/api/forgot-password", { email });
      
      if (response.ok) {
        const data = await response.json();
        setIsSubmitted(true);
        
        // In development, show the reset token
        if (data.resetToken) {
          setResetToken(data.resetToken);
          toast({
            title: "Reset Link Generated",
            description: "Development mode: Reset token shown below",
          });
        } else {
          toast({
            title: "Reset Link Sent",
            description: "Check your email for password reset instructions",
          });
        }
      } else {
        toast({
          title: "Error",
          description: "Failed to send reset link. Please try again.",
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
        <div className="w-full max-w-md mx-auto p-8">
          <AuthHeader />

          <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-4 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                Reset Link Sent
              </h2>
              
              <p className="text-slate-600 dark:text-slate-400 text-sm mb-6">
                We've sent password reset instructions to <strong>{email}</strong>
              </p>

              {resetToken && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
                  <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                    Development Mode - Reset Token:
                  </h3>
                  <code className="text-xs bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-1 rounded break-all">
                    {resetToken}
                  </code>
                  <div className="mt-3">
                    <Button
                      onClick={() => window.location.href = `/reset-password?token=${resetToken}`}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Reset Password Now
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <Button
                  onClick={() => setIsSubmitted(false)}
                  variant="outline"
                  className="w-full"
                >
                  Try Different Email
                </Button>
                
                <Button
                  onClick={() => window.location.href = "/"}
                  variant="ghost"
                  className="w-full"
                >
                  Back to Sign In
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
      <div className="w-full max-w-md mx-auto p-8">
        <AuthHeader />

        {/* Forgot Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
              Password Reset for All Account Types
            </h3>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              This works for accounts created with email/password, Replit, or Google. 
              You'll be able to set up email/password authentication for social accounts.
            </p>
          </div>

          <div>
            <Label htmlFor="email" className="text-sm">Email Address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1"
              placeholder="Enter your email address"
              required
            />
          </div>

          <Button 
            type="submit" 
            className="w-full bg-blue-500 hover:bg-blue-600 text-white"
            disabled={isLoading}
          >
            {isLoading ? "Sending Reset Link..." : "Send Reset Link"}
          </Button>

          <div className="text-center space-y-2">
            <button
              type="button"
              onClick={() => window.location.href = "/"}
              className="text-sm text-blue-600 hover:text-blue-700 underline focus:outline-none"
            >
              Back to Sign In
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}