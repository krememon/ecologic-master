import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, Loader2, X } from "lucide-react";

interface ChangePasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail?: string;
}

export default function ChangePasswordModal({ open, onOpenChange, userEmail }: ChangePasswordModalProps) {
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendResetEmailMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/request-password-reset");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to send reset email");
      }
      return res.json();
    },
    onSuccess: () => {
      setEmailSent(true);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to send reset email. Please try again.");
    },
  });

  const handleSendEmail = () => {
    setError(null);
    sendResetEmailMutation.mutate();
  };

  const handleClose = () => {
    setEmailSent(false);
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-sm p-0 gap-0 overflow-hidden rounded-2xl" preventAutoFocus hideCloseButton>
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="min-w-[44px]" />
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {emailSent ? "Email Sent" : "Reset Password"}
          </DialogTitle>
          <button 
            onClick={handleClose} 
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 bg-white dark:bg-slate-900">
          {emailSent ? (
            /* Success State */
            <div className="text-center space-y-4">
              <div className="mx-auto w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="space-y-1">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Check your inbox at
                </p>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {userEmail}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
                  Link expires in 1 hour
                </p>
              </div>
              <Button 
                onClick={handleClose} 
                className="w-full h-11 rounded-xl font-medium"
              >
                Done
              </Button>
            </div>
          ) : (
            /* Send State */
            <div className="space-y-5">
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                We'll email you a secure link to set a new password.
              </p>
              
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Send reset link to
                </label>
                <div className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                    {userEmail}
                  </p>
                </div>
              </div>

              {error && (
                <div className="text-sm text-red-600 dark:text-red-400 text-center bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              
              <div className="flex gap-3 pt-1">
                <Button 
                  variant="outline" 
                  onClick={handleClose}
                  className="flex-1 h-11 rounded-xl font-medium"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleSendEmail}
                  disabled={sendResetEmailMutation.isPending}
                  className="flex-1 h-11 rounded-xl font-medium"
                >
                  {sendResetEmailMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Link"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
