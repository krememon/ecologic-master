import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, ShieldCheck, KeyRound } from "lucide-react";
import { AuthHeader } from "@/components/AuthHeader";

export default function TwoFactor() {
  const [, setLocation] = useLocation();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [useBackupCode, setUseBackupCode] = useState(false);

  const verifyMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/auth/2fa/verify", { code });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Verification failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setLocation("/jobs");
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError("Please enter a code");
      return;
    }
    verifyMutation.mutate(code.trim());
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9a-zA-Z-]/g, "");
    setCode(value);
    setError(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-6">
          <AuthHeader />
          <div className="text-center mb-6">
            <div className="w-12 h-12 mx-auto bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-3">
              <ShieldCheck className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Two-Factor Authentication
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {useBackupCode 
                ? "Enter one of your backup codes"
                : "Enter the 6-digit code from your authenticator app"
              }
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text"
                inputMode={useBackupCode ? "text" : "numeric"}
                placeholder={useBackupCode ? "XXXX-XXXX" : "000000"}
                value={code}
                onChange={handleCodeChange}
                maxLength={useBackupCode ? 9 : 6}
                className="text-center text-lg tracking-widest font-mono h-12 rounded-xl"
                autoComplete="one-time-code"
              />
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={verifyMutation.isPending}
              className="w-full h-11 rounded-xl font-medium"
            >
              {verifyMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify"
              )}
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setUseBackupCode(!useBackupCode);
                setCode("");
                setError(null);
              }}
              className="flex items-center justify-center gap-2 w-full text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 transition-colors"
            >
              <KeyRound className="h-4 w-4" />
              {useBackupCode ? "Use authenticator code instead" : "Use a backup code"}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          Lost access to your authenticator?{" "}
          <a href="mailto:support@ecologic.app" className="text-blue-500 hover:underline">
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}
