import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileText, Mail, Loader2, Download, ArrowRight, ArrowLeft, ExternalLink, X, Maximize2 } from "lucide-react";
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
  const [iframeError, setIframeError] = useState(false);
  const [isPdfViewerOpen, setIsPdfViewerOpen] = useState(false);
  
  const [toEmail, setToEmail] = useState(customerEmail || "");
  const [subject, setSubject] = useState(`Estimate ${estimateNumber} from ${companyName}`);
  const [message, setMessage] = useState(
    `Hi${customerFirstName ? ` ${customerFirstName}` : ""},\n\nThank you for choosing ${companyName}. Please see attached estimate.\n\nBest regards,\n${companyName}`
  );

  const generatePdfMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/estimates/${estimateId}/share/pdf`);
      return response.json();
    },
    onSuccess: (data) => {
      setPdfUrl(data.pdfUrl);
      setPdfFileName(data.fileName);
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
      const response = await apiRequest("POST", `/api/estimates/${estimateId}/share/email`, {
        toEmail,
        subject,
        message,
        pdfUrl,
      });
      return response.json();
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
    setStep(1);
    setPdfUrl(null);
    setPdfFileName(null);
    setIframeError(false);
    setIsPdfViewerOpen(false);
    setToEmail(customerEmail || "");
    setSubject(`Estimate ${estimateNumber} from ${companyName}`);
    setMessage(
      `Hi${customerFirstName ? ` ${customerFirstName}` : ""},\n\nThank you for choosing ${companyName}. Please see attached estimate.\n\nBest regards,\n${companyName}`
    );
    onOpenChange(false);
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

  const getPdfViewerUrl = (url: string | null) => {
    if (!url) return '';
    return url.includes('#') ? url : `${url}#view=Fit`;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={pdfUrl && step === 1 ? "max-w-2xl" : "max-w-md"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 1 ? (
              <>
                <FileText className="h-5 w-5" />
                Generate Estimate PDF
              </>
            ) : (
              <>
                <Mail className="h-5 w-5" />
                Send Estimate
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Generate a PDF document of this estimate."
              : "Enter the recipient details to send the estimate via email."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="py-4">
            {!pdfUrl ? (
              <div className="text-center">
                <FileText className="h-16 w-16 text-slate-300 mx-auto mb-4" />
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                  Click the button below to generate a PDF of estimate {estimateNumber}
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
                      Generate PDF
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
                  className="relative border rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-900 cursor-pointer group" 
                  style={{ height: '55vh' }}
                  onClick={() => setIsPdfViewerOpen(true)}
                >
                  <iframe
                    src={getPdfViewerUrl(pdfUrl)}
                    title="Estimate PDF Preview"
                    className="w-full h-full pointer-events-none"
                    style={{ border: 0 }}
                    onError={() => setIframeError(true)}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-slate-800 rounded-full p-3 shadow-lg">
                      <Maximize2 className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                    </div>
                  </div>
                  <div className="absolute bottom-2 left-2 text-xs text-slate-500 bg-white/80 dark:bg-slate-800/80 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                    Tap to enlarge
                  </div>
                </div>
                {iframeError && (
                  <div className="text-center py-4">
                    <p className="text-sm text-slate-500 mb-2">Preview not supported on this device</p>
                    <Button variant="outline" size="sm" onClick={() => window.open(pdfUrl, "_blank")}>
                      Open PDF
                    </Button>
                  </div>
                )}
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

        <DialogFooter className="flex gap-2 sm:gap-2">
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
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

      {/* Full-screen PDF Viewer */}
      <Dialog open={isPdfViewerOpen} onOpenChange={setIsPdfViewerOpen}>
        <DialogContent className="max-w-[95vw] w-full h-[95vh] p-0 gap-0">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-white dark:bg-slate-950">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-600 dark:text-slate-400" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate max-w-[200px] sm:max-w-none">
                {pdfFileName}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(pdfUrl!, "_blank")}
                className="h-8 px-2"
                title="Open in new tab"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-8 px-2"
                title="Download"
              >
                <a href={pdfUrl!} download={pdfFileName}>
                  <Download className="h-4 w-4" />
                </a>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsPdfViewerOpen(false)}
                className="h-8 px-2"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex-1 bg-slate-100 dark:bg-slate-900" style={{ height: 'calc(95vh - 56px)' }}>
            {pdfUrl && (
              <iframe
                src={getPdfViewerUrl(pdfUrl)}
                title="Estimate PDF Full View"
                className="w-full h-full"
                style={{ border: 0 }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
