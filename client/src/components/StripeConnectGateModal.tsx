import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreditCard, Loader2, ShieldAlert, AlertTriangle, CheckCircle2, X } from "lucide-react";
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

function StatusPill({ readiness, label }: { readiness: StripeConnectReadiness; label: string }) {
  const styles: Record<StripeConnectReadiness, string> = {
    loading: "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
    not_connected: "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400",
    setup_incomplete: "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400",
    ready: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400",
    needs_attention: "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400",
  };

  const dotStyles: Record<StripeConnectReadiness, string> = {
    loading: "bg-slate-400",
    not_connected: "bg-amber-500",
    setup_incomplete: "bg-amber-500",
    ready: "bg-emerald-500",
    needs_attention: "bg-red-500",
  };

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${styles[readiness]}`}>
      {readiness === "loading" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <span className={`w-1.5 h-1.5 rounded-full ${dotStyles[readiness]}`} />
      )}
      {label}
    </div>
  );
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

  const title = isReady
    ? "Stripe Connected"
    : showOwnerBlock
      ? "Stripe Setup Required"
      : "Set Up Card Payments";

  const description = isReady
    ? "Your Stripe account is active and ready to accept card payments."
    : showOwnerBlock
      ? "Only the business owner can complete Stripe setup. Please ask your company owner to enable card payments."
      : readiness === "not_connected"
        ? "To accept card payments, connect your Stripe account. This only takes a few minutes."
        : readiness === "setup_incomplete"
          ? "Your Stripe account setup isn't complete yet. Finish onboarding to start accepting card payments."
          : readiness === "needs_attention"
            ? "Your Stripe account needs attention. Please update your information to continue accepting payments."
            : "Checking your Stripe account status...";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" preventAutoFocus hideCloseButton>
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="min-w-[44px]" />
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </DialogTitle>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-white dark:bg-slate-900 px-5 pt-6 pb-5">
          <div className="flex flex-col items-center text-center">
            {isReady ? (
              <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
            ) : showOwnerBlock ? (
              <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center mb-4">
                <ShieldAlert className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
            ) : readiness === "needs_attention" ? (
              <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center mb-4">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
            ) : (
              <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center mb-4">
                <CreditCard className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
            )}

            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-[280px]">
              {description}
            </p>
          </div>

          <div className="flex justify-center mt-4 mb-5">
            <StatusPill readiness={readiness} label={statusLabel} />
          </div>

          <div className="flex flex-col gap-2">
            {isReady ? (
              <button
                onClick={onClose}
                className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                Continue to Payment
              </button>
            ) : showOwnerBlock ? (
              <button
                onClick={onClose}
                className="w-full h-11 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:bg-slate-300 dark:active:bg-slate-600 text-slate-700 dark:text-slate-300 text-sm font-semibold transition-colors"
              >
                Close
              </button>
            ) : (
              <>
                <button
                  onClick={() => startOnboarding(returnPath)}
                  disabled={isProcessing}
                  className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  {isProcessing ? "Setting up..." : actionLabel}
                </button>
                <button
                  onClick={onClose}
                  className="w-full h-11 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:bg-slate-300 dark:active:bg-slate-600 text-slate-600 dark:text-slate-400 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
