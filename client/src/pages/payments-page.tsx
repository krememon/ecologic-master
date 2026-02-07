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

type LedgerItem = {
  invoiceId: number;
  invoiceNumber: string | null;
  customerId: number | null;
  customerName: string;
  jobId: number | null;
  jobTitle: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  refundedCents: number;
  netCollectedCents: number;
  status: string;
  dueDate: string | null;
  issueDate: string | null;
  createdAt: string | null;
  lastActivityDate: string | null;
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

type FilterTab = "all" | "unpaid" | "paid" | "partial";

export default function PaymentsPage() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [recordModalOpen, setRecordModalOpen] = useState(false);

  const { data: ledgerItems = [], isLoading: ledgerLoading } = useQuery<LedgerItem[]>({
    queryKey: ["/api/payments/ledger"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<StatsData>({
    queryKey: ["/api/payments/stats"],
  });

  const filteredItems = useMemo(() => {
    let list = ledgerItems;
    if (activeTab !== "all") {
      list = list.filter((item) => {
        if (activeTab === "paid") {
          return item.status === "paid" || item.status === "refunded" || item.status === "partially_refunded";
        }
        return item.status === activeTab;
      });
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter((item) => {
        const name = (item.customerName || "").toLowerCase();
        const invNum = (item.invoiceNumber || "").toLowerCase();
        const totalStr = (item.totalCents / 100).toFixed(2);
        const balanceStr = (item.balanceCents / 100).toFixed(2);
        const job = (item.jobTitle || "").toLowerCase();
        return name.includes(q) || invNum.includes(q) || totalStr.includes(q) || balanceStr.includes(q) || job.includes(q);
      });
    }
    return list;
  }, [ledgerItems, activeTab, searchTerm]);

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { color: string; label: string }> = {
      paid: { color: "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400", label: "Paid" },
      partial: { color: "bg-yellow-50 text-yellow-600 dark:bg-yellow-950/40 dark:text-yellow-400", label: "Partial" },
      unpaid: { color: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400", label: "Unpaid" },
      refunded: { color: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400", label: "Refunded" },
      partially_refunded: { color: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400", label: "Partially Refunded" },
    };
    const config = configs[status] || configs.unpaid;
    return (
      <span className={`${config.color} text-[11px] font-semibold px-2 py-0.5 rounded-full`}>
        {config.label}
      </span>
    );
  };

  const getDateDisplay = (item: LedgerItem): string => {
    const date = safeParseDate(item.lastActivityDate) || safeParseDate(item.createdAt);
    if (!date) return "";
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "MMM d");
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "paid", label: "Paid" },
    { key: "unpaid", label: "Unpaid" },
    { key: "partial", label: "Partial" },
  ];

  if (ledgerLoading || statsLoading) {
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
      value: formatCents(stats?.thisMonthTotalCents || 0),
      color: "text-slate-900 dark:text-slate-100",
    },
    {
      label: "Still Owed",
      value: formatCents(stats?.stillOwedTotalCents || 0),
      color: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Paid Today",
      value: formatCents(stats?.paidTodayTotalCents || 0),
      color: "text-slate-900 dark:text-slate-100",
    },
    {
      label: "Overdue",
      value: String(stats?.overdueCount || 0),
      color: (stats?.overdueCount || 0) > 0 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-100",
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

      {filteredItems.length === 0 ? (
        <div className="text-center py-14 px-4">
          <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3">
            <Receipt className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {searchTerm ? "No matching payments" : activeTab !== "all" ? "No matching payments" : "No payments yet"}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
          {filteredItems.map((item) => {
            const dateStr = getDateDisplay(item);
            const isOwed = item.status === "unpaid" || item.status === "partial";
            const hasRefunds = (item.refundedCents || 0) > 0;

            let displayAmount: number;
            let amountSuffix = "";
            let amountColor: string;

            if (isOwed) {
              displayAmount = item.balanceCents;
              amountSuffix = " owed";
              amountColor = item.status === "unpaid" ? "text-amber-600 dark:text-amber-400" : "text-yellow-600 dark:text-yellow-400";
            } else if (hasRefunds) {
              displayAmount = item.netCollectedCents;
              amountColor = item.status === "refunded" ? "text-red-500 dark:text-red-400" : "text-slate-900 dark:text-slate-100";
            } else {
              displayAmount = item.totalCents;
              amountColor = "text-slate-900 dark:text-slate-100";
            }

            let subtitle: string;
            if (item.status === "paid") subtitle = `Paid · ${dateStr}`;
            else if (item.status === "partial") subtitle = `Partial · ${dateStr}`;
            else if (item.status === "refunded") subtitle = `Paid · Refunded · ${dateStr}`;
            else if (item.status === "partially_refunded") subtitle = `Paid · Refunded ${formatCents(item.refundedCents || 0)} · ${dateStr}`;
            else subtitle = dateStr;

            return (
              <div
                key={item.invoiceId}
                onClick={() => navigate(`/payments/invoice/${item.invoiceId}`)}
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer active:bg-slate-100 dark:active:bg-slate-800/60"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 mb-0.5">
                    <p className="font-semibold text-[14px] text-slate-900 dark:text-slate-100 leading-snug break-words">
                      {item.customerName}
                    </p>
                    {getStatusBadge(item.status)}
                  </div>
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 leading-relaxed">
                    {subtitle}
                    {item.invoiceNumber && <span className="ml-1.5">· #{item.invoiceNumber}</span>}
                    {item.jobTitle && <span className="ml-1.5">· {item.jobTitle}</span>}
                  </p>
                </div>

                <div className="text-right shrink-0 mr-0.5">
                  <p className={`text-[15px] font-bold tabular-nums ${amountColor}`}>
                    {formatCents(displayAmount)}{amountSuffix}
                  </p>
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
