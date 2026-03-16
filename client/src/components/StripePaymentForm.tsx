import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Loader2, AlertCircle } from "lucide-react";

interface StripePaymentFormProps {
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  invoiceId: number;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}

function CheckoutForm({
  amountCents,
  onSuccess,
  onCancel,
}: {
  amountCents: number;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) return;

    setIsProcessing(true);
    setErrorMessage(null);

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.origin + "/jobs",
      },
      redirect: "if_required",
    });

    if (result.error) {
      setErrorMessage(result.error.message || "Payment failed. Please try again.");
      setIsProcessing(false);
    } else if (result.paymentIntent && result.paymentIntent.status === "succeeded") {
      onSuccess(result.paymentIntent.id);
    } else if (result.paymentIntent && result.paymentIntent.status === "requires_action") {
      setErrorMessage("Additional authentication required. Please complete the verification.");
      setIsProcessing(false);
    } else {
      setErrorMessage("Something went wrong. Please try again.");
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4">
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 p-4">
          <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1">Payment method</p>
          <p className="text-[12px] text-slate-400 dark:text-slate-500 mb-4">Choose how to pay the remaining balance.</p>
          <PaymentElement
            options={{
              layout: "tabs",
              wallets: { applePay: "auto", googlePay: "never" },
              fields: {
                billingDetails: {
                  email: "never",
                  phone: "never",
                },
              },
              terms: {
                card: "never",
              },
            }}
          />
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 mt-3 px-1">
            <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
            <p className="text-[13px] text-red-600 dark:text-red-400 leading-snug">{errorMessage}</p>
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 dark:border-slate-800 px-5 py-4 bg-white dark:bg-slate-900">
        <button
          type="submit"
          disabled={!stripe || !elements || isProcessing}
          className="w-full h-[50px] rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[15px] font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            `Pay ${formatCurrency(amountCents)}`
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isProcessing}
          className="w-full mt-2 h-10 text-[13px] font-medium text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const stripePromiseCache: Record<string, ReturnType<typeof loadStripe>> = {};

function getStripePromise(publishableKey: string) {
  if (!stripePromiseCache[publishableKey]) {
    stripePromiseCache[publishableKey] = loadStripe(publishableKey);
  }
  return stripePromiseCache[publishableKey];
}

export default function StripePaymentForm({
  clientSecret,
  publishableKey,
  amountCents,
  invoiceId,
  onSuccess,
  onCancel,
}: StripePaymentFormProps) {
  const stripePromise = getStripePromise(publishableKey);

  return (
    <Elements
      key={clientSecret}
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#2563eb",
            borderRadius: "12px",
            fontFamily: "system-ui, -apple-system, sans-serif",
            spacingUnit: "4px",
          },
          rules: {
            ".Input": {
              boxShadow: "none",
              borderColor: "#e2e8f0",
              transition: "border-color 0.15s ease",
            },
            ".Input:focus": {
              borderColor: "#2563eb",
              boxShadow: "0 0 0 1px #2563eb",
            },
            ".Label": {
              fontSize: "13px",
              fontWeight: "500",
              color: "#64748b",
            },
          },
        },
      }}
    >
      <CheckoutForm
        amountCents={amountCents}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    </Elements>
  );
}
