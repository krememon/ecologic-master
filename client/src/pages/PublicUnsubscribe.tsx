import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CheckCircle, XCircle, ArrowLeft } from "lucide-react";
import ecologicWordmark from "@/assets/branding/ecologic-wordmark.png";
import logoImage from "@assets/IMG_6171 2_1749763982284.jpg";

type State = "loading" | "confirm" | "success" | "resubscribed" | "cancelled" | "error";

function BrandingHeader() {
  return (
    <div className="text-center mb-6">
      <div className="w-20 h-20 mx-auto mb-3 rounded-2xl overflow-hidden shadow-lg">
        <img src={logoImage} alt="EcoLogic Logo" className="w-full h-full object-cover" />
      </div>
      <img
        src={ecologicWordmark}
        alt="EcoLogic"
        className="h-7 mx-auto mb-1"
      />
      <p className="text-slate-500 text-sm">Professional contractor management</p>
    </div>
  );
}

export default function PublicUnsubscribe() {
  const [state, setState] = useState<State>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const path = window.location.pathname;
  const channel = path.includes("/sms") ? "sms" : "email";

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

  const handleResubscribe = async () => {
    if (!token) return;
    
    setIsSubmitting(true);
    try {
      const optInField = channel === "sms" ? "smsOptIn" : "emailOptIn";
      const res = await fetch("/api/public/email-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, [optInField]: true }),
      });
      
      const data = await res.json();
      
      if (res.ok && data.ok) {
        setState("resubscribed");
      } else {
        setErrorMessage(data.message || "Failed to resubscribe");
        setState("error");
      }
    } catch {
      setErrorMessage("Something went wrong");
      setState("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 sm:p-8">
          {state === "loading" && (
            <div className="text-center">
              <BrandingHeader />
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-teal-600 mb-3" />
              <p className="text-slate-600">Validating link...</p>
            </div>
          )}

          {state === "confirm" && (
            <div className="text-center">
              <BrandingHeader />
              <h2 className="text-xl font-semibold text-slate-800 mb-2.5">Unsubscribe</h2>
              <p className="text-slate-600 mb-4">
                Are you sure you want to unsubscribe from EcoLogic marketing {channel === "sms" ? "text messages" : "emails"}?
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
                    "Yes, unsubscribe me"
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isSubmitting}
                  className="w-full"
                >
                  No, keep me subscribed
                </Button>
              </div>
            </div>
          )}

          {state === "success" && (
            <div className="text-center">
              <BrandingHeader />
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <h2 className="text-xl font-semibold text-slate-800 mb-2.5">Unsubscribed</h2>
              <p className="text-slate-600 mb-4">
                You have been unsubscribed from marketing {channel === "sms" ? "text messages" : "emails"}.
              </p>
              <Button
                variant="outline"
                onClick={handleResubscribe}
                disabled={isSubmitting}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Resubscribing...
                  </>
                ) : (
                  "Changed your mind? Resubscribe"
                )}
              </Button>
            </div>
          )}

          {state === "resubscribed" && (
            <div className="text-center">
              <BrandingHeader />
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <h2 className="text-xl font-semibold text-slate-800 mb-2.5">Resubscribed</h2>
              <p className="text-slate-600">
                You have been resubscribed to marketing {channel === "sms" ? "text messages" : "emails"}.
              </p>
            </div>
          )}

          {state === "cancelled" && (
            <div className="text-center">
              <BrandingHeader />
              <ArrowLeft className="w-12 h-12 text-slate-400 mx-auto mb-3" />
              <h2 className="text-xl font-semibold text-slate-800 mb-2.5">You're Still Subscribed</h2>
              <p className="text-slate-600">
                No changes were made. You'll continue receiving marketing {channel === "sms" ? "text messages" : "emails"}.
              </p>
            </div>
          )}

          {state === "error" && (
            <div className="text-center">
              <BrandingHeader />
              <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
              <h2 className="text-xl font-semibold text-slate-800 mb-2.5">Error</h2>
              <p className="text-slate-600">{errorMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
