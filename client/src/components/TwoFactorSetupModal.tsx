import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, X, Copy, CheckCircle, ShieldCheck, ShieldOff, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TwoFactorSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isEnabled: boolean;
}

type Step = "initial" | "setup" | "confirm" | "backup" | "disable";

export default function TwoFactorSetupModal({ open, onOpenChange, isEnabled }: TwoFactorSetupModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(isEnabled ? "initial" : "setup");
  const [qrCode, setQrCode] = useState<string>("");
  const [manualKey, setManualKey] = useState<string>("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [savedBackupCodes, setSavedBackupCodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const startSetupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/setup/start");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to start setup");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setQrCode(data.qrCodeDataUrl);
      setManualKey(data.manualKey);
      setStep("confirm");
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const confirmSetupMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/auth/2fa/setup/confirm", { code });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Invalid code");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setStep("backup");
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/auth/2fa/disable", { code });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to disable 2FA");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/2fa/status"] });
      toast({ title: "2FA Disabled", description: "Two-factor authentication has been turned off." });
      handleClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const regenerateBackupMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/auth/2fa/backup/regenerate", { code });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to regenerate backup codes");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setSavedBackupCodes(false);
      setCode("");
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleClose = () => {
    setStep(isEnabled ? "initial" : "setup");
    setQrCode("");
    setManualKey("");
    setCode("");
    setBackupCodes([]);
    setSavedBackupCodes(false);
    setError(null);
    setCopied(false);
    onOpenChange(false);
  };

  const handleFinish = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/auth/2fa/status"] });
    handleClose();
  };

  const copyManualKey = async () => {
    await navigator.clipboard.writeText(manualKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyBackupCodes = async () => {
    await navigator.clipboard.writeText(backupCodes.join("\n"));
    toast({ title: "Copied", description: "Backup codes copied to clipboard" });
  };

  const renderStep = () => {
    switch (step) {
      case "initial":
        return (
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-3">
                <ShieldCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Two-factor authentication is currently enabled on your account.
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setStep("confirm");
                  setBackupCodes([]);
                }}
                className="flex-1 h-11 rounded-xl"
              >
                <KeyRound className="h-4 w-4 mr-2" />
                Regenerate Codes
              </Button>
              <Button
                variant="destructive"
                onClick={() => setStep("disable")}
                className="flex-1 h-11 rounded-xl"
              >
                <ShieldOff className="h-4 w-4 mr-2" />
                Disable 2FA
              </Button>
            </div>
          </div>
        );

      case "setup":
        return (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
              Add an extra layer of security to your account using an authenticator app.
            </p>
            <Button
              onClick={() => startSetupMutation.mutate()}
              disabled={startSetupMutation.isPending}
              className="w-full h-11 rounded-xl font-medium"
            >
              {startSetupMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Setting up...
                </>
              ) : (
                "Set Up Authenticator"
              )}
            </Button>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
            )}
          </div>
        );

      case "confirm":
        if (backupCodes.length > 0) {
          return (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
                Enter a code from your authenticator to regenerate backup codes.
              </p>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setError(null);
                }}
                maxLength={6}
                className="text-center text-lg tracking-widest font-mono h-12 rounded-xl"
                autoFocus
              />
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
              )}
              <Button
                onClick={() => regenerateBackupMutation.mutate(code)}
                disabled={code.length !== 6 || regenerateBackupMutation.isPending}
                className="w-full h-11 rounded-xl font-medium"
              >
                {regenerateBackupMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  "Regenerate Backup Codes"
                )}
              </Button>
            </div>
          );
        }
        return (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Scan this QR code with your authenticator app
              </p>
              {qrCode && (
                <div className="inline-block bg-white p-3 rounded-xl mb-4">
                  <img src={qrCode} alt="2FA QR Code" className="w-40 h-40" />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                Or enter this key manually:
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
                  <code className="text-xs font-mono text-slate-700 dark:text-slate-300 break-all">
                    {manualKey}
                  </code>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyManualKey}
                  className="h-10 w-10 rounded-xl shrink-0"
                >
                  {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
                Enter the 6-digit code from your app:
              </p>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setError(null);
                }}
                maxLength={6}
                className="text-center text-lg tracking-widest font-mono h-12 rounded-xl"
              />
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
              )}
              <Button
                onClick={() => confirmSetupMutation.mutate(code)}
                disabled={code.length !== 6 || confirmSetupMutation.isPending}
                className="w-full h-11 rounded-xl font-medium"
              >
                {confirmSetupMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify & Enable"
                )}
              </Button>
            </div>
          </div>
        );

      case "backup":
        return (
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-10 h-10 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-3">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {isEnabled ? "New Backup Codes Generated" : "2FA Enabled!"}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Save these backup codes securely. Each can only be used once.
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((code, i) => (
                  <div key={i} className="font-mono text-sm text-slate-700 dark:text-slate-300 text-center py-1 bg-white dark:bg-slate-900 rounded-lg">
                    {code}
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={copyBackupCodes}
                className="w-full mt-3 h-9 rounded-lg"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy All Codes
              </Button>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="saved"
                checked={savedBackupCodes}
                onCheckedChange={(checked) => setSavedBackupCodes(!!checked)}
                className="mt-0.5"
              />
              <label htmlFor="saved" className="text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
                I've saved these backup codes in a safe place
              </label>
            </div>

            <Button
              onClick={handleFinish}
              disabled={!savedBackupCodes}
              className="w-full h-11 rounded-xl font-medium"
            >
              Done
            </Button>
          </div>
        );

      case "disable":
        return (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
              Enter a code from your authenticator or a backup code to disable 2FA.
            </p>
            <Input
              type="text"
              placeholder="Code or backup code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(null);
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
                onClick={() => {
                  setStep("initial");
                  setCode("");
                  setError(null);
                }}
                className="flex-1 h-11 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => disableMutation.mutate(code)}
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
        );
    }
  };

  const getTitle = () => {
    switch (step) {
      case "initial": return "Two-Factor Authentication";
      case "setup": return "Set Up 2FA";
      case "confirm": return backupCodes.length > 0 ? "Regenerate Backup Codes" : "Verify Setup";
      case "backup": return "Backup Codes";
      case "disable": return "Disable 2FA";
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-sm p-0 gap-0 overflow-hidden rounded-2xl" preventAutoFocus hideCloseButton>
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="min-w-[44px]" />
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {getTitle()}
          </DialogTitle>
          <button 
            onClick={handleClose} 
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-5 bg-white dark:bg-slate-900">
          {renderStep()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
