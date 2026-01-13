import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { FileText, Loader2, Download, ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface JobInvoiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: number;
  jobTitle: string;
}

export function JobInvoiceModal({
  open,
  onOpenChange,
  jobId,
  jobTitle,
}: JobInvoiceModalProps) {
  const { toast } = useToast();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      setPreviewLoading(true);
      setPreviewError(false);
      setErrorMessage(null);
      toast({
        title: "Invoice Generated",
        description: `${data.fileName} is ready.`,
      });
    },
    onError: (error: any) => {
      const message = error.message || "Failed to generate invoice";
      setErrorMessage(message);
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setPreviewLoading(false);
    setPreviewError(false);
    setErrorMessage(null);
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={pdfUrl ? "max-w-2xl" : "max-w-md"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Generate Invoice PDF
          </DialogTitle>
          <DialogDescription>
            Generate a PDF invoice for "{jobTitle}"
          </DialogDescription>
        </DialogHeader>

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
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
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

              {previewImageUrl && (
                <div className="relative border rounded-lg overflow-hidden bg-white">
                  {previewLoading && !previewError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
                      <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                    </div>
                  )}
                  {previewError ? (
                    <div className="h-64 flex items-center justify-center bg-slate-100">
                      <p className="text-sm text-slate-500">Preview not available</p>
                    </div>
                  ) : (
                    <img
                      src={previewImageUrl}
                      alt="Invoice preview"
                      className="w-full h-auto"
                      onLoad={() => setPreviewLoading(false)}
                      onError={() => {
                        setPreviewLoading(false);
                        setPreviewError(true);
                      }}
                      style={{ display: previewLoading ? 'none' : 'block' }}
                    />
                  )}
                </div>
              )}

              {!previewImageUrl && (
                <div className="h-64 flex items-center justify-center border rounded-lg bg-slate-50 dark:bg-slate-900">
                  <div className="text-center">
                    <FileText className="h-12 w-12 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">PDF generated successfully</p>
                    <p className="text-xs text-slate-400 mt-1">Click the buttons above to view or download</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
