import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, Brain, Zap, TrendingUp, Edit3, Plus, Trash2, Clock, User, MapPin, AlertTriangle, X, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { startOfWeekLocal, addDaysLocal, fmtWeekOf, fmtDowShort, fmtDayNumber, dateToYmdLocal, parseYmdLocal } from "@/utils/scheduleDate";
import { formatInLocalTimezone } from "@/utils/timezone";

interface ScheduleItem {
  id: number;
  jobId: number;
  jobTitle: string;
  jobStatus: string;
  jobAddress?: string;
  clientName?: string;
  clientId?: number;
  subcontractorId: number | null;
  subcontractorName?: string;
  startDateTime: string; // UTC ISO string
  endDateTime: string; // UTC ISO string
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  location?: string | null;
  notes?: string | null;
  companyId: number;
  createdAt?: string;
  updatedAt?: string;
}

export default function AIScheduling() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<Date>(() => {
    return startOfWeekLocal(new Date(), 0); // Sunday-start week
  });

  // Compute date range for the current week view
  const weekStartUtc = selectedWeek.toISOString();
  const weekEndDate = new Date(selectedWeek);
  weekEndDate.setDate(weekEndDate.getDate() + 7);
  const weekEndUtc = weekEndDate.toISOString();

  // Query for schedule items filtered by week range
  const { data: scheduledItems } = useQuery({
    queryKey: [`/api/schedule-items?start=${weekStartUtc}&end=${weekEndUtc}`],
    enabled: isAuthenticated,
  });

  // Query for actual jobs and subcontractors data (legacy - keeping for other parts)
  const { data: jobs } = useQuery({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
  });

  const { data: subcontractors } = useQuery({
    queryKey: ["/api/subcontractors"],
    enabled: isAuthenticated,
  });

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

  // Generate week dates from Sunday (local time only)
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysLocal(selectedWeek, i));

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
      case 'in-progress': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300';
      case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      case 'cancelled': return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
    }
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

      {/* Week Navigator */}
      <Card className="overflow-visible">
        <CardHeader className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap gap-y-2">
            <CardTitle className="text-base sm:text-lg">Week of {fmtWeekOf(selectedWeek)}</CardTitle>
            <div className="inline-flex rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setSelectedWeek(addDaysLocal(selectedWeek, -7));
                }}
                className="px-3 sm:px-4 h-9 sm:h-10 text-sm font-medium bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600 active:translate-y-[0.5px] border-0 border-r border-slate-200 dark:border-slate-700 rounded-l-xl text-slate-700 dark:text-slate-300"
                aria-label="Go to previous week"
              >
                Previous Week
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedWeek(addDaysLocal(selectedWeek, 7));
                }}
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
              const dayJobs = (jobs as any[])?.filter((job: any) => {
                if (!job.startDate) return false;
                const jobDate = parseYmdLocal(job.startDate);
                return dateToYmdLocal(jobDate) === dateStr;
              }) || [];
              
              return (
                <div 
                  key={dateStr} 
                  className={`min-h-[120px] border rounded-lg p-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                    selectedDay === dateStr ? 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950' : ''
                  }`}
                  onClick={() => setSelectedDay(dateStr)}
                >
                  <div className="flex flex-col items-center h-full">
                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                      {fmtDowShort(date)}
                    </div>
                    <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3">
                      {fmtDayNumber(date)}
                    </div>
                    
                    <div className="flex-1 flex items-center justify-center">
                      {dayJobs.length > 0 && (
                        <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Schedule Statistics */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Weekly Jobs</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {weekDates.reduce((total, date) => {
                const dateStr = dateToYmdLocal(date);
                const dayJobs = Array.isArray(jobs) ? jobs.filter((job: any) => {
                  if (!job.startDate) return false;
                  const jobDate = parseYmdLocal(job.startDate);
                  return dateToYmdLocal(jobDate) === dateStr;
                }) : [];
                return total + dayJobs.length;
              }, 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Jobs scheduled this week
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Planning Jobs</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Array.isArray(jobs) ? jobs.filter((job: any) => job.status === 'planning').length : 0}
            </div>
            <p className="text-xs text-muted-foreground">In planning phase</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
            <Brain className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Array.isArray(jobs) ? jobs.filter((job: any) => job.status === 'in_progress' || job.status === 'active').length : 0}
            </div>
            <p className="text-xs text-muted-foreground">Currently in progress</p>
          </CardContent>
        </Card>
      </div>

      {/* Day Details Modal */}
      <Dialog open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              All Planned Jobs
            </DialogTitle>
          </DialogHeader>
          
          <div className="mt-4">
            {(() => {
              // Filter schedule items based on selected day
              let filteredItems = Array.isArray(scheduledItems) ? scheduledItems : [];
              
              // If a specific day is selected, filter to only show jobs for that day
              if (selectedDay && filteredItems.length > 0) {
                const selectedDayStart = new Date(selectedDay);
                selectedDayStart.setHours(0, 0, 0, 0);
                const selectedDayEnd = new Date(selectedDay);
                selectedDayEnd.setHours(23, 59, 59, 999);
                
                filteredItems = filteredItems.filter((item: any) => {
                  const itemStart = new Date(item.startDateTime);
                  const itemEnd = new Date(item.endDateTime);
                  // Overlap check: item overlaps with selected day
                  return itemStart < selectedDayEnd && itemEnd > selectedDayStart;
                });
              }

              if (filteredItems.length === 0) {
                return (
                  <div className="text-center py-12">
                    <Calendar className="h-16 w-16 text-slate-400 mx-auto mb-4" />
                    <h3 className="text-xl font-medium text-slate-900 dark:text-slate-100 mb-2">
                      No jobs scheduled
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                      No jobs are scheduled for this time period.
                    </p>
                  </div>
                );
              }

              // Group schedule items by job status for better organization
              const jobsByStatus = {
                planning: filteredItems.filter((item: any) => item.jobStatus === 'planning'),
                active: filteredItems.filter((item: any) => item.jobStatus === 'active' || item.status === 'in-progress'),
                completed: filteredItems.filter((item: any) => item.jobStatus === 'completed'),
                other: filteredItems.filter((item: any) => !['planning', 'active', 'in_progress', 'completed'].includes(item.jobStatus || item.status))
              };

              return (
                <div className="space-y-8">
                  {/* Planning Jobs */}
                  {jobsByStatus.planning.length > 0 && (
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-3">
                        <Brain className="h-6 w-6 text-orange-500" />
                        Planning Phase ({jobsByStatus.planning.length})
                      </h3>
                      <div className="grid gap-4">
                        {jobsByStatus.planning.map((item: any) => (
                          <div
                            key={item.id}
                            className="p-6 border rounded-lg hover:shadow-lg transition-shadow bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                  {item.jobTitle}
                                </h4>
                                {item.subcontractorName && (
                                  <p className="text-slate-600 dark:text-slate-400 mt-1">
                                    Assigned to: {item.subcontractorName}
                                  </p>
                                )}
                              </div>
                              <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-sm">
                                {item.jobStatus || item.status}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">{item.location || item.jobAddress || 'No location specified'}</span>
                              </div>
                              
                              <div className="flex items-center gap-2">
                                <Calendar className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">
                                  {formatInLocalTimezone(item.startDateTime, 'MMM d, yyyy h:mm a')}
                                </span>
                              </div>
                              
                              {item.clientName && (
                                <div className="flex items-center gap-2">
                                  <User className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">{item.clientName}</span>
                                </div>
                              )}
                            </div>

                            {item.notes && (
                              <div className="mt-4 p-3 bg-orange-100 dark:bg-orange-900 rounded">
                                <strong className="text-sm">Notes:</strong> 
                                <span className="text-sm ml-2">{item.notes}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Active Jobs */}
                  {jobsByStatus.active.length > 0 && (
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-3">
                        <Zap className="h-6 w-6 text-green-500" />
                        Active Jobs ({jobsByStatus.active.length})
                      </h3>
                      <div className="grid gap-4">
                        {jobsByStatus.active.map((item: any) => (
                          <div
                            key={item.id}
                            className="p-6 border rounded-lg hover:shadow-lg transition-shadow bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                  {item.jobTitle}
                                </h4>
                                {item.subcontractorName && (
                                  <p className="text-slate-600 dark:text-slate-400 mt-1">
                                    Assigned to: {item.subcontractorName}
                                  </p>
                                )}
                              </div>
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-sm">
                                {item.jobStatus || item.status}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">{item.location || item.jobAddress || 'No location specified'}</span>
                              </div>
                              
                              <div className="flex items-center gap-2">
                                <Calendar className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">
                                  {formatInLocalTimezone(item.startDateTime, 'MMM d, yyyy h:mm a')}
                                </span>
                              </div>
                              
                              {item.clientName && (
                                <div className="flex items-center gap-2">
                                  <User className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">{item.clientName}</span>
                                </div>
                              )}
                            </div>

                            {item.notes && (
                              <div className="mt-4 p-3 bg-green-100 dark:bg-green-900 rounded">
                                <strong className="text-sm">Notes:</strong> 
                                <span className="text-sm ml-2">{item.notes}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Completed Jobs */}
                  {jobsByStatus.completed.length > 0 && (
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-3">
                        <TrendingUp className="h-6 w-6 text-blue-500" />
                        Completed Jobs ({jobsByStatus.completed.length})
                      </h3>
                      <div className="grid gap-4">
                        {jobsByStatus.completed.map((item: any) => (
                          <div
                            key={item.id}
                            className="p-6 border rounded-lg hover:shadow-lg transition-shadow bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                  {item.jobTitle}
                                </h4>
                                {item.subcontractorName && (
                                  <p className="text-slate-600 dark:text-slate-400 mt-1">
                                    Assigned to: {item.subcontractorName}
                                  </p>
                                )}
                              </div>
                              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-sm">
                                {item.jobStatus || item.status}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">{item.location || item.jobAddress || 'No location specified'}</span>
                              </div>
                              
                              <div className="flex items-center gap-2">
                                <Calendar className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">
                                  Completed: {formatInLocalTimezone(item.endDateTime, 'MMM d, yyyy')}
                                </span>
                              </div>
                              
                              {item.clientName && (
                                <div className="flex items-center gap-2">
                                  <User className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">{item.clientName}</span>
                                </div>
                              )}
                            </div>

                            {item.notes && (
                              <div className="mt-4 p-3 bg-blue-100 dark:bg-blue-900 rounded">
                                <strong className="text-sm">Notes:</strong> 
                                <span className="text-sm ml-2">{item.notes}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Other Status Jobs */}
                  {jobsByStatus.other.length > 0 && (
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-3">
                        <AlertTriangle className="h-6 w-6 text-slate-500" />
                        Other Jobs ({jobsByStatus.other.length})
                      </h3>
                      <div className="grid gap-4">
                        {jobsByStatus.other.map((item: any) => (
                          <div
                            key={item.id}
                            className="p-6 border rounded-lg hover:shadow-lg transition-shadow bg-slate-50 dark:bg-slate-800"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                  {item.jobTitle}
                                </h4>
                                {item.subcontractorName && (
                                  <p className="text-slate-600 dark:text-slate-400 mt-1">
                                    Assigned to: {item.subcontractorName}
                                  </p>
                                )}
                              </div>
                              <Badge className={getStatusColor(item.jobStatus || item.status)}>
                                {item.jobStatus || item.status}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">{item.location || item.jobAddress || 'No location specified'}</span>
                              </div>
                              
                              <div className="flex items-center gap-2">
                                <Calendar className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">
                                  {formatInLocalTimezone(item.startDateTime, 'MMM d, yyyy h:mm a')}
                                </span>
                              </div>
                              
                              {item.clientName && (
                                <div className="flex items-center gap-2">
                                  <User className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">{item.clientName}</span>
                                </div>
                              )}
                            </div>

                            {item.notes && (
                              <div className="mt-4 p-3 bg-slate-100 dark:bg-slate-700 rounded">
                                <strong className="text-sm">Notes:</strong> 
                                <span className="text-sm ml-2">{item.notes}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}