import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CheckCircle, XCircle, ArrowLeft } from "lucide-react";
import ecologicWordmark from "@/assets/branding/ecologic-wordmark.png";

type State = "loading" | "confirm" | "success" | "resubscribed" | "cancelled" | "error";

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

  const handleCancel = () => setState("cancelled");

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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-sm mx-auto">

        {/* Branding — outside the card */}
        <div className="text-center mb-4">
          <img
            src={ecologicWordmark}
            alt="EcoLogic"
            className="w-full max-w-[280px] h-auto mx-auto"
          />
        </div>

        {/* Action card */}
        <Card>
          <CardContent className="p-6 text-center">
            {state === "loading" && (
              <>
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-teal-600 mb-3" />
                <p className="text-slate-600">Validating link...</p>
              </>
            )}

            {state === "confirm" && (
              <>
                <h2 className="text-xl font-semibold text-slate-800 mb-2">Unsubscribe</h2>
                <p className="text-slate-600 mb-5">
                  Are you sure you want to unsubscribe from EcoLogic marketing{" "}
                  {channel === "sms" ? "text messages" : "emails"}?
                </p>
                <div className="flex flex-col gap-3">
                  <Button onClick={handleUnsubscribe} disabled={isSubmitting} className="w-full">
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Unsubscribing...
                      </>
                    ) : (
                      "Yes, unsubscribe me"
                    )}
                  </Button>
                  <Button variant="outline" onClick={handleCancel} disabled={isSubmitting} className="w-full">
                    No, keep me subscribed
                  </Button>
                </div>
              </>
            )}

            {state === "success" && (
              <>
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h2 className="text-xl font-semibold text-slate-800 mb-2">Unsubscribed</h2>
                <p className="text-slate-600 mb-5">
                  You have been unsubscribed from marketing{" "}
                  {channel === "sms" ? "text messages" : "emails"}.
                </p>
                <Button variant="outline" onClick={handleResubscribe} disabled={isSubmitting} className="w-full">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Resubscribing...
                    </>
                  ) : (
                    "Changed your mind? Resubscribe"
                  )}
                </Button>
              </>
            )}

            {state === "resubscribed" && (
              <>
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h2 className="text-xl font-semibold text-slate-800 mb-2">Resubscribed</h2>
                <p className="text-slate-600">
                  You have been resubscribed to marketing{" "}
                  {channel === "sms" ? "text messages" : "emails"}.
                </p>
              </>
            )}

            {state === "cancelled" && (
              <>
                <ArrowLeft className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                <h2 className="text-xl font-semibold text-slate-800 mb-2">You're Still Subscribed</h2>
                <p className="text-slate-600">
                  No changes were made. You'll continue receiving marketing{" "}
                  {channel === "sms" ? "text messages" : "emails"}.
                </p>
              </>
            )}

            {state === "error" && (
              <>
                <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
                <h2 className="text-xl font-semibold text-slate-800 mb-2">Error</h2>
                <p className="text-slate-600">{errorMessage}</p>
              </>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
