import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
  XCircle, 
  Plus,
  Download,
  Search,
  AlertCircle,
  Banknote,
  X,
  ChevronDown,
  Receipt
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, isWithinInterval } from "date-fns";

const paymentSchema = z.object({
  jobId: z.string().min(1, "Job is required"),
  amount: z.string().min(1, "Amount is required"),
  paymentMethod: z.enum(["cash", "check", "credit_card", "bank_transfer", "other"]),
  status: z.enum(["pending", "completed", "failed", "refunded"]),
  paidDate: z.string().optional(),
  notes: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

export default function PaymentsPage() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [monthFilter, setMonthFilter] = useState<string>("this");
  const { toast } = useToast();

  const { data: payments = [], isLoading: paymentsLoading } = useQuery<any[]>({
    queryKey: ["/api/payments"],
  });

  const { data: breakdownData, isLoading: breakdownLoading } = useQuery<{
    cashTotalCents: number;
    checkTotalCents: number;
    cardTotalCents: number;
    pendingTotalCents: number;
    completedTotalCents: number;
  }>({
    queryKey: ["/api/payments/breakdown", monthFilter === "this" ? "this_month" : "last_month"],
    queryFn: async () => {
      const range = monthFilter === "this" ? "this_month" : "last_month";
      const res = await fetch(`/api/payments/breakdown?range=${range}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch breakdown");
      return res.json();
    },
  });

  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs"],
  });

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      jobId: "",
      amount: "",
      paymentMethod: "cash",
      status: "pending",
      paidDate: "",
      notes: "",
    },
  });

  const createPaymentMutation = useMutation({
    mutationFn: async (paymentData: PaymentFormData) => {
      const response = await apiRequest('POST', '/api/payments', {
        ...paymentData,
        amount: parseFloat(paymentData.amount),
        paidDate: paymentData.paidDate || null,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/payments/breakdown'] });
      setIsAddDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updatePaymentStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const response = await apiRequest('PATCH', `/api/payments/${id}`, { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/payments/breakdown'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreatePayment = (data: PaymentFormData) => {
    createPaymentMutation.mutate(data);
  };

  const handleStatusUpdate = (paymentId: number, newStatus: string) => {
    updatePaymentStatusMutation.mutate({ id: paymentId, status: newStatus });
  };

  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const thisMonthEnd = endOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const lastMonthEnd = endOfMonth(subMonths(now, 1));

  const monthlyPayments = useMemo(() => {
    const start = monthFilter === "this" ? thisMonthStart : lastMonthStart;
    const end = monthFilter === "this" ? thisMonthEnd : lastMonthEnd;
    
    return payments.filter(p => {
      const paidDate = p.paidDate ? new Date(p.paidDate) : p.createdAt ? new Date(p.createdAt) : null;
      if (!paidDate) return false;
      return isWithinInterval(paidDate, { start, end });
    });
  }, [payments, monthFilter, thisMonthStart, thisMonthEnd, lastMonthStart, lastMonthEnd]);

  const breakdown = useMemo(() => {
    if (breakdownData) {
      return {
        cash: breakdownData.cashTotalCents / 100,
        check: breakdownData.checkTotalCents / 100,
        card: breakdownData.cardTotalCents / 100,
        pending: breakdownData.pendingTotalCents / 100,
        total: breakdownData.completedTotalCents / 100,
      };
    }
    return { cash: 0, check: 0, card: 0, pending: 0, total: 0 };
  }, [breakdownData]);

  const filteredPayments = monthlyPayments.filter(payment => {
    const matchesStatus = filterStatus === "all" || payment.status === filterStatus;
    const matchesSearch = payment.jobTitle?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         payment.clientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         payment.notes?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && (searchTerm === "" || matchesSearch);
  });

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: Clock },
      completed: { color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle },
      paid: { color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle },
      failed: { color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: XCircle },
      refunded: { color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400", icon: AlertCircle },
    };
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    const Icon = config.icon;
    return (
      <Badge className={`${config.color} flex items-center gap-1 text-xs font-medium border-0`}>
        <Icon className="w-3 h-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const getPaymentMethodLabel = (method: string) => {
    switch (method?.toLowerCase()) {
      case "credit_card":
      case "card":
      case "stripe":
        return "Card";
      case "cash":
        return "Cash";
      case "check":
        return "Check";
      case "bank_transfer":
        return "Transfer";
      default:
        return "Other";
    }
  };

  if (paymentsLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
          <div className="h-20 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 h-64 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
            <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header with Month Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">Payments</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Financial overview</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="w-40 bg-white dark:bg-slate-800">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="this">This Month</SelectItem>
              <SelectItem value="last">Last Month</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Total Revenue Card */}
      <Card className="bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-800 dark:to-slate-700 border-0 text-white">
        <CardContent className="py-6 px-6">
          <p className="text-slate-300 text-sm font-medium mb-1">
            {monthFilter === "this" ? "This Month" : "Last Month"}'s Revenue
          </p>
          <p className="text-4xl sm:text-5xl font-bold tracking-tight">
            ${breakdown.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-slate-400 text-sm mt-2">
            {monthlyPayments.length} payment{monthlyPayments.length !== 1 ? 's' : ''} received
          </p>
        </CardContent>
      </Card>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Payments List */}
        <div className="lg:col-span-2 space-y-4">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Search payments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-9 bg-white dark:bg-slate-800"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full sm:w-36 bg-white dark:bg-slate-800">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700 shrink-0">
                  <Plus className="w-4 h-4 mr-2" />
                  Record
                </Button>
              </DialogTrigger>
              <DialogContent className="w-[95vw] max-w-[400px] max-h-[85vh] rounded-2xl overflow-y-auto p-5 pt-4 gap-3">
                <DialogHeader className="pb-1">
                  <DialogTitle>Record Payment</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(handleCreatePayment)} className="space-y-3">
                    <FormField
                      control={form.control}
                      name="jobId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Job</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a job" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {jobs.map((job) => (
                                <SelectItem key={job.id} value={job.id.toString()}>
                                  {job.title} - {job.clientName}
                                </SelectItem>
                              ))}
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
                            <Input type="number" step="0.01" placeholder="0.00" {...field} />
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
                          <FormLabel>Method</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="check">Check</SelectItem>
                              <SelectItem value="credit_card">Card</SelectItem>
                              <SelectItem value="bank_transfer">Transfer</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="paidDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date (Optional)</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes (Optional)</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Notes..." rows={2} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex justify-end gap-2 pt-2">
                      <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createPaymentMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
                        {createPaymentMutation.isPending ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Payments Table / Cards */}
          <Card className="shadow-sm">
            <CardContent className="p-0">
              {filteredPayments.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="w-14 h-14 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Receipt className="w-6 h-6 text-slate-400" />
                  </div>
                  <h3 className="text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {searchTerm || filterStatus !== "all" ? "No matching payments" : "No payments yet"}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {searchTerm || filterStatus !== "all" 
                      ? "Try adjusting your filters" 
                      : "Payments will appear here once recorded"}
                  </p>
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider py-3 px-4">Job</th>
                          <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider py-3 px-4">Method</th>
                          <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider py-3 px-4">Date</th>
                          <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider py-3 px-4">Status</th>
                          <th className="text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider py-3 px-4">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredPayments.map((payment) => (
                          <tr key={payment.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-900 dark:text-slate-100 text-sm">
                                {payment.jobTitle || 'Payment'}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {payment.clientName || '—'}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-300">
                              {getPaymentMethodLabel(payment.paymentMethod)}
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-300">
                              {payment.paidDate ? format(new Date(payment.paidDate), 'MMM d, yyyy') : '—'}
                            </td>
                            <td className="py-3 px-4">
                              {getStatusBadge(payment.status)}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                ${parseFloat(payment.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredPayments.map((payment) => (
                      <div key={payment.id} className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-900 dark:text-slate-100 text-sm truncate">
                              {payment.jobTitle || 'Payment'}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {payment.clientName || '—'}
                            </p>
                          </div>
                          <span className="font-semibold text-slate-900 dark:text-slate-100 ml-3">
                            ${parseFloat(payment.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span>{getPaymentMethodLabel(payment.paymentMethod)}</span>
                            <span>•</span>
                            <span>{payment.paidDate ? format(new Date(payment.paidDate), 'MMM d') : '—'}</span>
                          </div>
                          {getStatusBadge(payment.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Breakdown Card */}
        <div className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                    <Banknote className="w-4 h-4 text-green-600 dark:text-green-400" />
                  </div>
                  <span className="text-sm text-slate-600 dark:text-slate-300">Cash</span>
                </div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  ${breakdown.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-sm text-slate-600 dark:text-slate-300">Check</span>
                </div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  ${breakdown.check.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <span className="text-sm text-slate-600 dark:text-slate-300">Card</span>
                </div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  ${breakdown.card.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                    <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <span className="text-sm text-slate-600 dark:text-slate-300">Pending</span>
                </div>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  ${breakdown.pending.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
