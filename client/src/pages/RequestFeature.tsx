import { useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, Lightbulb, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { getPlatform } from "@/lib/capacitor";

export default function RequestFeature() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [whyUseful, setWhyUseful] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/support", {
        type: "feature_request",
        subject: title.trim(),
        body: description.trim(),
        whyUseful: whyUseful.trim() || null,
        metadata: {
          userId: user?.id,
          email: user?.email,
          appVersion: "1.0.0",
          platform: getPlatform(),
          timestamp: new Date().toISOString(),
        },
      });
      setSent(true);
      setTitle("");
      setDescription("");
      setWhyUseful("");
      toast({ title: "Feature request sent", description: "Thanks for the suggestion!" });
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Request a Feature</h1>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 text-center">
          <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Request Submitted</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">We'll review your idea.</p>
          <Button variant="outline" size="sm" onClick={() => setSent(false)}>Suggest another</Button>
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
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Request a Feature</h1>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Feature title</Label>
          <Input
            placeholder="Give it a short name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Description</Label>
          <Textarea
            placeholder="What would this feature do?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={5000}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Why is this useful? <span className="text-slate-400 font-normal">(optional)</span></Label>
          <Textarea
            placeholder="How would this help your workflow?"
            value={whyUseful}
            onChange={(e) => setWhyUseful(e.target.value)}
            rows={3}
            maxLength={3000}
          />
        </div>
        <Button
          className="w-full"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? "Sending..." : <><Lightbulb className="h-4 w-4 mr-2" />Submit Request</>}
        </Button>
      </div>
    </div>
  );
}
