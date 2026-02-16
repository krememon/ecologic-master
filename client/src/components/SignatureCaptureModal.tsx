import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import SignatureCanvas from "react-signature-canvas";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SignatureCaptureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: number;
  jobId?: number;
  invoiceId?: number;
  onComplete?: () => void;
  required?: boolean;
}

export function SignatureCaptureModal({
  open,
  onOpenChange,
  paymentId,
  jobId,
  invoiceId,
  onComplete,
  required = false,
}: SignatureCaptureModalProps) {
  const { toast } = useToast();
  const sigRef = useRef<SignatureCanvas>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!sigRef.current || sigRef.current.isEmpty()) {
        throw new Error("Please draw your signature");
      }
      const signaturePngBase64 = sigRef.current.toDataURL("image/png");
      await apiRequest("POST", `/api/payments/${paymentId}/signature`, {
        signaturePngBase64,
        jobId,
        invoiceId,
      });
    },
    onSuccess: () => {
      resetState();
      onOpenChange(false);
      if (jobId) {
        queryClient.invalidateQueries({ queryKey: ['/api/jobs', String(jobId), 'payment-signatures'] });
      }
      queryClient.invalidateQueries({ predicate: (q) =>
        Array.isArray(q.queryKey) && typeof q.queryKey[0] === 'string' && q.queryKey[0].includes('payment-signatures')
      });
      onComplete?.();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetState = useCallback(() => {
    setHasDrawn(false);
    sigRef.current?.clear();
  }, []);

  const handleClear = () => {
    sigRef.current?.clear();
    setHasDrawn(false);
  };

  const canSave = hasDrawn && !saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !required) { resetState(); onOpenChange(false); } }}>
      <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" hideCloseButton onPointerDownOutside={required ? (e) => e.preventDefault() : undefined} onEscapeKeyDown={required ? (e) => e.preventDefault() : undefined}>
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="min-w-[44px]" />
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Confirm &amp; Sign
          </DialogTitle>
          {!required ? (
            <button
              onClick={() => { resetState(); onOpenChange(false); }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          ) : (
            <div className="min-w-[44px]" />
          )}
        </div>

        <div className="bg-white dark:bg-slate-900">
          <div className="px-4 pt-4 pb-2">
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
              Please sign below to confirm payment.
            </p>
          </div>

          <div className="px-4 py-3">
            <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-800" style={{ touchAction: 'none' }}>
              <SignatureCanvas
                ref={sigRef}
                canvasProps={{
                  className: "w-full",
                  style: { width: "100%", height: "180px" },
                }}
                penColor="#1e293b"
                backgroundColor="transparent"
                onBegin={() => setHasDrawn(true)}
              />
            </div>
            <div className="flex justify-end mt-1.5">
              <button
                onClick={handleClear}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-medium"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave}
              className="w-full h-11 rounded-xl font-medium"
            >
              {saveMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving...</>
              ) : (
                "Save Signature"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
