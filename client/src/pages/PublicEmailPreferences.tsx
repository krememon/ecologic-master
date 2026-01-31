import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, CheckCircle, XCircle, Mail, Settings } from "lucide-react";

type State = "loading" | "loaded" | "saving" | "success" | "error";

export default function PublicEmailPreferences() {
  const [state, setState] = useState<State>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [emailOptIn, setEmailOptIn] = useState(true);
  const [smsOptIn, setSmsOptIn] = useState(true);
  
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  useEffect(() => {
    if (!token) {
      setErrorMessage("Invalid preferences link");
      setState("error");
      return;
    }
    
    async function loadPreferences() {
      try {
        const res = await fetch(`/api/public/email-preferences?token=${encodeURIComponent(token!)}`);
        const data = await res.json();
        
        if (!res.ok || !data.ok) {
          setErrorMessage(data.message || "This link is invalid or has expired");
          setState("error");
        } else {
          setEmailOptIn(data.emailOptIn ?? true);
          setSmsOptIn(data.smsOptIn ?? true);
          setState("loaded");
        }
      } catch {
        setErrorMessage("Could not load preferences");
        setState("error");
      }
    }
    
    loadPreferences();
  }, [token]);

  const handleSave = async () => {
    if (!token) return;
    
    setState("saving");
    try {
      const res = await fetch("/api/public/email-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, emailOptIn, smsOptIn }),
      });
      
      const data = await res.json();
      
      if (res.ok && data.ok) {
        setState("success");
      } else {
        setErrorMessage(data.message || "Failed to save preferences");
        setState("error");
      }
    } catch {
      setErrorMessage("Something went wrong");
      setState("error");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 px-6">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-teal-100 mb-4">
              <Settings className="w-8 h-8 text-teal-600" />
            </div>
            <h1 className="text-2xl font-bold tracking-widest text-slate-800 uppercase">
              ECOLOGIC
            </h1>
          </div>

          {state === "loading" && (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-teal-600 mb-4" />
              <p className="text-slate-600">Loading preferences...</p>
            </div>
          )}

          {state === "loaded" && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-slate-800 text-center mb-4">
                Communication Preferences
              </h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Mail className="w-5 h-5 text-slate-600" />
                    <span className="font-medium text-slate-800">Marketing Emails</span>
                  </div>
                  <Switch
                    checked={emailOptIn}
                    onCheckedChange={setEmailOptIn}
                  />
                </div>
                
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Settings className="w-5 h-5 text-slate-600" />
                    <span className="font-medium text-slate-800">Marketing Texts</span>
                  </div>
                  <Switch
                    checked={smsOptIn}
                    onCheckedChange={setSmsOptIn}
                  />
                </div>
              </div>

              <Button onClick={handleSave} className="w-full">
                Save Preferences
              </Button>
            </div>
          )}

          {state === "saving" && (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-teal-600 mb-4" />
              <p className="text-slate-600">Saving...</p>
            </div>
          )}

          {state === "success" && (
            <div className="text-center py-4">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Preferences Saved</h2>
              <p className="text-slate-600">
                Your communication preferences have been updated.
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
