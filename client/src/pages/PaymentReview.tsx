import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { X, Loader2, Plus, ChevronDown, ChevronUp, Banknote, FileCheck, CreditCard, CheckCircle2, Cloud, CloudOff, Percent, DollarSign } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useCan } from "@/hooks/useCan";
import { useStripeConnectGate } from "@/hooks/useStripeConnectGate";
import { StripeConnectGateModal } from "@/components/StripeConnectGateModal";
import StripePaymentForm from "@/components/StripePaymentForm";
import { SignatureCaptureModal } from "@/components/SignatureCaptureModal";
import { useSignatureAfterPayment } from "@/hooks/useSignatureAfterPayment";

interface Invoice {
  id: number;
  invoiceNumber: string;
  jobId: number;
  amount: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidAmountCents?: number;
  balanceDueCents?: number;
  status: string;
  createdAt: string;
  qboInvoiceId?: string | null;
  qboSyncStatus?: string | null;
  qboLastSyncError?: string | null;
  qboLastSyncedAt?: string | null;
  isSubcontractJob?: boolean;
}

interface LineItem {
  id: number;
  name: string;
  description?: string;
  quantity: string;
  unitPriceCents: number;
  lineTotalCents: number;
  taxable?: boolean;
  taxCents?: number;
  taxNameSnapshot?: string;
  taxRatePercentSnapshot?: string;
  subtotalCents?: number;
  totalCents?: number;
}

interface PaymentReviewProps {
  jobId: string;
  invoiceId: string;
}

type PaymentMethod = 'cash' | 'check' | 'card';
type ViewState = 'review' | 'processing' | 'success';

export default function PaymentReview({ jobId, invoiceId }: PaymentReviewProps) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { can } = useCan();
  const stripeGate = useStripeConnectGate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [showAllItems, setShowAllItems] = useState(false);
  
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [viewState, setViewState] = useState<ViewState>('review');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [resultNewStatus, setResultNewStatus] = useState<string>('paid');
  const [resultBalanceRemaining, setResultBalanceRemaining] = useState<number>(0);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSyncingQbo, setIsSyncingQbo] = useState(false);
  const [qboSyncResult, setQboSyncResult] = useState<{ success: boolean; message: string } | null>(null);

  const [partialEnabled, setPartialEnabled] = useState(false);
  const [partialAmountStr, setPartialAmountStr] = useState("");
  const [resultPaymentId, setResultPaymentId] = useState<number | null>(null);

  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValueStr, setDiscountValueStr] = useState("");
  const [discountReason, setDiscountReason] = useState("");

  const [showCardForm, setShowCardForm] = useState(false);
  const [stripeClientSecret, setStripeClientSecret] = useState<string | null>(null);
  const [stripePublishableKey, setStripePublishableKey] = useState<string | null>(null);
  const [stripeAmountCents, setStripeAmountCents] = useState<number>(0);
  const [stripePaymentIntentId, setStripePaymentIntentId] = useState<string | null>(null);

  const {
    isModalOpen: signatureModalOpen,
    pendingPayment: sigPendingPayment,
    triggerSignature,
    onSignatureComplete: handleSignatureComplete,
    onModalDismiss: handleSignatureDismiss,
  } = useSignatureAfterPayment();

  const numericJobId = parseInt(jobId, 10);
  const numericInvoiceId = parseInt(invoiceId, 10);
  const canSyncQbo = can('customize.manage');

  const { data: qboStatus } = useQuery<{ connected: boolean }>({
    queryKey: ['/api/integrations/quickbooks/status'],
    enabled: canSyncQbo,
  });
  const qboConnected = canSyncQbo && qboStatus?.connected === true;

  const { data: invoiceData, isLoading: invoiceLoading, error: invoiceError } = useQuery<{ invoice: Invoice | null }>({
    queryKey: ['/api/jobs', numericJobId, 'invoice'],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${numericJobId}/invoice`, { credentials: 'include' });
      if (!res.ok) throw new Error('Invoice not found');
      return res.json();
    },
    enabled: !isNaN(numericJobId),
  });

  const invoice = invoiceData?.invoice;

  const { data: paymentPermissions } = useQuery<{ canRecordManualPayment: boolean }>({
    queryKey: ['/api/payments/invoice', numericInvoiceId, 'permissions'],
    queryFn: async () => {
      const res = await fetch(`/api/payments/invoice/${numericInvoiceId}`, { credentials: 'include' });
      if (!res.ok) return { canRecordManualPayment: false };
      const data = await res.json();
      return { canRecordManualPayment: data.canRecordManualPayment ?? false };
    },
    enabled: !isNaN(numericInvoiceId),
  });
  const canRecordManual = paymentPermissions?.canRecordManualPayment ?? false;
  console.log(`[PaymentReview] invoiceId=${numericInvoiceId} canRecordManual=${canRecordManual} permissionsLoaded=${paymentPermissions !== undefined}`);

  const { data: lineItems = [], isLoading: lineItemsLoading } = useQuery<LineItem[]>({
    queryKey: ['/api/jobs', numericJobId, 'line-items'],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${numericJobId}/line-items`, { 
        credentials: 'include',
        cache: 'no-store'
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data.lineItems ?? data.items ?? []);
    },
    enabled: !isNaN(numericJobId),
    staleTime: 0,
  });

  const invoiceTotalCents = invoice
    ? (invoice.totalCents > 0 ? invoice.totalCents : Math.round(parseFloat(invoice.amount) * 100))
    : 0;
  const currentPaidCents = invoice?.paidAmountCents || 0;
  const balanceRemainingCents = invoice?.balanceDueCents || (invoiceTotalCents - currentPaidCents);

  useEffect(() => {
    if (invoice && !partialEnabled) {
      setPartialAmountStr((balanceRemainingCents / 100).toFixed(2));
    }
  }, [invoice, balanceRemainingCents, partialEnabled]);

  const discountValue = parseFloat(discountValueStr || "0");
  const discountAmountCents = discountEnabled
    ? discountType === 'amount'
      ? Math.round(discountValue * 100)
      : Math.round((balanceRemainingCents * Math.min(discountValue, 100)) / 100)
    : 0;
  const clampedDiscountCents = Math.max(0, Math.min(discountAmountCents, balanceRemainingCents));
  const afterDiscountCents = balanceRemainingCents - clampedDiscountCents;

  const isDiscountValid = !discountEnabled || (
    discountValue > 0 &&
    (discountType === 'percent' ? discountValue <= 100 : true) &&
    clampedDiscountCents <= balanceRemainingCents
  );

  const partialAmountCents = Math.round(parseFloat(partialAmountStr || "0") * 100);
  const isPartialValid = partialAmountCents > 0 && partialAmountCents <= afterDiscountCents;
  const paymentAmountCents = partialEnabled ? partialAmountCents : afterDiscountCents;

  const handleClose = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate('/jobs', { replace: true });
    }
  };

  const handleMethodSelect = async (method: PaymentMethod) => {
    if (partialEnabled && !isPartialValid) return;
    if (method === 'card') {
      const ready = await stripeGate.ensureReady(() => handleCardPayment());
      if (!ready) return;
      handleCardPayment();
    } else {
      setSelectedMethod(method);
      setConfirmModalOpen(true);
    }
  };

  const handleCardPayment = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const intentPayload: any = {
        invoiceId: numericInvoiceId,
        amountCents: paymentAmountCents,
      };
      if (discountEnabled && clampedDiscountCents > 0) {
        intentPayload.discount = {
          enabled: true,
          type: discountType,
          value: discountValue,
          amountCents: clampedDiscountCents,
          reason: discountReason || null,
        };
      }
      const response = await apiRequest("POST", "/api/payments/stripe/create-intent", intentPayload);
      const data = await response.json();
      
      if (!data.clientSecret || !data.publishableKey) {
        throw new Error("Failed to initialize card payment");
      }
      
      setStripeClientSecret(data.clientSecret);
      setStripePublishableKey(data.publishableKey);
      setStripeAmountCents(data.amountCents || paymentAmountCents);
      setStripePaymentIntentId(data.paymentIntentId || null);
      setShowCardForm(true);
      setIsLoading(false);
    } catch (err: any) {
      setIsLoading(false);
      let msg = err.message || "Failed to start card payment";
      try { const parsed = JSON.parse(msg); if (parsed.message) msg = parsed.message; } catch {}
      setError(msg);
    }
  };

  const handleCardPaymentSuccess = async (paymentIntentId: string) => {
    setShowCardForm(false);
    setViewState('processing');
    
    try {
      let confirmed = false;
      let confirmedPaymentId: number | null = null;
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          const res = await fetch(`/api/payments/stripe/confirm?invoiceId=${invoiceId}&payment_intent_id=${paymentIntentId}`, {
            credentials: 'include',
          });
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'succeeded' || data.paid) {
              setPaidAmount(data.amountCents || stripeAmountCents);
              setResultNewStatus(data.newStatus || (data.balanceRemaining > 0 ? 'partial' : 'paid'));
              setResultBalanceRemaining(data.balanceRemaining || 0);
              setResultPaymentId(data.paymentId || null);
              confirmedPaymentId = data.paymentId || null;
              confirmed = true;
              break;
            }
          }
        } catch {}
      }
      
      if (!confirmed) {
        setPaidAmount(stripeAmountCents);
        setResultNewStatus(stripeAmountCents < balanceRemainingCents ? 'partial' : 'paid');
        setResultBalanceRemaining(Math.max(0, balanceRemainingCents - stripeAmountCents));
      }
      
      invalidateAll();

      if (confirmedPaymentId) {
        triggerSignature({ paymentId: confirmedPaymentId, jobId: numericJobId, invoiceId: numericInvoiceId });
      }

      setViewState('success');
    } catch (err: any) {
      setError(err.message || "Payment may have succeeded but confirmation failed. Please check your invoices.");
      setViewState('review');
    }
  };

  const handleCardPaymentCancel = () => {
    setShowCardForm(false);
    setStripeClientSecret(null);
    setStripePublishableKey(null);
    setStripeAmountCents(0);
    setStripePaymentIntentId(null);
    // Refresh invoice data so frontend balance matches the real DB state
    // (important if a prior card attempt with discount mutated any state)
    queryClient.invalidateQueries({ queryKey: ['/api/jobs', numericJobId, 'invoice'] });
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
    queryClient.invalidateQueries({ queryKey: ['/api/jobs', numericJobId, 'invoice'] });
    queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
    queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
    queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/today'] });
    queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
    queryClient.invalidateQueries({ queryKey: ['/api/payments/ledger'] });
    queryClient.invalidateQueries({ queryKey: ['/api/payments/stats'] });
    queryClient.invalidateQueries({ queryKey: ['/api/payments/breakdown'] });
    queryClient.invalidateQueries({ predicate: (query) => 
      Array.isArray(query.queryKey) && 
      typeof query.queryKey[0] === 'string' && 
      (query.queryKey[0].includes('/api/customers/') && query.queryKey[0].includes('/jobs') ||
       query.queryKey[0].startsWith('/api/schedule-items'))
    });
  };

  const handleManualPaymentConfirm = async () => {
    if (!selectedMethod || isConfirming) return;
    
    setIsConfirming(true);
    setConfirmModalOpen(false);
    setViewState('processing');
    
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const manualPayload: any = {
        invoiceId: numericInvoiceId,
        method: selectedMethod,
        amountCents: paymentAmountCents,
      };
      if (discountEnabled && clampedDiscountCents > 0) {
        manualPayload.discount = {
          enabled: true,
          type: discountType,
          value: discountValue,
          amountCents: clampedDiscountCents,
          reason: discountReason || null,
        };
      }
      const response = await apiRequest("POST", "/api/payments/manual", manualPayload);
      const data = await response.json();
      
      if (data.success) {
        setPaidAmount(data.amountCents);
        setResultNewStatus(data.newStatus || 'paid');
        setResultBalanceRemaining(data.balanceRemaining || 0);
        setResultPaymentId(data.paymentId || null);
        invalidateAll();
        console.log("[Payments] success handler fired", { paymentId: data.paymentId, jobId: numericJobId, invoiceId: numericInvoiceId, status: data.newStatus });
        if (data.paymentId) {
          triggerSignature({ paymentId: data.paymentId, jobId: numericJobId, invoiceId: numericInvoiceId });
        }
        setViewState('success');
      } else {
        throw new Error(data.message || "Payment failed");
      }
    } catch (err: any) {
      let msg = err.message || "Failed to record payment";
      try { const parsed = JSON.parse(msg); if (parsed.message) msg = parsed.message; } catch {}
      setError(msg);
      setViewState('review');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleDone = () => {
    navigate('/jobs', { replace: true });
  };

  const handleQboSync = async () => {
    if (isSyncingQbo || !invoice) return;
    
    setIsSyncingQbo(true);
    setQboSyncResult(null);
    
    try {
      const response = await apiRequest('POST', `/api/integrations/quickbooks/sync-invoice/${invoice.id}`);
      const data = await response.json();
      
      if (data.success) {
        setQboSyncResult({ 
          success: true, 
          message: data.alreadySynced ? 'Already synced' : 'Synced successfully'
        });
        queryClient.invalidateQueries({ queryKey: ['/api/jobs', numericJobId, 'invoice'] });
      } else {
        throw new Error(data.error || 'Sync failed');
      }
    } catch (err: any) {
      setQboSyncResult({ 
        success: false, 
        message: err.message || 'Sync failed'
      });
    } finally {
      setIsSyncingQbo(false);
    }
  };

  const formatCurrency = (dollars: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(dollars);
  };

  if (invoiceLoading || lineItemsLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (invoiceError || !invoice) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-4">
          <p className="text-lg text-gray-600 dark:text-gray-400">Invoice not found</p>
          <Button onClick={() => navigate('/jobs', { replace: true })}>
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  if (viewState === 'processing') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-6">
          <Loader2 className="h-16 w-16 animate-spin text-blue-600 mx-auto" />
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Processing payment…</h1>
            <p className="text-gray-600 dark:text-gray-400">
              We are processing your payment…
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (viewState === 'success') {
    const paidDollars = paidAmount / 100;
    const isPartial = resultNewStatus === 'partial';
    const remainingDollars = resultBalanceRemaining / 100;
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-6">
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payment Successful</h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              {formatCurrency(paidDollars)} received
            </p>
            {isPartial && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {formatCurrency(remainingDollars)} still owed on this invoice
              </p>
            )}
          </div>
          <Button onClick={handleDone} className="px-8">
            Done
          </Button>
        </div>
        {sigPendingPayment && (
          <SignatureCaptureModal
            open={signatureModalOpen}
            onOpenChange={handleSignatureDismiss}
            paymentId={sigPendingPayment.paymentId}
            jobId={sigPendingPayment.jobId}
            invoiceId={sigPendingPayment.invoiceId}
            required
            onComplete={handleSignatureComplete}
          />
        )}
      </div>
    );
  }

  if (invoice.status?.toLowerCase() === 'paid') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-4">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Already Paid</h1>
          <p className="text-gray-600 dark:text-gray-400">
            This invoice has already been paid in full.
          </p>
          <Button onClick={() => navigate('/jobs', { replace: true })}>
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  const subtotalDollars = (invoice.subtotalCents || 0) / 100;
  const taxDollars = (invoice.taxCents || 0) / 100;
  const totalDollars = invoiceTotalCents / 100;
  const balanceDollars = balanceRemainingCents / 100;
  const isPartialInvoice = currentPaidCents > 0;
  
  const isSubcontractJob = invoice.isSubcontractJob ?? false;
  const maxVisible = 5;
  const hasMoreItems = lineItems.length > maxVisible;
  const visibleItems = showAllItems ? lineItems : lineItems.slice(0, maxVisible);
  const paymentDisabled = isLoading || (!isSubcontractJob && partialEnabled && !isPartialValid) || (!isSubcontractJob && discountEnabled && !isDiscountValid);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <button
            onClick={handleClose}
            className="p-2 -ml-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Invoice #{invoice.invoiceNumber}
          </span>
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-6">
        <div className="space-y-1.5 mb-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Checkout</h1>
          {canSyncQbo && (
            qboConnected ? (
              <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                <Cloud className="h-3 w-3" />
                Automatically synced to QuickBooks
              </span>
            ) : (
              <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                <CloudOff className="h-3 w-3" />
                QuickBooks not connected
                <a href="/customize/quickbooks" className="text-blue-600 dark:text-blue-400 hover:underline font-medium ml-0.5">Connect</a>
              </span>
            )
          )}
        </div>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-0">
            {lineItems.length === 0 ? (
              <div className="py-3 text-gray-500 dark:text-gray-400 text-sm">
                No line items found
              </div>
            ) : (
              <>
                {visibleItems.map((item, index) => {
                  const qty = parseFloat(item.quantity) || 1;
                  const computedLineTotalCents = Math.round(qty * (item.unitPriceCents || 0));
                  const lineTotalCents = item.lineTotalCents || item.subtotalCents || computedLineTotalCents;
                  const taxCents = item.taxCents || 0;
                  const lineTotalWithTax = (lineTotalCents + taxCents) / 100;
                  const isLast = index === visibleItems.length - 1 && !hasMoreItems;
                  
                  return (
                    <div
                      key={item.id}
                      className={`flex justify-between items-start py-3 ${
                        !isLast ? 'border-b border-gray-100 dark:border-gray-700' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="text-gray-900 dark:text-white font-medium truncate">
                          {item.name}
                        </div>
                        {qty !== 1 && (
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            Qty: {qty}
                          </div>
                        )}
                        {item.taxable && taxCents > 0 && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            incl. tax: {formatCurrency(taxCents / 100)}
                          </div>
                        )}
                      </div>
                      <div className="text-gray-900 dark:text-white font-medium whitespace-nowrap">
                        {formatCurrency(lineTotalWithTax)}
                      </div>
                    </div>
                  );
                })}
                
                {hasMoreItems && !showAllItems && (
                  <button
                    onClick={() => setShowAllItems(true)}
                    className="flex items-center gap-1 py-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    <ChevronDown className="h-4 w-4" />
                    Show all ({lineItems.length})
                  </button>
                )}
                
                {hasMoreItems && showAllItems && (
                  <button
                    onClick={() => setShowAllItems(false)}
                    className="flex items-center gap-1 py-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    <ChevronUp className="h-4 w-4" />
                    Show less
                  </button>
                )}
              </>
            )}
            
            <div className="space-y-2 pt-3 mt-2 border-t border-gray-200 dark:border-gray-600">
              {invoice.subtotalCents > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
                  <span className="text-gray-900 dark:text-white">
                    {formatCurrency(subtotalDollars)}
                  </span>
                </div>
              )}
              {invoice.taxCents > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-400">Tax</span>
                  <span className="text-gray-900 dark:text-white">
                    {formatCurrency(taxDollars)}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center pt-1">
                <span className="font-semibold text-gray-900 dark:text-white">Total</span>
                <span className="font-bold text-lg text-gray-900 dark:text-white">
                  {formatCurrency(totalDollars)}
                </span>
              </div>
              {discountEnabled && clampedDiscountCents > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-emerald-600 dark:text-emerald-400 text-sm">
                    {discountType === 'percent' ? `Discount (${discountValue}%)` : 'Discount'}
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                    -{formatCurrency(clampedDiscountCents / 100)}
                  </span>
                </div>
              )}
              {isPartialInvoice && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-green-600 dark:text-green-400 text-sm">Previously paid</span>
                    <span className="text-green-600 dark:text-green-400 text-sm font-medium">
                      {formatCurrency(currentPaidCents / 100)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-gray-100 dark:border-gray-700">
                    <span className="font-semibold text-amber-600 dark:text-amber-400">Balance Due</span>
                    <span className="font-bold text-lg text-amber-600 dark:text-amber-400">
                      {formatCurrency(balanceDollars)}
                    </span>
                  </div>
                </>
              )}
              {(discountEnabled && clampedDiscountCents > 0) && (
                <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-600">
                  <span className="font-semibold text-gray-900 dark:text-white">Amount Due Today</span>
                  <span className="font-bold text-lg text-blue-600 dark:text-blue-400">
                    {formatCurrency(afterDiscountCents / 100)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {!isSubcontractJob && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Partial Payment</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Pay less than the full amount</p>
            </div>
            <Switch
              checked={partialEnabled}
              onCheckedChange={(checked) => {
                setPartialEnabled(checked);
                if (checked) {
                  setPartialAmountStr("");
                } else {
                  setPartialAmountStr((balanceRemainingCents / 100).toFixed(2));
                }
              }}
            />
          </div>
          {partialEnabled && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Amount to pay today
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={(afterDiscountCents / 100).toFixed(2)}
                  placeholder={(afterDiscountCents / 100).toFixed(2)}
                  value={partialAmountStr}
                  onChange={(e) => setPartialAmountStr(e.target.value)}
                  className="pl-7 h-10 rounded-lg text-base tabular-nums"
                />
              </div>
              {partialAmountStr && !isPartialValid && (
                <p className="text-xs text-red-500">
                  {partialAmountCents <= 0
                    ? "Enter an amount greater than $0"
                    : `Cannot exceed ${formatCurrency(afterDiscountCents / 100)}`}
                </p>
              )}
              {partialEnabled && isPartialValid && partialAmountCents < afterDiscountCents && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatCurrency((afterDiscountCents - partialAmountCents) / 100)} will remain after this payment
                </p>
              )}
            </div>
          )}
        </div>
        )}

        {!isSubcontractJob && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Discount</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Apply a discount to this payment</p>
            </div>
            <Switch
              checked={discountEnabled}
              onCheckedChange={(checked) => {
                setDiscountEnabled(checked);
                if (!checked) {
                  setDiscountValueStr("");
                  setDiscountReason("");
                }
              }}
            />
          </div>
          {discountEnabled && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    discountType === 'amount'
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => { setDiscountType('amount'); setDiscountValueStr(""); }}
                >
                  <DollarSign className="h-3.5 w-3.5" />
                  Amount
                </button>
                <button
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    discountType === 'percent'
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => { setDiscountType('percent'); setDiscountValueStr(""); }}
                >
                  <Percent className="h-3.5 w-3.5" />
                  Percent
                </button>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  {discountType === 'amount' ? 'Discount amount' : 'Discount percentage'}
                </label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                    {discountType === 'amount' ? '$' : '%'}
                  </span>
                  <Input
                    type="number"
                    step={discountType === 'amount' ? '0.01' : '1'}
                    min="0"
                    max={discountType === 'percent' ? '100' : (balanceRemainingCents / 100).toFixed(2)}
                    placeholder={discountType === 'amount' ? '0.00' : '0'}
                    value={discountValueStr}
                    onChange={(e) => setDiscountValueStr(e.target.value)}
                    className="pl-7 h-10 rounded-lg text-base tabular-nums"
                  />
                </div>
                {discountValueStr && !isDiscountValid && (
                  <p className="text-xs text-red-500 mt-1">
                    {discountValue <= 0
                      ? "Enter a value greater than 0"
                      : discountType === 'percent' && discountValue > 100
                        ? "Percentage cannot exceed 100%"
                        : "Discount cannot exceed the balance"}
                  </p>
                )}
                {discountEnabled && isDiscountValid && clampedDiscountCents > 0 && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                    {formatCurrency(clampedDiscountCents / 100)} off — pay {formatCurrency(afterDiscountCents / 100)}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Reason (optional)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Loyalty discount"
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  className="mt-1 h-10 rounded-lg text-sm"
                  maxLength={100}
                />
              </div>
            </div>
          )}
        </div>
        )}

        {!showNote ? (
          <button
            onClick={() => setShowNote(true)}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Add Note
          </button>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Note (optional)
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note for your records..."
              className="resize-none"
              rows={3}
            />
          </div>
        )}

        {showCardForm && stripeClientSecret && stripePublishableKey ? (
          <div className="pt-4">
            <StripePaymentForm
              clientSecret={stripeClientSecret}
              publishableKey={stripePublishableKey}
              amountCents={stripeAmountCents}
              invoiceId={numericInvoiceId}
              onSuccess={handleCardPaymentSuccess}
              onCancel={handleCardPaymentCancel}
            />
          </div>
        ) : (
          <div className="space-y-3 pt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Select payment method
              </h2>
              {partialEnabled && isPartialValid && (
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                  {formatCurrency(paymentAmountCents / 100)}
                </span>
              )}
            </div>
            
            <div className={`grid gap-3 ${canRecordManual ? 'grid-cols-3' : 'grid-cols-1'}`}>
              {canRecordManual && (
                <>
                  <Button
                    variant="outline"
                    className="flex flex-col items-center gap-2 h-24 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20"
                    onClick={() => handleMethodSelect('cash')}
                    disabled={paymentDisabled}
                  >
                    <Banknote className="h-8 w-8 text-green-600" />
                    <span className="text-sm font-medium">Cash</span>
                  </Button>
                  
                  <Button
                    variant="outline"
                    className="flex flex-col items-center gap-2 h-24 hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    onClick={() => handleMethodSelect('check')}
                    disabled={paymentDisabled}
                  >
                    <FileCheck className="h-8 w-8 text-blue-600" />
                    <span className="text-sm font-medium">Check</span>
                  </Button>
                </>
              )}
              
              <Button
                variant="outline"
                className="flex flex-col items-center gap-2 h-24 hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                onClick={() => handleMethodSelect('card')}
                disabled={paymentDisabled}
              >
                {isLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
                ) : (
                  <CreditCard className="h-8 w-8 text-purple-600" />
                )}
                <span className="text-sm font-medium">Card</span>
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={confirmModalOpen} onOpenChange={setConfirmModalOpen}>
        <DialogContent hideCloseButton className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative">
            <button
              onClick={() => setConfirmModalOpen(false)}
              className="absolute right-4 top-1/2 -translate-y-1/2"
              disabled={isConfirming}
            >
              <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            </button>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {selectedMethod === 'cash' ? 'Cash payment' : 'Check payment'}
            </h3>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Collecting {formatCurrency(paymentAmountCents / 100)} by {selectedMethod === 'cash' ? 'cash' : 'check'}.
              {discountEnabled && clampedDiscountCents > 0 && (
                <span className="block mt-1 text-emerald-600 dark:text-emerald-400">
                  Includes {discountType === 'percent' ? `${discountValue}%` : formatCurrency(clampedDiscountCents / 100)} discount.
                </span>
              )}
              {partialEnabled && paymentAmountCents < afterDiscountCents && (
                <span className="block mt-1 text-amber-600 dark:text-amber-400">
                  {formatCurrency((afterDiscountCents - paymentAmountCents) / 100)} will remain on this invoice.
                </span>
              )}
            </p>
            <div className="flex flex-col gap-2">
              <Button
                className="w-full"
                onClick={handleManualPaymentConfirm}
                disabled={isConfirming}
              >
                {isConfirming ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Confirm
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setConfirmModalOpen(false)}
                disabled={isConfirming}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <StripeConnectGateModal
        open={stripeGate.showGateModal}
        onClose={stripeGate.dismissGateModal}
        returnPath={`/jobs/${jobId}/pay/${invoiceId}`}
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
