import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Clock, ChevronLeft, ChevronRight, Loader2, AlertCircle, Calendar, User, MoreHorizontal, Pencil } from "lucide-react";
import { format, startOfWeek, endOfWeek, addWeeks, parseISO } from "date-fns";
import { useCan } from "@/hooks/useCan";
import { TimeWheelPicker } from "@/components/TimeWheelPicker";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

function formatTime(dateStr: string): string {
  return format(parseISO(dateStr), "h:mm a");
}

function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), "EEE, MMM d");
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function calculateMinutes(start: string, end: string): number {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return Math.round((endTime - startTime) / 60000);
}

function getJobOrCategory(entry: TimeEntry): { title: string; subtitle?: string } {
  if (entry.job?.title) return { title: entry.job.title };
  if (entry.category && entry.category !== "job") {
    const displayCat = entry.category === 'admin' ? 'work' : entry.category;
    return { title: displayCat.charAt(0).toUpperCase() + displayCat.slice(1) };
  }
  // Job was deleted - jobId is null but category was "job"
  if (entry.category === "job" && !entry.job) {
    return { title: "Unassigned", subtitle: "Deleted job" };
  }
  return { title: "—" };
}

function getWeekDates(date: Date): { startDate: string; endDate: string; label: string } {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(date, { weekStartsOn: 1 });
  return {
    startDate: format(start, "yyyy-MM-dd"),
    endDate: format(end, "yyyy-MM-dd"),
    label: `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`,
  };
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

interface DateGroup {
  date: string;
  dateLabel: string;
  entries: TimeEntry[];
  totalMinutes: number;
}

interface EmployeeGroup {
  userId: string;
  name: string;
  dateGroups: DateGroup[];
  totalMinutes: number;
}

function groupEntriesByDate(entries: TimeEntry[]): DateGroup[] {
  const dateMap = new Map<string, TimeEntry[]>();
  
  for (const entry of entries) {
    const existing = dateMap.get(entry.date) || [];
    existing.push(entry);
    dateMap.set(entry.date, existing);
  }
  
  return Array.from(dateMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, dayEntries]) => {
      const totalMinutes = dayEntries.reduce(
        (sum, e) => sum + calculateMinutes(e.clockInAt, e.clockOutAt),
        0
      );
      return {
        date,
        dateLabel: formatDate(date),
        entries: dayEntries.sort((a, b) => 
          new Date(b.clockInAt).getTime() - new Date(a.clockInAt).getTime()
        ),
        totalMinutes,
      };
    });
}

function EntryTags({ entry }: { entry: TimeEntry }) {
  return (
    <div className="flex items-center gap-1.5">
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
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
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
              {getJobOrCategory(entry).title} • {formatDate(entry.date)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time</Label>
              <TimeWheelPicker
                value={startTime}
                onChange={setStartTime}
                label="Select Start Time"
              />
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <TimeWheelPicker
                value={endTime}
                onChange={setEndTime}
                label="Select End Time"
              />
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

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EntryRowProps {
  entry: TimeEntry;
  isManager: boolean;
  onEdit: (entry: TimeEntry, employeeName?: string) => void;
  employeeName?: string;
  compact?: boolean;
}

function EntryRow({ entry, isManager, onEdit, employeeName, compact = false }: EntryRowProps) {
  return (
    <div className={`px-4 ${compact ? "py-2.5" : "py-3"} flex items-center justify-between gap-2`}>
      <div className="flex-1 min-w-0">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <p className={`font-medium text-slate-900 dark:text-slate-100 truncate ${compact ? "text-sm" : ""}`}>
              {getJobOrCategory(entry).title}
            </p>
            <EntryTags entry={entry} />
          </div>
          {getJobOrCategory(entry).subtitle && (
            <p className={`text-slate-400 dark:text-slate-500 ${compact ? "text-xs" : "text-xs"}`}>
              {getJobOrCategory(entry).subtitle}
            </p>
          )}
        </div>
        <p className={`text-slate-500 dark:text-slate-400 ${compact ? "text-xs" : "text-sm"}`}>
          {formatTime(entry.clockInAt)} - {formatTime(entry.clockOutAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`font-medium text-slate-900 dark:text-slate-100 ${compact ? "text-sm" : ""}`}>
          {formatDuration(calculateMinutes(entry.clockInAt, entry.clockOutAt))}
        </span>
        {isManager && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(entry, employeeName)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit entry
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

export default function Timesheets() {
  const { role } = useCan();
  const [, navigate] = useLocation();
  const [weekOffset, setWeekOffset] = useState(0);
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);
  const [editEmployeeName, setEditEmployeeName] = useState<string | undefined>(undefined);


  const currentDate = useMemo(() => {
    const now = new Date();
    return weekOffset === 0 ? now : addWeeks(now, weekOffset);
  }, [weekOffset]);

  const { startDate, endDate, label: weekLabel } = useMemo(
    () => getWeekDates(currentDate),
    [currentDate]
  );

  const { data, isLoading, error } = useQuery<TimeEntriesResponse>({
    queryKey: ["/api/time/entries", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/time/entries?startDate=${startDate}&endDate=${endDate}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch time entries");
      return res.json();
    },
  });

  const isTechnician = data?.role === "technician";
  const isManager = data?.role === "manager";
  const pageTitle = isTechnician ? "My Timesheet" : "Timesheets";

  const employees = useMemo(() => {
    if (!data?.entries || isTechnician) return [];
    const map = new Map<string, string>();
    for (const entry of data.entries) {
      if (entry.user) {
        const name = `${entry.user.firstName || ""} ${entry.user.lastName || ""}`.trim() || entry.userId;
        map.set(entry.userId, name);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data?.entries, isTechnician]);

  const filteredEntries = useMemo(() => {
    if (!data?.entries) return [];
    if (employeeFilter === "all" || isTechnician) return data.entries;
    return data.entries.filter((e) => e.userId === employeeFilter);
  }, [data?.entries, employeeFilter, isTechnician]);

  const totalMinutes = useMemo(() => {
    return filteredEntries.reduce(
      (sum, entry) => sum + calculateMinutes(entry.clockInAt, entry.clockOutAt),
      0
    );
  }, [filteredEntries]);

  const technicianDateGroups = useMemo(() => {
    if (!isTechnician) return null;
    return groupEntriesByDate(filteredEntries);
  }, [filteredEntries, isTechnician]);

  const employeeGroups = useMemo((): EmployeeGroup[] | null => {
    if (isTechnician) return null;
    
    const groupMap = new Map<string, { name: string; entries: TimeEntry[] }>();
    
    for (const entry of filteredEntries) {
      const existing = groupMap.get(entry.userId);
      if (existing) {
        existing.entries.push(entry);
      } else {
        const name = entry.user
          ? `${entry.user.firstName || ""} ${entry.user.lastName || ""}`.trim() || entry.userId
          : entry.userId;
        groupMap.set(entry.userId, { name, entries: [entry] });
      }
    }
    
    return Array.from(groupMap.entries())
      .map(([userId, { name, entries }]) => {
        const dateGroups = groupEntriesByDate(entries);
        const totalMinutes = entries.reduce(
          (sum, e) => sum + calculateMinutes(e.clockInAt, e.clockOutAt),
          0
        );
        return { userId, name, dateGroups, totalMinutes };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredEntries, isTechnician]);

  const selectedEmployeeName = useMemo(() => {
    if (employeeFilter === "all") return null;
    const emp = employees.find(([id]) => id === employeeFilter);
    return emp ? emp[1] : null;
  }, [employeeFilter, employees]);

  const handleEditEntry = (entry: TimeEntry, employeeName?: string) => {
    setEditEntry(entry);
    setEditEmployeeName(employeeName);
  };

  const handleEditSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/time/entries", startDate, endDate] });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Clock className="h-6 w-6" />
            {pageTitle}
          </h1>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setWeekOffset(weekOffset - 1)}
                  aria-label="Previous week"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <Calendar className="h-4 w-4 text-slate-500 flex-shrink-0" />
                  <span className="text-sm font-medium whitespace-nowrap">{weekLabel}</span>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setWeekOffset(weekOffset + 1)}
                  disabled={weekOffset >= 0}
                  aria-label="Next week"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {!isTechnician && employees.length > 0 && (
                <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                  <SelectTrigger className="w-48">
                    <User className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="All Employees" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Employees</SelectItem>
                    {employees.map(([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardContent>
        </Card>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        )}

        {error && (
          <Card className="border-red-200 dark:border-red-800">
            <CardContent className="py-8 text-center">
              <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-600 dark:text-red-400">Failed to load timesheet data</p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && filteredEntries.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <Clock className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-lg">
                {selectedEmployeeName 
                  ? `No entries for ${selectedEmployeeName} this week`
                  : "No time entries this week"}
              </p>
              <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">
                Time entries will appear here when clocked in and out
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && filteredEntries.length > 0 && (
          <>
            <Card className="mb-4">
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    Total Hours {selectedEmployeeName ? `(${selectedEmployeeName})` : ""}
                  </span>
                  <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {formatDuration(totalMinutes)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {isTechnician && technicianDateGroups ? (
              <div className="space-y-4">
                {technicianDateGroups.map((dateGroup) => (
                  <Card key={dateGroup.date}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          {dateGroup.dateLabel}
                        </span>
                        <span className="text-sm font-medium text-slate-500">
                          {formatDuration(dateGroup.totalMinutes)}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y divide-slate-200 dark:divide-slate-700">
                        {dateGroup.entries.map((entry) => (
                          <EntryRow
                            key={entry.id}
                            entry={entry}
                            isManager={false}
                            onEdit={handleEditEntry}
                          />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : employeeGroups ? (
              <div className="space-y-6">
                {employeeGroups.map((empGroup) => (
                  <div key={empGroup.userId}>
                    <div className="flex items-center justify-between mb-2 px-1">
                      <div className="flex items-center gap-2">
                        <User className="h-5 w-5 text-slate-500" />
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {empGroup.name}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                        {formatDuration(empGroup.totalMinutes)}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {empGroup.dateGroups.map((dateGroup) => (
                        <Card key={dateGroup.date}>
                          <CardHeader className="py-2 px-4">
                            <CardTitle className="text-sm flex items-center justify-between font-medium">
                              <span className="text-slate-600 dark:text-slate-400">
                                {dateGroup.dateLabel}
                              </span>
                              <span className="text-slate-500">
                                {formatDuration(dateGroup.totalMinutes)}
                              </span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-0">
                            <div className="divide-y divide-slate-200 dark:divide-slate-700">
                              {dateGroup.entries.map((entry) => (
                                <EntryRow
                                  key={entry.id}
                                  entry={entry}
                                  isManager={isManager}
                                  onEdit={handleEditEntry}
                                  employeeName={empGroup.name}
                                  compact
                                />
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
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
