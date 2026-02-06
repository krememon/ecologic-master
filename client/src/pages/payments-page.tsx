import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecordPaymentModal } from "@/components/modals/RecordPaymentModal";
import {
  Receipt,
  ChevronRight,
  Search,
  Plus,
  X,
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
  estimateId?: number | null;
  customer?: {
    firstName?: string;
    lastName?: string;
    companyName?: string;
  };
  client?: {
    name?: string;
  };
  job?: {
    title?: string;
    clientName?: string;
  };
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

function getCustomerName(invoice: Invoice): string {
  if (invoice.customer) {
    const { firstName, lastName, companyName } = invoice.customer;
    if (companyName) return companyName;
    return [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
  }
  if (invoice.client?.name) return invoice.client.name;
  if (invoice.job?.clientName) return invoice.job.clientName;
  return "Unknown Customer";
}

function getInvoiceStatus(invoice: Invoice): string {
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
}

export default function PaymentsPage() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [recordModalOpen, setRecordModalOpen] = useState(false);

  const { data: allInvoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const invoices = useMemo(() => {
    return allInvoices.filter((inv) => !inv.estimateId);
  }, [allInvoices]);

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let thisMonthTotalCents = 0;
    let stillOwedTotalCents = 0;
    let paidTodayTotalCents = 0;
    let overdueCount = 0;

    for (const inv of invoices) {
      const totalCents = inv.totalCents || Math.round(parseFloat(inv.amount || "0") * 100);
      const paidCents = inv.paidAmountCents || 0;
      const balanceCents = inv.balanceDueCents ?? (totalCents - paidCents);
      const status = getInvoiceStatus(inv);

      if (status === "paid" && inv.paidDate) {
        const pd = safeParseDate(inv.paidDate);
        if (pd && pd >= thisMonthStart) thisMonthTotalCents += totalCents;
        if (pd && pd >= todayStart) paidTodayTotalCents += totalCents;
      }

      if (status === "unpaid" || status === "partial" || status === "overdue") {
        stillOwedTotalCents += balanceCents;
      }

      if (status === "overdue") overdueCount++;
    }

    return { thisMonthTotalCents, stillOwedTotalCents, paidTodayTotalCents, overdueCount };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    let list = invoices;
    if (activeTab !== "all") {
      list = list.filter((inv) => getInvoiceStatus(inv) === activeTab);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter((inv) => {
        const name = getCustomerName(inv).toLowerCase();
        const num = (inv.invoiceNumber || "").toLowerCase();
        const totalCents = inv.totalCents || Math.round(parseFloat(inv.amount || "0") * 100);
        const amountStr = (totalCents / 100).toFixed(2);
        return name.includes(q) || num.includes(q) || amountStr.includes(q);
      });
    }
    return list;
  }, [invoices, activeTab, searchTerm]);

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { color: string; label: string }> = {
      paid: { color: "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400", label: "Paid" },
      partial: { color: "bg-yellow-50 text-yellow-600 dark:bg-yellow-950/40 dark:text-yellow-400", label: "Partial" },
      unpaid: { color: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400", label: "Unpaid" },
      overdue: { color: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400", label: "Overdue" },
    };
    const config = configs[status] || configs.unpaid;
    return (
      <span className={`${config.color} text-[11px] font-semibold px-2 py-0.5 rounded-full`}>
        {config.label}
      </span>
    );
  };

  const getDateDisplay = (invoice: Invoice): string => {
    const status = getInvoiceStatus(invoice);

    if (status === "paid") {
      const paidDate = safeParseDate(invoice.paidDate);
      if (paidDate) {
        if (isToday(paidDate)) return "Paid Today";
        if (isYesterday(paidDate)) return "Paid Yesterday";
        return `Paid ${format(paidDate, "MMM d")}`;
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
    const status = getInvoiceStatus(invoice);

    if (status === "paid") {
      return { primary: formatCents(totalCents), secondary: null };
    }
    if (status === "partial") {
      return { primary: formatCents(paidCents), secondary: `/ ${formatCents(totalCents)}` };
    }
    return { primary: formatCents(totalCents), secondary: null };
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unpaid", label: "Unpaid" },
    { key: "paid", label: "Paid" },
    { key: "overdue", label: "Overdue" },
    { key: "partial", label: "Partial" },
  ];

  if (invoicesLoading) {
    return (
      <div className="p-4 sm:p-5 space-y-4 max-w-2xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-7 bg-slate-200 dark:bg-slate-700 rounded-lg w-28"></div>
          <div className="h-[140px] bg-slate-200 dark:bg-slate-700 rounded-2xl"></div>
          <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
          <div className="space-y-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[72px] bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const scoreboardItems = [
    {
      label: "This Month",
      value: formatCents(stats.thisMonthTotalCents),
      color: "text-slate-900 dark:text-slate-100",
    },
    {
      label: "Still Owed",
      value: formatCents(stats.stillOwedTotalCents),
      color: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Paid Today",
      value: formatCents(stats.paidTodayTotalCents),
      color: "text-slate-900 dark:text-slate-100",
    },
    {
      label: "Overdue",
      value: String(stats.overdueCount),
      color: stats.overdueCount > 0 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-100",
    },
  ];

  return (
    <div className="p-4 sm:p-5 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Payments</h1>
        <Button
          onClick={() => setRecordModalOpen(true)}
          className="h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium gap-1.5 px-4"
        >
          <Plus className="w-4 h-4" />
          Record Payment
        </Button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
        <div className="grid grid-cols-2">
          {scoreboardItems.map((item, i) => (
            <div
              key={item.label}
              className={`px-5 py-4 ${
                i < 2 ? "border-b border-slate-100 dark:border-slate-800" : ""
              } ${i % 2 === 0 ? "border-r border-slate-100 dark:border-slate-800" : ""}`}
            >
              <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
                {item.label}
              </p>
              <p className={`text-xl font-bold tracking-tight ${item.color}`}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-100 dark:bg-slate-800/60 rounded-xl p-[3px] flex">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 text-[13px] font-medium py-[7px] rounded-[10px] transition-all ${
              activeTab === tab.key
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Search invoices..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 pr-9 h-10 rounded-xl bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 text-sm"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {filteredInvoices.length === 0 ? (
        <div className="text-center py-14 px-4">
          <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3">
            <Receipt className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {searchTerm ? "No matching invoices" : activeTab !== "all" ? "No matching invoices" : "No invoices yet"}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
          {filteredInvoices.map((invoice) => {
            const status = getInvoiceStatus(invoice);
            const amount = getAmountDisplay(invoice);
            const dateStr = getDateDisplay(invoice);

            return (
              <div
                key={invoice.id}
                onClick={() => navigate(`/payments/invoice/${invoice.id}`)}
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer active:bg-slate-100 dark:active:bg-slate-800/60"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 mb-0.5">
                    <p className="font-semibold text-[14px] text-slate-900 dark:text-slate-100 leading-snug break-words">
                      {getCustomerName(invoice)}
                    </p>
                    {getStatusBadge(status)}
                  </div>
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-relaxed">
                    #{invoice.invoiceNumber}
                    {dateStr && <span className="ml-1.5">· {dateStr}</span>}
                  </p>
                  {invoice.jobId && invoice.job?.title && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-1.5 py-[1px] rounded-full leading-snug">
                        From Job
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[200px]">
                        {invoice.job.title}
                      </span>
                    </div>
                  )}
                </div>

                <div className="text-right shrink-0 mr-0.5">
                  <p className="text-[15px] font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {amount.primary}
                  </p>
                  {amount.secondary && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">{amount.secondary}</p>
                  )}
                </div>

                <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
              </div>
            );
          })}
        </div>
      )}

      <RecordPaymentModal
        open={recordModalOpen}
        onOpenChange={setRecordModalOpen}
      />
    </div>
  );
}
