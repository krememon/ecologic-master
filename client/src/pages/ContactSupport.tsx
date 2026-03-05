import { useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, Send, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function ContactSupport() {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const canSubmit = subject.trim().length > 0 && message.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/support", {
        type: "contact_support",
        subject: subject.trim(),
        body: message.trim(),
        metadata: {
          timestamp: new Date().toISOString(),
          platform: navigator.userAgent.includes("iPhone") ? "iOS" : navigator.userAgent.includes("Android") ? "Android" : "Web",
          route: window.location.pathname,
        },
      });
      setSent(true);
      setSubject("");
      setMessage("");
      toast({ title: "Message sent", description: "We'll get back to you soon." });
    } catch {
      toast({ title: "Failed to send", description: "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="mb-6">
          <Link href="/settings/support">
            <button className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-3">
              <ChevronLeft className="h-4 w-4" />
              Support
            </button>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Contact Support</h1>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 text-center">
          <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Sent</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">We'll review your message and get back to you.</p>
          <Button variant="outline" size="sm" onClick={() => setSent(false)}>Send another</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl pb-24">
      <div className="mb-6">
        <Link href="/settings/support">
          <button className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-3">
            <ChevronLeft className="h-4 w-4" />
            Support
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Contact Support</h1>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Subject</Label>
          <Input
            placeholder="What do you need help with?"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Message</Label>
          <Textarea
            placeholder="Describe your question or issue..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            maxLength={5000}
          />
        </div>
        <Button
          className="w-full"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? "Sending..." : <><Send className="h-4 w-4 mr-2" />Send Message</>}
        </Button>
      </div>
    </div>
  );
}
