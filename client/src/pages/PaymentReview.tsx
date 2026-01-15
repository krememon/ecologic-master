import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X, Loader2, Plus, ChevronDown, ChevronUp, Banknote, FileCheck, CreditCard, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Invoice {
  id: number;
  invoiceNumber: string;
  jobId: number;
  amount: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  status: string;
  createdAt: string;
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [showAllItems, setShowAllItems] = useState(false);
  
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [viewState, setViewState] = useState<ViewState>('review');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [isConfirming, setIsConfirming] = useState(false);

  const numericJobId = parseInt(jobId, 10);
  const numericInvoiceId = parseInt(invoiceId, 10);

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

  const handleClose = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate('/jobs', { replace: true });
    }
  };

  const handleMethodSelect = (method: PaymentMethod) => {
    if (method === 'card') {
      handleStripeCheckout();
    } else {
      setSelectedMethod(method);
      setConfirmModalOpen(true);
    }
  };

  const handleStripeCheckout = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await apiRequest("POST", "/api/payments/checkout", {
        invoiceId: numericInvoiceId,
        returnBaseUrl: window.location.origin,
      });
      const data = await response.json();
      
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL received");
      }
    } catch (err: any) {
      setIsLoading(false);
      setError(err.message || "Failed to start payment");
    }
  };

  const handleManualPaymentConfirm = async () => {
    if (!selectedMethod || isConfirming) return;
    
    setIsConfirming(true);
    setConfirmModalOpen(false);
    setViewState('processing');
    
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const response = await apiRequest("POST", "/api/payments/manual", {
        invoiceId: numericInvoiceId,
        method: selectedMethod,
      });
      const data = await response.json();
      
      if (data.success) {
        setPaidAmount(data.amountCents);
        queryClient.invalidateQueries({ queryKey: ['/api/jobs', numericJobId, 'invoice'] });
        queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
        setViewState('success');
      } else {
        throw new Error(data.message || "Payment failed");
      }
    } catch (err: any) {
      setError(err.message || "Failed to record payment");
      setViewState('review');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleDone = () => {
    navigate('/jobs', { replace: true });
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

  if (invoice.status?.toLowerCase() === 'paid') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-4">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Already Paid</h1>
          <p className="text-gray-600 dark:text-gray-400">
            This invoice has already been paid.
          </p>
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
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-6">
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payment success</h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Payment of {formatCurrency(paidDollars)} was successful.
            </p>
          </div>
          <Button onClick={handleDone} className="px-8">
            Done
          </Button>
        </div>
      </div>
    );
  }

  const subtotalDollars = (invoice.subtotalCents || 0) / 100;
  const taxDollars = (invoice.taxCents || 0) / 100;
  const totalDollars = invoice.totalCents > 0 
    ? invoice.totalCents / 100 
    : parseFloat(invoice.amount) || 0;
  
  const maxVisible = 5;
  const hasMoreItems = lineItems.length > maxVisible;
  const visibleItems = showAllItems ? lineItems : lineItems.slice(0, maxVisible);

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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Checkout</h1>

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
                  const lineTotalWithTax = (item.totalCents ?? (item.lineTotalCents || 0)) / 100;
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
                        {item.taxable && item.taxCents && item.taxCents > 0 && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            incl. tax: {formatCurrency(item.taxCents / 100)}
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
            </div>
          </CardContent>
        </Card>

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

        <div className="space-y-3 pt-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Select payment method
          </h2>
          
          <div className="grid grid-cols-3 gap-3">
            <Button
              variant="outline"
              className="flex flex-col items-center gap-2 h-24 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20"
              onClick={() => handleMethodSelect('cash')}
              disabled={isLoading}
            >
              <Banknote className="h-8 w-8 text-green-600" />
              <span className="text-sm font-medium">Cash</span>
            </Button>
            
            <Button
              variant="outline"
              className="flex flex-col items-center gap-2 h-24 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
              onClick={() => handleMethodSelect('check')}
              disabled={isLoading}
            >
              <FileCheck className="h-8 w-8 text-blue-600" />
              <span className="text-sm font-medium">Check</span>
            </Button>
            
            <Button
              variant="outline"
              className="flex flex-col items-center gap-2 h-24 hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20"
              onClick={() => handleMethodSelect('card')}
              disabled={isLoading}
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
      </div>

      <Dialog open={confirmModalOpen} onOpenChange={setConfirmModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedMethod === 'cash' ? 'Cash payment' : 'Check payment'}
            </DialogTitle>
            <DialogDescription>
              You're collecting payment by {selectedMethod === 'cash' ? 'cash' : 'check'}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setConfirmModalOpen(false)}
              disabled={isConfirming}
            >
              Cancel
            </Button>
            <Button
              onClick={handleManualPaymentConfirm}
              disabled={isConfirming}
            >
              {isConfirming ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
