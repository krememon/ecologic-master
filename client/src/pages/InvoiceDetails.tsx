import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { useStripeConnectGate } from "@/hooks/useStripeConnectGate";
import { StripeConnectGateModal } from "@/components/StripeConnectGateModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, User, FileText, Calendar, List, DollarSign, ExternalLink, XCircle, Loader2, CreditCard, Send, Mail, MessageSquare, Cloud, Check } from "lucide-react";
import StripePaymentForm from "@/components/StripePaymentForm";
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
  paidAmountCents?: number;
  balanceDueCents?: number;
  paidAt?: string | null;
  qboInvoiceId?: string | null;
  qboSyncStatus?: string | null;
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
    phone?: string | null;
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
  const stripeGate = useStripeConnectGate();
  
  const [isVoidDialogOpen, setIsVoidDialogOpen] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [stripeClientSecret, setStripeClientSecret] = useState<string | null>(null);
  const [stripePublishableKey, setStripePublishableKey] = useState<string | null>(null);
  const [stripeAmountCents, setStripeAmountCents] = useState<number>(0);
  const [partialEnabled, setPartialEnabled] = useState(false);
  const [partialAmountStr, setPartialAmountStr] = useState("");
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [sendMode, setSendMode] = useState<'email' | 'text'>('email');
  const [emailValue, setEmailValue] = useState('');
  const [phoneValue, setPhoneValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSyncingQbo, setIsSyncingQbo] = useState(false);
  const [qboSyncResult, setQboSyncResult] = useState<{ success: boolean; message: string } | null>(null);
  
  const canVoidInvoice = role === 'OWNER' || role === 'SUPERVISOR';
  const canSyncQbo = role === 'OWNER' || role === 'SUPERVISOR';

  const { data: invoice, isLoading, error } = useQuery<InvoiceData>({
    queryKey: [`/api/invoices/${invoiceId}`],
    enabled: !!invoiceId && isAuthenticated,
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

  const invoiceTotalCents = invoice ? (invoice.totalCents > 0 ? invoice.totalCents : Math.round(parseFloat(invoice.amount) * 100)) : 0;
  const currentPaidCents = invoice?.paidAmountCents || 0;
  const balanceRemainingCents = invoice?.balanceDueCents || (invoiceTotalCents - currentPaidCents);
  const partialAmountCents = Math.round(parseFloat(partialAmountStr || "0") * 100);
  const isPartialValid = partialAmountCents >= 50 && partialAmountCents <= balanceRemainingCents;
  const paymentAmountCents = partialEnabled ? partialAmountCents : balanceRemainingCents;

  const startCardPaymentFlow = async () => {
    setIsCheckoutLoading(true);
    try {
      const res = await apiRequest('POST', '/api/payments/stripe/create-intent', {
        invoiceId: parseInt(invoiceId),
        ...(partialEnabled ? { amountCents: paymentAmountCents } : {}),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to initialize payment');
      }
      const { clientSecret, publishableKey, amountCents } = await res.json();
      setStripeClientSecret(clientSecret);
      setStripePublishableKey(publishableKey);
      setStripeAmountCents(amountCents);
      setShowCardForm(true);
    } catch (error: any) {
      toast({ title: error.message || "Payment failed", variant: "destructive" });
    } finally {
      setIsCheckoutLoading(false);
    }
  };

  const handlePayWithCard = async () => {
    if (isCheckoutLoading) return;
    if (partialEnabled && !isPartialValid) return;
    const ready = await stripeGate.ensureReady(() => startCardPaymentFlow());
    if (!ready) return;
    await startCardPaymentFlow();
  };

  const handleCardPaymentSuccess = async () => {
    queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
    queryClient.invalidateQueries({ queryKey: [`/api/invoices/${invoiceId}`] });
    queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
    queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
    toast({ title: "Payment successful!" });
    setShowCardForm(false);
    setStripeClientSecret(null);
    setPartialEnabled(false);
    setPartialAmountStr("");
  };

  const handleCardPaymentCancel = () => {
    setShowCardForm(false);
    setStripeClientSecret(null);
    setStripePublishableKey(null);
  };

  const formatPhoneNumber = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const openSendDialog = () => {
    const customerEmail = invoice?.customer?.email || invoice?.client?.email || '';
    const customerPhone = invoice?.customer?.phone || '';
    
    setEmailValue(customerEmail);
    setPhoneValue(formatPhoneNumber(customerPhone));
    
    if (customerEmail) {
      setSendMode('email');
    } else if (customerPhone) {
      setSendMode('text');
    } else {
      setSendMode('email');
    }
    
    setIsSendDialogOpen(true);
  };

  const handleSendInvoice = async () => {
    const value = sendMode === 'email' ? emailValue.trim() : phoneValue.replace(/\D/g, '');
    if (!value) return;
    
    console.log("[SendInvoice] sending", { invoiceId, mode: sendMode, to: value });
    
    setIsSending(true);
    try {
      const endpoint = sendMode === 'email' 
        ? `/api/invoices/${invoiceId}/send/email`
        : `/api/invoices/${invoiceId}/send/text`;
      
      const payload = sendMode === 'email' 
        ? { email: value }
        : { phone: value };
      
      const res = await apiRequest('POST', endpoint, payload);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error("[SendInvoice] error response", errorData);
        const errorMsg = errorData.detail 
          ? `${errorData.message}: ${errorData.detail}` 
          : errorData.message || 'Failed to send invoice';
        throw new Error(errorMsg);
      }
      
      const result = await res.json();
      console.log("[SendInvoice] success", result);
      
      queryClient.invalidateQueries({ queryKey: [`/api/invoices/${invoiceId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
      setIsSendDialogOpen(false);
      setEmailValue('');
      setPhoneValue('');
    } catch (error: any) {
      console.error("[SendInvoice] error", error);
      toast({ title: error.message || "Failed to send invoice", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  const handleQboSync = async () => {
    if (isSyncingQbo || !invoice) return;
    
    console.log("[QB UI] Sync clicked for invoice", invoice.id);
    console.log("[QB UI] Current qboInvoiceId:", invoice.qboInvoiceId);
    
    setIsSyncingQbo(true);
    setQboSyncResult(null);
    
    try {
      console.log("[QB UI] Calling POST /api/integrations/quickbooks/sync-invoice/" + invoice.id);
      const response = await apiRequest('POST', `/api/integrations/quickbooks/sync-invoice/${invoice.id}`);
      const data = await response.json();
      console.log("[QB UI] Sync response", response.status, data);
      
      if (data.success) {
        setQboSyncResult({ 
          success: true, 
          message: data.alreadySynced ? 'Already synced' : 'Synced successfully'
        });
        // Refetch invoice to get updated qboInvoiceId
        console.log("[QB UI] Refetching invoice to update UI");
        queryClient.invalidateQueries({ queryKey: [`/api/invoices/${invoiceId}`] });
      } else {
        throw new Error(data.error || 'Sync failed');
      }
    } catch (err: any) {
      console.log("[QB UI] Sync error:", err.message);
      setQboSyncResult({ 
        success: false, 
        message: err.message || 'Sync failed'
      });
      toast({ title: err.message || "Failed to sync to QuickBooks", variant: "destructive" });
    } finally {
      setIsSyncingQbo(false);
    }
  };

  const hasContactInfo = !!(invoice?.customer?.email || invoice?.client?.email || invoice?.customer?.phone);
  const canSendEmail = !!(emailValue.trim() && emailValue.includes('@'));
  const canSendText = !!(phoneValue.replace(/\D/g, '').length >= 10);

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

  // Resolve customer display name with priority order
  const resolveCustomerDisplayName = () => {
    const customer = invoice.customer as any;
    const job = invoice.job as any;
    // Priority 1: invoice.customer.companyName
    if (customer?.companyName) {
      return customer.companyName;
    }
    // Priority 2: invoice.customer firstName + lastName
    if (customer) {
      const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
      if (fullName) return fullName;
    }
    // Priority 3: invoice.job.customer (if job has customer data)
    if (job?.customer?.companyName) {
      return job.customer.companyName;
    }
    if (job?.customer) {
      const jobCustomerName = `${job.customer.firstName || ''} ${job.customer.lastName || ''}`.trim();
      if (jobCustomerName) return jobCustomerName;
    }
    // Priority 4: invoice.client (legacy)
    if (invoice.client?.name) {
      return invoice.client.name;
    }
    // Priority 5: job.clientName (legacy)
    if (job?.clientName) {
      return job.clientName;
    }
    return 'Unknown Customer';
  };
  const customerName = resolveCustomerDisplayName();
  console.log("[Invoice UI] Display name resolved as:", customerName);

  const lineItems = invoice.lineItems || [];
  const canPay = invoice.status !== 'paid' && invoice.status !== 'void' && invoice.status !== 'cancelled';
  const canSend = invoice.status !== 'void' && invoice.status !== 'cancelled';
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

      {/* Inline Card Payment Form */}
      {showCardForm && stripeClientSecret && stripePublishableKey && (
        <div className="mb-4">
          <StripePaymentForm
            clientSecret={stripeClientSecret}
            publishableKey={stripePublishableKey}
            amountCents={stripeAmountCents}
            invoiceId={parseInt(invoiceId)}
            onSuccess={handleCardPaymentSuccess}
            onCancel={handleCardPaymentCancel}
          />
        </div>
      )}

      {/* Partial Payment Toggle + Pay Button */}
      {canPay && invoice.totalCents > 0 && !showCardForm && (
        <div className="space-y-3 mb-2">
          {balanceRemainingCents > 0 && (
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Partial Payment</Label>
              <Switch
                checked={partialEnabled}
                onCheckedChange={(checked) => {
                  setPartialEnabled(checked);
                  if (!checked) setPartialAmountStr("");
                }}
              />
            </div>
          )}
          {partialEnabled && (
            <div className="space-y-1">
              <Input
                type="number"
                min="0.50"
                step="0.01"
                max={(balanceRemainingCents / 100).toFixed(2)}
                placeholder="Amount in dollars"
                value={partialAmountStr}
                onChange={(e) => setPartialAmountStr(e.target.value)}
              />
              {partialAmountStr && !isPartialValid && (
                <p className="text-xs text-red-500">
                  {partialAmountCents < 50
                    ? "Minimum payment is $0.50"
                    : `Maximum is ${formatCurrency(balanceRemainingCents)}`}
                </p>
              )}
              {partialAmountStr && isPartialValid && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Remaining after payment: {formatCurrency(balanceRemainingCents - partialAmountCents)}
                </p>
              )}
            </div>
          )}
          <Button
            onClick={handlePayWithCard}
            disabled={isCheckoutLoading || (partialEnabled && !isPartialValid)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isCheckoutLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4 mr-2" />
            )}
            {isCheckoutLoading ? 'Processing...' : `Pay ${formatCurrency(paymentAmountCents)}`}
          </Button>
        </div>
      )}

      {/* Secondary Send Invoice Button */}
      {canSend && invoice.status !== 'paid' && (
        <Button 
          variant="outline"
          onClick={openSendDialog}
          className="w-full mb-4"
        >
          <Send className="h-4 w-4 mr-2" />
          Send Invoice
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
            {invoice.customer?.phone && (
              <p className="text-sm text-muted-foreground">{invoice.customer.phone}</p>
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

        {/* QuickBooks Sync Card */}
        {canSyncQbo && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5" />
                QuickBooks
              </CardTitle>
            </CardHeader>
            <CardContent>
              {invoice.qboInvoiceId ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  <span className="text-sm font-medium">Synced to QuickBooks</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Not synced</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleQboSync}
                    disabled={isSyncingQbo}
                    className="w-full"
                  >
                    {isSyncingQbo ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <Cloud className="h-4 w-4 mr-2" />
                        Sync to QuickBooks
                      </>
                    )}
                  </Button>
                  {qboSyncResult && !qboSyncResult.success && (
                    <p className="text-xs text-red-600 dark:text-red-400">{qboSyncResult.message}</p>
                  )}
                </div>
              )}
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

      {/* Send Invoice Dialog */}
      <Dialog open={isSendDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsSendDialogOpen(false);
          setEmailValue('');
          setPhoneValue('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Send Invoice
            </DialogTitle>
            <DialogDescription>
              Send {invoice.invoiceNumber} for {formatCurrency(invoice.totalCents)} to your customer.
              {invoice.dueDate && ` Due: ${format(new Date(invoice.dueDate), 'MMM d, yyyy')}`}
            </DialogDescription>
          </DialogHeader>
          
          {/* Email / Text Toggle */}
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-1 bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setSendMode('email')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                sendMode === 'email'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Mail className="h-4 w-4" />
              Email
            </button>
            <button
              type="button"
              onClick={() => setSendMode('text')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                sendMode === 'text'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              Text
            </button>
          </div>

          <div className="py-2">
            {!hasContactInfo && (
              <p className="text-sm text-orange-600 dark:text-orange-400 mb-3">
                No contact info on file. Please enter contact details below.
              </p>
            )}
            
            {sendMode === 'email' ? (
              <>
                <Label htmlFor="emailInput">Email Address</Label>
                <Input
                  id="emailInput"
                  type="email"
                  placeholder="customer@example.com"
                  value={emailValue}
                  onChange={(e) => setEmailValue(e.target.value)}
                  className="mt-2"
                />
              </>
            ) : (
              <>
                <Label htmlFor="phoneInput">Phone Number</Label>
                <Input
                  id="phoneInput"
                  type="tel"
                  placeholder="555-123-4567"
                  value={phoneValue}
                  onChange={(e) => setPhoneValue(formatPhoneNumber(e.target.value))}
                  className="mt-2"
                />
              </>
            )}
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setIsSendDialogOpen(false);
                setEmailValue('');
                setPhoneValue('');
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSendInvoice}
              disabled={isSending || (sendMode === 'email' ? !canSendEmail : !canSendText)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Invoice
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Invoice Dialog */}
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

      <StripeConnectGateModal
        open={stripeGate.showGateModal}
        onClose={stripeGate.dismissGateModal}
        returnPath={`/payments/invoice/${invoiceId}`}
        readiness={stripeGate.readiness}
        isOwner={stripeGate.isOwner}
        isProcessing={stripeGate.isProcessing}
        statusLabel={stripeGate.statusLabel}
        actionLabel={stripeGate.actionLabel}
        showOwnerOnlyMessage={stripeGate.showOwnerOnlyMessage}
        startOnboarding={stripeGate.startOnboarding}
      />
    </div>
  );
}
