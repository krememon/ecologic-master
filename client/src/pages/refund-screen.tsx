import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft,
  CreditCard,
  Building2,
  Banknote,
  FileCheck,
  Loader2,
  AlertCircle,
  ChevronDown,
  Check,
} from "lucide-react";
import { format, parseISO } from "date-fns";

type RefundMethod = "card" | "bank" | "cash" | "check";

interface ExistingRefund {
  id: number;
  amountCents: number;
  method: string;
  status: string;
  reason: string | null;
  createdAt: string;
}

interface RefundContext {
  paymentId: number;
  invoiceId: number | null;
  customerId: number | null;
  customerName: string;
  amountCents: number;
  refundedAmountCents: number;
  maxRefundable: number;
  hasStripeRef: boolean;
  companyBankLinked: boolean;
  customerBankLinked: boolean;
  paymentMethod: string;
  existingRefunds: ExistingRefund[];
}

interface InvoicePayment {
  id: number;
  amountCents: number;
  refundedAmountCents: number;
  paymentMethod: string;
  paidDate: string | null;
  createdAt: string;
  stripePaymentIntentId?: string | null;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safeFormatDate(dateStr: string | null | undefined, fmt = "MMM d, yyyy"): string {
  if (!dateStr) return "—";
  try {
    const d = parseISO(dateStr);
    return isNaN(d.getTime()) ? "—" : format(d, fmt);
  } catch {
    return "—";
  }
}

const methodLabels: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card",
  credit_card: "Credit Card",
  stripe: "Card (Stripe)",
  other: "Other",
};

const methodConfig: Record<RefundMethod, { icon: typeof CreditCard; label: string; confirmLabel: string }> = {
  card: { icon: CreditCard, label: "Card", confirmLabel: "Issue Card Refund" },
  bank: { icon: Building2, label: "Bank", confirmLabel: "Send Direct Deposit" },
  cash: { icon: Banknote, label: "Cash", confirmLabel: "Record Refund" },
  check: { icon: FileCheck, label: "Check", confirmLabel: "Record Refund" },
};

export default function RefundScreen() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const searchParams = new URLSearchParams(window.location.search);
  const paramPaymentId = searchParams.get("paymentId");
  const paramInvoiceId = searchParams.get("invoiceId");

  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(paramPaymentId ? parseInt(paramPaymentId) : null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<RefundMethod | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const invoiceQuery = useQuery<{
    invoiceId: number;
    customerName: string;
    payments: InvoicePayment[];
  }>({
    queryKey: ["/api/payments/invoice", paramInvoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/payments/invoice/${paramInvoiceId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load invoice");
      return res.json();
    },
    enabled: !!paramInvoiceId && !paramPaymentId,
  });

  const refundablePayments = (invoiceQuery.data?.payments || []).filter((p) => {
    const amt = p.amountCents || 0;
    return p.id && (p.refundedAmountCents || 0) < amt;
  });

  useEffect(() => {
    if (paramInvoiceId && !paramPaymentId && refundablePayments.length > 0 && !selectedPaymentId) {
      const sorted = [...refundablePayments].sort((a, b) => {
        const da = new Date(a.paidDate || a.createdAt || 0).getTime();
        const db = new Date(b.paidDate || b.createdAt || 0).getTime();
        return db - da;
      });
      setSelectedPaymentId(sorted[0].id);
    }
  }, [refundablePayments.length, paramInvoiceId, paramPaymentId, selectedPaymentId]);

  const activePaymentId = selectedPaymentId || (paramPaymentId ? parseInt(paramPaymentId) : null);

  const { data: ctx, isLoading: ctxLoading, error: ctxError } = useQuery<RefundContext>({
    queryKey: ["/api/payments", activePaymentId, "refund-context"],
    queryFn: async () => {
      const res = await fetch(`/api/payments/${activePaymentId}/refund-context`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load refund context");
      return res.json();
    },
    enabled: !!activePaymentId,
  });

  useEffect(() => {
    setAmountStr("");
    setSelectedMethod(null);
  }, [activePaymentId]);

  const isLoading = paramInvoiceId && !paramPaymentId ? invoiceQuery.isLoading || ctxLoading : ctxLoading;
  const hasError = paramInvoiceId && !paramPaymentId ? invoiceQuery.error || ctxError : ctxError;

  const maxDollars = ctx ? ctx.maxRefundable / 100 : 0;
  const amount = parseFloat(amountStr || "0");

  const effectiveAmount = amountStr ? amount : maxDollars;
  const effectiveAmountCents = Math.round(effectiveAmount * 100);
  const effectiveAmountValid = effectiveAmount > 0 && effectiveAmountCents <= (ctx?.maxRefundable ?? 0);

  const isCardDisabled = !ctx?.hasStripeRef;
  const isBankDisabled = true;

  const canSubmit = selectedMethod && effectiveAmountValid && !isSubmitting &&
    selectedMethod !== "bank" &&
    !(selectedMethod === "card" && isCardDisabled);

  const handleConfirm = async () => {
    if (!canSubmit || !ctx || !activePaymentId) return;

    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/refunds", {
        paymentId: activePaymentId,
        method: selectedMethod,
        amountCents: effectiveAmountCents,
        reason: reason.trim() || undefined,
      });

      toast({ title: "Refund recorded", description: `${formatCents(effectiveAmountCents)} refunded via ${methodConfig[selectedMethod!].label}` });

      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments/stats"] });

      const invoiceId = ctx.invoiceId || (paramInvoiceId ? parseInt(paramInvoiceId) : null);
      if (invoiceId) {
        navigate(`/payments/invoice/${invoiceId}`);
      } else {
        navigate("/payments");
      }
    } catch (err: any) {
      toast({ title: "Refund failed", description: err.message || "Something went wrong", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate("/payments");
    }
  };

  const handleAmountFocus = () => {
    if (!amountStr && ctx) {
      setAmountStr(maxDollars.toFixed(2));
    }
  };

  if (paramInvoiceId && !paramPaymentId && !invoiceQuery.isLoading && refundablePayments.length === 0 && invoiceQuery.data) {
    return (
      <div className="p-4 sm:p-5 max-w-2xl mx-auto">
        <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-6">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="text-center py-14">
          <AlertCircle className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">No refundable payments on this invoice</p>
        </div>
      </div>
    );
  }

  if (!paramPaymentId && !paramInvoiceId) {
    return (
      <div className="p-4 sm:p-5 max-w-2xl mx-auto">
        <button onClick={() => navigate("/payments")} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-6">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="text-center py-14">
          <AlertCircle className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">No payment or invoice specified</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 sm:p-5 max-w-2xl mx-auto space-y-5">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-lg w-20" />
          <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded-lg w-64" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-slate-200 dark:bg-slate-700 rounded-2xl" />
            ))}
          </div>
          <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-xl" />
          <div className="h-24 bg-slate-200 dark:bg-slate-700 rounded-xl" />
          <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-xl" />
        </div>
      </div>
    );
  }

  if (hasError || !ctx) {
    return (
      <div className="p-4 sm:p-5 max-w-2xl mx-auto">
        <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-6">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="text-center py-14">
          <AlertCircle className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Failed to load refund details</p>
        </div>
      </div>
    );
  }

  const showPaymentSelector = paramInvoiceId && !paramPaymentId && refundablePayments.length > 1;
  const selectedPaymentInfo = refundablePayments.find((p) => p.id === activePaymentId);

  const methods: { key: RefundMethod; disabled: boolean; helperText?: string }[] = [
    {
      key: "card",
      disabled: isCardDisabled,
      helperText: isCardDisabled ? "No original card charge exists for this payment" : undefined,
    },
    {
      key: "bank",
      disabled: isBankDisabled,
      helperText: "Coming soon",
    },
    { key: "cash", disabled: false },
    { key: "check", disabled: false },
  ];

  return (
    <div className="p-4 sm:p-5 max-w-2xl mx-auto space-y-5">
      <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
        How would you like to refund {ctx.customerName}?
      </h1>

      {showPaymentSelector && selectedPaymentInfo && (
        <div className="relative">
          <button
            onClick={() => setSelectorOpen(!selectorOpen)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600 transition-colors text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">Refunding</p>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {methodLabels[(selectedPaymentInfo.paymentMethod || "").toLowerCase()] || selectedPaymentInfo.paymentMethod || "Payment"}
                <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
                <span className="text-green-600 dark:text-green-400 font-semibold tabular-nums">{formatCents(selectedPaymentInfo.amountCents)}</span>
                <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
                <span className="text-slate-500 dark:text-slate-400">{safeFormatDate(selectedPaymentInfo.paidDate || selectedPaymentInfo.createdAt)}</span>
              </p>
            </div>
            <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${selectorOpen ? "rotate-180" : ""}`} />
          </button>

          {selectorOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSelectorOpen(false)} />
              <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-lg overflow-hidden">
                {refundablePayments.map((p) => {
                  const isActive = p.id === activePaymentId;
                  const pMethodLabel = methodLabels[(p.paymentMethod || "").toLowerCase()] || p.paymentMethod || "Payment";
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedPaymentId(p.id);
                        setSelectorOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                        isActive ? "bg-blue-50 dark:bg-blue-950/20" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {pMethodLabel}
                          <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
                          <span className="tabular-nums">{formatCents(p.amountCents)}</span>
                        </p>
                        <p className="text-[12px] text-slate-400 dark:text-slate-500">
                          {safeFormatDate(p.paidDate || p.createdAt)}
                          {(p.refundedAmountCents || 0) > 0 && (
                            <span className="ml-1.5 text-amber-500 font-medium">
                              · {formatCents(p.refundedAmountCents)} refunded
                            </span>
                          )}
                        </p>
                      </div>
                      {isActive && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {ctx.existingRefunds.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              Previous Refunds
            </p>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {ctx.existingRefunds.map((refund) => (
              <div key={refund.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 bg-red-50 dark:bg-red-950/40 rounded-full flex items-center justify-center shrink-0">
                  <ArrowLeft className="w-4 h-4 text-red-500 dark:text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 capitalize">
                    {refund.method} refund
                  </p>
                  <p className="text-[12px] text-slate-400 dark:text-slate-500">
                    {safeFormatDate(refund.createdAt)}
                    {refund.status && <span className="ml-1.5">· {refund.status}</span>}
                    {refund.reason && <span className="ml-1.5">· {refund.reason}</span>}
                  </p>
                </div>
                <p className="text-sm font-bold text-red-500 dark:text-red-400 tabular-nums shrink-0">
                  -{formatCents(refund.amountCents)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 p-4">
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
          Refund Method
        </p>
        <div className="grid grid-cols-2 gap-3">
          {methods.map(({ key, disabled, helperText }) => {
            const config = methodConfig[key];
            const Icon = config.icon;
            const isSelected = selectedMethod === key;

            return (
              <button
                key={key}
                disabled={disabled}
                onClick={() => !disabled && setSelectedMethod(key)}
                className={`relative flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all text-center ${
                  disabled
                    ? "opacity-50 cursor-not-allowed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"
                    : isSelected
                    ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-400"
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900"
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  isSelected
                    ? "bg-blue-100 dark:bg-blue-900/40"
                    : "bg-slate-100 dark:bg-slate-800"
                }`}>
                  <Icon className={`w-5 h-5 ${
                    isSelected
                      ? "text-blue-600 dark:text-blue-400"
                      : "text-slate-400 dark:text-slate-500"
                  }`} />
                </div>
                <span className={`text-sm font-medium ${
                  isSelected
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-slate-700 dark:text-slate-300"
                }`}>
                  {config.label}
                </span>
                {helperText && (
                  <span className="text-[10px] leading-tight text-slate-400 dark:text-slate-500">
                    {helperText}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 p-4 space-y-4">
        <div>
          <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">
            Refund Amount
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm font-medium">$</span>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              max={maxDollars}
              placeholder={maxDollars.toFixed(2)}
              value={amountStr}
              onFocus={handleAmountFocus}
              onChange={(e) => setAmountStr(e.target.value)}
              className="pl-8 h-11 rounded-xl bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-700 text-sm tabular-nums"
            />
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
            Max refundable: {formatCents(ctx.maxRefundable)}
          </p>
          {amountStr && !effectiveAmountValid && (
            <p className="text-[11px] text-red-500 dark:text-red-400 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Amount exceeds maximum refundable
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">
            Reason (optional)
          </label>
          <Textarea
            placeholder="Why is this refund being issued?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="rounded-xl bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-700 text-sm resize-none"
          />
        </div>
      </div>

      <div className="space-y-2.5">
        <Button
          onClick={handleConfirm}
          disabled={!canSubmit}
          className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing…
            </>
          ) : selectedMethod ? (
            methodConfig[selectedMethod].confirmLabel
          ) : (
            "Select a refund method"
          )}
        </Button>

        <Button
          variant="outline"
          onClick={handleBack}
          className="w-full h-12 rounded-xl text-sm font-medium"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
