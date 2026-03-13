import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, AlertTriangle, X } from "lucide-react";

interface DeleteAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DeleteAccountModal({ open, onOpenChange }: DeleteAccountModalProps) {
  const { toast } = useToast();
  const [confirmText, setConfirmText] = useState("");

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/account");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete account");
      }
      return res.json();
    },
    onSuccess: () => {
      console.log("[delete-account] Success — clearing auth state and redirecting to login");
      // Wipe all cached queries so no stale auth/user/company state leaks through
      queryClient.clear();
      // Clear any onboarding-related localStorage that could trigger onboarding redirect
      localStorage.removeItem("onboardingChoice");
      localStorage.removeItem("onboardingIndustry");
      toast({
        title: "Account deleted",
        description: "Your account has been permanently deleted.",
      });
      // Hard navigation: reloads the page completely, destroying all React state
      window.location.href = "/login";
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleConfirm = () => {
    if (confirmText === "DELETE") {
      deleteAccountMutation.mutate();
    }
  };

  const handleClose = () => {
    setConfirmText("");
    onOpenChange(false);
  };

  const isConfirmEnabled = confirmText === "DELETE" && !deleteAccountMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" preventAutoFocus hideCloseButton>
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <DialogTitle className="text-base font-semibold text-red-600 dark:text-red-500">
              Delete Account
            </DialogTitle>
          </div>
          <button 
            onClick={handleClose}
            disabled={deleteAccountMutation.isPending}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-white dark:bg-slate-900 px-4 py-4">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            This permanently deletes your account and signs you out.
          </p>

          <p className="text-sm text-slate-700 dark:text-slate-300 mb-3">
            Type <span className="font-bold text-red-600 dark:text-red-500">DELETE</span> to confirm:
          </p>

          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE"
            className="h-10 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-0"
            autoComplete="off"
            disabled={deleteAccountMutation.isPending}
          />
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800" />

        <div className="flex gap-3 p-4 bg-white dark:bg-slate-900">
          <Button 
            variant="outline" 
            onClick={handleClose}
            disabled={deleteAccountMutation.isPending}
            className="flex-1 h-11 rounded-xl border-slate-200 dark:border-slate-700"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!isConfirmEnabled}
            className="flex-1 h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
          >
            {deleteAccountMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Deleting...
              </>
            ) : (
              "Delete account"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
