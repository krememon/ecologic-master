import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import StripePaymentForm from "@/components/StripePaymentForm";
import {
  ArrowLeft,
  DollarSign,
  User,
  FileText,
  CreditCard,
  Banknote,
  Hash,
  Briefcase,
  Receipt,
  RotateCcw,
  Plus,
  Loader2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface InvoicePaymentDetailsProps {
  invoiceId: string;
}

const REFUND_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "SUPERVISOR"]);
const COLLECT_ROLES = new Set(["OWNER", "SUPERVISOR", "TECHNICIAN"]);

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safeFormat(dateStr: string | null | undefined, fmt: string): string {
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

const methodIcons: Record<string, typeof Banknote> = {
  cash: Banknote,
  check: FileText,
  card: CreditCard,
  credit_card: CreditCard,
  stripe: CreditCard,
  other: DollarSign,
};

const refundStatusConfig: Record<string, { color: string; label: string }> = {
  succeeded: { color: "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400", label: "Succeeded" },
  settled: { color: "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400", label: "Settled" },
  posted: { color: "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400", label: "Posted" },
  pending: { color: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400", label: "Pending" },
  failed: { color: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400", label: "Failed" },
  returned: { color: "bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400", label: "Returned" },
  cancelled: { color: "bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400", label: "Cancelled" },
};

export default function InvoicePaymentDetails({ invoiceId }: InvoicePaymentDetailsProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [stripeModalOpen, setStripeModalOpen] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeData, setStripeData] = useState<{
    clientSecret: string;
    publishableKey: string;
    amountCents: number;
    paymentIntentId: string;
  } | null>(null);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/payments/invoice", invoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/payments/invoice/${invoiceId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const { data: membership } = useQuery<{ role: string }>({
    queryKey: ["/api/user/membership"],
  });
  const userRole = (membership?.role || "").toUpperCase();
  const canRefund = REFUND_ROLES.has(userRole);
  const canCollect = COLLECT_ROLES.has(userRole);

  function handleRefundClick() {
    navigate(`/refunds/new?invoiceId=${invoiceId}`);
  }

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/payments/invoice", invoiceId] });
    queryClient.invalidateQueries({ queryKey: ["/api/payments/ledger"] });
    queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today"] });
  };

  const handleCollectRemaining = async () => {
    const balanceDue = data?.balanceDueCents ?? 0;
    if (balanceDue < 50) {
      toast({
        title: "Cannot collect",
        description: "Remaining balance is too small to charge (Stripe minimum is $0.50).",
        variant: "destructive",
      });
      return;
    }

    setStripeLoading(true);
    try {
      const res = await apiRequest("POST", "/api/payments/stripe/create-intent", {
        invoiceId: parseInt(invoiceId),
        amountCents: balanceDue,
      });
      const result = await res.json();
      setStripeData({
        clientSecret: result.clientSecret,
        publishableKey: result.publishableKey,
        amountCents: result.amountCents,
        paymentIntentId: result.paymentIntentId,
      });
      setStripeModalOpen(true);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to create payment intent",
        variant: "destructive",
      });
    } finally {
      setStripeLoading(false);
    }
  };

  const handleCardPaymentSuccess = async (paymentIntentId: string) => {
    setStripeModalOpen(false);
    setStripeData(null);

    const maxPolls = 10;
    for (let i = 0; i < maxPolls; i++) {
      try {
        const res = await fetch(
          `/api/payments/stripe/confirm?invoiceId=${invoiceId}&payment_intent_id=${paymentIntentId}`,
          { credentials: "include" }
        );
        const result = await res.json();
        if (result.status === "succeeded") {
          toast({ title: "Payment successful", description: `Collected ${formatCents(result.amountCents || stripeData?.amountCents || 0)}` });
          invalidateAll();
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }

    toast({ title: "Payment processing", description: "Your payment is being processed. It will appear shortly." });
    invalidateAll();
  };

  const handleCardPaymentCancel = () => {
    setStripeModalOpen(false);
    setStripeData(null);
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-5 max-w-2xl mx-auto space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-lg w-24" />
          <div className="h-20 bg-slate-200 dark:bg-slate-700 rounded-2xl" />
          <div className="h-[200px] bg-slate-200 dark:bg-slate-700 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 sm:p-5 max-w-2xl mx-auto">
        <button onClick={() => navigate("/payments")} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-6">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="text-center py-14">
          <p className="text-sm text-slate-500 dark:text-slate-400">Invoice not found</p>
        </div>
      </div>
    );
  }

  const totalCents = data.invoiceTotalCents || 0;
  const payments: any[] = data.payments || [];
  const refundsList: any[] = data.refunds || [];

  const totalPaymentsCents = data.totalPaymentsCents || data.paidAmountCents || 0;
  const totalRefundsCents = data.totalRefundsCents || 0;
  const pendingRefundsCents = data.pendingRefundsCents || 0;
  const netCollectedCents = data.netCollectedCents ?? Math.max(0, totalPaymentsCents - totalRefundsCents);
  const balanceCents = data.balanceDueCents ?? Math.max(0, totalCents - totalPaymentsCents);

  const computedStatus = data.invoiceStatus || "unpaid";
  const isRefundedStatus = computedStatus === "refunded" || computedStatus === "partially_refunded";
  const isPaid = computedStatus === "paid" || isRefundedStatus;
  const isPartial = computedStatus === "partial";

  const showCollectButton = canCollect && isPartial && balanceCents > 0;

  const refundsByPaymentId: Record<number, any[]> = {};
  for (const r of refundsList) {
    const pid = r.paymentId;
    if (!refundsByPaymentId[pid]) refundsByPaymentId[pid] = [];
    refundsByPaymentId[pid].push(r);
  }

  const statusPill = (() => {
    switch (computedStatus) {
      case "paid":
        return <span className="bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 text-xs font-semibold px-3 py-1 rounded-full">Paid</span>;
      case "refunded":
        return <span className="bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-semibold px-3 py-1 rounded-full">Refunded</span>;
      case "partially_refunded":
        return <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-xs font-semibold px-3 py-1 rounded-full">Partially Refunded</span>;
      case "partial":
        return <span className="bg-yellow-50 dark:bg-yellow-950/40 text-yellow-600 dark:text-yellow-400 text-xs font-semibold px-3 py-1 rounded-full">Partial</span>;
      default:
        return <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-xs font-semibold px-3 py-1 rounded-full">Unpaid</span>;
    }
  })();

  const details = [
    { icon: User, label: "Customer", value: data.customerName || "Unknown Customer" },
    ...(data.invoiceNumber ? [{ icon: Hash, label: "Invoice", value: `#${data.invoiceNumber}` }] : []),
    ...(data.jobTitle ? [{ icon: Briefcase, label: "Job", value: data.jobTitle }] : []),
    { icon: DollarSign, label: "Invoice Total", value: formatCents(totalCents) },
    ...(totalPaymentsCents > 0 ? [{ icon: DollarSign, label: "Total Payments", value: formatCents(totalPaymentsCents) }] : []),
    ...(totalRefundsCents > 0 ? [{ icon: RotateCcw, label: "Total Refunded", value: `-${formatCents(totalRefundsCents)}`, valueColor: "text-red-500 dark:text-red-400" }] : []),
    ...(pendingRefundsCents > 0 ? [{ icon: RotateCcw, label: "Pending Refund", value: formatCents(pendingRefundsCents), valueColor: "text-amber-500 dark:text-amber-400" }] : []),
    ...(totalRefundsCents > 0 ? [{ icon: DollarSign, label: "Net Collected", value: formatCents(netCollectedCents) }] : []),
    ...(!isPaid ? [{ icon: DollarSign, label: "Balance Due", value: formatCents(balanceCents) }] : []),
    ...(payments.length > 0 ? [{ icon: Receipt, label: "Payments Made", value: `${payments.length} payment${payments.length !== 1 ? "s" : ""}` }] : []),
  ];

  return (
    <div className="p-4 sm:p-5 max-w-2xl mx-auto space-y-5">
      <button onClick={() => navigate("/payments")} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Payments
      </button>

      <div className="text-center py-4">
        <p className="text-4xl font-bold text-slate-900 dark:text-slate-100 tracking-tight tabular-nums mb-1">
          {formatCents(totalRefundsCents > 0 ? netCollectedCents : totalPaymentsCents > 0 ? totalPaymentsCents : totalCents)}
        </p>
        {totalRefundsCents > 0 && (
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Net Collected</p>
        )}
        {statusPill}
        {pendingRefundsCents > 0 && (
          <p className="text-[12px] text-amber-500 dark:text-amber-400 mt-2">
            Pending refund: {formatCents(pendingRefundsCents)}
          </p>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
        {details.map((item, i) => {
          const Icon = item.icon;
          return (
            <div key={i} className="flex items-start gap-3 px-4 py-3.5">
              <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">
                  {item.label}
                </p>
                <p className={`text-sm font-medium break-words ${(item as any).valueColor || "text-slate-900 dark:text-slate-100"}`}>
                  {item.value}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {showCollectButton && (
        <button
          onClick={handleCollectRemaining}
          disabled={stripeLoading}
          className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          {stripeLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating payment...
            </>
          ) : (
            <>
              <CreditCard className="w-4 h-4" />
              Collect Remaining {formatCents(balanceCents)}
            </>
          )}
        </button>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Payment History
          </p>
          {canRefund && payments.some((p: any) => {
            const amt = p.amountCents || Math.round(parseFloat(p.amount || "0") * 100);
            return p.id && (p.refundedAmountCents || 0) < amt;
          }) && (
            <button
              onClick={handleRefundClick}
              className="h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 inline-flex items-center gap-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50 focus-visible:ring-offset-1"
            >
              <Plus className="w-4 h-4" />
              Refund
            </button>
          )}
        </div>
        {payments.length === 0 && refundsList.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-2.5">
              <Receipt className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">No payments recorded yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {payments.map((payment: any, idx: number) => {
              const paymentCents = payment.amountCents || Math.round(parseFloat(payment.amount || "0") * 100);
              const methodKey = (payment.paymentMethod || "").toLowerCase();
              const MethodIcon = methodIcons[methodKey] || DollarSign;
              const methodLabel = methodLabels[methodKey] || payment.paymentMethod || "—";

              const refundedCents = payment.refundedAmountCents || 0;
              const paymentRefunds = refundsByPaymentId[payment.id] || [];

              const settledStatuses = new Set(['succeeded', 'settled']);
              const pendingStatuses = new Set(['pending', 'posted']);
              let settledRefundCents = 0;
              let pendingRefundCents = 0;
              for (const r of paymentRefunds) {
                if (settledStatuses.has(r.status)) settledRefundCents += r.amountCents;
                else if (pendingStatuses.has(r.status)) pendingRefundCents += r.amountCents;
              }
              const isFullyRefunded = settledRefundCents >= paymentCents;

              const refundLines: { text: string; color: string }[] = [];
              if (settledRefundCents > 0) {
                refundLines.push({
                  text: `Refunded ${formatCents(settledRefundCents)}`,
                  color: "text-red-500 dark:text-red-400",
                });
              }
              if (pendingRefundCents > 0) {
                refundLines.push({
                  text: `Refund pending: ${formatCents(pendingRefundCents)}`,
                  color: "text-amber-500 dark:text-amber-400",
                });
              }

              return (
                <div key={payment.id || idx} className="flex items-center gap-3 px-4 py-3.5">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isFullyRefunded ? "bg-red-50 dark:bg-red-950/40" : "bg-green-50 dark:bg-green-950/40"}`}>
                    <MethodIcon className={`w-4 h-4 ${isFullyRefunded ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {methodLabel}
                      {isFullyRefunded && <span className="ml-1.5 text-[11px] text-red-500 font-semibold">Refunded</span>}
                      {!isFullyRefunded && settledRefundCents > 0 && <span className="ml-1.5 text-[11px] text-amber-500 font-semibold">Partial Refund</span>}
                    </p>
                    <p className="text-[12px] text-slate-400 dark:text-slate-500">
                      {safeFormat(payment.paidDate || payment.createdAt, "MMM d, yyyy 'at' h:mm a")}
                      {payment.checkNumber && <span className="ml-1.5">· Check #{payment.checkNumber}</span>}
                      {payment.collectedByName && <span className="ml-1.5">· by {payment.collectedByName}</span>}
                      {payment.notes && <span className="ml-1.5">· {payment.notes}</span>}
                    </p>
                    {refundLines.map((line, ri) => (
                      <p key={ri} className={`text-[11px] ${line.color} mt-0.5 font-medium`}>
                        {line.text}
                      </p>
                    ))}
                  </div>
                  <p className={`text-sm font-bold tabular-nums shrink-0 ${isFullyRefunded ? "text-red-500 dark:text-red-400 line-through" : "text-green-600 dark:text-green-400"}`}>
                    +{formatCents(paymentCents)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={stripeModalOpen} onOpenChange={(open) => { if (!open) handleCardPaymentCancel(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Collect Remaining Balance</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Charging {formatCents(stripeData?.amountCents || balanceCents)} to complete this invoice.
            </p>
            {stripeData && (
              <StripePaymentForm
                clientSecret={stripeData.clientSecret}
                publishableKey={stripeData.publishableKey}
                amountCents={stripeData.amountCents}
                invoiceId={parseInt(invoiceId)}
                onSuccess={handleCardPaymentSuccess}
                onCancel={handleCardPaymentCancel}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
