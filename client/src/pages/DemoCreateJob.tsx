import { useState, useEffect, useCallback } from "react";
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
import { TimeWheelPicker } from "@/components/TimeWheelPicker";
import {
  Briefcase,
  MapPin,
  Calendar,
  Clock,
  FileText,
  User,
  Trash2,
  CheckCircle2,
  Sparkles,
  X,
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
  startTime: string;
  endTime: string;
  notes: string;
  createdAt: string;
}

const JOB_TYPES = ["Service Call", "Install", "Maintenance", "Emergency"];

function saveDemoJobs(jobs: DemoJob[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

function formatTime(value: string): string {
  if (!value) return "";
  const [h, m] = value.split(":");
  let hourNum = parseInt(h, 10);
  const period = hourNum >= 12 ? "PM" : "AM";
  if (hourNum === 0) hourNum = 12;
  else if (hourNum > 12) hourNum -= 12;
  return `${hourNum}:${m.padStart(2, "0")} ${period}`;
}

export default function DemoCreateJob() {
  const [, setLocation] = useLocation();
  const [jobs, setJobs] = useState<DemoJob[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);

  const [clientName, setClientName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobType, setJobType] = useState("");
  const [address, setAddress] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");

  const [errors, setErrors] = useState<{ clientName?: string; jobTitle?: string; time?: string }>({});

  const escapeDemo = useCallback(() => {
    sessionStorage.removeItem(DEMO_MODE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    setLocation("/login");
  }, [setLocation]);

  useEffect(() => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.setItem(DEMO_MODE_KEY, "1");

    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("demo") === "0" || searchParams.get("demo") === "off") {
      escapeDemo();
      return;
    }

    const handleBeforeUnload = () => {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(DEMO_MODE_KEY);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === "Escape") {
        escapeDemo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("keydown", handleKeyDown);
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(DEMO_MODE_KEY);
    };
  }, [escapeDemo]);

  const handleSave = () => {
    const newErrors: { clientName?: string; jobTitle?: string; time?: string } = {};
    if (!clientName.trim()) newErrors.clientName = "Client name is required";
    if (!jobTitle.trim()) newErrors.jobTitle = "Job title is required";
    if (startTime && endTime && startTime >= endTime) {
      newErrors.time = "End time must be after start time";
    }
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
      startTime,
      endTime,
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
    setStartTime("");
    setEndTime("");
    setNotes("");

    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const handleClear = () => {
    setJobs([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <div className="fixed top-4 left-4 z-50">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border border-amber-200 dark:border-amber-700 shadow-sm">
          <Sparkles className="w-3.5 h-3.5" />
          Demo Mode
        </span>
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
          {showSuccess && (
            <div className="mb-5 flex items-center justify-between p-3 rounded-xl bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 text-sm animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <div>
                  <span className="font-medium">Job created ✅ (Demo)</span>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">Saved locally for demo purposes.</p>
                </div>
              </div>
              <button
                onClick={() => setShowSuccess(false)}
                className="p-1 rounded-md hover:bg-green-100 dark:hover:bg-green-800/50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="clientName" className="text-sm font-medium flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  Client Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="clientName"
                  placeholder="Client Name"
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
                  placeholder="Job Title"
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
                    <SelectValue placeholder="Job Type" />
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
                  placeholder="Address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            </div>

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Start Time
                </Label>
                <TimeWheelPicker
                  value={startTime}
                  onChange={(val) => { setStartTime(val); setErrors((p) => ({ ...p, time: undefined })); }}
                  label="Start Time"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  End Time
                </Label>
                <TimeWheelPicker
                  value={endTime}
                  onChange={(val) => { setEndTime(val); setErrors((p) => ({ ...p, time: undefined })); }}
                  label="End Time"
                />
              </div>
              {errors.time && (
                <p className="text-xs text-red-500 sm:col-span-2 -mt-2">{errors.time}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-sm font-medium flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                Notes
              </Label>
              <Textarea
                id="notes"
                placeholder="Notes"
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
        </div>

        {showSuccess && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-5 mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-3">Next steps in the full app:</h3>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 flex-shrink-0" />
                Assign crew members to the job
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 flex-shrink-0" />
                Create and send invoices to your client
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 flex-shrink-0" />
                Track time and schedule with AI-powered tools
              </li>
            </ul>
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
                {(job.date || job.startTime || job.endTime) && (
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    {job.date && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(job.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                    {(job.startTime || job.endTime) && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {job.startTime && job.endTime
                          ? `${formatTime(job.startTime)} – ${formatTime(job.endTime)}`
                          : job.startTime
                            ? formatTime(job.startTime)
                            : formatTime(job.endTime)}
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
