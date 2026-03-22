import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Clock, ChevronLeft, ChevronRight, Loader2, AlertCircle, MoreHorizontal, Pencil, ChevronDown, ChevronUp, Filter } from "lucide-react";
import { format, startOfWeek, addWeeks, addDays, isToday, parseISO, isFuture } from "date-fns";
import { useCan } from "@/hooks/useCan";
import { TimeWheelPicker } from "@/components/TimeWheelPicker";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimeEntry {
  id: number;
  userId: string;
  jobId: number | null;
  estimateId?: number | null;
  category: string;
  clockInAt: string;
  clockOutAt: string;
  date: string;
  autoClosed?: boolean | null;
  autoClosedReason?: string | null;
  editedAt?: string | null;
  editedByUserId?: string | null;
  editReason?: string | null;
  job?: { id: number; title: string | null } | null;
  estimate?: { id: number; estimateNumber: string; title: string; customerName: string | null } | null;
  user?: { id: string; firstName: string | null; lastName: string | null };
}

interface TimeEntriesResponse {
  role: "technician" | "manager";
  entries: TimeEntry[];
}

interface OrgUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string;
  status: string;
}

interface EmployeeDaySummary {
  userId: string;
  name: string;
  initials: string;
  profileImageUrl: string | null;
  entries: TimeEntry[];
  totalMinutes: number;
  isActive: boolean;
}

// ─── Utility Functions ────────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  return format(parseISO(dateStr), "h:mm a");
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function calculateMinutes(start: string, end: string): number {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return Math.max(0, Math.round((endTime - startTime) / 60000));
}

function getJobOrCategory(entry: TimeEntry): { title: string; subtitle?: string } {
  if (entry.job?.title) return { title: entry.job.title };
  if (entry.estimate) {
    const est = entry.estimate;
    const customerPart = est.customerName ? est.customerName : est.title;
    const label = est.estimateNumber
      ? `${est.estimateNumber} · ${customerPart}`
      : customerPart;
    return { title: label, subtitle: "Estimate" };
  }
  if (entry.category && entry.category !== "job") {
    const displayCat = entry.category === "admin" ? "work" : entry.category;
    return { title: displayCat.charAt(0).toUpperCase() + displayCat.slice(1) };
  }
  if (entry.category === "job" && !entry.job && !entry.estimateId) {
    return { title: "Unassigned", subtitle: "Deleted job" };
  }
  if (entry.category === "job" && entry.estimateId && !entry.estimate) {
    return { title: "Estimate", subtitle: `#${entry.estimateId}` };
  }
  return { title: "—" };
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
    "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function dateToTimeString(dateStr: string): string {
  const date = parseISO(dateStr);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function combineDateTime(dateStr: string, timeStr: string): string {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const date = parseISO(dateStr);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

// Week helpers — Sunday start for display
function getWeekDays(weekBaseDate: Date): Date[] {
  const sunday = startOfWeek(weekBaseDate, { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

function getWeekDateRange(weekBaseDate: Date): { startDate: string; endDate: string } {
  const sunday = startOfWeek(weekBaseDate, { weekStartsOn: 0 });
  const saturday = addDays(sunday, 6);
  return {
    startDate: format(sunday, "yyyy-MM-dd"),
    endDate: format(saturday, "yyyy-MM-dd"),
  };
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmployeeAvatar({
  name,
  profileImageUrl,
  size = "md",
}: {
  name: string;
  profileImageUrl: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-14 w-14 text-lg" : "h-10 w-10 text-sm";
  return (
    <Avatar className={`${sizeClass} flex-shrink-0`}>
      {profileImageUrl && <AvatarImage src={profileImageUrl} alt={name} className="object-cover" />}
      <AvatarFallback className={`font-semibold text-white ${getAvatarColor(name)}`}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

function EntryTags({ entry }: { entry: TimeEntry }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {entry.editedAt && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          Edited
        </span>
      )}
      {entry.autoClosed && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
          Auto-closed
        </span>
      )}
    </div>
  );
}

interface EditEntryModalProps {
  entry: TimeEntry | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  employeeName?: string;
}

function EditEntryModal({ entry, open, onClose, onSaved, employeeName }: EditEntryModalProps) {
  const { toast } = useToast();
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (entry && open) {
      setStartTime(dateToTimeString(entry.clockInAt));
      setEndTime(dateToTimeString(entry.clockOutAt));
      setReason("");
      setError("");
    }
  }, [entry, open]);

  const updateMutation = useMutation({
    mutationFn: async (data: { clockInAt: string; clockOutAt: string; editReason: string }) => {
      return apiRequest("PATCH", `/api/time/entries/${entry?.id}`, data);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: any) => {
      const message = err?.message || "Failed to save changes";
      setError(message);
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (!entry) return;
    setError("");
    if (!reason.trim()) { setError("A reason is required for editing time entries"); return; }
    const clockInAt = combineDateTime(entry.date, startTime);
    const clockOutAt = combineDateTime(entry.date, endTime);
    const s = new Date(clockInAt), e = new Date(clockOutAt);
    if (s >= e) { setError("Start time must be before end time"); return; }
    if ((e.getTime() - s.getTime()) / 3600000 > 16) { setError("Duration cannot exceed 16 hours"); return; }
    updateMutation.mutate({ clockInAt, clockOutAt, editReason: reason.trim() });
  };

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit Time Entry</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{employeeName || "Employee"}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {getJobOrCategory(entry).title} · {format(parseISO(entry.date), "EEE, MMM d")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time</Label>
              <TimeWheelPicker value={startTime} onChange={setStartTime} label="Select Start Time" />
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <TimeWheelPicker value={endTime} onChange={setEndTime} label="Select End Time" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Reason for Edit <span className="text-red-500">*</span></Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Forgot to clock out…" rows={3} />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={updateMutation.isPending}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EmployeeCardProps {
  emp: EmployeeDaySummary;
  isManager: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: (entry: TimeEntry, name: string) => void;
}

function EmployeeCard({ emp, isManager, isSelected, onSelect, onEdit }: EmployeeCardProps) {
  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-all duration-200 ${
        isSelected
          ? "border-blue-500 dark:border-blue-500 shadow-md shadow-blue-100 dark:shadow-blue-900/30 ring-1 ring-blue-500/30"
          : "border-slate-200 dark:border-slate-800 shadow-sm"
      }`}
    >
      {/* Header row — always visible */}
      <button
        onClick={onSelect}
        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
          isSelected
            ? "bg-blue-50 dark:bg-blue-950/40"
            : "bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50"
        }`}
      >
        <EmployeeAvatar name={emp.name} profileImageUrl={emp.profileImageUrl} />

        <div className="flex-1 min-w-0">
          <p className={`font-semibold truncate ${isSelected ? "text-blue-900 dark:text-blue-100" : "text-slate-900 dark:text-slate-100"}`}>
            {emp.name}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {emp.entries.length === 1 ? "1 entry" : `${emp.entries.length} entries`}
            {emp.isActive && (
              <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                Active
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`font-bold tabular-nums ${isSelected ? "text-blue-700 dark:text-blue-300 text-base" : "text-slate-800 dark:text-slate-200 text-sm"}`}>
            {formatDuration(emp.totalMinutes)}
          </span>
          {isSelected
            ? <ChevronUp className="h-4 w-4 text-blue-500" />
            : <ChevronDown className="h-4 w-4 text-slate-400" />
          }
        </div>
      </button>

      {/* Expanded entries */}
      {isSelected && (
        <div className="bg-white dark:bg-slate-900 border-t border-blue-100 dark:border-blue-900/40">
          {/* Selected employee summary banner */}
          <div className="flex items-center gap-4 px-4 py-3 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-100 dark:border-blue-900/40">
            <EmployeeAvatar name={emp.name} profileImageUrl={emp.profileImageUrl} size="lg" />
            <div>
              <p className="font-semibold text-blue-900 dark:text-blue-100">{emp.name}</p>
              <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 tabular-nums leading-tight">
                {formatDuration(emp.totalMinutes)}
              </p>
              <p className="text-xs text-blue-500 dark:text-blue-400">
                {emp.entries.length === 1 ? "1 session" : `${emp.entries.length} sessions`} today
              </p>
            </div>
          </div>

          {/* Entry list */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {emp.entries
              .sort((a, b) => new Date(a.clockInAt).getTime() - new Date(b.clockInAt).getTime())
              .map((entry) => {
                const { title, subtitle } = getJobOrCategory(entry);
                const mins = calculateMinutes(entry.clockInAt, entry.clockOutAt);
                const active = entry.clockOutAt && isFuture(parseISO(entry.clockOutAt));
                return (
                  <div key={entry.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{title}</p>
                        <EntryTags entry={entry} />
                        {active && (
                          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Active</span>
                        )}
                      </div>
                      {subtitle && <p className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>}
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {formatTime(entry.clockInAt)}{active ? " → now" : ` → ${formatTime(entry.clockOutAt)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                        {active ? "—" : formatDuration(mins)}
                      </span>
                      {isManager && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit(entry, emp.name)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit entry
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Day total */}
          <div className="px-4 py-2.5 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Day Total</span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatDuration(emp.totalMinutes)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Technician Day View ──────────────────────────────────────────────────────

function TechnicianDayView({ emp }: { emp: EmployeeDaySummary }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm bg-white dark:bg-slate-900">
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {emp.entries
          .sort((a, b) => new Date(a.clockInAt).getTime() - new Date(b.clockInAt).getTime())
          .map((entry) => {
            const { title, subtitle } = getJobOrCategory(entry);
            const mins = calculateMinutes(entry.clockInAt, entry.clockOutAt);
            const active = entry.clockOutAt && isFuture(parseISO(entry.clockOutAt));
            return (
              <div key={entry.id} className="px-4 py-3.5 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{title}</p>
                    <EntryTags entry={entry} />
                    {active && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                        </span>
                        Active
                      </span>
                    )}
                  </div>
                  {subtitle && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {formatTime(entry.clockInAt)}{active ? " → now" : ` → ${formatTime(entry.clockOutAt)}`}
                  </p>
                </div>
                <span className="text-sm font-bold text-slate-700 dark:text-slate-300 tabular-nums flex-shrink-0 pt-0.5">
                  {active ? "—" : formatDuration(mins)}
                </span>
              </div>
            );
          })}
      </div>
      <div className="px-4 py-2.5 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Day Total</span>
        <span className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatDuration(emp.totalMinutes)}</span>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Timesheets() {
  const { role } = useCan();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(() => new Date().getDay());
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>("all");
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);
  const [editEmployeeName, setEditEmployeeName] = useState<string | undefined>(undefined);

  const weekBaseDate = useMemo(() => {
    const now = new Date();
    return weekOffset === 0 ? now : addWeeks(now, weekOffset);
  }, [weekOffset]);

  const weekDays = useMemo(() => getWeekDays(weekBaseDate), [weekBaseDate]);
  const { startDate, endDate } = useMemo(() => getWeekDateRange(weekBaseDate), [weekBaseDate]);

  // Reset selected day to today when returning to current week
  useEffect(() => {
    if (weekOffset === 0) setSelectedDayIdx(new Date().getDay());
  }, [weekOffset]);

  // Reset selection when day or week changes
  useEffect(() => {
    setSelectedEmployeeId(null);
  }, [selectedDayIdx, weekOffset]);

  // Time entries — all week
  const { data, isLoading, error } = useQuery<TimeEntriesResponse>({
    queryKey: ["/api/time/entries", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/time/entries?startDate=${startDate}&endDate=${endDate}`, { credentials: "include" });
      if (res.status === 403) throw Object.assign(new Error("Access denied"), { status: 403 });
      if (!res.ok) throw new Error("Failed to fetch time entries");
      return res.json();
    },
    retry: (failureCount, err: any) => err?.status === 403 ? false : failureCount < 2,
  });

  // Org users — for profile images
  const { data: orgUsersData } = useQuery<{ users: OrgUser[] }>({
    queryKey: ["/api/org/users"],
    enabled: data?.role === "manager",
    retry: false,
  });

  // Build a map of userId → profileImageUrl
  const avatarMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const u of orgUsersData?.users ?? []) {
      map.set(u.id, u.profileImageUrl ?? null);
    }
    return map;
  }, [orgUsersData]);

  const isManager = data?.role === "manager";
  const isTechnician = data?.role === "technician";
  const selectedDate = format(weekDays[selectedDayIdx], "yyyy-MM-dd");

  // Entries for the selected day
  const dayEntries = useMemo(() => {
    if (!data?.entries) return [];
    return data.entries.filter((e) => e.date === selectedDate);
  }, [data?.entries, selectedDate]);

  // All employees who have entries today (for filter dropdown)
  const allEmployeesForDay = useMemo((): EmployeeDaySummary[] => {
    const map = new Map<string, { name: string; entries: TimeEntry[] }>();
    for (const entry of dayEntries) {
      const existing = map.get(entry.userId);
      if (existing) { existing.entries.push(entry); }
      else {
        const name = entry.user
          ? `${entry.user.firstName || ""} ${entry.user.lastName || ""}`.trim() || entry.userId
          : entry.userId;
        map.set(entry.userId, { name, entries: [entry] });
      }
    }
    return Array.from(map.entries())
      .map(([userId, { name, entries }]) => ({
        userId,
        name,
        initials: getInitials(name),
        profileImageUrl: avatarMap.get(userId) ?? null,
        entries,
        totalMinutes: entries.reduce((sum, e) => sum + calculateMinutes(e.clockInAt, e.clockOutAt), 0),
        isActive: entries.some((e) => e.clockOutAt && isFuture(parseISO(e.clockOutAt))),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dayEntries, avatarMap]);

  // Apply filter
  const employeesForDay = useMemo(() => {
    if (filterEmployeeId === "all") return allEmployeesForDay;
    return allEmployeesForDay.filter((e) => e.userId === filterEmployeeId);
  }, [allEmployeesForDay, filterEmployeeId]);

  // If the selected filter employee has no entries on the new day, show "all"
  useEffect(() => {
    if (filterEmployeeId !== "all" && !allEmployeesForDay.find((e) => e.userId === filterEmployeeId)) {
      setFilterEmployeeId("all");
    }
  }, [allEmployeesForDay, filterEmployeeId]);

  // Day totals (based on filtered list)
  const dayTotalMinutes = useMemo(
    () => employeesForDay.reduce((sum, e) => sum + e.totalMinutes, 0),
    [employeesForDay]
  );

  const handleEditEntry = (entry: TimeEntry, name?: string) => {
    setEditEntry(entry);
    setEditEmployeeName(name);
  };

  const handleEditSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/time/entries", startDate, endDate] });
  };

  const toggleSelect = (userId: string) => {
    setSelectedEmployeeId((prev) => (prev === userId ? null : userId));
  };

  const selectedDayDate = weekDays[selectedDayIdx];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-4">

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Clock className="h-6 w-6 text-blue-600" />
            Timesheets
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {isTechnician ? "Your personal clock-in history" : "Review daily employee hours"}
          </p>
        </div>

        {/* ── Day Selector ─────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="h-9 w-9 rounded-full flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex-shrink-0 shadow-sm"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4 text-slate-600 dark:text-slate-400" />
          </button>

          <div className="flex-1 grid grid-cols-7 gap-1">
            {weekDays.map((day, idx) => {
              const isSelected = idx === selectedDayIdx;
              const isTodayDay = isToday(day);
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedDayIdx(idx)}
                  className={`flex flex-col items-center py-2 rounded-xl transition-all duration-150 ${
                    isSelected
                      ? "bg-blue-600 shadow-md shadow-blue-200 dark:shadow-blue-900/40"
                      : isTodayDay
                      ? "bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/50"
                      : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                    isSelected ? "text-blue-100" : isTodayDay ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-slate-500"
                  }`}>
                    {DAY_LABELS[idx]}
                  </span>
                  <span className={`text-sm font-bold mt-0.5 ${
                    isSelected ? "text-white" : isTodayDay ? "text-blue-700 dark:text-blue-300" : "text-slate-700 dark:text-slate-300"
                  }`}>
                    {format(day, "d")}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            onClick={() => { if (weekOffset < 0) setWeekOffset((w) => w + 1); }}
            disabled={weekOffset >= 0}
            className="h-9 w-9 rounded-full flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex-shrink-0 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4 text-slate-600 dark:text-slate-400" />
          </button>
        </div>

        {/* Week range label */}
        <p className="text-xs text-center text-slate-400 dark:text-slate-500 mb-5 tabular-nums">
          {format(weekDays[0], "MMM d")} – {format(weekDays[6], "MMM d, yyyy")}
        </p>

        {/* ── Loading ──────────────────────────────────────────────── */}
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        )}

        {/* ── Access Denied ─────────────────────────────────────────── */}
        {!isLoading && (error as any)?.status === 403 && (
          <Card className="border-slate-200 dark:border-slate-800">
            <CardContent className="py-10 text-center">
              <AlertCircle className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="font-medium text-slate-700 dark:text-slate-300">Access Restricted</p>
              <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Timesheet data is only visible to managers.</p>
            </CardContent>
          </Card>
        )}

        {/* ── Error ────────────────────────────────────────────────── */}
        {!isLoading && error && (error as any)?.status !== 403 && (
          <Card className="border-red-200 dark:border-red-900">
            <CardContent className="py-8 text-center">
              <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
              <p className="text-red-600 dark:text-red-400">Failed to load timesheet data</p>
            </CardContent>
          </Card>
        )}

        {/* ── Main Content ─────────────────────────────────────────── */}
        {!isLoading && !error && data && (
          <>
            {/* Daily Summary Card */}
            <Card className="mb-4 border-slate-200 dark:border-slate-800 shadow-sm">
              <CardContent className="px-5 py-4">
                <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
                  {format(selectedDayDate, "EEEE, MMMM d")}
                </p>
                {isTechnician ? (
                  /* Technician: show only their own total */
                  employeesForDay.length === 0 ? (
                    <p className="text-sm text-slate-400 dark:text-slate-500">No entries</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatDuration(dayTotalMinutes)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Your hours</p>
                      </div>
                      {employeesForDay[0]?.isActive && (
                        <span className="ml-3 inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                          </span>
                          Currently clocked in
                        </span>
                      )}
                    </div>
                  )
                ) : (
                  /* Manager: show company totals */
                  employeesForDay.length === 0 ? (
                    <p className="text-sm text-slate-400 dark:text-slate-500">No entries</p>
                  ) : (
                    <div className="flex items-center gap-6">
                      <div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatDuration(dayTotalMinutes)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Total hours</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {allEmployeesForDay.length}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {allEmployeesForDay.length === 1 ? "Employee" : "Employees"}
                        </p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {dayEntries.length}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {dayEntries.length === 1 ? "Entry" : "Entries"}
                        </p>
                      </div>
                    </div>
                  )
                )}
              </CardContent>
            </Card>

            {/* Employee filter — only show if more than 1 employee has entries AND user is manager */}
            {!isTechnician && allEmployeesForDay.length > 1 && (
              <div className="flex items-center gap-2 mb-3">
                <Filter className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                <Select value={filterEmployeeId} onValueChange={(v) => { setFilterEmployeeId(v); setSelectedEmployeeId(null); }}>
                  <SelectTrigger className="h-8 text-xs border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg flex-1 max-w-[220px]">
                    <SelectValue placeholder="All Employees" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Employees</SelectItem>
                    {allEmployeesForDay.map((emp) => (
                      <SelectItem key={emp.userId} value={emp.userId}>
                        {emp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filterEmployeeId !== "all" && (
                  <button
                    onClick={() => { setFilterEmployeeId("all"); setSelectedEmployeeId(null); }}
                    className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {/* Employee List */}
            {employeesForDay.length === 0 ? (
              <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                <CardContent className="py-10 text-center">
                  <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                    <Clock className="h-6 w-6 text-slate-400 dark:text-slate-500" />
                  </div>
                  <p className="font-medium text-slate-700 dark:text-slate-300">
                    {isTechnician ? "No time entries for this day" : "No time entries"}
                  </p>
                  <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                    {isTechnician
                      ? "Your clock-ins and clock-outs will appear here."
                      : `No one logged hours on ${format(selectedDayDate, "EEEE")}`}
                  </p>
                </CardContent>
              </Card>
            ) : isTechnician ? (
              /* Technician: flat entry list, no collapse toggle */
              <TechnicianDayView emp={employeesForDay[0]} />
            ) : (
              /* Manager: expandable employee cards */
              <div className="space-y-2.5">
                {employeesForDay.map((emp) => (
                  <EmployeeCard
                    key={emp.userId}
                    emp={emp}
                    isManager={isManager}
                    isSelected={selectedEmployeeId === emp.userId}
                    onSelect={() => toggleSelect(emp.userId)}
                    onEdit={handleEditEntry}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <EditEntryModal
        entry={editEntry}
        open={!!editEntry}
        onClose={() => setEditEntry(null)}
        onSaved={handleEditSaved}
        employeeName={editEmployeeName}
      />
    </div>
  );
}
