import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { FileText, CheckCircle, AlertCircle, Building2, Loader2, Download, ExternalLink, XCircle, Clock, Eraser } from "lucide-react";

interface SignatureRequestData {
  customerName: string;
  customerEmail: string;
  message: string | null;
  status: string;
  documentName: string;
  documentUrl: string;
  documentCategory: string;
  documentMimeType?: string;
  companyName: string;
  viewedAt: string | null;
  signedAt: string | null;
  expiresAt: string | null;
}

export default function PublicSign() {
  // Extract token directly from window.location.pathname for maximum reliability
  const token = useMemo(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/sign\/(.+)$/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
    return "";
  }, []);
  
  // Debug logging
  console.log("[PublicSign] COMPONENT MOUNTED - token:", token, "path:", window.location.pathname);
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<SignatureRequestData>({
    queryKey: ["/api/public/signature-requests", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/signature-requests/${token}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to load document");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const markViewedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/signature-requests/${token}/viewed`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to mark as viewed");
      return res.json();
    },
  });

  const signMutation = useMutation({
    mutationFn: async (signatureDataUrl: string) => {
      const res = await fetch(`/api/public/signature-requests/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          signatureDataUrl,
          signerName: signerName.trim() || undefined
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to sign document");
      }
      return res.json();
    },
    onSuccess: () => {
      setShowSuccess(true);
      toast({
        title: "Document Signed",
        description: "Thank you! Your signature has been recorded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (data && !data.viewedAt && data.status === "sent") {
      markViewedMutation.mutate();
    }
    if (data?.customerName) {
      setSignerName(data.customerName);
    }
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [data]);

  const getCanvasCoords = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    if ("touches" in e) {
      const touch = e.touches[0] || e.changedTouches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    
    setIsDrawing(true);
    const { x, y } = getCanvasCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, [getCanvasCoords]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    
    const { x, y } = getCanvasCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  }, [isDrawing, getCanvasCoords]);

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }, []);

  const handleSign = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;
    
    const signatureDataUrl = canvas.toDataURL("image/png");
    signMutation.mutate(signatureDataUrl);
  }, [hasSignature, signMutation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const errorMessage = (error as Error)?.message || "";
  const isExpired = errorMessage.includes("expired");
  const isAlreadySigned = errorMessage.includes("Already signed");

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full" data-testid="error-card">
          <CardContent className="pt-6 text-center">
            {isExpired ? (
              <>
                <Clock className="h-12 w-12 mx-auto text-orange-500 mb-4" />
                <h2 className="text-xl font-semibold mb-2">Link Expired</h2>
                <p className="text-muted-foreground">
                  This signing link has expired. Please contact the company that sent this request to get a new link.
                </p>
              </>
            ) : isAlreadySigned ? (
              <>
                <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                <h2 className="text-xl font-semibold mb-2">Already Signed</h2>
                <p className="text-muted-foreground">
                  This document has already been signed. You can close this tab.
                </p>
              </>
            ) : (
              <>
                <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
                <h2 className="text-xl font-semibold mb-2">Document Not Found</h2>
                <p className="text-muted-foreground">
                  This signing link may be invalid. Please contact the company that sent this request.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (showSuccess) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full" data-testid="success-card">
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">Thanks!</h2>
            <p className="text-lg text-muted-foreground mb-4">
              Your signature has been recorded.
            </p>
            <p className="text-sm text-muted-foreground">
              You can close this tab.
            </p>
          </CardContent>
        </Card>
        <p className="fixed bottom-4 text-center text-sm text-muted-foreground">
          Powered by EcoLogic
        </p>
      </div>
    );
  }

  const isPdf = data.documentMimeType?.includes("pdf");
  const isImage = data.documentMimeType?.startsWith("image/");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Building2 className="h-6 w-6 text-blue-600" />
          <span className="text-lg font-semibold text-gray-900 dark:text-white" data-testid="company-name">
            {data.companyName}
          </span>
        </div>

        <Card data-testid="signature-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Review & Sign
            </CardTitle>
            <CardDescription>
              Hello {data.customerName}, please review the document and sign below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {data.message && (
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
                <p className="text-sm text-muted-foreground mb-1">Message from {data.companyName}:</p>
                <p className="text-sm whitespace-pre-wrap" data-testid="message">{data.message}</p>
              </div>
            )}

            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-medium" data-testid="document-name">{data.documentName}</p>
                  <p className="text-sm text-muted-foreground capitalize">{data.documentCategory?.replace("_", " ")}</p>
                </div>
                {data.documentUrl && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" asChild data-testid="view-document-btn">
                      <a href={data.documentUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" asChild data-testid="download-document-btn">
                      <a href={data.documentUrl} download>
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </a>
                    </Button>
                  </div>
                )}
              </div>

              {isPdf && data.documentUrl && (
                <div className="mt-4 border rounded overflow-hidden" style={{ height: "400px" }}>
                  <iframe
                    src={data.documentUrl}
                    className="w-full h-full"
                    title="Document Preview"
                  />
                </div>
              )}

              {isImage && data.documentUrl && (
                <div className="mt-4">
                  <img
                    src={data.documentUrl}
                    alt="Document"
                    className="max-w-full rounded border"
                  />
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="signerName">Your Name</Label>
                <Input
                  id="signerName"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Type your name"
                  className="mt-1"
                  data-testid="signer-name-input"
                />
              </div>

              <div>
                <Label>Your Signature</Label>
                <div className="mt-1 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-2 bg-white dark:bg-gray-800">
                  <canvas
                    ref={canvasRef}
                    width={500}
                    height={200}
                    className="w-full touch-none cursor-crosshair rounded"
                    style={{ maxHeight: "200px" }}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    data-testid="signature-canvas"
                  />
                  <p className="text-xs text-center text-muted-foreground mt-1">
                    Draw your signature above
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSignature}
                  className="mt-2"
                  data-testid="clear-signature-btn"
                >
                  <Eraser className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              </div>
            </div>

            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-4">
                By clicking "Sign & Submit", I agree to sign this document electronically and understand this constitutes a legally binding signature.
              </p>
              <Button
                className="w-full"
                size="lg"
                disabled={!hasSignature || signMutation.isPending}
                onClick={handleSign}
                data-testid="sign-submit-button"
              >
                {signMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Signing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Sign & Submit
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Powered by EcoLogic
        </p>
      </div>
    </div>
  );
}
