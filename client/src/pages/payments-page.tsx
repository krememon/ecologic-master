import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle,
  Receipt,
  ChevronRight,
  Search,
  Plus,
  X,
  Banknote,
  FileText,
  Loader2,
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

function RecordPaymentModal({
  open,
  onOpenChange,
  invoices,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoices: Invoice[];
}) {
  const { toast } = useToast();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "check">("cash");
  const [invoiceSearch, setInvoiceSearch] = useState("");

  const unpaidInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const totalCents = inv.totalCents || Math.round(parseFloat(inv.amount || "0") * 100);
      const paidCents = inv.paidAmountCents || 0;
      const balance = inv.balanceDueCents ?? (totalCents - paidCents);
      return balance > 0 && inv.status !== "paid";
    });
  }, [invoices]);

  const filteredUnpaidInvoices = useMemo(() => {
    if (!invoiceSearch.trim()) return unpaidInvoices;
    const q = invoiceSearch.toLowerCase();
    return unpaidInvoices.filter((inv) => {
      const name = getCustomerNameStatic(inv).toLowerCase();
      return name.includes(q) || inv.invoiceNumber?.toLowerCase().includes(q);
    });
  }, [unpaidInvoices, invoiceSearch]);

  const selectedInvoice = invoices.find((i) => i.id === selectedInvoiceId);

  const getBalance = (inv: Invoice) => {
    const totalCents = inv.totalCents || Math.round(parseFloat(inv.amount || "0") * 100);
    const paidCents = inv.paidAmountCents || 0;
    return inv.balanceDueCents ?? (totalCents - paidCents);
  };

  const recordMutation = useMutation({
    mutationFn: async () => {
      if (!selectedInvoiceId) throw new Error("Select an invoice");
      const amountVal = parseFloat(amount);
      if (isNaN(amountVal) || amountVal <= 0) throw new Error("Enter a valid amount");
      const amountCents = Math.round(amountVal * 100);
      const res = await apiRequest("POST", "/api/payments/manual", {
        invoiceId: selectedInvoiceId,
        method,
        amountCents,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payment recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      resetAndClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetAndClose = () => {
    setSelectedInvoiceId(null);
    setAmount("");
    setMethod("cash");
    setInvoiceSearch("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else onOpenChange(v); }}>
      <DialogContent className="w-[95vw] max-w-[420px] rounded-2xl p-0 gap-0 overflow-hidden [&>button]:hidden">
        <DialogHeader className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-center flex-1">Record Payment</DialogTitle>
            <button onClick={resetAndClose} className="min-w-[44px] flex items-center justify-end">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </DialogHeader>

        <div className="px-5 pb-5 space-y-4">
          {/* Invoice Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Invoice</Label>
            {selectedInvoice ? (
              <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {getCustomerNameStatic(selectedInvoice)}
                  </p>
                  <p className="text-xs text-slate-400">
                    #{selectedInvoice.invoiceNumber} · Balance: {formatCents(getBalance(selectedInvoice))}
                  </p>
                </div>
                <button onClick={() => setSelectedInvoiceId(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search invoices..."
                    value={invoiceSearch}
                    onChange={(e) => setInvoiceSearch(e.target.value)}
                    className="pl-9 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div className="max-h-[180px] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredUnpaidInvoices.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">No unpaid invoices</p>
                  ) : (
                    filteredUnpaidInvoices.map((inv) => (
                      <button
                        key={inv.id}
                        onClick={() => {
                          setSelectedInvoiceId(inv.id);
                          const bal = getBalance(inv);
                          setAmount((bal / 100).toFixed(2));
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {getCustomerNameStatic(inv)}
                        </p>
                        <p className="text-xs text-slate-400">
                          #{inv.invoiceNumber} · {formatCents(getBalance(inv))} owed
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Amount</Label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">$</span>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-8 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 tabular-nums"
              />
            </div>
            {selectedInvoice && (
              <p className="text-xs text-slate-400">
                Balance: {formatCents(getBalance(selectedInvoice))}
              </p>
            )}
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Method</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "cash" as const, label: "Cash", icon: Banknote },
                { key: "check" as const, label: "Check", icon: FileText },
              ]).map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.key}
                    onClick={() => setMethod(m.key)}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                      method === m.key
                        ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400"
                        : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              onClick={resetAndClose}
              className="flex-1 h-11 rounded-xl"
            >
              Cancel
            </Button>
            <Button
              onClick={() => recordMutation.mutate()}
              disabled={!selectedInvoiceId || !amount || recordMutation.isPending}
              className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              {recordMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Record Payment"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getCustomerNameStatic(invoice: Invoice): string {
  if (invoice.customer) {
    const { firstName, lastName, companyName } = invoice.customer;
    if (companyName) return companyName;
    return [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
  }
  if (invoice.client?.name) return invoice.client.name;
  return "Unknown Customer";
}

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [recordModalOpen, setRecordModalOpen] = useState(false);

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
    let list = invoices;
    if (activeTab !== "all") {
      list = list.filter((inv) => getInvoiceStatus(inv) === activeTab);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter((inv) => {
        const name = getCustomerNameStatic(inv).toLowerCase();
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

    if (status === "paid" || status === "partial") {
      const relatedPayment = payments.find((p) => p.invoiceId === invoice.id);
      const paidDate = relatedPayment?.paidDate || relatedPayment?.createdAt;
      const date = safeParseDate(paidDate);
      if (date) {
        if (isToday(date)) return "Today";
        if (isYesterday(date)) return "Yesterday";
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

  if (invoicesLoading || statsLoading) {
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
      value: stats ? formatCents(stats.thisMonthTotalCents) : "$0.00",
      color: "text-slate-900 dark:text-slate-100",
    },
    {
      label: "Still Owed",
      value: stats ? formatCents(stats.stillOwedTotalCents) : "$0.00",
      color: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Paid Today",
      value: stats ? formatCents(stats.paidTodayTotalCents) : "$0.00",
      color: "text-slate-900 dark:text-slate-100",
    },
    {
      label: "Overdue",
      value: stats ? String(stats.overdueCount) : "0",
      color: stats && stats.overdueCount > 0 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-100",
    },
  ];

  return (
    <div className="p-4 sm:p-5 space-y-4 max-w-2xl mx-auto">
      {/* Header */}
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

      {/* Scoreboard */}
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

      {/* Segmented Control */}
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

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Search payments..."
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

      {/* Invoice List */}
      {filteredInvoices.length === 0 ? (
        <div className="text-center py-14 px-4">
          <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3">
            <Receipt className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {searchTerm ? "No matching payments" : activeTab !== "all" ? "No matching invoices" : "No invoices yet"}
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
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer active:bg-slate-100 dark:active:bg-slate-800/60"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 mb-0.5">
                    <p className="font-semibold text-[14px] text-slate-900 dark:text-slate-100 leading-snug break-words">
                      {getCustomerNameStatic(invoice)}
                    </p>
                    {getStatusBadge(status)}
                  </div>
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-relaxed">
                    #{invoice.invoiceNumber}
                    {dateStr && <span className="ml-1.5">· {dateStr}</span>}
                  </p>
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

      {/* Record Payment Modal */}
      <RecordPaymentModal
        open={recordModalOpen}
        onOpenChange={setRecordModalOpen}
        invoices={invoices}
      />
    </div>
  );
}
