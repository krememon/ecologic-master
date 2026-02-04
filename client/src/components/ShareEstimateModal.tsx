import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileText, Mail, Loader2, Download, ArrowRight, ArrowLeft, ExternalLink, Maximize2, RefreshCw, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ShareEstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateId: number;
  estimateNumber: string;
  customerEmail?: string | null;
  customerFirstName?: string | null;
  companyName?: string;
}

export function ShareEstimateModal({
  open,
  onOpenChange,
  estimateId,
  estimateNumber,
  customerEmail,
  customerFirstName,
  companyName = "Our Company",
}: ShareEstimateModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  
  const [toEmail, setToEmail] = useState(customerEmail || "");
  const [subject, setSubject] = useState(`Estimate ${estimateNumber} from ${companyName}`);
  const [message, setMessage] = useState(
    `Hi${customerFirstName ? ` ${customerFirstName}` : ""},\n\nThank you for choosing ${companyName}. Please see attached estimate.\n\nBest regards,\n${companyName}`
  );

  // Fetch existing PDF when modal opens
  useEffect(() => {
    if (open && !pdfUrl) {
      setLoadingExisting(true);
      fetch(`/api/estimates/${estimateId}/share/pdf/latest`, { credentials: 'include' })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            if (data.pdfUrl) {
              setPdfUrl(data.pdfUrl);
              setPdfFileName(data.fileName);
              setPreviewImageUrl(data.previewImageUrl || null);
              setPreviewLoading(true);
              setPreviewError(false);
              console.log("[SharePDF] Loaded existing PDF:", data);
            }
          }
        })
        .catch((err) => {
          console.log("[SharePDF] No existing PDF found:", err);
        })
        .finally(() => {
          setLoadingExisting(false);
        });
    }
  }, [open, estimateId]);

  const generatePdfMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/estimates/${estimateId}/share/pdf`);
      return response.json();
    },
    onSuccess: (data) => {
      console.log("[SharePDF] Generation response:", data);
      setPdfUrl(data.pdfUrl);
      setPdfFileName(data.fileName);
      setPreviewImageUrl(data.previewImageUrl || null);
      setPreviewLoading(true);
      setPreviewError(false);
      console.log("[SharePDF] previewImageUrl set:", data.previewImageUrl);
      toast({
        title: "PDF Generated",
        description: `${data.fileName} is ready to send.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate PDF",
        variant: "destructive",
      });
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      const payload = { toEmail, subject, message, pdfUrl };
      console.log("[ShareEmail] sending payload", payload);
      const response = await apiRequest("POST", `/api/estimates/${estimateId}/share/email`, payload);
      const text = await response.text();
      console.log("[ShareEmail] response", response.status, text);
      if (!response.ok) {
        throw new Error(text || "Failed to send email");
      }
      return JSON.parse(text);
    },
    onSuccess: () => {
      toast({
        title: "Email Sent",
        description: `Estimate sent to ${toEmail}`,
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
    // Only reset step and email fields, keep PDF state so it persists on reopen
    setStep(1);
    setPreviewLoading(false);
    setPreviewError(false);
    setToEmail(customerEmail || "");
    setSubject(`Estimate ${estimateNumber} from ${companyName}`);
    setMessage(
      `Hi${customerFirstName ? ` ${customerFirstName}` : ""},\n\nThank you for choosing ${companyName}. Please see attached estimate.\n\nBest regards,\n${companyName}`
    );
    onOpenChange(false);
  };

  const handleRegenerate = () => {
    generatePdfMutation.mutate();
  };

  const handleGeneratePdf = () => {
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

  const isEmailValid = toEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent 
        className={`${pdfUrl && step === 1 ? "max-w-2xl" : "max-w-md"} p-0 gap-0 overflow-hidden rounded-2xl`}
        hideCloseButton
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2">
            {step === 1 ? (
              <FileText className="h-4 w-4 text-slate-500" />
            ) : (
              <Mail className="h-4 w-4 text-slate-500" />
            )}
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {step === 1 ? "Generate Estimate PDF" : "Send Estimate"}
            </DialogTitle>
          </div>
          <button 
            onClick={handleClose} 
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === 1 && (
          <div className="bg-white dark:bg-slate-900">
            {loadingExisting ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400 mb-3" />
                <p className="text-sm text-slate-500">Checking for existing PDF...</p>
              </div>
            ) : !pdfUrl ? (
              <div className="flex flex-col items-center px-6 py-8">
                <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                  <FileText className="h-7 w-7 text-slate-400" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                  Generate a PDF for estimate
                </p>
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300 mb-6">
                  {estimateNumber}
                </span>
                <div className="w-full space-y-2">
                  <Button
                    onClick={handleGeneratePdf}
                    disabled={generatePdfMutation.isPending}
                    className="w-full h-11 rounded-xl"
                  >
                    {generatePdfMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4 mr-2" />
                        Generate PDF
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setStep(2)}
                    disabled={!pdfUrl}
                    className="w-full h-11 rounded-xl disabled:opacity-40"
                  >
                    Next
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleClose}
                    className="w-full h-11 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between px-1">
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
                  className="relative rounded-xl overflow-hidden cursor-pointer group bg-slate-100 dark:bg-slate-800 p-3 shadow-inner" 
                  style={{ height: '50vh' }}
                  onClick={() => window.open(`${pdfUrl}#view=Fit`, "_blank")}
                >
                  <div className="bg-white dark:bg-slate-900 rounded-lg shadow-lg mx-auto h-full overflow-hidden">
                    {previewImageUrl ? (
                      <img
                        src={previewImageUrl}
                        alt="Estimate Preview"
                        className="w-full h-full object-contain"
                        onLoad={() => setPreviewLoading(false)}
                        onError={() => { setPreviewLoading(false); setPreviewError(true); }}
                      />
                    ) : (
                      <iframe
                        key={pdfUrl}
                        src={`${pdfUrl}#view=Fit`}
                        title="Estimate PDF Preview"
                        className="w-full h-full"
                        style={{ border: 0 }}
                        onLoad={() => setPreviewLoading(false)}
                        onError={() => { setPreviewLoading(false); setPreviewError(true); }}
                      />
                    )}
                    {previewLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-slate-900/80">
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                          <span className="text-sm text-slate-500">Loading preview...</span>
                        </div>
                      </div>
                    )}
                    {previewError && !previewLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-slate-900">
                        <div className="flex flex-col items-center gap-3 text-center p-4">
                          <FileText className="h-10 w-10 text-slate-300" />
                          <p className="text-sm text-slate-500">Preview not available on this device</p>
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="rounded-xl"
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
                  <div className="absolute bottom-4 left-4 text-xs text-slate-500 bg-white/90 dark:bg-slate-800/90 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                    Tap to enlarge
                  </div>
                </div>
                {/* Buttons for PDF ready state */}
                <div className="space-y-2 pt-2">
                  <Button
                    onClick={() => setStep(2)}
                    className="w-full h-11 rounded-xl"
                  >
                    Next
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleClose}
                    className="w-full h-11 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="bg-white dark:bg-slate-900 p-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="toEmail" className="text-sm font-medium text-slate-700 dark:text-slate-300">To</Label>
              <Input
                id="toEmail"
                type="email"
                placeholder="customer@email.com"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject" className="text-sm font-medium text-slate-700 dark:text-slate-300">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message" className="text-sm font-medium text-slate-700 dark:text-slate-300">Message</Label>
              <Textarea
                id="message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0 resize-none"
              />
            </div>
            <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
              <FileText className="h-4 w-4 text-slate-500" />
              <span className="text-sm text-slate-600 dark:text-slate-400">
                Attachment: {pdfFileName}
              </span>
            </div>
            {/* Buttons for step 2 */}
            <div className="space-y-2 pt-2">
              <Button
                onClick={handleSendEmail}
                disabled={!isEmailValid || sendEmailMutation.isPending}
                className="w-full h-11 rounded-xl"
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
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                className="w-full h-11 rounded-xl"
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
