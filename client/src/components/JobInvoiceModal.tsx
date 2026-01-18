import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileText, Mail, Loader2, Download, ExternalLink, RefreshCw, AlertCircle, ArrowRight, ArrowLeft, Maximize2, CreditCard, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

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
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);
  
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

  // Fetch existing PDF when modal opens
  useEffect(() => {
    if (open && !pdfUrl) {
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
              // Set invoice data for payment link
              if (data.invoiceId) {
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
      
      toast({
        title: "Invoice Generated",
        description: `${data.fileName} is ready to send.`,
      });
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

    setPaymentLinkLoading(true);
    try {
      console.log("[Checkout] window.location.origin", window.location.origin);
      const response = await apiRequest("POST", "/api/payments/checkout", { 
        invoiceId,
        returnBaseUrl: window.location.origin 
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to create payment link");
      }
      const data = await response.json();
      
      // Open Stripe Checkout in new tab
      if (data.url) {
        window.open(data.url, "_blank");
        toast({
          title: "Payment Link Created",
          description: "Stripe Checkout page opened in a new tab. Share this with your customer.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create payment link",
        variant: "destructive",
      });
    } finally {
      setPaymentLinkLoading(false);
    }
  };

  const isEmailValid = toEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail);
  const isPaid = invoiceStatus?.toLowerCase() === 'paid';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={pdfUrl && step === 1 ? "max-w-2xl" : "max-w-md"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 1 ? (
              <>
                <FileText className="h-5 w-5" />
                Generate Invoice PDF
              </>
            ) : (
              <>
                <Mail className="h-5 w-5" />
                Send Invoice
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? `Generate a PDF invoice for "${jobTitle}"`
              : "Enter the recipient details to send the invoice via email."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="py-4">
            {loadingExisting ? (
              <div className="text-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400 mx-auto mb-4" />
                <p className="text-sm text-slate-500">Checking for existing invoice...</p>
              </div>
            ) : errorMessage ? (
              <div className="text-center py-6">
                <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                  {errorMessage}
                </p>
                <Button
                  variant="outline"
                  onClick={() => setErrorMessage(null)}
                >
                  Try Again
                </Button>
              </div>
            ) : !pdfUrl ? (
              <div className="text-center">
                <FileText className="h-16 w-16 text-slate-300 mx-auto mb-4" />
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                  Click the button below to generate an invoice PDF for this job
                </p>
                <Button
                  onClick={handleGeneratePdf}
                  disabled={generatePdfMutation.isPending}
                  className="w-full"
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
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {pdfFileName}
                    </span>
                    <button
                      onClick={handleRegenerate}
                      disabled={generatePdfMutation.isPending}
                      className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline flex items-center gap-1"
                    >
                      {generatePdfMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Regenerate
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(pdfUrl, "_blank")}
                      className="h-8 px-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="h-8 px-2"
                    >
                      <a href={pdfUrl} download={pdfFileName}>
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
                <div 
                  className="relative rounded-lg overflow-hidden cursor-pointer group bg-slate-100 dark:bg-slate-800 p-4 shadow-inner" 
                  style={{ height: '55vh' }}
                  onClick={() => window.open(`${pdfUrl}#view=Fit`, "_blank")}
                >
                  <div className="bg-white dark:bg-slate-900 rounded shadow-lg mx-auto h-full overflow-hidden">
                    {previewImageUrl ? (
                      <img
                        src={previewImageUrl}
                        alt="Invoice Preview"
                        className="w-full h-full object-contain"
                        onLoad={() => setPreviewLoading(false)}
                        onError={() => { setPreviewLoading(false); setPreviewError(true); }}
                      />
                    ) : (
                      <iframe
                        key={pdfUrl}
                        src={`${pdfUrl}#view=Fit`}
                        title="Invoice PDF Preview"
                        className="w-full h-full"
                        style={{ border: 0 }}
                        onLoad={() => setPreviewLoading(false)}
                        onError={() => { setPreviewLoading(false); setPreviewError(true); }}
                      />
                    )}
                    {previewLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-slate-900/80">
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                          <span className="text-sm text-slate-500">Loading preview...</span>
                        </div>
                      </div>
                    )}
                    {previewError && !previewLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-slate-900">
                        <div className="flex flex-col items-center gap-3 text-center p-4">
                          <FileText className="h-12 w-12 text-slate-300" />
                          <p className="text-sm text-slate-500">Preview not available on this device</p>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); window.open(pdfUrl!, "_blank"); }}
                          >
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Open PDF
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center pointer-events-none">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-slate-800 rounded-full p-3 shadow-lg">
                      <Maximize2 className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                    </div>
                  </div>
                  <div className="absolute bottom-6 left-6 text-xs text-slate-500 bg-white/90 dark:bg-slate-800/90 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                    Tap to enlarge
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="toEmail">To</Label>
              <Input
                id="toEmail"
                type="email"
                placeholder="customer@email.com"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
              />
              {!customerEmail && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No email on file for this customer
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
              <FileText className="h-4 w-4 text-slate-500" />
              <span className="text-sm text-slate-600 dark:text-slate-400">
                Attachment: {pdfFileName}
              </span>
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:gap-2">
          {isPaid && (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 flex items-center gap-1 mr-auto">
              <CheckCircle2 className="h-3 w-3" />
              Paid
            </Badge>
          )}
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              {pdfUrl && invoiceId && !isPaid && (
                <Button
                  variant="outline"
                  onClick={handleGetPaymentLink}
                  disabled={paymentLinkLoading}
                  className="text-green-600 border-green-600 hover:bg-green-50 dark:text-green-400 dark:border-green-400 dark:hover:bg-green-950"
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
                onClick={() => setStep(2)}
                disabled={!pdfUrl}
              >
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              {invoiceId && !isPaid && (
                <Button
                  variant="outline"
                  onClick={handleGetPaymentLink}
                  disabled={paymentLinkLoading}
                  className="text-green-600 border-green-600 hover:bg-green-50 dark:text-green-400 dark:border-green-400 dark:hover:bg-green-950"
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
                onClick={handleSendEmail}
                disabled={!isEmailValid || sendEmailMutation.isPending}
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
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
