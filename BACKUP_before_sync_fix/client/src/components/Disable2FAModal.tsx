import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, X, ShieldOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Disable2FAModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function Disable2FAModal({ open, onOpenChange }: Disable2FAModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const disableMutation = useMutation({
    mutationFn: async (codeOrBackupCode: string) => {
      const res = await apiRequest("POST", "/api/auth/2fa/disable", { code: codeOrBackupCode });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to disable 2FA");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/2fa/status"] });
      toast({ 
        title: "2FA Disabled", 
        description: "Two-factor authentication has been turned off." 
      });
      handleClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleClose = () => {
    setCode("");
    setError(null);
    onOpenChange(false);
  };

  const handleSubmit = () => {
    if (code.trim()) {
      disableMutation.mutate(code.trim());
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-sm p-0 gap-0 overflow-hidden rounded-2xl" preventAutoFocus hideCloseButton>
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="min-w-[44px]" />
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Disable Two-Factor Authentication?
          </DialogTitle>
          <button 
            onClick={handleClose} 
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-5 bg-white dark:bg-slate-900 space-y-4">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-3">
              <ShieldOff className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Enter your 6-digit authenticator code or a backup code to disable 2FA.
            </p>
          </div>

          <Input
            type="text"
            placeholder="Code or backup code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.trim()) {
                handleSubmit();
              }
            }}
            className="text-center text-lg tracking-widest font-mono h-12 rounded-xl"
            autoFocus
          />

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleClose}
              className="flex-1 h-11 rounded-xl"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSubmit}
              disabled={!code.trim() || disableMutation.isPending}
              className="flex-1 h-11 rounded-xl"
            >
              {disableMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Disabling...
                </>
              ) : (
                "Disable 2FA"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
