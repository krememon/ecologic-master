import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { 
  Calendar, 
  ChevronDown, 
  ChevronLeft, 
  ChevronRight, 
  MapPin, 
  SlidersHorizontal,
  List,
  Map
} from "lucide-react";
import { startOfWeekLocal, addDaysLocal, dateToYmdLocal, parseYmdLocal } from "@/utils/scheduleDate";
import { useLocation } from "wouter";
import { useCan } from "@/hooks/useCan";
import { ViewOptionsModal, ExtendedViewMode } from "@/components/ViewOptionsModal";

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

interface Employee {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  profileImageUrl: string | null;
  role: string;
}

const HOUR_HEIGHT = 60;
const START_HOUR = 6;
const END_HOUR = 20;

export default function AIScheduling() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { role } = useCan();
  const [, setLocation] = useLocation();
  
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [viewMode, setViewMode] = useState<ExtendedViewMode>('day');
  const [isViewOptionsOpen, setIsViewOptionsOpen] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [showUnscheduledOnMap, setShowUnscheduledOnMap] = useState(true);
  const [showWeekendsOnWeek, setShowWeekendsOnWeek] = useState(true);
  const [memberFilterInitialized, setMemberFilterInitialized] = useState(false);

  const selectedWeek = useMemo(() => startOfWeekLocal(selectedDate, 0), [selectedDate]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysLocal(selectedWeek, i)), [selectedWeek]);
  const selectedDayStr = dateToYmdLocal(selectedDate);

  const { data: rawJobs = [] } = useQuery<JobWithSchedule[]>({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/company/members"],
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
    }
  }, [isAuthenticated, isLoading, toast]);

  useEffect(() => {
    if (!memberFilterInitialized && employees.length > 0) {
      if (role === 'TECHNICIAN' && user?.id) {
        setSelectedMemberIds([user.id]);
      } else {
        setSelectedMemberIds(employees.map(e => e.id));
      }
      setMemberFilterInitialized(true);
    }
  }, [employees, memberFilterInitialized, role, user?.id]);

  const teamMembersForModal = useMemo(() => {
    return employees.map(emp => ({
      id: emp.id,
      name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.email,
      profileImageUrl: emp.profileImageUrl
    }));
  }, [employees]);

  const dailyJobs = useMemo(() => {
    if (!Array.isArray(jobs)) return [];
    
    return jobs.filter((job) => {
      if (!job.startDate) return false;
      const jobDate = parseYmdLocal(job.startDate);
      if (dateToYmdLocal(jobDate) !== selectedDayStr) return false;
      
      if (selectedMemberIds.length === 0) return false;
      
      const crew = job.crewAssignments || [];
      const assignedIds = job.assignedEmployeeIds || [];
      const allAssigned = Array.from(new Set([
        ...crew.map(c => c.userId),
        ...assignedIds
      ]));
      
      if (allAssigned.length === 0) {
        return true;
      }
      
      return allAssigned.some(id => selectedMemberIds.includes(id));
    }).sort((a, b) => {
      const timeA = a.scheduledTime || '99:99';
      const timeB = b.scheduledTime || '99:99';
      return timeA.localeCompare(timeB);
    });
  }, [jobs, selectedDayStr, selectedMemberIds]);

  const jobsByEmployee = useMemo(() => {
    const grouped: Record<string, { employee: { id: string; name: string; profileImageUrl: string | null } | null; jobs: JobWithSchedule[] }> = {};
    
    grouped['unassigned'] = { employee: null, jobs: [] };
    
    if (role === 'TECHNICIAN' && user?.id) {
      const currentUser = employees.find(e => e.id === user.id);
      if (currentUser) {
        const name = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email;
        grouped[user.id] = { 
          employee: { id: user.id, name, profileImageUrl: currentUser.profileImageUrl },
          jobs: [] 
        };
      }
      
      dailyJobs.forEach(job => {
        const crew = job.crewAssignments || [];
        if (crew.length === 0) {
          grouped['unassigned'].jobs.push(job);
        } else {
          if (grouped[user.id]) {
            grouped[user.id].jobs.push(job);
          }
        }
      });
      
      return Object.entries(grouped)
        .filter(([_, data]) => data.jobs.length > 0)
        .sort((a, b) => {
          if (a[0] === 'unassigned') return 1;
          if (b[0] === 'unassigned') return -1;
          return 0;
        });
    }
    
    const selectedSet = new Set(selectedMemberIds);
    employees.filter(emp => selectedSet.has(emp.id)).forEach(emp => {
      const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.email;
      grouped[emp.id] = { 
        employee: { id: emp.id, name, profileImageUrl: emp.profileImageUrl },
        jobs: [] 
      };
    });

    dailyJobs.forEach(job => {
      const crew = job.crewAssignments || [];
      if (crew.length === 0) {
        grouped['unassigned'].jobs.push(job);
      } else {
        crew.forEach(assignment => {
          if (selectedSet.has(assignment.userId)) {
            if (grouped[assignment.userId]) {
              grouped[assignment.userId].jobs.push(job);
            } else {
              const name = `${assignment.user.firstName || ''} ${assignment.user.lastName || ''}`.trim() || assignment.user.email;
              grouped[assignment.userId] = {
                employee: { id: assignment.userId, name, profileImageUrl: assignment.user.profileImageUrl },
                jobs: [job]
              };
            }
          }
        });
      }
    });

    return Object.entries(grouped)
      .filter(([key, data]) => {
        if (key === 'unassigned') return data.jobs.length > 0;
        return selectedSet.has(key);
      })
      .sort((a, b) => {
        if (a[0] === 'unassigned') return 1;
        if (b[0] === 'unassigned') return -1;
        return (a[1].employee?.name || '').localeCompare(b[1].employee?.name || '');
      });
  }, [dailyJobs, employees, role, user?.id, selectedMemberIds]);

  const navigateMonth = (direction: number) => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() + direction);
    setSelectedDate(newDate);
  };

  const navigateWeek = (direction: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + (direction * 7));
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  const handleApplyViewOptions = (options: {
    view: ExtendedViewMode;
    selectedMembers: string[];
    showUnscheduledOnMap: boolean;
    showWeekendsOnWeek: boolean;
  }) => {
    setViewMode(options.view);
    setSelectedMemberIds(options.selectedMembers);
    setShowUnscheduledOnMap(options.showUnscheduledOnMap);
    setShowWeekendsOnWeek(options.showWeekendsOnWeek);
  };

  const formatTime = (time: string | null) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const getTimePosition = (time: string | null) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    if (hours < START_HOUR || hours >= END_HOUR) return null;
    return ((hours - START_HOUR) * HOUR_HEIGHT) + ((minutes / 60) * HOUR_HEIGHT);
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pending': return 'bg-yellow-500';
      case 'active': case 'in_progress': return 'bg-blue-500';
      case 'completed': return 'bg-green-500';
      case 'cancelled': return 'bg-red-500';
      default: return 'bg-slate-400';
    }
  };

  const monthName = selectedDate.toLocaleDateString('en-US', { month: 'long' });
  const year = selectedDate.getFullYear();
  const dayOfWeekShort = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen h-screen bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateMonth(-1)}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
          >
            <ChevronLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 text-lg font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1 rounded-lg transition-colors">
                {monthName} {year}
                <ChevronDown className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {Array.from({ length: 12 }, (_, i) => {
                const d = new Date(year, i, 1);
                return (
                  <DropdownMenuItem 
                    key={i} 
                    onClick={() => {
                      const newDate = new Date(selectedDate);
                      newDate.setMonth(i);
                      setSelectedDate(newDate);
                    }}
                  >
                    {d.toLocaleDateString('en-US', { month: 'long' })}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={() => navigateMonth(1)}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
          >
            <ChevronRight className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={goToToday}
            className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 rounded-lg transition-colors"
          >
            Today
          </button>
          <button 
            onClick={() => setIsViewOptionsOpen(true)}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
          >
            <SlidersHorizontal className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </button>
        </div>
      </div>

      <div className="flex justify-center px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 p-1">
          <button
            onClick={() => setViewMode('day')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              viewMode === 'day'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Day
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              viewMode === 'list'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            List
          </button>
          <button
            onClick={() => setViewMode('map')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              viewMode === 'map'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Map
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-2 py-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => navigateWeek(-1)}
          className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
        >
          <ChevronLeft className="h-4 w-4 text-slate-500" />
        </button>
        
        <div className="flex gap-1">
          {weekDates.map((date, idx) => {
            const dateStr = dateToYmdLocal(date);
            const isSelected = dateStr === selectedDayStr;
            const isToday = dateStr === dateToYmdLocal(new Date());
            const dayNum = date.getDate();
            
            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(date)}
                className="flex flex-col items-center w-10 py-1"
              >
                <span className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                  {dayOfWeekShort[idx]}
                </span>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                  isSelected
                    ? 'bg-blue-600 text-white'
                    : isToday
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}>
                  {dayNum}
                </div>
              </button>
            );
          })}
        </div>
        
        <button
          onClick={() => navigateWeek(1)}
          className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
        >
          <ChevronRight className="h-4 w-4 text-slate-500" />
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-white dark:bg-slate-900">
        {viewMode === 'day' && (
          <div className="min-h-full">
            {jobsByEmployee.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-slate-500 dark:text-slate-400">
                <Calendar className="h-16 w-16 mb-4 opacity-30" />
                <p className="text-lg font-medium">No jobs scheduled</p>
                <p className="text-sm">for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {jobsByEmployee.map(([employeeId, data]) => (
                  <div key={employeeId} className="relative">
                    <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                      {data.employee ? (
                        <>
                          {data.employee.profileImageUrl ? (
                            <img
                              src={data.employee.profileImageUrl}
                              alt={data.employee.name}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
                              {data.employee.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {data.employee.name}
                          </span>
                        </>
                      ) : (
                        <>
                          <div className="h-8 w-8 rounded-full bg-slate-400 flex items-center justify-center text-white text-sm font-medium">
                            ?
                          </div>
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            Unassigned
                          </span>
                        </>
                      )}
                      <Badge className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs">
                        {data.jobs.length}
                      </Badge>
                    </div>

                    <div className="relative" style={{ height: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT}px` }}>
                      <div className="absolute inset-0 pointer-events-none">
                        {hours.map((hour) => (
                          <div
                            key={hour}
                            className="absolute left-0 right-0 border-t border-slate-100 dark:border-slate-800 flex"
                            style={{ top: `${(hour - START_HOUR) * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                          >
                            <div className="w-14 flex-shrink-0 pr-2 text-right">
                              <span className="text-xs text-slate-400">
                                {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="absolute left-14 right-0 top-0 bottom-0">
                        {data.jobs.map((job) => {
                          const position = getTimePosition(job.scheduledTime);
                          
                          return (
                            <div
                              key={job.id}
                              onClick={() => setLocation(`/jobs/${job.id}`)}
                              className={`absolute left-2 right-2 px-3 py-2 rounded-lg cursor-pointer transition-all hover:shadow-md ${getStatusColor(job.status)} bg-opacity-20 dark:bg-opacity-30 border-l-4 ${getStatusColor(job.status).replace('bg-', 'border-')}`}
                              style={{ 
                                top: position !== null ? `${position}px` : '0px',
                                minHeight: '50px'
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-medium text-slate-900 dark:text-slate-100 text-sm truncate">
                                    {job.clientName || job.client?.name || job.title}
                                  </p>
                                  {job.scheduledTime && (
                                    <p className="text-xs text-slate-600 dark:text-slate-400">
                                      {formatTime(job.scheduledTime)}
                                    </p>
                                  )}
                                  {(job.location || job.city) && (
                                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1 mt-0.5">
                                      <MapPin className="h-3 w-3" />
                                      {job.location || job.city}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {viewMode === 'list' && (
          <div className="p-4 space-y-3 min-h-full">
            {dailyJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-slate-500 dark:text-slate-400">
                <List className="h-16 w-16 mb-4 opacity-30" />
                <p className="text-lg font-medium">No jobs scheduled</p>
                <p className="text-sm">for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
              </div>
            ) : (
              dailyJobs.map((job) => (
                <div
                  key={job.id}
                  onClick={() => setLocation(`/jobs/${job.id}`)}
                  className="flex items-center gap-4 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-750 transition-all"
                >
                  <div className="flex-shrink-0 w-16">
                    {job.scheduledTime ? (
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {formatTime(job.scheduledTime)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">No time</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {job.clientName || job.client?.name || job.title}
                    </p>
                    {(job.location || job.city) && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 truncate flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {job.location || job.city}
                      </p>
                    )}
                  </div>
                  <Badge className={`capitalize text-xs ${
                    job.status === 'completed' ? 'bg-green-100 text-green-800' :
                    job.status === 'active' || job.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {job.status?.replace('_', ' ') || 'pending'}
                  </Badge>
                </div>
              ))
            )}
          </div>
        )}

        {viewMode === '3day' && (
          <div className="flex flex-col items-center justify-center min-h-full text-slate-500 dark:text-slate-400">
            <Calendar className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">3 Day View</p>
            <p className="text-sm">Coming soon</p>
          </div>
        )}

        {viewMode === 'week' && (
          <div className="flex flex-col items-center justify-center min-h-full text-slate-500 dark:text-slate-400">
            <Calendar className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">Week View</p>
            <p className="text-sm">Coming soon</p>
          </div>
        )}

        {viewMode === 'map' && (
          <div className="flex flex-col items-center justify-center min-h-full text-slate-500 dark:text-slate-400">
            <Map className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">Map View</p>
            <p className="text-sm">Coming soon</p>
          </div>
        )}
      </div>

      <ViewOptionsModal
        isOpen={isViewOptionsOpen}
        onClose={() => setIsViewOptionsOpen(false)}
        currentView={viewMode}
        selectedMembers={selectedMemberIds}
        showUnscheduledOnMap={showUnscheduledOnMap}
        showWeekendsOnWeek={showWeekendsOnWeek}
        teamMembers={teamMembersForModal}
        onApply={handleApplyViewOptions}
        isTechnician={role === 'TECHNICIAN'}
        currentUserId={user?.id}
      />
    </div>
  );
}
