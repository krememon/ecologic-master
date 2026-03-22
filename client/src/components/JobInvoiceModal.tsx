import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileText, Mail, Loader2, Download, ExternalLink, RefreshCw, AlertCircle, ArrowRight, ArrowLeft, CheckCircle2, CreditCard, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isNativePlatform, nativePdfShare } from "@/lib/capacitor";

interface JobInvoiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: number;
  jobTitle: string;
  customerEmail?: string | null;
  customerFirstName?: string | null;
  companyName?: string;
}

export function JobInvoiceModal({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  customerEmail,
  customerFirstName,
  companyName = "Our Company",
}: JobInvoiceModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [invoiceAmount, setInvoiceAmount] = useState<string | null>(null);
  const [invoiceStatus, setInvoiceStatus] = useState<string | null>(null);
  const [invoicePaidAt, setInvoicePaidAt] = useState<string | null>(null);
  const [invoiceBalanceDueCents, setInvoiceBalanceDueCents] = useState<number | null>(null);
  const [invoiceAmountPaidCents, setInvoiceAmountPaidCents] = useState<number | null>(null);
  const [invoiceTotalCents, setInvoiceTotalCents] = useState<number | null>(null);
  const [invoiceStatusLoading, setInvoiceStatusLoading] = useState(true);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  
  const [toEmail, setToEmail] = useState(customerEmail || "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  // Update email defaults when invoice number or props change
  useEffect(() => {
    const invNum = invoiceNumber || "Invoice";
    setSubject(`${invNum} from ${companyName}`);
    setMessage(
      `Hi${customerFirstName ? ` ${customerFirstName}` : ""},\n\nThank you for your business. Please find your invoice attached.\n\nBest regards,\n${companyName}`
    );
  }, [invoiceNumber, companyName, customerFirstName]);

  // Fetch existing PDF and fresh invoice status when modal opens
  useEffect(() => {
    if (open) {
      // Set loading flag to prevent stale state from showing Pay Invoice
      setInvoiceStatusLoading(true);
      
      // Always fetch fresh invoice status when modal opens
      fetch(`/api/jobs/${jobId}/invoice`, { credentials: 'include' })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            if (data.invoice) {
              const inv = data.invoice;
              console.log("[Invoice PDF Modal] opened", { 
                invoiceId: inv.id, 
                jobId, 
                paidAt: inv.paidAt, 
                status: inv.status, 
                balanceDueCents: inv.balanceDueCents,
                amountPaidCents: inv.amountPaidCents,
                totalCents: inv.totalCents
              });
              setInvoiceId(inv.id);
              setInvoiceStatus(inv.status);
              setInvoicePaidAt(inv.paidAt || null);
              setInvoiceBalanceDueCents(typeof inv.balanceDueCents === 'number' ? inv.balanceDueCents : null);
              setInvoiceAmountPaidCents(typeof inv.amountPaidCents === 'number' ? inv.amountPaidCents : null);
              setInvoiceTotalCents(typeof inv.totalCents === 'number' ? inv.totalCents : null);
              setInvoiceAmount(inv.total || inv.amount);
              console.log("[Invoice PDF Modal] refreshed invoice", inv);
            }
          }
        })
        .catch((err) => {
          console.log("[Invoice UI] Could not fetch invoice status:", err);
        })
        .finally(() => {
          setInvoiceStatusLoading(false);
        });

      // Only fetch PDF if not already loaded
      if (!pdfUrl) {
        setLoadingExisting(true);
        setErrorMessage(null);
        fetch(`/api/jobs/${jobId}/invoice/pdf/latest`, { credentials: 'include' })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              if (data.pdfUrl) {
                setPdfUrl(data.pdfUrl);
                setPdfFileName(data.fileName);
                setPreviewImageUrl(data.previewImageUrl || null);
                setPreviewLoading(true);
                setPreviewError(false);
                // Set invoice data for payment link (backup if not set above)
                if (data.invoiceId && !invoiceId) {
                  setInvoiceId(data.invoiceId);
                  setInvoiceAmount(data.invoiceAmount);
                  setInvoiceStatus(data.invoiceStatus);
                }
                // Extract invoice number from filename
                const match = data.fileName?.match(/Invoice_(INV_\d+)/);
                if (match) {
                  setInvoiceNumber(match[1].replace(/_/g, '-'));
                }
              }
            }
          })
          .catch((err) => {
            console.log("[InvoicePDF] No existing PDF found:", err);
          })
          .finally(() => {
            setLoadingExisting(false);
          });
      }
    }
  }, [open, jobId]);

  const generatePdfMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/jobs/${jobId}/invoice/pdf`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to generate invoice");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setPdfUrl(data.pdfUrl);
      setPdfFileName(data.fileName);
      setPreviewImageUrl(data.previewImageUrl || null);
      setInvoiceNumber(data.invoiceNumber || null);
      setInvoiceId(data.invoiceId || null);
      setInvoiceAmount(data.amount || null);
      setInvoiceStatus('pending');
      setPreviewLoading(true);
      setPreviewError(false);
      setErrorMessage(null);
      
      // Invalidate invoices cache so it appears in Invoices tab immediately
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
    },
    onError: (error: any) => {
      const errMsg = error.message || "Failed to generate invoice";
      setErrorMessage(errMsg);
      toast({
        title: "Error",
        description: errMsg,
        variant: "destructive",
      });
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      const payload = { toEmail, subject, message, pdfUrl };
      const response = await apiRequest("POST", `/api/jobs/${jobId}/invoice/email`, payload);
      const text = await response.text();
      if (!response.ok) {
        throw new Error(text || "Failed to send email");
      }
      return JSON.parse(text);
    },
    onSuccess: () => {
      toast({
        title: "Invoice Sent",
        description: `Invoice sent to ${toEmail}`,
      });
      handleClose();
    },
    onError: (error: any) => {
      const errorData = error.message;
      if (errorData?.includes("not configured") || errorData?.includes("EMAIL_NOT_CONFIGURED")) {
        toast({
          title: "Email Not Configured",
          description: "The email service is not set up. Please configure RESEND_API_KEY.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to send email",
          variant: "destructive",
        });
      }
    },
  });

  const handleClose = () => {
    // Reset all state so each job starts fresh
    setStep(1);
    setPdfUrl(null);
    setPdfFileName(null);
    setInvoiceNumber(null);
    setInvoiceId(null);
    setInvoiceAmount(null);
    setInvoiceStatus(null);
    setInvoicePaidAt(null);
    setInvoiceBalanceDueCents(null);
    setInvoiceAmountPaidCents(null);
    setInvoiceTotalCents(null);
    setInvoiceStatusLoading(true);
    setPreviewImageUrl(null);
    setPreviewLoading(false);
    setPreviewError(false);
    setLoadingExisting(false);
    setErrorMessage(null);
    setPaymentLinkLoading(false);
    setToEmail(customerEmail || "");
    onOpenChange(false);
  };

  const handleRegenerate = () => {
    setErrorMessage(null);
    generatePdfMutation.mutate();
  };

  const handleGeneratePdf = () => {
    setErrorMessage(null);
    generatePdfMutation.mutate();
  };

  const handleSendEmail = () => {
    if (!toEmail) {
      toast({
        title: "Email Required",
        description: "Please enter an email address",
        variant: "destructive",
      });
      return;
    }
    sendEmailMutation.mutate();
  };

  const handleGetPaymentLink = async () => {
    if (!invoiceId) {
      toast({
        title: "No Invoice",
        description: "Generate an invoice first before creating a payment link.",
        variant: "destructive",
      });
      return;
    }

    const paymentUrl = `${window.location.origin}/invoice/${invoiceId}/pay`;
    try {
      await navigator.clipboard.writeText(paymentUrl);
      toast({
        title: "Payment Link Copied",
        description: "Share this link with your customer so they can pay online.",
      });
    } catch {
      window.open(paymentUrl, "_blank");
      toast({
        title: "Payment Link Opened",
        description: "Share this page link with your customer to collect payment.",
      });
    }
    setPaymentLinkLoading(false);
  };

  const isEmailValid = toEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail);
  // Comprehensive isPaid check - matches backend logic
  const isPaid = (
    invoiceStatus?.toLowerCase() === 'paid' ||
    !!invoicePaidAt ||
    (typeof invoiceBalanceDueCents === 'number' && invoiceBalanceDueCents <= 0) ||
    (typeof invoiceAmountPaidCents === 'number' && typeof invoiceTotalCents === 'number' && invoiceAmountPaidCents >= invoiceTotalCents)
  );
  
  // Only show "Pay Invoice" when we've confirmed the invoice is NOT paid
  // Hide the button while loading to prevent flash of stale state
  const canShowPayButton = !invoiceStatusLoading && !isPaid;
  
  // Debug log for render
  console.log("[Invoice PDF Modal] render flags", {
    invoiceStatusLoading,
    status: invoiceStatus,
    paidAt: invoicePaidAt,
    balanceDueCents: invoiceBalanceDueCents,
    amountPaidCents: invoiceAmountPaidCents,
    totalCents: invoiceTotalCents,
    isPaid,
    canShowPayButton
  });

  const isNative = isNativePlatform();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" hideCloseButton>
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex-shrink-0">
          <div className="min-w-[44px]" />
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {step === 1 ? "Generate Invoice PDF" : "Send Invoice"}
          </DialogTitle>
          <button 
            onClick={handleClose} 
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === 1 && (
          <div className="bg-white dark:bg-slate-900 flex flex-col flex-1 overflow-hidden">
            {loadingExisting ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400 mr-2" />
                <span className="text-sm text-slate-500">Checking for existing invoice...</span>
              </div>
            ) : errorMessage ? (
              <div className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {errorMessage}
                  </p>
                </div>
                <div className="pt-2 space-y-2">
                  <Button
                    className="w-full h-11 rounded-xl font-medium"
                    onClick={() => setErrorMessage(null)}
                  >
                    Try Again
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-11 rounded-xl font-medium"
                    onClick={handleClose}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : !pdfUrl ? (
              <div className="p-4 space-y-4">
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Generate a PDF invoice for</p>
                  <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{jobTitle}</p>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Click Generate to download a PDF for this job.
                </p>
                <div className="pt-1 space-y-2">
                  <Button
                    onClick={handleGeneratePdf}
                    disabled={generatePdfMutation.isPending}
                    className="w-full h-11 rounded-xl font-medium"
                  >
                    {generatePdfMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4 mr-2" />
                        Generate Invoice
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-11 rounded-xl font-medium"
                    onClick={handleClose}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {/* Document card */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 overflow-hidden">
                  {/* Preview thumbnail — only shown when server actually produced one */}
                  {previewImageUrl && (
                    <div
                      className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer max-h-48 overflow-hidden flex items-center justify-center"
                      onClick={() => window.open(pdfUrl!, "_blank")}
                    >
                      <img
                        src={previewImageUrl}
                        alt="Invoice preview"
                        className="w-full object-contain max-h-48"
                      />
                    </div>
                  )}

                  {/* File info */}
                  <div className="p-3.5 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                      <FileText className="h-5 w-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {pdfFileName}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">PDF Ready</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-slate-500 flex-shrink-0"
                      disabled={downloadingPdf}
                      onClick={async () => {
                        if (!pdfUrl) return;
                        setDownloadingPdf(true);
                        try {
                          await nativePdfShare(
                            pdfUrl,
                            pdfFileName ?? "invoice.pdf",
                            `/api/jobs/${jobId}/invoice/pdf/download`,
                          );
                        } finally {
                          setDownloadingPdf(false);
                        }
                      }}
                    >
                      {downloadingPdf ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {/* Card actions */}
                  <div className="flex border-t border-slate-200 dark:border-slate-700">
                    <button
                      onClick={() => window.open(pdfUrl!, "_blank")}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View PDF
                    </button>
                    <div className="w-px bg-slate-200 dark:bg-slate-700" />
                    <button
                      onClick={handleRegenerate}
                      disabled={generatePdfMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-50"
                    >
                      {generatePdfMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Regenerate
                    </button>
                  </div>
                </div>

                {/* Primary actions */}
                <Button
                  onClick={() => setStep(2)}
                  className="w-full h-11 rounded-xl font-medium"
                >
                  Next
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
                {invoiceId && canShowPayButton && (
                  <Button
                    variant="outline"
                    onClick={handleGetPaymentLink}
                    disabled={paymentLinkLoading}
                    className="w-full h-11 rounded-xl font-medium text-green-600 border-green-600 hover:bg-green-50 dark:text-green-400 dark:border-green-400 dark:hover:bg-green-950"
                  >
                    {paymentLinkLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <CreditCard className="h-4 w-4 mr-2" />
                        Pay Invoice
                      </>
                    )}
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={handleClose}
                  className="w-full h-11 rounded-xl font-medium"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="bg-white dark:bg-slate-900 p-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="toEmail">To</Label>
              <Input
                id="toEmail"
                type="email"
                placeholder="customer@email.com"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                className="h-10 rounded-xl"
              />
              {!customerEmail && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No email on file for this customer
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="h-10 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
              <FileText className="h-4 w-4 text-slate-500" />
              <span className="text-sm text-slate-600 dark:text-slate-400 truncate">
                Attachment: {pdfFileName}
              </span>
            </div>
            <div className="pt-1 space-y-2">
              <Button
                onClick={handleSendEmail}
                disabled={!isEmailValid || sendEmailMutation.isPending}
                className="w-full h-11 rounded-xl font-medium"
              >
                {sendEmailMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Send Email
                  </>
                )}
              </Button>
              {invoiceId && canShowPayButton && (
                <Button
                  variant="outline"
                  onClick={handleGetPaymentLink}
                  disabled={paymentLinkLoading}
                  className="w-full h-11 rounded-xl font-medium text-green-600 border-green-600 hover:bg-green-50 dark:text-green-400 dark:border-green-400 dark:hover:bg-green-950"
                >
                  {paymentLinkLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <CreditCard className="h-4 w-4 mr-2" />
                      Pay Invoice
                    </>
                  )}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                className="w-full h-11 rounded-xl font-medium"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
