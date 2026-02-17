import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import SignatureCanvas from "react-signature-canvas";
import { useToast } from "@/hooks/use-toast";

interface PublicInvoicePayProps {
  invoiceId: string;
}

interface PublicInvoiceData {
  id: number;
  invoiceNumber: string;
  totalCents: number;
  subtotalCents: number;
  taxCents: number;
  paidAmountCents: number;
  balanceDueCents: number;
  status: string;
  dueDate: string;
  issueDate: string;
  lineItems?: {
    name: string;
    description?: string;
    quantity: number;
    unitPriceCents: number;
    unit?: string;
  }[] | null;
  company: {
    name: string;
    email: string | null;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  customer: {
    name: string;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  jobTitle: string | null;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function buildAddress(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(', ');
}

const MAX_POLL_ATTEMPTS = 15;
const POLL_INTERVAL_MS = 1000;

export default function PublicInvoicePay({ invoiceId }: PublicInvoicePayProps) {
  const { toast } = useToast();
  const [invoice, setInvoice] = useState<PublicInvoiceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  const [stripeSuccess, setStripeSuccess] = useState(false);
  const [stripeCanceled, setStripeCanceled] = useState(false);
  const [stripeSessionId, setStripeSessionId] = useState<string | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [paymentId, setPaymentId] = useState<number | null>(null);
  const [confirmedAmountCents, setConfirmedAmountCents] = useState<number | null>(null);
  const [isPartialPayment, setIsPartialPayment] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [signatureSaved, setSignatureSaved] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const sigRef = useRef<SignatureCanvas>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const pollingRef = useRef(false);
  const signatureTriggeredRef = useRef(false);
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get("success");
    const canceled = urlParams.get("canceled");
    const sessionId = urlParams.get("session_id");

    if (success === "1") {
      setStripeSuccess(true);
      if (sessionId) setStripeSessionId(sessionId);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (canceled === "1") {
      setStripeCanceled(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

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

  const runConfirmPoll = useCallback(async () => {
    if (!stripeSessionId) return;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(`/api/payments/stripe/confirm?invoiceId=${invoiceId}&session_id=${stripeSessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'recorded' && data.paymentId) {
            setPaymentId(data.paymentId);
            setConfirmedAmountCents(data.amountCents || null);
            setIsPartialPayment(!!data.isPartial);
            setPaymentConfirmed(true);
            setPollTimedOut(false);
            return;
          }
        }
      } catch (e) {
        // silent retry
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    pollingRef.current = false;
    setPollTimedOut(true);
  }, [stripeSessionId, invoiceId]);

  useEffect(() => {
    if (!stripeSuccess || !stripeSessionId || pollingRef.current || paymentConfirmed) return;
    pollingRef.current = true;
    runConfirmPoll();
  }, [stripeSuccess, stripeSessionId, paymentConfirmed, runConfirmPoll]);

  useEffect(() => {
    if (paymentConfirmed && paymentId && !signatureTriggeredRef.current) {
      const key = `signatureTriggeredForInvoice:${invoiceId}`;
      if (sessionStorage.getItem(key)) return;
      signatureTriggeredRef.current = true;
      sessionStorage.setItem(key, "1");
      setShowSignature(true);
    }
  }, [paymentConfirmed, paymentId, invoiceId]);

  const handleSaveSignature = useCallback(async () => {
    if (!sigRef.current || sigRef.current.isEmpty() || !paymentId || !stripeSessionId) return;
    setSignatureSaving(true);
    try {
      const signaturePngBase64 = sigRef.current.toDataURL("image/png");
      const res = await fetch(`/api/public/payments/${paymentId}/signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signaturePngBase64, invoiceId: parseInt(invoiceId), sessionId: stripeSessionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save signature');
      }
      setSignatureSaved(true);
      setShowSignature(false);
      if (!hasRedirectedRef.current) {
        hasRedirectedRef.current = true;
        setTimeout(() => {
          window.location.href = '/jobs';
        }, 1200);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to save signature", variant: "destructive" });
    } finally {
      setSignatureSaving(false);
    }
  }, [paymentId, invoiceId, stripeSessionId]);

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-800"></div>
      </div>
    );
  }

  if (error && !stripeCanceled && !stripeSuccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
          <h2 className="text-xl font-semibold mb-2 text-gray-900">
            {error || 'Invoice not found'}
          </h2>
          <p className="text-gray-500">
            This invoice may no longer be available or the link may be incorrect.
          </p>
        </div>
      </div>
    );
  }

  if (stripeSuccess && showSignature) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-md w-full overflow-hidden">
          <div className="px-6 pt-6 pb-4 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              {isPartialPayment ? 'Partial Payment Received' : 'Payment Successful'}
            </h2>
            {confirmedAmountCents && (
              <p className="text-sm font-semibold text-green-600 mb-1">{formatCurrency(confirmedAmountCents)}</p>
            )}
            <p className="text-sm text-gray-500 mb-4">Please sign below to confirm your payment.</p>
          </div>
          <div className="px-6 pb-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden bg-gray-50">
              <SignatureCanvas
                ref={sigRef}
                penColor="black"
                canvasProps={{
                  width: 350,
                  height: 200,
                  className: 'w-full',
                  style: { width: '100%', height: '200px', touchAction: 'none' },
                }}
                onBegin={() => setHasDrawn(true)}
              />
            </div>
            <div className="flex gap-3 mt-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { sigRef.current?.clear(); setHasDrawn(false); }}
              >
                Clear
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                disabled={!hasDrawn || signatureSaving}
                onClick={handleSaveSignature}
              >
                {signatureSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : 'Confirm & Sign'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (stripeSuccess) {
    if (pollTimedOut && !paymentConfirmed) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
            <Loader2 className="h-12 w-12 text-blue-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              We're still finalizing your payment
            </h2>
            <p className="text-gray-500 mb-6 text-sm">
              This can take a few seconds. Your payment has been received by Stripe and is being processed.
            </p>
            <div className="flex gap-3 justify-center">
              <Button
                variant="outline"
                onClick={() => {
                  setStripeSuccess(false);
                  setStripeCanceled(false);
                  setPollTimedOut(false);
                  setStripeSessionId(null);
                  pollingRef.current = false;
                }}
              >
                Back to Invoice
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => {
                  setPollTimedOut(false);
                  pollingRef.current = true;
                  runConfirmPoll();
                }}
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {signatureSaved
              ? 'Thank You!'
              : paymentConfirmed
                ? (isPartialPayment ? 'Partial Payment Received' : 'Payment Successful')
                : 'Confirming Payment...'}
          </h2>
          {!paymentConfirmed && (
            <div className="flex items-center justify-center gap-2 text-gray-500 mt-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p className="text-sm">Verifying your payment...</p>
            </div>
          )}
          {paymentConfirmed && (
            <p className="text-gray-500 mt-1">
              {signatureSaved
                ? 'Your payment and signature have been recorded. A receipt will be sent to your email.'
                : 'Your payment has been recorded successfully.'}
            </p>
          )}
          {invoice && (
            <div className="mt-6 pt-4 border-t border-gray-100 text-sm text-gray-600 space-y-1">
              <p><span className="font-medium">Invoice:</span> {invoice.invoiceNumber}</p>
              <p><span className="font-medium">Amount Paid:</span> {formatCurrency(confirmedAmountCents || invoice.balanceDueCents || invoice.totalCents)}</p>
              {invoice.company.name && (
                <p><span className="font-medium">Paid to:</span> {invoice.company.name}</p>
              )}
            </div>
          )}
          {signatureSaved && (
            <div className="mt-6">
              <Button
                variant="outline"
                onClick={() => { window.location.href = '/jobs'; }}
                className="text-sm"
              >
                Back to Jobs
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (stripeCanceled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
          <XCircle className="h-16 w-16 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Payment Canceled</h2>
          <p className="text-gray-500 mb-6">
            Your payment was not completed. You can try again when you're ready.
          </p>
          <Button
            onClick={() => {
              setStripeCanceled(false);
              setError(null);
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            Return to Invoice
          </Button>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
          <h2 className="text-xl font-semibold mb-2 text-gray-900">Invoice not found</h2>
          <p className="text-gray-500">This invoice may no longer be available.</p>
        </div>
      </div>
    );
  }

  const isPaid = invoice.status === 'paid';
  const lineItems = invoice.lineItems || [];
  const companyAddress = buildAddress([
    invoice.company.addressLine1,
    invoice.company.addressLine2,
    invoice.company.city,
    invoice.company.state,
    invoice.company.postalCode,
  ]);
  const customerAddress = invoice.customer
    ? buildAddress([
        invoice.customer.address,
        invoice.customer.city,
        invoice.customer.state,
        invoice.customer.zip,
      ])
    : null;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 md:py-12">
      <div className="max-w-[900px] mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-extrabold tracking-tight text-black" style={{ fontFamily: 'Inter, Arial, sans-serif', letterSpacing: '-0.5px' }}>
            EcoLogic
          </h1>
          <p className="text-sm text-gray-500 mt-1 font-medium" style={{ fontFamily: 'Inter, Arial, sans-serif' }}>
            Professional contractor management
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-8 pt-8 pb-6 md:px-10 md:pt-10">
            <div className="flex flex-col md:flex-row md:justify-between gap-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{invoice.company.name}</h2>
                {companyAddress && (
                  <p className="text-sm text-gray-500 mt-1">{companyAddress}</p>
                )}
                {invoice.company.email && (
                  <p className="text-sm text-gray-500">{invoice.company.email}</p>
                )}
                {invoice.company.phone && (
                  <p className="text-sm text-gray-500">{invoice.company.phone}</p>
                )}
              </div>

              <div className="md:text-right">
                <h3 className="text-2xl font-bold text-gray-900 tracking-tight">INVOICE</h3>
                <div className="mt-2 space-y-1 text-sm">
                  <p className="text-gray-500">
                    <span className="font-medium text-gray-700">{invoice.invoiceNumber}</span>
                  </p>
                  <p className="text-gray-500">
                    Issued: {format(new Date(invoice.issueDate), 'MMM d, yyyy')}
                  </p>
                  <p className="text-gray-500">
                    Due: {format(new Date(invoice.dueDate), 'MMM d, yyyy')}
                  </p>
                </div>
                <div className="mt-3">
                  {isPaid ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-green-50 text-green-700 border border-green-200">
                      <CheckCircle className="h-3.5 w-3.5" />
                      Paid
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                      {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="px-8 pb-6 md:px-10">
            <div className="flex flex-col md:flex-row gap-6">
              {invoice.customer && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Bill To</p>
                  <p className="text-sm font-semibold text-gray-900">{invoice.customer.name}</p>
                  {customerAddress && (
                    <p className="text-sm text-gray-500">{customerAddress}</p>
                  )}
                  {invoice.customer.email && (
                    <p className="text-sm text-gray-500">{invoice.customer.email}</p>
                  )}
                </div>
              )}
              {invoice.jobTitle && (
                <div className={invoice.customer ? 'md:ml-16' : ''}>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Job</p>
                  <p className="text-sm font-semibold text-gray-900">{invoice.jobTitle}</p>
                </div>
              )}
            </div>
          </div>

          {lineItems.length > 0 && (
            <div className="px-8 pb-6 md:px-10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-b border-gray-200">
                    <th className="py-3 text-left font-semibold text-gray-500 uppercase text-xs tracking-wider">Service</th>
                    <th className="py-3 text-center font-semibold text-gray-500 uppercase text-xs tracking-wider w-16">Qty</th>
                    <th className="py-3 text-right font-semibold text-gray-500 uppercase text-xs tracking-wider w-24">Price</th>
                    <th className="py-3 text-right font-semibold text-gray-500 uppercase text-xs tracking-wider w-28">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, index) => (
                    <tr key={index} className="border-b border-gray-100">
                      <td className="py-3">
                        <p className="font-medium text-gray-900">{item.name}</p>
                        {item.description && (
                          <p className="text-gray-500 text-xs mt-0.5">{item.description}</p>
                        )}
                      </td>
                      <td className="py-3 text-center text-gray-700">
                        {item.quantity} {item.unit && item.unit !== 'x' ? item.unit : ''}
                      </td>
                      <td className="py-3 text-right text-gray-700">{formatCurrency(item.unitPriceCents)}</td>
                      <td className="py-3 text-right font-medium text-gray-900">{formatCurrency(item.quantity * item.unitPriceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="px-8 pb-8 md:px-10">
            <div className="flex justify-end">
              <div className="w-full max-w-[280px] space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="text-gray-900">{formatCurrency(invoice.subtotalCents)}</span>
                </div>
                {invoice.taxCents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Tax</span>
                    <span className="text-gray-900">{formatCurrency(invoice.taxCents)}</span>
                  </div>
                )}
                <div className="border-t border-gray-200 pt-2">
                  <div className="flex justify-between text-base font-bold">
                    <span className="text-gray-900">Total</span>
                    <span className="text-gray-900">{formatCurrency(invoice.totalCents)}</span>
                  </div>
                </div>
                {(invoice.paidAmountCents > 0 || isPaid) && (
                  <div className="flex justify-between text-sm">
                    <span className="text-green-600 font-medium">Amount Paid</span>
                    <span className="text-green-600 font-semibold">{formatCurrency(isPaid && !invoice.paidAmountCents ? invoice.totalCents : invoice.paidAmountCents)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t border-gray-100 pt-2">
                  <span className="text-gray-500 font-medium">Balance Due</span>
                  <span className={`font-semibold ${(invoice.balanceDueCents || 0) > 0 ? 'text-gray-900' : 'text-green-600'}`}>
                    {formatCurrency(isPaid ? 0 : (invoice.balanceDueCents ?? invoice.totalCents))}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {!isPaid && invoice.totalCents > 0 && (
            <div className="px-8 pb-8 md:px-10">
              <Button
                onClick={handlePay}
                disabled={isCheckoutLoading}
                className="w-full h-14 text-lg bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
              >
                {isCheckoutLoading ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CreditCard className="h-5 w-5 mr-2" />
                    Pay {formatCurrency(invoice.balanceDueCents || invoice.totalCents)}
                  </>
                )}
              </Button>
            </div>
          )}

          {isPaid && (
            <div className="px-8 pb-8 md:px-10">
              <div className="text-center text-green-600 font-medium flex items-center justify-center gap-2">
                <CheckCircle className="h-5 w-5" />
                This invoice has been paid. Thank you!
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
