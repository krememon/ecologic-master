import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, X, Copy, CheckCircle, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TwoFactorSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isEnabled: boolean;
}

type Step = "intro" | "scan" | "verify" | "backup";

export default function TwoFactorSetupModal({ open, onOpenChange, isEnabled }: TwoFactorSetupModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("intro");
  const [qrCode, setQrCode] = useState<string>("");
  const [manualKey, setManualKey] = useState<string>("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [savedBackupCodes, setSavedBackupCodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep("intro");
      setQrCode("");
      setManualKey("");
      setCode("");
      setBackupCodes([]);
      setSavedBackupCodes(false);
      setError(null);
      setCopied(false);
    }
  }, [open]);

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
      setStep("scan");
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const confirmSetupMutation = useMutation({
    mutationFn: async (verifyCode: string) => {
      const res = await apiRequest("POST", "/api/auth/2fa/setup/confirm", { code: verifyCode });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Invalid code");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setStep("backup");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/2fa/status"] });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleFinish = () => {
    toast({ 
      title: "2FA Enabled", 
      description: "Two-factor authentication is now active on your account." 
    });
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
      case "intro":
        return (
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-3">
                <Shield className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Add an extra layer of security to your account using an authenticator app like Google Authenticator or Authy.
              </p>
            </div>
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
                "Continue"
              )}
            </Button>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
            )}
          </div>
        );

      case "scan":
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

            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 text-center">
                Or enter this key manually:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 px-3 py-2 rounded-lg text-center break-all">
                  {manualKey}
                </code>
                <Button variant="outline" size="sm" onClick={copyManualKey} className="shrink-0">
                  {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Button
              onClick={() => setStep("verify")}
              className="w-full h-11 rounded-xl font-medium"
            >
              Next
            </Button>
          </div>
        );

      case "verify":
        return (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
              Enter the 6-digit code from your authenticator app to verify setup.
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length === 6) {
                  confirmSetupMutation.mutate(code);
                }
              }}
              maxLength={6}
              className="text-center text-lg tracking-widest font-mono h-12 rounded-xl"
              autoFocus
            />
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
            )}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep("scan")}
                className="flex-1 h-11 rounded-xl"
              >
                Back
              </Button>
              <Button
                onClick={() => confirmSetupMutation.mutate(code)}
                disabled={code.length !== 6 || confirmSetupMutation.isPending}
                className="flex-1 h-11 rounded-xl font-medium"
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
                2FA Enabled!
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Save these backup codes securely. Each can only be used once.
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((backupCode, i) => (
                  <div key={i} className="font-mono text-sm text-slate-700 dark:text-slate-300 text-center py-1 bg-white dark:bg-slate-900 rounded-lg">
                    {backupCode}
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
    }
  };

  const getTitle = () => {
    switch (step) {
      case "intro": return "Set Up Two-Factor Authentication";
      case "scan": return "Scan QR Code";
      case "verify": return "Verify Setup";
      case "backup": return "Backup Codes";
    }
  };

  if (isEnabled) {
    return null;
  }

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
