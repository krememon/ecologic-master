import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Briefcase,
  MapPin,
  Calendar,
  Clock,
  FileText,
  User,
  Trash2,
  LogOut,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

const STORAGE_KEY = "ecologic_demo_jobs";
const DEMO_MODE_KEY = "ecologic_demo_mode";

interface DemoJob {
  id: string;
  clientName: string;
  jobTitle: string;
  jobType: string;
  address: string;
  date: string;
  timeWindow: string;
  notes: string;
  createdAt: string;
}

const JOB_TYPES = ["Service Call", "Install", "Maintenance", "Emergency"];
const TIME_WINDOWS = ["8–10 AM", "10–12 PM", "12–2 PM", "2–4 PM", "4–6 PM"];

function loadDemoJobs(): DemoJob[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveDemoJobs(jobs: DemoJob[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

export default function DemoCreateJob() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [jobs, setJobs] = useState<DemoJob[]>(loadDemoJobs);
  const [showSuccess, setShowSuccess] = useState(false);

  const [clientName, setClientName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobType, setJobType] = useState("");
  const [address, setAddress] = useState("");
  const [date, setDate] = useState("");
  const [timeWindow, setTimeWindow] = useState("");
  const [notes, setNotes] = useState("");

  const [errors, setErrors] = useState<{ clientName?: string; jobTitle?: string }>({});

  useEffect(() => {
    localStorage.setItem(DEMO_MODE_KEY, "1");
  }, []);

  const handleSave = () => {
    const newErrors: { clientName?: string; jobTitle?: string } = {};
    if (!clientName.trim()) newErrors.clientName = "Client name is required";
    if (!jobTitle.trim()) newErrors.jobTitle = "Job title is required";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    const newJob: DemoJob = {
      id: `demo-${Date.now()}`,
      clientName: clientName.trim(),
      jobTitle: jobTitle.trim(),
      jobType: jobType || "Service Call",
      address: address.trim(),
      date: date || new Date().toISOString().split("T")[0],
      timeWindow: timeWindow || "8–10 AM",
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
    };

    const updated = [newJob, ...jobs];
    setJobs(updated);
    saveDemoJobs(updated);

    setClientName("");
    setJobTitle("");
    setJobType("");
    setAddress("");
    setDate("");
    setTimeWindow("");
    setNotes("");

    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);

    toast({
      title: "Job created ✅ (Demo)",
      description: `"${newJob.jobTitle}" for ${newJob.clientName} saved locally.`,
    });
  };

  const handleClear = () => {
    setJobs([]);
    localStorage.removeItem(STORAGE_KEY);
    toast({ title: "Demo data cleared", description: "All demo jobs removed." });
  };

  const handleExitDemo = () => {
    localStorage.removeItem(DEMO_MODE_KEY);
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <div className="fixed top-4 left-4 z-50">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border border-amber-200 dark:border-amber-700 shadow-sm">
          <Sparkles className="w-3.5 h-3.5" />
          Demo Mode
        </span>
      </div>

      <div className="fixed top-4 right-4 z-50">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExitDemo}
          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 gap-1.5"
        >
          <LogOut className="w-4 h-4" />
          Exit Demo
        </Button>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
        <div className="text-center mb-8">
          <h1
            className="text-4xl sm:text-5xl mx-auto mb-1"
            style={{
              fontFamily: "'Plus Jakarta Sans', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
              color: "#0B0B0D",
            }}
          >
            <span className="dark:text-white">EcoLogic</span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-light mb-4">
            Professional contractor management
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800">
            <Briefcase className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-blue-700 dark:text-blue-300 text-sm font-medium">
              Interactive Demo — Create a Job
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-6 sm:p-8 mb-6">
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="clientName" className="text-sm font-medium flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  Client Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="clientName"
                  placeholder="e.g. John Smith"
                  value={clientName}
                  onChange={(e) => { setClientName(e.target.value); setErrors((p) => ({ ...p, clientName: undefined })); }}
                  className={errors.clientName ? "border-red-400 focus:ring-red-400" : ""}
                />
                {errors.clientName && <p className="text-xs text-red-500">{errors.clientName}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="jobTitle" className="text-sm font-medium flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                  Job Title <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="jobTitle"
                  placeholder="e.g. Kitchen Plumbing Repair"
                  value={jobTitle}
                  onChange={(e) => { setJobTitle(e.target.value); setErrors((p) => ({ ...p, jobTitle: undefined })); }}
                  className={errors.jobTitle ? "border-red-400 focus:ring-red-400" : ""}
                />
                {errors.jobTitle && <p className="text-xs text-red-500">{errors.jobTitle}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  Job Type
                </Label>
                <Select value={jobType} onValueChange={setJobType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="address" className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  Address
                </Label>
                <Input
                  id="address"
                  placeholder="123 Main St, City"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="date" className="text-sm font-medium flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  Date
                </Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Time Window
                </Label>
                <Select value={timeWindow} onValueChange={setTimeWindow}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select window" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_WINDOWS.map((w) => (
                      <SelectItem key={w} value={w}>{w}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-sm font-medium flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                Notes
              </Label>
              <Textarea
                id="notes"
                placeholder="Any special instructions or details..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>

            <Button
              onClick={handleSave}
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-base"
            >
              Save Job
            </Button>
          </div>

          {showSuccess && (
            <div className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 text-sm animate-in fade-in slide-in-from-top-1 duration-200">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <span>Job created successfully! (Demo — saved locally only)</span>
            </div>
          )}
        </div>

        {showSuccess && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-5 mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">Next steps in the full app:</h3>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                Assign crew members to the job
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                Create and send invoices to your client
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                Track time and schedule with AI-powered tools
              </li>
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 rounded-lg"
              onClick={() => { localStorage.removeItem(DEMO_MODE_KEY); setLocation("/signup"); }}
            >
              Sign up for free trial
            </Button>
          </div>
        )}

        {jobs.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800 dark:text-white">
                Demo Jobs ({jobs.length})
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear demo data
              </Button>
            </div>

            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium text-slate-800 dark:text-white truncate">
                      {job.jobTitle}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {job.clientName}
                    </p>
                  </div>
                  <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    {job.jobType}
                  </span>
                </div>
                {(job.date || job.timeWindow) && (
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    {job.date && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(job.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                    {job.timeWindow && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {job.timeWindow}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
