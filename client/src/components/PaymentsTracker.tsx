import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Filter,
  Search,
  Calendar,
  TrendingUp,
  AlertCircle,
  X
} from "lucide-react";
import { format } from "date-fns";

const paymentSchema = z.object({
  jobId: z.string().min(1, "Job is required"),
  amount: z.string().min(1, "Amount is required"),
  paymentMethod: z.enum(["cash", "check", "credit_card", "bank_transfer", "other"]),
  status: z.enum(["pending", "completed", "failed", "refunded"]),
  paidDate: z.string().optional(),
  notes: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface PaymentsTrackerProps {
  jobs: any[];
}

export function PaymentsTracker({ jobs }: PaymentsTrackerProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  const { data: payments = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/payments"],
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/dashboard/stats"],
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
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      setIsAddDialogOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "Payment recorded successfully",
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

  const updatePaymentStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const response = await apiRequest('PATCH', `/api/payments/${id}`, { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/payments/breakdown'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      toast({
        title: "Success",
        description: "Payment status updated",
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

  const handleCreatePayment = (data: PaymentFormData) => {
    createPaymentMutation.mutate(data);
  };

  const handleStatusUpdate = (paymentId: number, newStatus: string) => {
    updatePaymentStatusMutation.mutate({ id: paymentId, status: newStatus });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { color: "bg-yellow-100 text-yellow-800", icon: Clock },
      completed: { color: "bg-green-100 text-green-800", icon: CheckCircle },
      failed: { color: "bg-red-100 text-red-800", icon: XCircle },
      refunded: { color: "bg-gray-100 text-gray-800", icon: AlertCircle },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} flex items-center gap-1`}>
        <Icon className="w-3 h-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const getPaymentMethodIcon = (method: string) => {
    switch (method) {
      case "credit_card":
        return <CreditCard className="w-4 h-4" />;
      case "cash":
        return <DollarSign className="w-4 h-4" />;
      default:
        return <DollarSign className="w-4 h-4" />;
    }
  };

  const filteredPayments = payments.filter(payment => {
    const matchesStatus = filterStatus === "all" || payment.status === filterStatus;
    const matchesSearch = payment.jobTitle?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         payment.clientName?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && (searchTerm === "" || matchesSearch);
  });

  // Use real dashboard statistics instead of calculated values
  const totalPaymentsValue = stats?.totalRevenue || 0;
  const completedPaymentsValue = stats?.paidInvoices || 0;
  const pendingPaymentsValue = stats?.outstandingInvoices || 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-1/2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Payment Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Payments</p>
                <p className="text-2xl font-bold text-gray-900">${totalPaymentsValue.toLocaleString()}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Completed</p>
                <p className="text-2xl font-bold text-green-600">${completedPaymentsValue.toLocaleString()}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Pending</p>
                <p className="text-2xl font-bold text-yellow-600">${pendingPaymentsValue.toLocaleString()}</p>
              </div>
              <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
                <Clock className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search payments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 w-64"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="refunded">Refunded</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Record Payment
              </Button>
            </DialogTrigger>
            <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative">
                <button 
                  onClick={() => setIsAddDialogOpen(false)}
                  className="absolute right-4 top-1/2 -translate-y-1/2"
                >
                  <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                </button>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Record Payment</h3>
              </div>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleCreatePayment)} className="p-4 space-y-3">
                  <FormField
                    control={form.control}
                    name="jobId"
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">Job</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-10">
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
                      <FormItem className="space-y-1">
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">Amount</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" className="h-10" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="paymentMethod"
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">Payment Method</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-10">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="check">Check</SelectItem>
                            <SelectItem value="credit_card">Credit Card</SelectItem>
                            <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
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
                      <FormItem className="space-y-1">
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">Status</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-10">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="failed">Failed</SelectItem>
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
                      <FormItem className="space-y-1">
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">Payment Date</FormLabel>
                        <FormControl>
                          <Input type="date" className="h-10" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Notes" className="min-h-[72px] resize-none" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700 mt-4">
                    <Button type="button" variant="outline" className="h-10" onClick={() => setIsAddDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" className="h-10" disabled={createPaymentMutation.isPending}>
                      {createPaymentMutation.isPending ? "Recording..." : "Save"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Payments List */}
      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
          <CardDescription>
            Track all payments received from your jobs
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredPayments.length === 0 ? (
            <div className="text-center py-8">
              <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No payments found</h3>
              <p className="text-gray-500 mb-4">
                {searchTerm || filterStatus !== "all" 
                  ? "No payments match your current filters" 
                  : "Start by recording your first payment"}
              </p>
              {(!searchTerm && filterStatus === "all") && (
                <Button onClick={() => setIsAddDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Record First Payment
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredPayments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      {getPaymentMethodIcon(payment.paymentMethod)}
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">{payment.jobTitle}</h4>
                      <p className="text-sm text-gray-500">
                        {payment.clientName} • {payment.paymentMethod.replace('_', ' ')}
                      </p>
                      {payment.paidDate && (
                        <p className="text-xs text-gray-400">
                          Paid: {format(new Date(payment.paidDate), 'MMM d, yyyy')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">
                        ${payment.amount?.toLocaleString()}
                      </p>
                      {payment.notes && (
                        <p className="text-xs text-gray-500 max-w-32 truncate">
                          {payment.notes}
                        </p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {getStatusBadge(payment.status)}
                      {payment.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusUpdate(payment.id, "completed")}
                          disabled={updatePaymentStatusMutation.isPending}
                        >
                          Mark Paid
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}