import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, ChevronLeft, ChevronRight, Loader2, AlertCircle, Calendar, User } from "lucide-react";
import { format, startOfWeek, endOfWeek, addWeeks, parseISO } from "date-fns";
import { useCan } from "@/hooks/useCan";

interface TimeEntry {
  id: number;
  userId: string;
  jobId: number | null;
  category: string;
  clockInAt: string;
  clockOutAt: string;
  date: string;
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

function getJobOrCategory(entry: TimeEntry): string {
  if (entry.job?.title) return entry.job.title;
  if (entry.category && entry.category !== "job") {
    return entry.category.charAt(0).toUpperCase() + entry.category.slice(1);
  }
  return "—";
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

export default function Timesheets() {
  const { role } = useCan();
  const [, navigate] = useLocation();
  const [weekOffset, setWeekOffset] = useState(0);
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");

  useEffect(() => {
    if (role === "ESTIMATOR" || role === "DISPATCHER") {
      navigate("/");
    }
  }, [role, navigate]);

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
                  <Calendar className="h-4 w-4 text-slate-500" />
                  <span className="text-sm font-medium">{weekLabel}</span>
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
                {weekOffset !== 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setWeekOffset(0)}
                    className="text-sm"
                  >
                    This Week
                  </Button>
                )}
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
                          <div
                            key={entry.id}
                            className="px-4 py-3 flex items-center justify-between gap-2"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                                {getJobOrCategory(entry)}
                              </p>
                              <p className="text-sm text-slate-500 dark:text-slate-400">
                                {formatTime(entry.clockInAt)} - {formatTime(entry.clockOutAt)}
                              </p>
                            </div>
                            <span className="font-medium text-slate-900 dark:text-slate-100 text-sm">
                              {formatDuration(calculateMinutes(entry.clockInAt, entry.clockOutAt))}
                            </span>
                          </div>
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
                                <div
                                  key={entry.id}
                                  className="px-4 py-2.5 flex items-center justify-between gap-2"
                                >
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                                      {getJobOrCategory(entry)}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                      {formatTime(entry.clockInAt)} - {formatTime(entry.clockOutAt)}
                                    </p>
                                  </div>
                                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                    {formatDuration(calculateMinutes(entry.clockInAt, entry.clockOutAt))}
                                  </span>
                                </div>
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
    </div>
  );
}
