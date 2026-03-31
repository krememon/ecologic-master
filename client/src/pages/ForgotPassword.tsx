import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await apiRequest("POST", "/api/forgot-password", { email });

      if (response.ok) {
        setIsSubmitted(true);
        toast({
          title: "Reset Link Sent",
          description: "Check your email for password reset instructions",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to send reset link. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
        <div className="w-full max-w-md mx-auto p-8">
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
                We've sent password reset instructions to <strong>{email}</strong>. Check your inbox and follow the link to set a new password.
              </p>

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
            Reset your password
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            disabled={isLoading}
          >
            {isLoading ? "Sending Reset Link..." : "Send Reset Link"}
          </Button>

          <div className="text-center">
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
