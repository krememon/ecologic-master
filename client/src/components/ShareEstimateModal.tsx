import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileText, Mail, Check, Loader2, Download, ArrowRight, ArrowLeft } from "lucide-react";
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
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
          <div className="py-6">
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
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <p className="font-medium text-slate-900 dark:text-slate-100 mb-2">
                  PDF Ready
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                  {pdfFileName}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(pdfUrl, "_blank")}
                  className="mb-4"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Preview PDF
                </Button>
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
    </Dialog>
  );
}
