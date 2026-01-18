import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CreditCard, Loader2, CheckCircle, FileText, Calendar, DollarSign } from "lucide-react";
import { format } from "date-fns";

interface PublicInvoicePayProps {
  invoiceId: string;
}

interface PublicInvoiceData {
  id: number;
  invoiceNumber: string;
  totalCents: number;
  subtotalCents: number;
  taxCents: number;
  status: string;
  dueDate: string;
  issueDate: string;
  companyName: string;
  companyLogo?: string | null;
  lineItems?: {
    name: string;
    description?: string;
    quantity: number;
    unitPriceCents: number;
    unit?: string;
  }[] | null;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export default function PublicInvoicePay({ invoiceId }: PublicInvoicePayProps) {
  const [, navigate] = useLocation();
  const [invoice, setInvoice] = useState<PublicInvoiceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        const res = await fetch(`/api/public/invoices/${invoiceId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Invoice not found');
        }
        const data = await res.json();
        setInvoice(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load invoice');
      } finally {
        setIsLoading(false);
      }
    };
    fetchInvoice();
  }, [invoiceId]);

  const handlePay = async () => {
    if (isCheckoutLoading || !invoice) return;
    setIsCheckoutLoading(true);
    try {
      const returnBaseUrl = window.location.origin;
      const res = await fetch('/api/public/invoices/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: parseInt(invoiceId),
          returnBaseUrl,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to create checkout session');
      }
      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err: any) {
      setError(err.message || 'Payment failed');
      setIsCheckoutLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <h2 className="text-xl font-semibold mb-2 text-slate-900 dark:text-slate-100">
              {error || 'Invoice not found'}
            </h2>
            <p className="text-slate-500 dark:text-slate-400">
              This invoice may no longer be available or the link may be incorrect.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isPaid = invoice.status === 'paid';
  const lineItems = invoice.lineItems || [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          {invoice.companyLogo && (
            <img 
              src={invoice.companyLogo} 
              alt={invoice.companyName} 
              className="h-16 mx-auto mb-4"
            />
          )}
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {invoice.companyName}
          </h1>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Invoice {invoice.invoiceNumber}
              </CardTitle>
              <Badge 
                variant={isPaid ? 'default' : 'outline'} 
                className={isPaid ? 'bg-green-600' : ''}
              >
                {isPaid ? (
                  <>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Paid
                  </>
                ) : (
                  invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)
                )}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Calendar className="h-4 w-4" />
              <span>Due {format(new Date(invoice.dueDate), 'MMMM d, yyyy')}</span>
            </div>

            {lineItems.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-slate-100 dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                  Items
                </div>
                <div className="divide-y dark:divide-slate-700">
                  {lineItems.map((item, index) => (
                    <div key={index} className="px-4 py-3 flex justify-between items-start">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">{item.name}</p>
                        {item.description && (
                          <p className="text-sm text-slate-500 dark:text-slate-400">{item.description}</p>
                        )}
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {item.quantity} {item.unit || 'x'} @ {formatCurrency(item.unitPriceCents)}
                        </p>
                      </div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {formatCurrency(item.quantity * item.unitPriceCents)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Subtotal</span>
                <span className="text-slate-900 dark:text-slate-100">{formatCurrency(invoice.subtotalCents)}</span>
              </div>
              {invoice.taxCents > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Tax</span>
                  <span className="text-slate-900 dark:text-slate-100">{formatCurrency(invoice.taxCents)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span className="text-slate-900 dark:text-slate-100">
                  {isPaid ? 'Amount Paid' : 'Total Due'}
                </span>
                <span className={isPaid ? 'text-green-600' : 'text-slate-900 dark:text-slate-100'}>
                  {formatCurrency(invoice.totalCents)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {!isPaid && invoice.totalCents > 0 && (
          <Button 
            onClick={handlePay}
            disabled={isCheckoutLoading}
            className="w-full h-14 text-lg bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isCheckoutLoading ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CreditCard className="h-5 w-5 mr-2" />
                Pay {formatCurrency(invoice.totalCents)}
              </>
            )}
          </Button>
        )}

        {isPaid && (
          <div className="text-center py-4">
            <div className="inline-flex items-center gap-2 text-green-600 font-medium">
              <CheckCircle className="h-5 w-5" />
              This invoice has been paid. Thank you!
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          Secure payment powered by Stripe
        </p>
      </div>
    </div>
  );
}
