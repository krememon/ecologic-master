import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, CheckCircle2, AlertCircle, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CampaignInfo {
  ok: boolean;
  campaignSubject?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface Props {
  token: string;
}

export default function CampaignResponsePage({ token }: Props) {
  const [, navigate] = useLocation();
  const [info, setInfo] = useState<CampaignInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [interestMessage, setInterestMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }

    fetch(`/api/public/campaign-response/${token}`)
      .then(r => r.json())
      .then((data: CampaignInfo) => {
        if (!data.ok) {
          setInvalid(true);
        } else {
          setInfo(data);
          const fullName = [data.firstName, data.lastName].filter(Boolean).join(" ");
          if (fullName) setName(fullName);
          if (data.email) setEmail(data.email);
          if (data.phone) setPhone(data.phone);
        }
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interestMessage.trim()) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/public/campaign-response/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, interestMessage }),
      });
      const data = await res.json();

      if (data.ok) {
        setSubmitted(true);
      } else {
        setSubmitError(data.message || "Something went wrong. Please try again.");
      }
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="h-12 w-12 text-slate-400 mb-4" />
        <h1 className="text-xl font-semibold text-slate-800 mb-2">Link not found</h1>
        <p className="text-slate-500 max-w-sm">
          This link is invalid or has already expired. Please contact us directly if you need assistance.
        </p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <CheckCircle2 className="h-14 w-14 text-green-500 mb-5" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Thanks — your request was sent.</h1>
        <p className="text-slate-500 max-w-sm">We'll follow up with you soon.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-blue-600" />
          <span className="font-bold tracking-widest text-slate-900 text-sm uppercase">EcoLogic</span>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center pt-10 pb-16 px-4">
        <div className="w-full max-w-lg">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Tell us what you're interested in</h1>
            <p className="text-slate-500">
              {info?.campaignSubject
                ? `Re: ${info.campaignSubject} — let us know what service you need and we'll follow up.`
                : "Let us know what service you need and we'll follow up."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
            <div>
              <Label htmlFor="interestMessage" className="text-sm font-medium text-slate-700">
                What are you interested in? <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="interestMessage"
                value={interestMessage}
                onChange={e => setInterestMessage(e.target.value)}
                placeholder="e.g. Need a quote for a tankless water heater installation…"
                className="mt-1.5 min-h-[120px] resize-none text-base"
                required
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="name" className="text-sm font-medium text-slate-700">Your name</Label>
              <Input
                id="name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Jane Smith"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="email" className="text-sm font-medium text-slate-700">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="jane@example.com"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="phone" className="text-sm font-medium text-slate-700">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(555) 000-0000"
                className="mt-1.5"
              />
            </div>

            {submitError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                {submitError}
              </p>
            )}

            <Button
              type="submit"
              disabled={submitting || !interestMessage.trim()}
              className="w-full h-12 text-base font-semibold"
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
              ) : (
                "Send My Interest"
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
