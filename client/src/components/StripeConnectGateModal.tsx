import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { StripeConnectReadiness } from "@/hooks/useStripeConnectGate";

interface StripeConnectGateModalProps {
  open: boolean;
  onClose: () => void;
  returnPath?: string;
  readiness: StripeConnectReadiness;
  isOwner: boolean;
  isProcessing: boolean;
  statusLabel: string;
  actionLabel: string;
  showOwnerOnlyMessage: boolean;
  startOnboarding: (returnPath?: string) => Promise<void>;
}

export function StripeConnectGateModal({
  open,
  onClose,
  returnPath,
  readiness,
  isOwner,
  isProcessing,
  statusLabel,
  actionLabel,
  showOwnerOnlyMessage,
  startOnboarding,
}: StripeConnectGateModalProps) {
  const showOwnerBlock = showOwnerOnlyMessage || (!isOwner && readiness !== "ready");
  const isReady = readiness === "ready";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            {isReady ? (
              <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
            ) : showOwnerBlock ? (
              <div className="h-16 w-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <ShieldAlert className="h-8 w-8 text-amber-600 dark:text-amber-400" />
              </div>
            ) : readiness === "needs_attention" ? (
              <div className="h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
            ) : (
              <div className="h-16 w-16 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <CreditCard className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              </div>
            )}
          </div>
          <DialogTitle className="text-center text-lg">
            {isReady
              ? "Stripe Connected"
              : showOwnerBlock
                ? "Stripe Setup Required"
                : "Set Up Card Payments"}
          </DialogTitle>
          <DialogDescription className="text-center">
            {isReady ? (
              "Your Stripe account is active and ready to accept card payments. Closing this shortly..."
            ) : showOwnerBlock ? (
              "Only the business owner can complete Stripe setup. Please ask your company owner to set up card payments."
            ) : readiness === "not_connected" ? (
              "To accept card payments, you need to connect your Stripe account. This only takes a few minutes."
            ) : readiness === "setup_incomplete" ? (
              "Your Stripe account setup isn't complete yet. Please finish your Stripe onboarding to start accepting card payments."
            ) : readiness === "needs_attention" ? (
              "Your Stripe account needs attention. Please update your information to continue accepting card payments."
            ) : (
              "Checking your Stripe account status..."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 mt-4">
          {isReady ? (
            <Button
              onClick={onClose}
              className="w-full bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Continue to Payment
            </Button>
          ) : showOwnerBlock ? (
            <Button variant="outline" onClick={onClose} className="w-full">
              Close
            </Button>
          ) : (
            <>
              <Button
                onClick={() => startOnboarding(returnPath)}
                disabled={isProcessing}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                {isProcessing ? "Setting up..." : actionLabel}
              </Button>
              <Button variant="outline" onClick={onClose} className="w-full">
                Cancel
              </Button>
            </>
          )}
        </div>

        {!showOwnerBlock && !isReady && (
          <p className="text-xs text-center text-muted-foreground mt-2">
            Status: {statusLabel}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
