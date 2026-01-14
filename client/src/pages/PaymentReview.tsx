import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { X, Loader2, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Invoice {
  id: number;
  invoiceNumber: string;
  jobId: number;
  amount: string; // Stored as decimal string in dollars (e.g., "350.00")
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
}

interface Job {
  id: number;
  title: string;
}

interface PaymentReviewProps {
  jobId: string;
  invoiceId: string;
}

export default function PaymentReview({ jobId, invoiceId }: PaymentReviewProps) {
  const [, navigate] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [showAllItems, setShowAllItems] = useState(false);

  const numericJobId = parseInt(jobId, 10);
  const numericInvoiceId = parseInt(invoiceId, 10);

  // Fetch invoice via the existing job invoice endpoint
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

  // Fetch line items for the job
  const { data: lineItemsData, isLoading: lineItemsLoading } = useQuery<{ lineItems: LineItem[] }>({
    queryKey: ['/api/jobs', numericJobId, 'line-items'],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${numericJobId}/line-items`, { credentials: 'include' });
      if (!res.ok) return { lineItems: [] };
      return res.json();
    },
    enabled: !isNaN(numericJobId),
  });

  const lineItems = lineItemsData?.lineItems || [];

  const handleClose = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate('/jobs', { replace: true });
    }
  };

  const handleNext = async () => {
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

  // Invoice amount is stored as decimal string in dollars (e.g., "350.00")
  const totalAmount = parseFloat(invoice.amount) || 0;
  
  // Determine which items to show (max 5 unless expanded)
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
          <Button
            onClick={handleNext}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Next"
            )}
          </Button>
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
                  const lineTotal = (item.lineTotalCents || 0) / 100;
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
                      </div>
                      <div className="text-gray-900 dark:text-white font-medium whitespace-nowrap">
                        {formatCurrency(lineTotal)}
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
            
            <div className="flex justify-between items-center py-3 mt-2 border-t border-gray-200 dark:border-gray-600">
              <span className="font-semibold text-gray-900 dark:text-white">Total</span>
              <span className="font-bold text-lg text-gray-900 dark:text-white">
                {formatCurrency(totalAmount)}
              </span>
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

        <div className="pt-4">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Payment History
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">No payments yet</p>
        </div>
      </div>
    </div>
  );
}
