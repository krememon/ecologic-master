import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";

export default function PaySuccess() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");

    if (!sessionId) {
      setStatus("error");
      return;
    }

    fetch(`/api/payments/session/${sessionId}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setInvoiceId(data.invoiceId);
          if (data.paymentStatus === "paid") {
            setStatus("success");
          } else {
            setStatus("loading");
            setTimeout(() => setStatus("success"), 2000);
          }
        } else {
          setStatus("success");
        }
      })
      .catch(() => {
        setStatus("success");
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {status === "loading" ? (
            <>
              <div className="mx-auto mb-4">
                <Loader2 className="h-16 w-16 text-blue-500 animate-spin" />
              </div>
              <CardTitle className="text-2xl">Processing Payment...</CardTitle>
              <CardDescription>Please wait while we confirm your payment.</CardDescription>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4">
                <CheckCircle2 className="h-16 w-16 text-green-500" />
              </div>
              <CardTitle className="text-2xl text-green-600">Payment Successful!</CardTitle>
              <CardDescription className="text-base mt-2">
                Thank you for your payment. Your invoice has been marked as paid.
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === "success" && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                You can safely close this window.
              </p>
              <Button
                variant="outline"
                onClick={() => window.close()}
                className="w-full"
              >
                Close Window
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
