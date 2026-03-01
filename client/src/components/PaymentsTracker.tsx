import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  DollarSign, 
  CreditCard, 
  Clock, 
  CheckCircle, 
  AlertTriangle,
  Plus,
  X,
  Banknote,
  FileText,
  User,
  Calendar
} from "lucide-react";
import { format, isToday, isYesterday, parseISO } from "date-fns";

interface LedgerItem {
  invoiceId: number;
  invoiceNumber: string;
  customerId?: number;
  customerName: string;
  jobId?: number;
  jobTitle?: string;
  totalCents: number;
  paidCents: number;
  balanceDueCents: number;
  refundedCents: number;
  computedStatus: string;
  dueDate?: string;
  issueDate?: string;
  createdAt?: string;
  lastActivityDate?: string;
  lastPayment?: {
    amountCents: number;
    status: string;
    paymentMethod: string;
    paidDate?: string;
    stripePaymentIntentId?: string;
  } | null;
  diagnostics?: {
    paymentRowsFound: number;
    succeededCount: number;
    latestStatusesSample: string[];
    invoiceIdKeyUsed: number;
  };
}

interface LedgerStats {
  stillOwedCents: number;
  paidTodayCents: number;
  overdueCount: number;
  earningsThisMonthCents: number;
}

interface LedgerResponse {
  items: LedgerItem[];
  stats: LedgerStats;
  debug: any;
}

type FilterTab = "all" | "paid" | "unpaid" | "overdue" | "partial";

const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1, "Invoice is required"),
  amount: z.string().min(1, "Amount is required"),
  paymentMethod: z.enum(["cash", "check"]),
});

type RecordPaymentFormData = z.infer<typeof recordPaymentSchema>;

interface PaymentsTrackerProps {
  jobs?: any[];
}

export function PaymentsTracker({ jobs = [] }: PaymentsTrackerProps) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: ledgerData, isLoading } = useQuery<LedgerResponse>({
    queryKey: ["/api/payments/ledger"],
  });

  const items = ledgerData?.items || [];
  const stats = ledgerData?.stats;

  const form = useForm<RecordPaymentFormData>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      invoiceId: "",
      amount: "",
      paymentMethod: "cash",
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async (data: RecordPaymentFormData) => {
      const amountCents = Math.round(parseFloat(data.amount) * 100);
      const item = items.find(i => i.invoiceId === parseInt(data.invoiceId));
      const response = await apiRequest('POST', '/api/payments/manual', {
        invoiceId: parseInt(data.invoiceId),
        amountCents,
        paymentMethod: data.paymentMethod,
        customerId: item?.customerId,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payments/ledger'] });
      queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      setIsRecordPaymentOpen(false);
      form.reset();
      toast({
        title: "Payment Recorded",
        description: "The payment has been recorded successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRecordPayment = (data: RecordPaymentFormData) => {
    recordPaymentMutation.mutate(data);
  };

  const formatCents = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  const getFilterStatus = (item: LedgerItem): FilterTab => {
    const st = item.computedStatus;
    if (st === 'paid') return 'paid';
    if (st === 'partial') return 'partial';
    const today = new Date().toISOString().split('T')[0];
    if (item.dueDate && item.dueDate < today && item.balanceDueCents > 0) return 'overdue';
    if (st === 'unpaid') return 'unpaid';
    return 'unpaid';
  };

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { color: string; label: string; icon: any }> = {
      paid: { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", label: "PAID", icon: CheckCircle },
      partial: { color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", label: "PARTIAL", icon: Clock },
      unpaid: { color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400", label: "UNPAID", icon: FileText },
      overdue: { color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", label: "OVERDUE", icon: AlertTriangle },
    };
    const config = configs[status] || configs.unpaid;
    const Icon = config.icon;
    return (
      <Badge className={`${config.color} flex items-center gap-1 font-semibold text-xs px-2 py-0.5`}>
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };

  const getPaymentMethodDisplay = (method: string) => {
    const methodLower = method?.toLowerCase() || "";
    if (methodLower === "cash") return { label: "Cash", icon: Banknote };
    if (methodLower === "check") return { label: "Check", icon: FileText };
    if (methodLower === "credit_card" || methodLower === "card" || methodLower === "stripe") return { label: "Card", icon: CreditCard };
    return { label: method || "Other", icon: DollarSign };
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

  const getDateDisplay = (item: LedgerItem): string => {
    const filterSt = getFilterStatus(item);
    if (filterSt === "paid" || filterSt === "partial") {
      const paidDate = item.lastPayment?.paidDate;
      const date = safeParseDate(paidDate);
      if (date) {
        if (isToday(date)) return `Today \u2022 ${format(date, 'h:mm a')}`;
        if (isYesterday(date)) return `Yesterday \u2022 ${format(date, 'h:mm a')}`;
        return format(date, 'MMM d, yyyy');
      }
    }
    const dueDate = safeParseDate(item.dueDate);
    if (dueDate) {
      if (isToday(dueDate)) return "Due Today";
      if (isYesterday(dueDate)) return "Due Yesterday";
      if (dueDate < new Date()) return `Due ${format(dueDate, 'MMM d')}`;
      return `Due ${format(dueDate, 'MMM d')}`;
    }
    return "";
  };

  const filteredItems = items.filter(item => {
    if (activeFilter === "all") return true;
    return getFilterStatus(item) === activeFilter;
  });

  const unpaidItems = items.filter(item => {
    const st = item.computedStatus;
    return st === 'unpaid' || st === 'partial';
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
                <div className="h-7 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Scoreboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/20 dark:to-gray-900 border-blue-100 dark:border-blue-900/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">This Month</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCents(stats?.earningsThisMonthCents || 0)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-yellow-50 to-white dark:from-yellow-950/20 dark:to-gray-900 border-yellow-100 dark:border-yellow-900/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
              <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400 uppercase tracking-wide">Still Owed</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCents(stats?.stillOwedCents || 0)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-white dark:from-green-950/20 dark:to-gray-900 border-green-100 dark:border-green-900/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">Paid Today</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCents(stats?.paidTodayCents || 0)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-gray-900 border-red-100 dark:border-red-900/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
              <span className="text-xs font-medium text-red-600 dark:text-red-400 uppercase tracking-wide">Overdue</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats?.overdueCount || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {(["all", "paid", "unpaid", "overdue", "partial"] as FilterTab[]).map((tab) => (
          <Button
            key={tab}
            variant={activeFilter === tab ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter(tab)}
            className={`rounded-full px-4 capitalize whitespace-nowrap ${
              activeFilter === tab 
                ? "bg-blue-600 hover:bg-blue-700 text-white" 
                : "hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            {tab === "all" ? "All" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </Button>
        ))}
      </div>

      {/* Payment Feed */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <DollarSign className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No invoices found</h3>
              <p className="text-gray-500 dark:text-gray-400">
                {activeFilter !== "all" 
                  ? `No ${activeFilter} invoices at this time.` 
                  : "Create your first invoice to start tracking payments."}
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredItems.map((item) => {
            const displayStatus = getFilterStatus(item);
            const dateDisplay = getDateDisplay(item);
            const amountDisplay = displayStatus === "partial" 
              ? `${formatCents(item.paidCents)} of ${formatCents(item.totalCents)}`
              : formatCents(item.totalCents);
            
            const paymentMethodInfo = item.lastPayment ? getPaymentMethodDisplay(item.lastPayment.paymentMethod) : null;

            return (
              <Card 
                key={item.invoiceId} 
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setSelectedInvoiceId(item.invoiceId)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="font-semibold text-gray-900 dark:text-white truncate">
                          {item.customerName}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Invoice #{item.invoiceNumber}
                        {item.jobTitle && ` \u2022 ${item.jobTitle}`}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        {getStatusBadge(displayStatus)}
                        {paymentMethodInfo && (displayStatus === "paid" || displayStatus === "partial") && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <paymentMethodInfo.icon className="w-3 h-3" />
                            {paymentMethodInfo.label}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-lg font-bold ${
                        displayStatus === "paid" ? "text-green-600 dark:text-green-400" :
                        displayStatus === "overdue" ? "text-red-600 dark:text-red-400" :
                        displayStatus === "partial" ? "text-yellow-600 dark:text-yellow-400" :
                        "text-gray-900 dark:text-white"
                      }`}>
                        {amountDisplay}
                      </p>
                      {displayStatus === "partial" && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatCents(item.balanceDueCents)} remaining
                        </p>
                      )}
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        {dateDisplay}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Floating Record Payment Button */}
      <Button
        onClick={() => setIsRecordPaymentOpen(true)}
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 h-14 w-14 rounded-full shadow-lg bg-blue-600 hover:bg-blue-700 z-50"
        size="icon"
      >
        <Plus className="w-6 h-6" />
      </Button>

      {/* Record Payment Modal */}
      <Dialog open={isRecordPaymentOpen} onOpenChange={setIsRecordPaymentOpen}>
        <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative">
            <div className="min-w-[44px]" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex-1 text-center">Record Payment</h3>
            <button 
              onClick={() => setIsRecordPaymentOpen(false)}
              className="min-w-[44px] flex items-center justify-center"
            >
              <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            </button>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleRecordPayment)} className="p-4 space-y-4">
              <FormField
                control={form.control}
                name="invoiceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Invoice</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="Choose an invoice..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {unpaidItems.length === 0 ? (
                          <div className="p-4 text-center text-gray-500">
                            No unpaid invoices
                          </div>
                        ) : (
                          unpaidItems.map((item) => (
                            <SelectItem key={item.invoiceId} value={item.invoiceId.toString()}>
                              <div className="flex items-center justify-between w-full gap-4">
                                <span>#{item.invoiceNumber} - {item.customerName}</span>
                                <span className="text-gray-500">{formatCents(item.balanceDueCents)}</span>
                              </div>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <Input 
                          type="number" 
                          step="0.01" 
                          placeholder="0.00" 
                          className="h-11 pl-7" 
                          {...field} 
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Method</FormLabel>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={field.value === "cash" ? "default" : "outline"}
                        className={`flex-1 h-11 ${field.value === "cash" ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                        onClick={() => field.onChange("cash")}
                      >
                        <Banknote className="w-4 h-4 mr-2" />
                        Cash
                      </Button>
                      <Button
                        type="button"
                        variant={field.value === "check" ? "default" : "outline"}
                        className={`flex-1 h-11 ${field.value === "check" ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                        onClick={() => field.onChange("check")}
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        Check
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-11"
                  onClick={() => setIsRecordPaymentOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1 h-11 bg-blue-600 hover:bg-blue-700"
                  disabled={recordPaymentMutation.isPending}
                >
                  {recordPaymentMutation.isPending ? "Saving..." : "Record Payment"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Payment Details Modal */}
      <PaymentDetailsModal
        invoiceId={selectedInvoiceId}
        items={items}
        onClose={() => setSelectedInvoiceId(null)}
        formatCents={formatCents}
      />
    </div>
  );
}

interface PaymentDetailsModalProps {
  invoiceId: number | null;
  items: LedgerItem[];
  onClose: () => void;
  formatCents: (cents: number) => string;
}

function PaymentDetailsModal({ 
  invoiceId, 
  items, 
  onClose, 
  formatCents 
}: PaymentDetailsModalProps) {
  const { data: invoicePayments } = useQuery<any>({
    queryKey: ['/api/payments/invoice', invoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/payments/invoice/${invoiceId}`, { credentials: 'include' });
      if (!res.ok) return { payments: [], refunds: [] };
      return res.json();
    },
    enabled: !!invoiceId,
  });

  if (!invoiceId) return null;
  
  const item = items.find(i => i.invoiceId === invoiceId);
  if (!item) return null;
  
  const paymentRows = invoicePayments?.payments || [];

  const timelineEvents: Array<{
    label: string;
    date?: string;
    completed: boolean;
    amount?: number;
  }> = [
    {
      label: "Invoice Created",
      date: item.createdAt || item.issueDate,
      completed: true,
    },
    {
      label: "Invoice Sent",
      date: item.issueDate,
      completed: item.computedStatus !== "draft",
    },
    ...paymentRows.map((payment: any) => ({
      label: `Payment Received (${payment.paymentMethod})`,
      date: payment.paidDate || payment.createdAt,
      completed: true,
      amount: payment.amountCents || Math.round(parseFloat(payment.amount || '0') * 100),
    })),
  ];

  if (item.computedStatus === "paid") {
    const lastPayment = paymentRows[paymentRows.length - 1];
    timelineEvents.push({
      label: "Fully Paid",
      date: lastPayment?.paidDate || lastPayment?.createdAt,
      completed: true,
    });
  }

  return (
    <Dialog open={!!invoiceId} onOpenChange={() => onClose()}>
      <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative">
          <div className="min-w-[44px]" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex-1 text-center">Invoice Details</h3>
          <button 
            onClick={onClose}
            className="min-w-[44px] flex items-center justify-center"
          >
            <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>
        
        <div className="p-4 space-y-4">
          <div className="text-center pb-4 border-b border-slate-200 dark:border-slate-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">Invoice #{item.invoiceNumber}</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white mt-1">{item.customerName}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
              {formatCents(item.totalCents)}
            </p>
            {item.balanceDueCents > 0 && (
              <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
                {formatCents(item.balanceDueCents)} remaining
              </p>
            )}
            {item.paidCents > 0 && (
              <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                {formatCents(item.paidCents)} paid
              </p>
            )}
          </div>
          
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Timeline</h4>
            <div className="space-y-3">
              {timelineEvents.map((event, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${
                    event.completed 
                      ? "bg-green-500" 
                      : "bg-gray-300 dark:bg-gray-600"
                  }`} />
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${
                      event.completed 
                        ? "text-gray-900 dark:text-white" 
                        : "text-gray-400 dark:text-gray-500"
                    }`}>
                      {event.label}
                      {'amount' in event && event.amount && (
                        <span className="ml-2 text-green-600 dark:text-green-400">
                          +{formatCents(event.amount)}
                        </span>
                      )}
                    </p>
                    {event.date && (() => {
                      try {
                        const parsedDate = parseISO(event.date);
                        if (isNaN(parsedDate.getTime())) return null;
                        return (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {format(parsedDate, 'MMM d, yyyy \u2022 h:mm a')}
                          </p>
                        );
                      } catch {
                        return null;
                      }
                    })()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="p-4 border-t border-slate-200 dark:border-slate-700">
          <Button
            variant="outline"
            className="w-full h-11"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
