import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CheckCircle, XCircle, Mail, ArrowLeft } from "lucide-react";

type State = "loading" | "confirm" | "success" | "cancelled" | "error";

export default function PublicUnsubscribe() {
  const [location] = useLocation();
  const [state, setState] = useState<State>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const channel = location.includes("/sms") ? "sms" : "email";

  useEffect(() => {
    if (!token) {
      setErrorMessage("Invalid unsubscribe link");
      setState("error");
      return;
    }
    
    async function validateToken() {
      try {
        const res = await fetch(`/api/public/unsubscribe/${channel}/status?token=${encodeURIComponent(token!)}`);
        const data = await res.json();
        
        if (!res.ok || !data.valid) {
          setErrorMessage(data.message || "This link is invalid or has expired");
          setState("error");
        } else {
          setState("confirm");
        }
      } catch {
        setErrorMessage("Could not validate link");
        setState("error");
      }
    }
    
    validateToken();
  }, [token, channel]);

  const handleUnsubscribe = async () => {
    if (!token) return;
    
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/public/unsubscribe/${channel}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      
      const data = await res.json();
      
      if (res.ok && data.ok) {
        setState("success");
      } else {
        setErrorMessage(data.message || "Failed to unsubscribe");
        setState("error");
      }
    } catch {
      setErrorMessage("Something went wrong");
      setState("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setState("cancelled");
  };

  const channelLabel = channel === "sms" ? "text messages" : "promotional emails";

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 px-6">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-teal-100 mb-4">
              <Mail className="w-8 h-8 text-teal-600" />
            </div>
            <h1 className="text-2xl font-bold tracking-widest text-slate-800 uppercase">
              ECOLOGIC
            </h1>
          </div>

          {state === "loading" && (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-teal-600 mb-4" />
              <p className="text-slate-600">Validating link...</p>
            </div>
          )}

          {state === "confirm" && (
            <div className="text-center">
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Unsubscribe</h2>
              <p className="text-slate-600 mb-6">
                Are you sure you want to unsubscribe from {channelLabel}?
              </p>
              <div className="flex flex-col gap-3">
                <Button
                  onClick={handleUnsubscribe}
                  disabled={isSubmitting}
                  className="w-full"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Unsubscribing...
                    </>
                  ) : (
                    "Yes, unsubscribe"
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isSubmitting}
                  className="w-full"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {state === "success" && (
            <div className="text-center py-4">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Successfully Unsubscribed</h2>
              <p className="text-slate-600">
                You will no longer receive {channelLabel} from this company.
              </p>
            </div>
          )}

          {state === "cancelled" && (
            <div className="text-center py-4">
              <ArrowLeft className="w-16 h-16 text-slate-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-800 mb-2">You're Still Subscribed</h2>
              <p className="text-slate-600">
                No changes were made. You'll continue receiving {channelLabel}.
              </p>
            </div>
          )}

          {state === "error" && (
            <div className="text-center py-4">
              <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Error</h2>
              <p className="text-slate-600">{errorMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
