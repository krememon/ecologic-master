import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Clock, ChevronLeft, ChevronRight, Loader2, AlertCircle, MoreHorizontal, Pencil, ChevronDown, ChevronUp, Users } from "lucide-react";
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
  user?: { id: string; firstName: string | null; lastName: string | null };
}

interface TimeEntriesResponse {
  role: "technician" | "manager";
  entries: TimeEntry[];
}

interface EmployeeDaySummary {
  userId: string;
  name: string;
  initials: string;
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
  if (entry.category && entry.category !== "job") {
    const displayCat = entry.category === "admin" ? "work" : entry.category;
    return { title: displayCat.charAt(0).toUpperCase() + displayCat.slice(1) };
  }
  if (entry.category === "job" && !entry.job) {
    return { title: "Unassigned", subtitle: "Deleted job" };
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
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: any) => {
      const message = err?.message || "Failed to save changes";
      setError(message);
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (!entry) return;
    setError("");
    if (!reason.trim()) {
      setError("A reason is required for editing time entries");
      return;
    }
    const clockInAt = combineDateTime(entry.date, startTime);
    const clockOutAt = combineDateTime(entry.date, endTime);
    const startDate = new Date(clockInAt);
    const endDate = new Date(clockOutAt);
    if (startDate >= endDate) {
      setError("Start time must be before end time");
      return;
    }
    const durationHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    if (durationHours > 16) {
      setError("Duration cannot exceed 16 hours");
      return;
    }
    updateMutation.mutate({ clockInAt, clockOutAt, editReason: reason.trim() });
  };

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Time Entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {employeeName || "Employee"}
            </p>
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
            <Label>
              Reason for Edit <span className="text-red-500">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Forgot to clock out…"
              rows={3}
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
            ) : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EmployeeCardProps {
  emp: EmployeeDaySummary;
  isManager: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: (entry: TimeEntry, name: string) => void;
}

function EmployeeCard({ emp, isManager, expanded, onToggle, onEdit }: EmployeeCardProps) {
  return (
    <Card className="overflow-hidden border-slate-200 dark:border-slate-800 shadow-sm">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        {/* Avatar */}
        <div
          className={`h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 ${getAvatarColor(emp.name)}`}
        >
          {emp.initials}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{emp.name}</p>
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

        {/* Hours + chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatDuration(emp.totalMinutes)}
          </span>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-slate-400" />
            : <ChevronDown className="h-4 w-4 text-slate-400" />
          }
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
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
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                        {title}
                      </p>
                      <EntryTags entry={entry} />
                      {active && (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          Active
                        </span>
                      )}
                    </div>
                    {subtitle && (
                      <p className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>
                    )}
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {formatTime(entry.clockInAt)}
                      {active ? " → now" : ` → ${formatTime(entry.clockOutAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
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
          {/* Daily total row */}
          <div className="px-4 py-2.5 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Day Total
            </span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatDuration(emp.totalMinutes)}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Timesheets() {
  const { role } = useCan();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(() => {
    const today = new Date();
    return today.getDay(); // 0=Sun ... 6=Sat
  });
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set());
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);
  const [editEmployeeName, setEditEmployeeName] = useState<string | undefined>(undefined);

  const weekBaseDate = useMemo(() => {
    const now = new Date();
    return weekOffset === 0 ? now : addWeeks(now, weekOffset);
  }, [weekOffset]);

  const weekDays = useMemo(() => getWeekDays(weekBaseDate), [weekBaseDate]);
  const { startDate, endDate } = useMemo(() => getWeekDateRange(weekBaseDate), [weekBaseDate]);

  // When changing weeks, snap selectedDayIdx to a valid day
  useEffect(() => {
    if (weekOffset === 0) {
      setSelectedDayIdx(new Date().getDay());
    }
    // For other weeks, keep the same day-of-week index
  }, [weekOffset]);

  // Reset expanded employees when day or week changes
  useEffect(() => {
    setExpandedEmployees(new Set());
  }, [selectedDayIdx, weekOffset]);

  const { data, isLoading, error } = useQuery<TimeEntriesResponse>({
    queryKey: ["/api/time/entries", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/time/entries?startDate=${startDate}&endDate=${endDate}`,
        { credentials: "include" }
      );
      if (res.status === 403) {
        throw Object.assign(new Error("Access denied"), { status: 403 });
      }
      if (!res.ok) throw new Error("Failed to fetch time entries");
      return res.json();
    },
    retry: (failureCount, err: any) => err?.status === 403 ? false : failureCount < 2,
  });

  const isManager = data?.role === "manager";
  const selectedDate = format(weekDays[selectedDayIdx], "yyyy-MM-dd");

  // Entries for the selected day
  const dayEntries = useMemo(() => {
    if (!data?.entries) return [];
    return data.entries.filter((e) => e.date === selectedDate);
  }, [data?.entries, selectedDate]);

  // Employee summaries for the selected day
  const employeesForDay = useMemo((): EmployeeDaySummary[] => {
    const map = new Map<string, { name: string; entries: TimeEntry[] }>();
    for (const entry of dayEntries) {
      const existing = map.get(entry.userId);
      if (existing) {
        existing.entries.push(entry);
      } else {
        const name = entry.user
          ? `${entry.user.firstName || ""} ${entry.user.lastName || ""}`.trim() || entry.userId
          : entry.userId;
        map.set(entry.userId, { name, entries: [entry] });
      }
    }
    return Array.from(map.entries())
      .map(([userId, { name, entries }]) => {
        const totalMinutes = entries.reduce(
          (sum, e) => sum + calculateMinutes(e.clockInAt, e.clockOutAt),
          0
        );
        const isActive = entries.some(
          (e) => e.clockOutAt && isFuture(parseISO(e.clockOutAt))
        );
        return {
          userId,
          name,
          initials: getInitials(name),
          entries,
          totalMinutes,
          isActive,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dayEntries]);

  // Day totals
  const dayTotalMinutes = useMemo(
    () => dayEntries.reduce((sum, e) => sum + calculateMinutes(e.clockInAt, e.clockOutAt), 0),
    [dayEntries]
  );

  const handleEditEntry = (entry: TimeEntry, name?: string) => {
    setEditEntry(entry);
    setEditEmployeeName(name);
  };

  const handleEditSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/time/entries", startDate, endDate] });
  };

  const toggleEmployee = (userId: string) => {
    setExpandedEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const goToPrevWeek = () => setWeekOffset((w) => w - 1);
  const goToNextWeek = () => {
    if (weekOffset < 0) setWeekOffset((w) => w + 1);
  };

  const selectedDayDate = weekDays[selectedDayIdx];
  const selectedDayLabel = format(selectedDayDate, "EEEE, MMMM d");

  // Access denied for non-managers
  const isAccessDenied = (error as any)?.status === 403 || (error && !isLoading);

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
            Review daily employee hours
          </p>
        </div>

        {/* ── Day Selector ─────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={goToPrevWeek}
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
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wider ${
                      isSelected
                        ? "text-blue-100"
                        : isTodayDay
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {DAY_LABELS[idx]}
                  </span>
                  <span
                    className={`text-sm font-bold mt-0.5 ${
                      isSelected
                        ? "text-white"
                        : isTodayDay
                        ? "text-blue-700 dark:text-blue-300"
                        : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            onClick={goToNextWeek}
            disabled={weekOffset >= 0}
            className="h-9 w-9 rounded-full flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex-shrink-0 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4 text-slate-600 dark:text-slate-400" />
          </button>
        </div>

        {/* Week label */}
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
              <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                Timesheet data is only visible to managers.
              </p>
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
                  {selectedDayLabel}
                </p>
                {employeesForDay.length === 0 ? (
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
                        {employeesForDay.length}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {employeesForDay.length === 1 ? "Employee" : "Employees"}
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
                )}
              </CardContent>
            </Card>

            {/* Employee List */}
            {employeesForDay.length === 0 ? (
              <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                <CardContent className="py-10 text-center">
                  <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                    <Clock className="h-6 w-6 text-slate-400 dark:text-slate-500" />
                  </div>
                  <p className="font-medium text-slate-700 dark:text-slate-300">
                    No time entries
                  </p>
                  <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                    No one logged hours on {format(selectedDayDate, "EEEE")}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2.5">
                {employeesForDay.map((emp) => (
                  <EmployeeCard
                    key={emp.userId}
                    emp={emp}
                    isManager={isManager}
                    expanded={expandedEmployees.has(emp.userId)}
                    onToggle={() => toggleEmployee(emp.userId)}
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
