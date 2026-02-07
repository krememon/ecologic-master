import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  DollarSign,
  User,
  FileText,
  CreditCard,
  Banknote,
  Calendar,
  Hash,
  Briefcase,
  Receipt,
  RotateCcw,
} from "lucide-react";
import { format, parseISO } from "date-fns";

interface InvoicePaymentDetailsProps {
  invoiceId: string;
}

const REFUND_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "SUPERVISOR"]);

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

export default function InvoicePaymentDetails({ invoiceId }: InvoicePaymentDetailsProps) {
  const [, navigate] = useLocation();

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
  const canRefund = REFUND_ROLES.has((membership?.role || "").toUpperCase());

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

  const paidCents = data.paidAmountCents || 0;
  const balanceCents = Math.max(totalCents - paidCents, 0);
  const isPaid = balanceCents === 0 && totalCents > 0;
  const isPartial = paidCents > 0 && balanceCents > 0;

  const details = [
    { icon: User, label: "Customer", value: data.customerName || "Unknown Customer" },
    ...(data.invoiceNumber ? [{ icon: Hash, label: "Invoice", value: `#${data.invoiceNumber}` }] : []),
    ...(data.jobTitle ? [{ icon: Briefcase, label: "Job", value: data.jobTitle }] : []),
    { icon: DollarSign, label: "Invoice Total", value: formatCents(totalCents) },
    ...(isPaid || isPartial ? [{ icon: DollarSign, label: "Amount Paid", value: formatCents(paidCents) }] : []),
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
        <p className="text-4xl font-bold text-slate-900 dark:text-slate-100 tracking-tight tabular-nums mb-3">
          {formatCents(totalCents)}
        </p>
        {isPaid ? (
          <span className="bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 text-xs font-semibold px-3 py-1 rounded-full">
            Paid
          </span>
        ) : isPartial ? (
          <span className="bg-yellow-50 dark:bg-yellow-950/40 text-yellow-600 dark:text-yellow-400 text-xs font-semibold px-3 py-1 rounded-full">
            Partial
          </span>
        ) : (
          <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-xs font-semibold px-3 py-1 rounded-full">
            Unpaid
          </span>
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
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 break-words">
                  {item.value}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Payment History
          </p>
        </div>
        {payments.length === 0 ? (
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
              const isFullyRefunded = refundedCents >= paymentCents;
              const showRefundBtn = canRefund && !isFullyRefunded && payment.id;

              return (
                <div key={payment.id || idx} className="flex items-center gap-3 px-4 py-3.5">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isFullyRefunded ? "bg-red-50 dark:bg-red-950/40" : "bg-green-50 dark:bg-green-950/40"}`}>
                    <MethodIcon className={`w-4 h-4 ${isFullyRefunded ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {methodLabel}
                      {isFullyRefunded && <span className="ml-1.5 text-[11px] text-red-500 font-semibold">Refunded</span>}
                      {!isFullyRefunded && refundedCents > 0 && <span className="ml-1.5 text-[11px] text-amber-500 font-semibold">Partial Refund</span>}
                    </p>
                    <p className="text-[12px] text-slate-400 dark:text-slate-500">
                      {safeFormat(payment.paidDate || payment.createdAt, "MMM d, yyyy 'at' h:mm a")}
                      {payment.checkNumber && <span className="ml-1.5">· Check #{payment.checkNumber}</span>}
                      {payment.collectedByName && <span className="ml-1.5">· by {payment.collectedByName}</span>}
                      {payment.notes && <span className="ml-1.5">· {payment.notes}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className={`text-sm font-bold tabular-nums ${isFullyRefunded ? "text-red-500 dark:text-red-400 line-through" : "text-green-600 dark:text-green-400"}`}>
                      +{formatCents(paymentCents)}
                    </p>
                    {showRefundBtn && (
                      <button
                        onClick={() => navigate(`/refunds/new?paymentId=${payment.id}`)}
                        className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-red-50 hover:border-red-200 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:border-red-800 dark:hover:text-red-400 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 focus-visible:ring-offset-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Refund
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {data.refunds && data.refunds.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              Refunds
            </p>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.refunds.map((refund: any) => {
              const statusColors: Record<string, string> = {
                succeeded: "text-red-500",
                pending: "text-amber-500",
                failed: "text-slate-400",
                returned: "text-slate-400",
                cancelled: "text-slate-400",
              };
              return (
                <div key={refund.id} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="w-8 h-8 bg-red-50 dark:bg-red-950/40 rounded-full flex items-center justify-center shrink-0">
                    <RotateCcw className="w-4 h-4 text-red-500 dark:text-red-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {refund.method === 'card' ? 'Card Refund' : refund.method === 'bank' ? 'Bank Refund' : refund.method === 'check' ? 'Check Refund' : 'Cash Refund'}
                      {refund.status === 'pending' && <span className="ml-1.5 text-[11px] text-amber-500 font-semibold">Pending</span>}
                    </p>
                    <p className="text-[12px] text-slate-400 dark:text-slate-500">
                      {safeFormat(refund.createdAt, "MMM d, yyyy 'at' h:mm a")}
                      {refund.reason && <span className="ml-1.5">· {refund.reason}</span>}
                    </p>
                  </div>
                  <p className={`text-sm font-bold tabular-nums shrink-0 ${statusColors[refund.status] || "text-red-500"}`}>
                    -{formatCents(refund.amountCents)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
