import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, TrendingUp, AlertTriangle, Clock, User, MapPin, Users } from "lucide-react";
import { startOfWeekLocal, addDaysLocal, fmtWeekOf, fmtDowShort, fmtDayNumber, dateToYmdLocal, parseYmdLocal } from "@/utils/scheduleDate";
import { useLocation } from "wouter";
import { useCan } from "@/hooks/useCan";

interface JobWithSchedule {
  id: number;
  title: string;
  status: string;
  startDate: string | null;
  scheduledTime: string | null;
  location: string | null;
  city: string | null;
  clientName: string | null;
  customerId: number | null;
  client?: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  assignedEmployeeIds?: string[];
  crewAssignments?: Array<{
    userId: string;
    user: {
      firstName: string | null;
      lastName: string | null;
      email: string;
      profileImageUrl: string | null;
    };
  }>;
}

export default function AIScheduling() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { role } = useCan();
  const [, setLocation] = useLocation();
  
  const [selectedWeek, setSelectedWeek] = useState<Date>(() => {
    return startOfWeekLocal(new Date(), 0);
  });
  
  const [selectedDay, setSelectedDay] = useState<string | null>(() => {
    const today = new Date();
    const weekStart = startOfWeekLocal(new Date(), 0);
    const weekEnd = addDaysLocal(weekStart, 6);
    if (today >= weekStart && today <= weekEnd) {
      return dateToYmdLocal(today);
    }
    return dateToYmdLocal(weekStart);
  });

  const { data: rawJobs = [] } = useQuery<JobWithSchedule[]>({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
  });

  const jobs = useMemo(() => {
    if (!Array.isArray(rawJobs)) return [];
    
    if (role === 'TECHNICIAN' && user?.id) {
      return rawJobs.filter((job) => {
        const assignedIds = job.assignedEmployeeIds || [];
        const crewIds = job.crewAssignments?.map(c => c.userId) || [];
        const allAssigned = Array.from(new Set([...assignedIds, ...crewIds]));
        return allAssigned.includes(user.id);
      });
    }
    
    return rawJobs;
  }, [rawJobs, role, user?.id]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  useEffect(() => {
    const today = new Date();
    const weekEnd = addDaysLocal(selectedWeek, 6);
    if (today >= selectedWeek && today <= weekEnd) {
      setSelectedDay(dateToYmdLocal(today));
    } else {
      setSelectedDay(dateToYmdLocal(selectedWeek));
    }
  }, [selectedWeek]);

  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysLocal(selectedWeek, i));

  const getStatusBadgeClass = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      case 'active':
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      case 'cancelled':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300';
    }
  };

  const dailyJobs = useMemo(() => {
    if (!selectedDay || !Array.isArray(jobs)) return [];
    
    const filtered = jobs.filter((job) => {
      if (!job.startDate) return false;
      const jobDate = parseYmdLocal(job.startDate);
      return dateToYmdLocal(jobDate) === selectedDay;
    });

    filtered.sort((a, b) => {
      const timeA = a.scheduledTime || '99:99';
      const timeB = b.scheduledTime || '99:99';
      return timeA.localeCompare(timeB);
    });

    return filtered;
  }, [jobs, selectedDay]);

  const weeklyStats = useMemo(() => {
    if (!Array.isArray(jobs)) return { total: 0, planning: 0, active: 0 };
    
    const weekJobIds = new Set<number>();
    weekDates.forEach(date => {
      const dateStr = dateToYmdLocal(date);
      jobs.forEach((job) => {
        if (!job.startDate) return;
        const jobDate = parseYmdLocal(job.startDate);
        if (dateToYmdLocal(jobDate) === dateStr) {
          weekJobIds.add(job.id);
        }
      });
    });

    return {
      total: weekJobIds.size,
      planning: jobs.filter((j) => j.status === 'planning').length,
      active: jobs.filter((j) => j.status === 'in_progress' || j.status === 'active').length,
    };
  }, [jobs, weekDates]);

  const getEmployeeDisplay = (job: JobWithSchedule) => {
    const crew = job.crewAssignments || [];
    if (crew.length === 0) return null;

    return (
      <div className="flex items-center gap-2">
        <div className="flex -space-x-2">
          {crew.slice(0, 3).map((assignment) => {
            const name = `${assignment.user.firstName || ''} ${assignment.user.lastName || ''}`.trim() || assignment.user.email;
            const initials = ((assignment.user.firstName?.[0] || '') + (assignment.user.lastName?.[0] || '')).toUpperCase() || assignment.user.email[0].toUpperCase();
            
            return assignment.user.profileImageUrl ? (
              <img
                key={assignment.userId}
                src={assignment.user.profileImageUrl}
                alt={name}
                title={name}
                className="h-7 w-7 rounded-full border-2 border-white dark:border-slate-800 object-cover"
              />
            ) : (
              <div
                key={assignment.userId}
                title={name}
                className="h-7 w-7 rounded-full border-2 border-white dark:border-slate-800 bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                {initials}
              </div>
            );
          })}
        </div>
        {crew.length > 3 && (
          <span className="text-xs text-muted-foreground">+{crew.length - 3}</span>
        )}
      </div>
    );
  };

  const formatTime = (time: string | null) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Weekly Schedule</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage your team's weekly schedule</p>
      </div>

      <Card className="overflow-visible">
        <CardHeader className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap gap-y-2">
            <CardTitle className="text-base sm:text-lg">Week of {fmtWeekOf(selectedWeek)}</CardTitle>
            <div className="inline-flex rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setSelectedWeek(addDaysLocal(selectedWeek, -7))}
                className="px-3 sm:px-4 h-9 sm:h-10 text-sm font-medium bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600 active:translate-y-[0.5px] border-0 border-r border-slate-200 dark:border-slate-700 rounded-l-xl text-slate-700 dark:text-slate-300"
                aria-label="Go to previous week"
              >
                Previous Week
              </button>
              <button
                type="button"
                onClick={() => setSelectedWeek(addDaysLocal(selectedWeek, 7))}
                className="px-3 sm:px-4 h-9 sm:h-10 text-sm font-medium bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600 active:translate-y-[0.5px] border-0 rounded-r-xl text-slate-700 dark:text-slate-300"
                aria-label="Go to next week"
              >
                Next Week
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {weekDates.map((date) => {
              const dateStr = dateToYmdLocal(date);
              const isSelected = selectedDay === dateStr;
              const dayJobs = jobs.filter((job) => {
                if (!job.startDate) return false;
                const jobDate = parseYmdLocal(job.startDate);
                return dateToYmdLocal(jobDate) === dateStr;
              });
              const hasJobs = dayJobs.length > 0;
              
              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => setSelectedDay(dateStr)}
                  className={`min-h-[100px] sm:min-h-[120px] border rounded-lg p-2 sm:p-3 cursor-pointer transition-all ${
                    isSelected 
                      ? 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700' 
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex flex-col items-center h-full">
                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1 sm:mb-2">
                      {fmtDowShort(date)}
                    </div>
                    <div className={`text-xl sm:text-2xl font-bold mb-2 sm:mb-3 ${
                      isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-slate-100'
                    }`}>
                      {fmtDayNumber(date)}
                    </div>
                    
                    <div className="flex-1 flex items-center justify-center">
                      {hasJobs && (
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-blue-500 rounded-full"></div>
                          <span className="text-xs text-slate-600 dark:text-slate-400">{dayJobs.length}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Weekly Jobs</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{weeklyStats.total}</div>
            <p className="text-xs text-muted-foreground">Jobs scheduled this week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Planning Jobs</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{weeklyStats.planning}</div>
            <p className="text-xs text-muted-foreground">In planning phase</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
            <Calendar className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{weeklyStats.active}</div>
            <p className="text-xs text-muted-foreground">Currently in progress</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Scheduled Jobs
            {selectedDay && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                {(() => {
                  const d = parseYmdLocal(selectedDay);
                  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                })()}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dailyJobs.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                No jobs scheduled for this day
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {dailyJobs.map((job) => (
                <div
                  key={job.id}
                  onClick={() => setLocation(`/jobs/${job.id}`)}
                  className="flex items-center gap-4 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-750 hover:border-slate-300 dark:hover:border-slate-600 transition-all active:scale-[0.99]"
                >
                  <div className="flex-shrink-0 w-16 text-center">
                    {job.scheduledTime ? (
                      <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                        <Clock className="h-4 w-4 text-slate-400" />
                        <span className="text-sm font-medium">{formatTime(job.scheduledTime)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">No time</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {job.clientName || job.client?.name || job.title}
                      </span>
                    </div>
                    {(job.location || job.city) && (
                      <div className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                        <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{job.location || job.city}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    {getEmployeeDisplay(job)}
                    <Badge className={`${getStatusBadgeClass(job.status)} capitalize text-xs`}>
                      {job.status?.replace('_', ' ') || 'pending'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
