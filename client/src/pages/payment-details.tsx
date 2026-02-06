import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, DollarSign, User, FileText, CreditCard, Banknote, Clock, CheckCircle, AlertTriangle, Calendar, Hash, Briefcase } from "lucide-react";
import { format, parseISO } from "date-fns";

interface PaymentDetailsProps {
  paymentId: string;
}

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

const methodIcons: Record<string, typeof Banknote> = {
  cash: Banknote,
  check: FileText,
  card: CreditCard,
  credit_card: CreditCard,
  stripe: CreditCard,
};

const methodLabels: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card",
  credit_card: "Credit Card",
  stripe: "Stripe",
};

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  paid: { color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/40", label: "Paid" },
  completed: { color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/40", label: "Completed" },
  failed: { color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/40", label: "Failed" },
  refunded: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40", label: "Refunded" },
  pending: { color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950/40", label: "Pending" },
};

export default function PaymentDetails({ paymentId }: PaymentDetailsProps) {
  const [, navigate] = useLocation();

  const { data: payment, isLoading, error } = useQuery<any>({
    queryKey: ["/api/payments", paymentId],
    queryFn: async () => {
      const res = await fetch(`/api/payments/${paymentId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Payment not found");
      return res.json();
    },
  });

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

  if (error || !payment) {
    return (
      <div className="p-4 sm:p-5 max-w-2xl mx-auto">
        <button onClick={() => navigate("/payments")} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-6">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="text-center py-14">
          <p className="text-sm text-slate-500 dark:text-slate-400">Payment not found</p>
        </div>
      </div>
    );
  }

  const amountCents = payment.amountCents || Math.round(parseFloat(payment.amount || "0") * 100);
  const status = (payment.status || "paid").toLowerCase();
  const sc = statusConfig[status] || statusConfig.paid;
  const methodKey = (payment.paymentMethod || "").toLowerCase();
  const MethodIcon = methodIcons[methodKey] || DollarSign;
  const methodLabel = methodLabels[methodKey] || payment.paymentMethod || "—";

  const customerName = payment.customerName || "Unknown Customer";
  const invoiceNumber = payment.invoiceNumber || null;

  const details = [
    { icon: User, label: "Customer", value: customerName },
    ...(invoiceNumber ? [{ icon: Hash, label: "Invoice", value: `#${invoiceNumber}` }] : []),
    { icon: MethodIcon, label: "Method", value: methodLabel },
    ...(payment.checkNumber ? [{ icon: FileText, label: "Check #", value: payment.checkNumber }] : []),
    ...(payment.jobTitle ? [{ icon: Briefcase, label: "Job", value: payment.jobTitle }] : []),
    { icon: Calendar, label: "Date", value: safeFormat(payment.paidDate || payment.createdAt, "MMM d, yyyy 'at' h:mm a") },
    ...(payment.collectedByName ? [{ icon: User, label: "Recorded By", value: payment.collectedByName }] : []),
    ...(payment.notes ? [{ icon: FileText, label: "Notes", value: payment.notes }] : []),
  ];

  const checklist = [
    { label: "Payment recorded", done: true },
    { label: "Invoice updated", done: true },
    ...(payment.jobId ? [{ label: "Job status synced", done: true }] : []),
    {
      label: "QuickBooks synced",
      done: payment.qboPaymentSyncStatus === "synced",
      pending: payment.qboPaymentSyncStatus === "pending" || payment.qboPaymentSyncStatus === "waiting",
      na: !payment.qboPaymentSyncStatus,
    },
  ];

  return (
    <div className="p-4 sm:p-5 max-w-2xl mx-auto space-y-5">
      {/* Back */}
      <button onClick={() => navigate("/payments")} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Payments
      </button>

      {/* Amount + Status */}
      <div className="text-center py-4">
        <p className="text-4xl font-bold text-slate-900 dark:text-slate-100 tracking-tight tabular-nums mb-3">
          {formatCents(amountCents)}
        </p>
        <span className={`${sc.bg} ${sc.color} text-xs font-semibold px-3 py-1 rounded-full`}>
          {sc.label}
        </span>
      </div>

      {/* Details Card */}
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
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 break-words">
                  {item.value}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Status Checklist */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            System Status
          </p>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {checklist.map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              {(item as any).na ? (
                <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <span className="text-[10px] text-slate-400">—</span>
                </div>
              ) : (item as any).pending ? (
                <Clock className="w-5 h-5 text-yellow-500" />
              ) : item.done ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              )}
              <p className={`text-sm ${item.done || (item as any).na ? "text-slate-600 dark:text-slate-400" : (item as any).pending ? "text-yellow-600 dark:text-yellow-400" : "text-amber-600 dark:text-amber-400"}`}>
                {item.label}
                {(item as any).na && <span className="text-slate-400 ml-1 text-xs">(not connected)</span>}
                {(item as any).pending && <span className="text-yellow-500 ml-1 text-xs">(pending)</span>}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
