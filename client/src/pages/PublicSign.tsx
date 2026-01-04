import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { FileText, CheckCircle, AlertCircle, Building2, Loader2, Download, ExternalLink, XCircle } from "lucide-react";

interface SignatureRequestData {
  customerName: string;
  customerEmail: string;
  message: string | null;
  status: string;
  documentName: string;
  documentUrl: string;
  documentCategory: string;
  companyName: string;
  viewedAt: string | null;
  signedAt: string | null;
}

export default function PublicSign() {
  const [, params] = useRoute("/sign/:token");
  const token = params?.token || "";
  const { toast } = useToast();
  const [agreed, setAgreed] = useState(false);

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
    mutationFn: async () => {
      const res = await fetch(`/api/public/signature-requests/${token}/sign`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to sign document");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Document Signed",
        description: "Thank you! The document has been signed successfully.",
      });
      refetch();
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
  }, [data]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full" data-testid="error-card">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Document Not Found</h2>
            <p className="text-muted-foreground">
              This signing link may be invalid or expired. Please contact the company that sent this request.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isAlreadySigned = data.status === "signed";
  const isExpiredOrCanceled = ["expired", "canceled", "declined"].includes(data.status);
  const canSign = ["sent", "viewed"].includes(data.status);

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
              <span data-testid="document-name">{data.documentName}</span>
            </CardTitle>
            <CardDescription>
              Hello {data.customerName}, please review and sign this document.
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
                  <p className="font-medium">{data.documentName}</p>
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
            </div>

            {isAlreadySigned && (
              <div className="flex items-center gap-2 text-green-600 bg-green-50 dark:bg-green-900/20 rounded-lg p-4" data-testid="signed-status">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">
                  This document was signed on {new Date(data.signedAt!).toLocaleDateString()}
                </span>
              </div>
            )}

            {isExpiredOrCanceled && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-4" data-testid="expired-status">
                <XCircle className="h-5 w-5" />
                <span className="font-medium">
                  This signature request is no longer valid ({data.status}).
                </span>
              </div>
            )}

            {canSign && (
              <>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="agree"
                    checked={agreed}
                    onCheckedChange={(checked) => setAgreed(checked as boolean)}
                    data-testid="agree-checkbox"
                  />
                  <Label htmlFor="agree" className="text-sm leading-relaxed cursor-pointer">
                    I have reviewed the document and agree to sign it electronically. I understand this constitutes a legally binding signature.
                  </Label>
                </div>

                <Button
                  className="w-full"
                  size="lg"
                  disabled={!agreed || signMutation.isPending}
                  onClick={() => signMutation.mutate()}
                  data-testid="sign-button"
                >
                  {signMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Signing...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Sign Document
                    </>
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Powered by EcoLogic
        </p>
      </div>
    </div>
  );
}
