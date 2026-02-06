import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DollarSign,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle,
  CreditCard,
  Banknote,
  FileText,
  Receipt,
  ChevronRight,
} from "lucide-react";
import { format, parseISO, isToday, isYesterday } from "date-fns";

type Invoice = {
  id: number;
  invoiceNumber: string;
  status: string;
  amount: string;
  totalCents: number;
  paidAmountCents?: number;
  balanceDueCents?: number;
  dueDate?: string;
  paidDate?: string;
  createdAt?: string;
  jobId: number;
  jobTitle?: string;
  customer?: {
    firstName?: string;
    lastName?: string;
    companyName?: string;
  };
  client?: {
    name?: string;
  };
};

type Payment = {
  id: number;
  invoiceId: number;
  amount: string;
  amountCents?: number;
  paymentMethod: string;
  paidDate?: string;
  createdAt?: string;
  status: string;
};

type StatsData = {
  thisMonthTotalCents: number;
  stillOwedTotalCents: number;
  paidTodayTotalCents: number;
  overdueCount: number;
};

const formatCents = (cents: number): string => {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const safeParseDate = (dateStr: string | undefined | null): Date | null => {
  if (!dateStr) return null;
  try {
    const date = parseISO(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
};

type FilterTab = "all" | "unpaid" | "paid" | "overdue" | "partial";

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const { data: stats, isLoading: statsLoading } = useQuery<StatsData>({
    queryKey: ["/api/payments/stats"],
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: payments = [] } = useQuery<Payment[]>({
    queryKey: ["/api/payments"],
  });

  const getInvoiceStatus = (invoice: Invoice): string => {
    const totalCents = invoice.totalCents || Math.round(parseFloat(invoice.amount || "0") * 100);
    const paidCents = invoice.paidAmountCents || 0;
    const balanceCents = invoice.balanceDueCents ?? (totalCents - paidCents);

    if (invoice.status === "paid" || balanceCents <= 0) return "paid";
    if (paidCents > 0 && balanceCents > 0) return "partial";

    if (invoice.dueDate) {
      const due = safeParseDate(invoice.dueDate);
      if (due) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (due < today && invoice.status !== "paid") return "overdue";
      }
    }

    return "unpaid";
  };

  const filteredInvoices = useMemo(() => {
    if (activeTab === "all") return invoices;
    return invoices.filter((inv) => getInvoiceStatus(inv) === activeTab);
  }, [invoices, activeTab]);

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { color: string; label: string; icon: typeof CheckCircle }> = {
      paid: { color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", label: "Paid", icon: CheckCircle },
      partial: { color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", label: "Partial", icon: TrendingUp },
      unpaid: { color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", label: "Unpaid", icon: Clock },
      overdue: { color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", label: "Overdue", icon: AlertTriangle },
    };
    const config = configs[status] || configs.unpaid;
    const Icon = config.icon;
    return (
      <Badge className={`${config.color} flex items-center gap-1 font-semibold text-xs px-2 py-0.5 border-0`}>
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };

  const getCustomerName = (invoice: Invoice): string => {
    if (invoice.customer) {
      const { firstName, lastName, companyName } = invoice.customer;
      if (companyName) return companyName;
      return [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
    }
    if (invoice.client?.name) return invoice.client.name;
    return "Unknown Customer";
  };

  const getDateDisplay = (invoice: Invoice): string => {
    const status = getInvoiceStatus(invoice);

    if (status === "paid" || status === "partial") {
      const relatedPayment = payments.find((p) => p.invoiceId === invoice.id);
      const paidDate = relatedPayment?.paidDate || relatedPayment?.createdAt;
      const date = safeParseDate(paidDate);
      if (date) {
        if (isToday(date)) return `Today`;
        if (isYesterday(date)) return `Yesterday`;
        return format(date, "MMM d, yyyy");
      }
    }

    const dueDate = safeParseDate(invoice.dueDate);
    if (dueDate) {
      if (isToday(dueDate)) return "Due Today";
      return `Due ${format(dueDate, "MMM d")}`;
    }

    return "";
  };

  const getAmountDisplay = (invoice: Invoice) => {
    const totalCents = invoice.totalCents || Math.round(parseFloat(invoice.amount || "0") * 100);
    const paidCents = invoice.paidAmountCents || 0;
    const balanceCents = invoice.balanceDueCents ?? (totalCents - paidCents);
    const status = getInvoiceStatus(invoice);

    if (status === "paid") {
      return { primary: formatCents(totalCents), secondary: null };
    }
    if (status === "partial") {
      return { primary: formatCents(balanceCents), secondary: `of ${formatCents(totalCents)}` };
    }
    return { primary: formatCents(totalCents), secondary: null };
  };

  const getPaymentMethodIcon = (method: string) => {
    const m = method?.toLowerCase() || "";
    if (m === "cash") return Banknote;
    if (m === "check") return FileText;
    if (m === "credit_card" || m === "card" || m === "stripe") return CreditCard;
    return DollarSign;
  };

  const scoreboard = [
    {
      label: "This Month",
      value: stats ? formatCents(stats.thisMonthTotalCents) : "$0.00",
      icon: DollarSign,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-50 dark:bg-green-900/20",
    },
    {
      label: "Still Owed",
      value: stats ? formatCents(stats.stillOwedTotalCents) : "$0.00",
      icon: Clock,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-900/20",
    },
    {
      label: "Paid Today",
      value: stats ? formatCents(stats.paidTodayTotalCents) : "$0.00",
      icon: TrendingUp,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-900/20",
    },
    {
      label: "Overdue",
      value: stats ? String(stats.overdueCount) : "0",
      icon: AlertTriangle,
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-900/20",
    },
  ];

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unpaid", label: "Unpaid" },
    { key: "paid", label: "Paid" },
    { key: "overdue", label: "Overdue" },
    { key: "partial", label: "Partial" },
  ];

  if (invoicesLoading || statsLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/3"></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
            ))}
          </div>
          <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      {/* PROOF BANNER */}
      <div className="bg-green-100 dark:bg-green-900/40 border border-green-300 dark:border-green-700 rounded-xl px-4 py-2 text-center">
        <span className="font-bold text-green-800 dark:text-green-300 text-sm">
          PAYMENTS PAGE UPDATED
        </span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Payments</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Financial overview</p>
      </div>

      {/* Scoreboard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {scoreboard.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="shadow-sm border border-slate-200 dark:border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 ${stat.bg} rounded-lg flex items-center justify-center`}>
                    <Icon className={`w-4 h-4 ${stat.color}`} />
                  </div>
                </div>
                <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  {stat.value}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{stat.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 text-sm font-medium py-2 px-3 rounded-lg transition-all ${
              activeTab === tab.key
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Invoice Feed */}
      <div className="space-y-2">
        {filteredInvoices.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div className="w-14 h-14 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <Receipt className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
              {activeTab !== "all" ? "No matching invoices" : "No invoices yet"}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {activeTab !== "all"
                ? "Try a different filter"
                : "Invoices will appear here once created"}
            </p>
          </div>
        ) : (
          filteredInvoices.map((invoice) => {
            const status = getInvoiceStatus(invoice);
            const amount = getAmountDisplay(invoice);
            const dateStr = getDateDisplay(invoice);
            const lastPayment = payments.find((p) => p.invoiceId === invoice.id);
            const MethodIcon = lastPayment
              ? getPaymentMethodIcon(lastPayment.paymentMethod)
              : DollarSign;

            return (
              <Card
                key={invoice.id}
                className="shadow-sm border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-colors cursor-pointer"
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center shrink-0">
                      <MethodIcon className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                          {getCustomerName(invoice)}
                        </p>
                        {getStatusBadge(status)}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>#{invoice.invoiceNumber}</span>
                        {invoice.jobTitle && (
                          <>
                            <span>-</span>
                            <span className="truncate">{invoice.jobTitle}</span>
                          </>
                        )}
                        {dateStr && (
                          <>
                            <span>-</span>
                            <span>{dateStr}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {amount.primary}
                      </p>
                      {amount.secondary && (
                        <p className="text-xs text-slate-400">{amount.secondary}</p>
                      )}
                    </div>

                    <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
