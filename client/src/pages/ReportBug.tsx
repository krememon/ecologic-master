import { useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, Bug, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { getPlatform } from "@/lib/capacitor";

function getDeviceSummary(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) {
    const m = ua.match(/iPhone OS (\d+[_\.]\d+)/);
    return m ? `iPhone (iOS ${m[1].replace("_", ".")})` : "iPhone";
  }
  if (/Android/.test(ua)) {
    const m = ua.match(/Android (\d+[\.\d]*)/);
    return m ? `Android (${m[1]})` : "Android";
  }
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Web Browser";
}

export default function ReportBug() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [urgency, setUrgency] = useState("Medium");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const canSubmit = description.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/support", {
        type: "bug_report",
        subject: description.trim().slice(0, 100),
        body: description.trim(),
        urgency,
        stepsToReproduce: steps.trim() || null,
        metadata: {
          userId: user?.id,
          email: user?.email,
          appVersion: "1.0.0",
          platform: getPlatform(),
          device: getDeviceSummary(),
          route: window.location.pathname,
          timestamp: new Date().toISOString(),
          screenWidth: window.innerWidth,
          screenHeight: window.innerHeight,
        },
      });
      setSent(true);
      setDescription("");
      setSteps("");
      setUrgency("Medium");
      toast({ title: "Bug report sent", description: "Thanks for letting us know." });
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Report a Bug</h1>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 text-center">
          <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Report Submitted</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">We'll investigate this issue.</p>
          <Button variant="outline" size="sm" onClick={() => setSent(false)}>Report another</Button>
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
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Report a Bug</h1>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">What happened?</Label>
          <Textarea
            placeholder="Describe the issue you encountered..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={5000}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Steps to reproduce <span className="text-slate-400 font-normal">(optional)</span></Label>
          <Textarea
            placeholder="1. Go to...&#10;2. Tap on...&#10;3. See error..."
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            rows={3}
            maxLength={3000}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">How urgent is this?</Label>
          <Select value={urgency} onValueChange={setUrgency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Low">Low</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="High">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Auto-captured context</p>
          <div className="text-xs text-slate-400 dark:text-slate-500 space-y-0.5">
            <p>Device: {getDeviceSummary()}</p>
            <p>Platform: {getPlatform()}</p>
            <p>Version: 1.0.0</p>
          </div>
        </div>
        <Button
          className="w-full"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? "Sending..." : <><Bug className="h-4 w-4 mr-2" />Submit Bug Report</>}
        </Button>
      </div>
    </div>
  );
}
