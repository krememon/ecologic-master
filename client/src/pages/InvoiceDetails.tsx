import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ArrowLeft, User, FileText, Calendar, List, DollarSign, ExternalLink, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface InvoiceDetailsProps {
  invoiceId: string;
}

interface InvoiceLineItem {
  name: string;
  description?: string;
  quantity: number;
  unitPriceCents: number;
  unit?: string;
  taxId?: number;
  taxRatePercentSnapshot?: number;
  taxNameSnapshot?: string;
}

interface InvoiceData {
  id: number;
  invoiceNumber: string;
  amount: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  status: string;
  dueDate: string;
  issueDate: string;
  paidDate?: string | null;
  pdfUrl?: string | null;
  clientId?: number | null;
  customerId?: number | null;
  jobId?: number | null;
  estimateId?: number | null;
  companyId: number;
  scheduledAt?: string | null;
  tags?: string[] | null;
  notes?: string | null;
  lineItems?: InvoiceLineItem[] | null;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  paidAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  client?: {
    id: number;
    name: string;
    email?: string | null;
  } | null;
  job?: {
    id: number;
    title: string;
  } | null;
  customer?: {
    id: number;
    firstName: string;
    lastName: string;
    email?: string | null;
  } | null;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case 'paid': return 'default';
    case 'draft': return 'secondary';
    case 'sent':
    case 'pending': return 'outline';
    case 'overdue': return 'destructive';
    case 'void':
    case 'cancelled': return 'destructive';
    default: return 'secondary';
  }
}

export default function InvoiceDetails({ invoiceId }: InvoiceDetailsProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { role } = useCan();
  
  const [isMarkPaidDialogOpen, setIsMarkPaidDialogOpen] = useState(false);
  const [isVoidDialogOpen, setIsVoidDialogOpen] = useState(false);
  
  const canMarkAsPaid = role === 'OWNER' || role === 'SUPERVISOR';
  const canVoidInvoice = role === 'OWNER' || role === 'SUPERVISOR';

  const { data: invoice, isLoading, error } = useQuery<InvoiceData>({
    queryKey: [`/api/invoices/${invoiceId}`],
    enabled: !!invoiceId && isAuthenticated,
  });

  const markPaidMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/invoices/${invoiceId}`, {
        status: 'paid',
        paidAt: new Date().toISOString(),
      });
      if (!res.ok) throw new Error('Failed to mark as paid');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/invoices/${invoiceId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
      setIsMarkPaidDialogOpen(false);
      toast({ title: "Invoice marked as paid" });
    },
    onError: () => {
      toast({ title: "Failed to update invoice", variant: "destructive" });
    },
  });

  const voidMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/invoices/${invoiceId}`, {
        status: 'void',
      });
      if (!res.ok) throw new Error('Failed to void invoice');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/invoices/${invoiceId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
      setIsVoidDialogOpen(false);
      toast({ title: "Invoice voided" });
    },
    onError: () => {
      toast({ title: "Failed to void invoice", variant: "destructive" });
    },
  });

  if (isLoading || authLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
          <div className="h-64 bg-slate-200 dark:bg-slate-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Invoice not found</h2>
          <Button onClick={() => navigate('/invoicing')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Invoices
          </Button>
        </div>
      </div>
    );
  }

  const customerName = invoice.customer 
    ? `${invoice.customer.firstName} ${invoice.customer.lastName}`.trim()
    : invoice.client?.name || 'No customer';

  const lineItems = invoice.lineItems || [];
  const canMarkPaid = invoice.status !== 'paid' && invoice.status !== 'void' && invoice.status !== 'cancelled';
  const canVoid = invoice.status !== 'void' && invoice.status !== 'cancelled';

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/invoicing')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{invoice.invoiceNumber}</h1>
            <p className="text-sm text-muted-foreground">{formatCurrency(invoice.totalCents)}</p>
          </div>
        </div>
        <Badge variant={getStatusBadgeVariant(invoice.status)} className="text-sm capitalize">
          {invoice.status}
        </Badge>
      </div>

      {invoice.pdfUrl && (
        <a 
          href={invoice.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full"
        >
          <Button variant="outline" className="w-full mb-4">
            <ExternalLink className="h-4 w-4 mr-2" />
            View PDF
          </Button>
        </a>
      )}

      {canMarkAsPaid && canMarkPaid && (
        <Button 
          onClick={() => setIsMarkPaidDialogOpen(true)}
          className="w-full mb-4 bg-green-600 hover:bg-green-700 text-white"
        >
          <CheckCircle className="h-4 w-4 mr-2" />
          Mark as Paid
        </Button>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Customer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{customerName}</p>
            {invoice.customer?.email && (
              <p className="text-sm text-muted-foreground">{invoice.customer.email}</p>
            )}
            {invoice.client?.email && !invoice.customer && (
              <p className="text-sm text-muted-foreground">{invoice.client.email}</p>
            )}
          </CardContent>
        </Card>

        {invoice.job && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Linked Job
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button 
                variant="link" 
                className="p-0 h-auto text-blue-600 hover:text-blue-700"
                onClick={() => navigate(`/jobs/${invoice.job!.id}`)}
              >
                {invoice.job.title}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Key Dates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{format(new Date(invoice.createdAt), 'MMM d, yyyy')}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Issue Date</span>
              <span>{format(new Date(invoice.issueDate), 'MMM d, yyyy')}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Due Date</span>
              <span className={invoice.status === 'overdue' ? 'text-red-600 font-medium' : ''}>
                {format(new Date(invoice.dueDate), 'MMM d, yyyy')}
              </span>
            </div>
            {invoice.scheduledAt && (
              <>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Scheduled</span>
                  <span>{format(new Date(invoice.scheduledAt), 'MMM d, yyyy h:mm a')}</span>
                </div>
              </>
            )}
            {invoice.paidAt && (
              <>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid</span>
                  <span className="text-green-600 font-medium">
                    {format(new Date(invoice.paidAt), 'MMM d, yyyy')}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {lineItems.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <List className="h-5 w-5" />
                Line Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {lineItems.map((item, index) => {
                  const lineTotalCents = item.quantity * item.unitPriceCents;
                  return (
                    <div key={index} className="flex justify-between items-start py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                      <div className="flex-1">
                        <p className="font-medium">{item.name}</p>
                        {item.description && (
                          <p className="text-sm text-muted-foreground">{item.description}</p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {item.quantity} {item.unit || 'x'} @ {formatCurrency(item.unitPriceCents)}
                        </p>
                        {item.taxNameSnapshot && (
                          <p className="text-xs text-muted-foreground">
                            Tax: {item.taxNameSnapshot} ({item.taxRatePercentSnapshot}%)
                          </p>
                        )}
                      </div>
                      <p className="font-medium">{formatCurrency(lineTotalCents)}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Totals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(invoice.subtotalCents)}</span>
            </div>
            {invoice.taxCents > 0 && (
              <>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span>{formatCurrency(invoice.taxCents)}</span>
                </div>
              </>
            )}
            <Separator />
            <div className="flex justify-between text-lg font-semibold">
              <span>Total</span>
              <span>{formatCurrency(invoice.totalCents)}</span>
            </div>
            {invoice.status === 'paid' && (
              <>
                <Separator />
                <div className="flex justify-between text-green-600">
                  <span>Amount Paid</span>
                  <span>{formatCurrency(invoice.totalCents)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Balance Due</span>
                  <span>$0.00</span>
                </div>
              </>
            )}
            {invoice.status !== 'paid' && invoice.status !== 'void' && invoice.status !== 'cancelled' && (
              <>
                <Separator />
                <div className="flex justify-between font-semibold text-orange-600">
                  <span>Balance Due</span>
                  <span>{formatCurrency(invoice.totalCents)}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {invoice.notes && (
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{invoice.notes}</p>
            </CardContent>
          </Card>
        )}

        {invoice.tags && invoice.tags.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {invoice.tags.map((tag, i) => (
                  <span 
                    key={i}
                    className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-600 dark:text-slate-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {canVoidInvoice && canVoid && (
          <Button 
            variant="outline"
            onClick={() => setIsVoidDialogOpen(true)}
            className="w-full text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
          >
            <XCircle className="h-4 w-4 mr-2" />
            Void Invoice
          </Button>
        )}
      </div>

      <Dialog open={isMarkPaidDialogOpen} onOpenChange={setIsMarkPaidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Invoice as Paid</DialogTitle>
            <DialogDescription>
              Are you sure you want to mark this invoice as paid? This will update the status to "Paid".
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMarkPaidDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => markPaidMutation.mutate()}
              disabled={markPaidMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {markPaidMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isVoidDialogOpen} onOpenChange={setIsVoidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Invoice</DialogTitle>
            <DialogDescription>
              Are you sure you want to void this invoice? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsVoidDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => voidMutation.mutate()}
              disabled={voidMutation.isPending}
            >
              {voidMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Void Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
