import { useState, useEffect } from "react";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle, AlertCircle, Building2 } from "lucide-react";

interface TokenInfo {
  customerName: string;
  companyName: string;
}

export default function PayoutSetup({ token }: { token: string }) {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stripeInstance, setStripeInstance] = useState<Stripe | null>(null);

  const [accountHolderName, setAccountHolderName] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountNumberConfirm, setAccountNumberConfirm] = useState("");
  const [accountType, setAccountType] = useState<"individual" | "company">("individual");

  useEffect(() => {
    async function init() {
      try {
        const [infoRes, keyRes] = await Promise.all([
          fetch(`/api/public/payout-setup/${token}/info`),
          fetch(`/api/stripe/publishable-key`),
        ]);

        if (!infoRes.ok) {
          const data = await infoRes.json();
          setError(data.message || "Invalid or expired link");
          setLoading(false);
          return;
        }

        const infoData = await infoRes.json();
        setInfo(infoData);

        if (keyRes.ok) {
          const keyData = await keyRes.json();
          const stripe = await loadStripe(keyData.publishableKey);
          setStripeInstance(stripe);
        }
      } catch {
        setError("Failed to load. Please try again later.");
      }
      setLoading(false);
    }
    init();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (accountNumber !== accountNumberConfirm) {
      setError("Account numbers do not match");
      return;
    }

    if (!stripeInstance) {
      setError("Payment system not loaded. Please refresh and try again.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const result = await stripeInstance.createToken("bank_account", {
        country: "US",
        currency: "usd",
        routing_number: routingNumber,
        account_number: accountNumber,
        account_holder_name: accountHolderName,
        account_holder_type: accountType,
      });

      if (result.error) {
        setError(result.error.message || "Failed to verify bank details");
        setSubmitting(false);
        return;
      }

      const completeRes = await fetch(`/api/public/payout-setup/${token}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankToken: result.token!.id }),
      });

      if (!completeRes.ok) {
        const data = await completeRes.json();
        setError(data.message || "Failed to save bank details");
        setSubmitting(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Bank Connected</h1>
          <p className="text-sm text-slate-500">
            Your bank details have been securely saved. {info?.companyName} can now send refunds directly to your bank account.
          </p>
          <p className="text-xs text-slate-400 mt-4">You can close this page.</p>
        </div>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Unable to Continue</h1>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 max-w-md w-full overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-emerald-600 px-6 py-5 text-center">
          <h1 className="text-white font-bold text-lg tracking-widest uppercase">ECOLOGIC</h1>
          <p className="text-white/80 text-sm mt-1">{info?.companyName}</p>
        </div>

        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Add Bank Details</h2>
              <p className="text-xs text-slate-500">For receiving refunds from {info?.companyName}</p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5 block">
                Account Holder Name
              </label>
              <Input
                value={accountHolderName}
                onChange={(e) => setAccountHolderName(e.target.value)}
                placeholder="Full name on account"
                required
                className="h-11 rounded-xl"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5 block">
                Account Type
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setAccountType("individual")}
                  className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    accountType === "individual"
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  Individual
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType("company")}
                  className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    accountType === "company"
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  Business
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5 block">
                Routing Number
              </label>
              <Input
                value={routingNumber}
                onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, "").slice(0, 9))}
                placeholder="9-digit routing number"
                required
                maxLength={9}
                inputMode="numeric"
                className="h-11 rounded-xl tabular-nums"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5 block">
                Account Number
              </label>
              <Input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                placeholder="Account number"
                required
                inputMode="numeric"
                type="password"
                className="h-11 rounded-xl tabular-nums"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5 block">
                Confirm Account Number
              </label>
              <Input
                value={accountNumberConfirm}
                onChange={(e) => setAccountNumberConfirm(e.target.value.replace(/\D/g, ""))}
                placeholder="Re-enter account number"
                required
                inputMode="numeric"
                type="password"
                className="h-11 rounded-xl tabular-nums"
              />
            </div>

            <Button
              type="submit"
              disabled={submitting || !accountHolderName || !routingNumber || !accountNumber || !accountNumberConfirm}
              className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold mt-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Bank Details"
              )}
            </Button>
          </form>

          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 text-center leading-relaxed">
              Your bank details are securely tokenized by Stripe and never stored as raw numbers.
              This information is used only for receiving refunds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
