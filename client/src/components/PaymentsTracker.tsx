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

interface PaymentStats {
  thisMonthTotalCents: number;
  stillOwedTotalCents: number;
  paidTodayTotalCents: number;
  overdueCount: number;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  totalCents: number;
  paidAmountCents: number;
  balanceDueCents: number;
  status: string;
  dueDate: string;
  issueDate: string;
  customerId?: number;
  clientId?: number;
  customer?: {
    firstName?: string;
    lastName?: string;
    companyName?: string;
  };
  client?: {
    name?: string;
    email?: string;
  };
  job?: {
    title?: string;
  };
  createdAt?: string;
}

interface Payment {
  id: number;
  invoiceId?: number;
  amount: string;
  amountCents?: number;
  paymentMethod: string;
  status: string;
  paidDate?: string;
  createdAt?: string;
  notes?: string;
  clientName?: string;
  jobTitle?: string;
}

interface Customer {
  id: number;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
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
  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: stats, isLoading: statsLoading } = useQuery<PaymentStats>({
    queryKey: ["/api/payments/stats"],
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: payments = [] } = useQuery<Payment[]>({
    queryKey: ["/api/payments"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

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
      const invoice = invoices.find(inv => inv.id === parseInt(data.invoiceId));
      const amountCents = Math.round(parseFloat(data.amount) * 100);
      
      const response = await apiRequest('POST', '/api/payments/manual', {
        invoiceId: parseInt(data.invoiceId),
        amountCents,
        paymentMethod: data.paymentMethod,
        customerId: invoice?.customerId || invoice?.clientId,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/payments/stats'] });
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

  const getInvoiceStatus = (invoice: Invoice): "paid" | "partial" | "unpaid" | "overdue" => {
    const status = invoice.status?.toLowerCase();
    if (status === "paid") return "paid";
    if (status === "partial") return "partial";
    
    const balance = invoice.balanceDueCents || (invoice.totalCents - (invoice.paidAmountCents || 0));
    if (balance === 0) return "paid";
    if (invoice.paidAmountCents && invoice.paidAmountCents > 0) return "partial";
    
    const today = new Date().toISOString().split('T')[0];
    if (invoice.dueDate && invoice.dueDate < today && balance > 0) return "overdue";
    
    return "unpaid";
  };

  const getStatusBadge = (status: "paid" | "partial" | "unpaid" | "overdue") => {
    const configs = {
      paid: { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", label: "PAID", icon: CheckCircle },
      partial: { color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", label: "PARTIAL", icon: Clock },
      unpaid: { color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400", label: "UNPAID", icon: FileText },
      overdue: { color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", label: "OVERDUE", icon: AlertTriangle },
    };
    const config = configs[status];
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

  const getCustomerName = (invoice: Invoice): string => {
    if (invoice.customer) {
      const { firstName, lastName, companyName } = invoice.customer;
      if (companyName) return companyName;
      return [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
    }
    if (invoice.client?.name) return invoice.client.name;
    return 'Unknown Customer';
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

  const getDateDisplay = (invoice: Invoice): string => {
    const status = getInvoiceStatus(invoice);
    
    if (status === "paid" || status === "partial") {
      const relatedPayment = payments.find(p => p.invoiceId === invoice.id);
      const paidDate = relatedPayment?.paidDate || relatedPayment?.createdAt;
      const date = safeParseDate(paidDate);
      if (date) {
        if (isToday(date)) return `Today • ${format(date, 'h:mm a')}`;
        if (isYesterday(date)) return `Yesterday • ${format(date, 'h:mm a')}`;
        return format(date, 'MMM d, yyyy');
      }
    }
    
    const dueDate = safeParseDate(invoice.dueDate);
    if (dueDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (isToday(dueDate)) return "Due Today";
      if (isYesterday(dueDate)) return "Due Yesterday";
      if (dueDate < today) return `Due ${format(dueDate, 'MMM d')}`;
      return `Due ${format(dueDate, 'MMM d')}`;
    }
    
    return "";
  };

  const filteredInvoices = invoices.filter(invoice => {
    if (activeFilter === "all") return true;
    const status = getInvoiceStatus(invoice);
    return status === activeFilter;
  });

  const unpaidInvoices = invoices.filter(inv => {
    const status = getInvoiceStatus(inv);
    return status === "unpaid" || status === "partial" || status === "overdue";
  });

  const isLoading = statsLoading || invoicesLoading;

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
              {formatCents(stats?.thisMonthTotalCents || 0)}
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
              {formatCents(stats?.stillOwedTotalCents || 0)}
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
              {formatCents(stats?.paidTodayTotalCents || 0)}
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
        {filteredInvoices.length === 0 ? (
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
          filteredInvoices.map((invoice) => {
            const status = getInvoiceStatus(invoice);
            const customerName = getCustomerName(invoice);
            const dateDisplay = getDateDisplay(invoice);
            const balance = invoice.balanceDueCents || (invoice.totalCents - (invoice.paidAmountCents || 0));
            const amountDisplay = status === "partial" 
              ? `${formatCents(invoice.paidAmountCents || 0)} of ${formatCents(invoice.totalCents)}`
              : formatCents(invoice.totalCents);
            
            const relatedPayment = payments.find(p => p.invoiceId === invoice.id);
            const paymentMethodInfo = relatedPayment ? getPaymentMethodDisplay(relatedPayment.paymentMethod) : null;

            return (
              <Card 
                key={invoice.id} 
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setSelectedPaymentId(invoice.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="font-semibold text-gray-900 dark:text-white truncate">
                          {customerName}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Invoice #{invoice.invoiceNumber}
                        {invoice.job?.title && ` • ${invoice.job.title}`}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        {getStatusBadge(status)}
                        {paymentMethodInfo && (status === "paid" || status === "partial") && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <paymentMethodInfo.icon className="w-3 h-3" />
                            {paymentMethodInfo.label}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-lg font-bold ${
                        status === "paid" ? "text-green-600 dark:text-green-400" :
                        status === "overdue" ? "text-red-600 dark:text-red-400" :
                        status === "partial" ? "text-yellow-600 dark:text-yellow-400" :
                        "text-gray-900 dark:text-white"
                      }`}>
                        {amountDisplay}
                      </p>
                      {status === "partial" && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatCents(balance)} remaining
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
                        {unpaidInvoices.length === 0 ? (
                          <div className="p-4 text-center text-gray-500">
                            No unpaid invoices
                          </div>
                        ) : (
                          unpaidInvoices.map((inv) => (
                            <SelectItem key={inv.id} value={inv.id.toString()}>
                              <div className="flex items-center justify-between w-full gap-4">
                                <span>#{inv.invoiceNumber} - {getCustomerName(inv)}</span>
                                <span className="text-gray-500">{formatCents(inv.balanceDueCents || inv.totalCents)}</span>
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
        invoiceId={selectedPaymentId}
        invoices={invoices}
        payments={payments}
        onClose={() => setSelectedPaymentId(null)}
        getCustomerName={getCustomerName}
        formatCents={formatCents}
      />
    </div>
  );
}

interface PaymentDetailsModalProps {
  invoiceId: number | null;
  invoices: Invoice[];
  payments: Payment[];
  onClose: () => void;
  getCustomerName: (invoice: Invoice) => string;
  formatCents: (cents: number) => string;
}

function PaymentDetailsModal({ 
  invoiceId, 
  invoices, 
  payments, 
  onClose, 
  getCustomerName,
  formatCents 
}: PaymentDetailsModalProps) {
  if (!invoiceId) return null;
  
  const invoice = invoices.find(inv => inv.id === invoiceId);
  if (!invoice) return null;
  
  const relatedPayments = payments.filter(p => p.invoiceId === invoiceId);
  const customerName = getCustomerName(invoice);
  
  const timelineEvents: Array<{
    label: string;
    date?: string;
    completed: boolean;
    amount?: number;
  }> = [
    {
      label: "Invoice Created",
      date: invoice.createdAt || invoice.issueDate,
      completed: true,
    },
    {
      label: "Invoice Sent",
      date: invoice.issueDate,
      completed: invoice.status !== "draft",
    },
    ...relatedPayments.map(payment => ({
      label: `Payment Received (${payment.paymentMethod})`,
      date: payment.paidDate || payment.createdAt,
      completed: true,
      amount: payment.amountCents || Math.round(parseFloat(payment.amount) * 100),
    })),
  ];

  if (invoice.status === "paid") {
    const lastPayment = relatedPayments[relatedPayments.length - 1];
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
            <p className="text-sm text-gray-500 dark:text-gray-400">Invoice #{invoice.invoiceNumber}</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white mt-1">{customerName}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
              {formatCents(invoice.totalCents)}
            </p>
            {(invoice.balanceDueCents || 0) > 0 && (
              <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
                {formatCents(invoice.balanceDueCents)} remaining
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
                            {format(parsedDate, 'MMM d, yyyy • h:mm a')}
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
