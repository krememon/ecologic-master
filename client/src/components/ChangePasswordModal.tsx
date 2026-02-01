import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Mail, CheckCircle, Loader2 } from "lucide-react";

interface ChangePasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail?: string;
}

export default function ChangePasswordModal({ open, onOpenChange, userEmail }: ChangePasswordModalProps) {
  const { toast } = useToast();
  const [emailSent, setEmailSent] = useState(false);

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
      toast({
        title: "Email Sent",
        description: "Check your inbox for the password reset link.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send reset email. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSendEmail = () => {
    sendResetEmailMutation.mutate();
  };

  const handleClose = () => {
    setEmailSent(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            Change Password
          </DialogTitle>
          <DialogDescription>
            {emailSent 
              ? "We've sent a password reset link to your email."
              : "We'll send a password reset link to your email address."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {emailSent ? (
            <div className="text-center space-y-4">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">Email Sent!</p>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Check your inbox at <span className="font-medium">{userEmail}</span>
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                  The link will expire in 1 hour.
                </p>
              </div>
              <Button onClick={handleClose} className="w-full">
                Done
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  A password reset link will be sent to:
                </p>
                <p className="font-medium text-slate-900 dark:text-slate-100 mt-1">
                  {userEmail}
                </p>
              </div>
              
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  onClick={handleClose}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleSendEmail}
                  disabled={sendResetEmailMutation.isPending}
                  className="flex-1"
                >
                  {sendResetEmailMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
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
