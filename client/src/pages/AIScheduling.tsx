import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Calendar as CalendarIcon, 
  ChevronDown, 
  ChevronLeft, 
  ChevronRight, 
  MapPin, 
  SlidersHorizontal,
  List,
  Map,
  Pencil,
  Trash2,
  Clock,
  Eye,
} from "lucide-react";
import { startOfWeekLocal, addDaysLocal, dateToYmdLocal, parseYmdLocal } from "@/utils/scheduleDate";
import { useLocation } from "wouter";
import { useCan } from "@/hooks/useCan";
import { ViewOptionsModal, ExtendedViewMode } from "@/components/ViewOptionsModal";
import { ScheduleMapView } from "@/components/ScheduleMapView";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { TimeWheelPicker } from "@/components/TimeWheelPicker";
import type { ScheduleEvent } from "@shared/schema";

interface JobWithSchedule {
  id: number;
  title: string;
  status: string;
  startDate: string | null;
  scheduledTime: string | null;
  scheduledEndTime?: string | null;
  location: string | null;
  city: string | null;
  postalCode?: string | null;
  locationLat?: string | null;
  locationLng?: string | null;
  clientName: string | null;
  customerId: number | null;
  customer?: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
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

interface EstimateWithSchedule {
  id: number;
  title: string;
  status: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  scheduledEndTime?: string | null;
  customerName: string | null;
  jobAddressLine1: string | null;
  jobCity: string | null;
  jobState: string | null;
  jobZip?: string | null;
  customerId?: number | null;
  customerLatitude?: number | null;
  customerLongitude?: number | null;
  assignedEmployeeIds?: string[];
}

interface ScheduleItem {
  type: 'job' | 'estimate' | 'event';
  id: number;
  title: string;
  customerName: string | null;
  scheduledTime: string | null;
  scheduledEndTime: string | null;
  address: string | null;
  status: string;
  jobType?: string | null;
  customerId?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  eventColor?: string | null;
  eventDescription?: string | null;
  eventAllDay?: boolean;
  eventVisibility?: string;
}

const EVENT_COLORS = [
  { value: '#2563EB', label: 'Blue' },
  { value: '#16A34A', label: 'Green' },
  { value: '#DC2626', label: 'Red' },
  { value: '#9333EA', label: 'Purple' },
  { value: '#EA580C', label: 'Orange' },
  { value: '#0D9488', label: 'Teal' },
];

const VISIBILITY_OPTIONS = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'office_only', label: 'Office Only' },
  { value: 'owner_only', label: 'Owner Only' },
];

interface EventFormState {
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  visibility: string;
  color: string;
}

interface Employee {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  profileImageUrl: string | null;
  role: string;
}

const HOUR_HEIGHT = 120;
const START_HOUR = 0;
const END_HOUR = 24;

function getInitialViewFromParams(): { view: ExtendedViewMode; date: Date } {
  if (typeof window === 'undefined') return { view: 'day', date: new Date() };
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  const dateParam = params.get('date');
  
  let view: ExtendedViewMode = 'day';
  if (viewParam === 'list' || viewParam === 'week' || viewParam === 'map') {
    view = viewParam;
  }
  
  let date = new Date();
  if (dateParam) {
    const parsed = new Date(dateParam + 'T12:00:00');
    if (!isNaN(parsed.getTime())) {
      date = parsed;
    }
  }
  
  return { view, date };
}

export default function AIScheduling() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { role } = useCan();
  const [, setLocation] = useLocation();
  
  const initialParams = useMemo(() => getInitialViewFromParams(), []);
  const [selectedDate, setSelectedDate] = useState<Date>(() => initialParams.date);
  const [viewMode, setViewMode] = useState<ExtendedViewMode>(initialParams.view);
  const [isViewOptionsOpen, setIsViewOptionsOpen] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [showUnscheduledOnMap, setShowUnscheduledOnMap] = useState(true);
  const [showWeekendsOnWeek, setShowWeekendsOnWeek] = useState(true);
  const [memberFilterInitialized, setMemberFilterInitialized] = useState(false);
  
  const timelineRef = useRef<HTMLDivElement>(null);

  const [isCreateEventOpen, setIsCreateEventOpen] = useState(false);
  const [isViewEventOpen, setIsViewEventOpen] = useState(false);
  const [isEditEventOpen, setIsEditEventOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null);
  const defaultEventForm: EventFormState = {
    title: '',
    description: '',
    date: dateToYmdLocal(selectedDate),
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    visibility: 'everyone',
    color: '#2563EB',
  };
  const [eventForm, setEventForm] = useState<EventFormState>(defaultEventForm);
  const [endTimeManuallySet, setEndTimeManuallySet] = useState(false);

  const bumpEndTime = (startTime: string): string => {
    const [h, m] = startTime.split(':').map(Number);
    const startMins = h * 60 + m;
    let endMins = startMins + 60;
    if (endMins >= 24 * 60) endMins = 23 * 60 + 45;
    if (endMins <= startMins) endMins = startMins + 15;
    if (endMins >= 24 * 60) endMins = 23 * 60 + 45;
    const eH = Math.floor(endMins / 60);
    const eM = endMins % 60;
    return `${eH.toString().padStart(2, '0')}:${eM.toString().padStart(2, '0')}`;
  };

  const handleEventStartTimeChange = (newStart: string) => {
    setEventForm(f => {
      const updated: EventFormState = { ...f, startTime: newStart };
      if (!endTimeManuallySet || f.endTime <= newStart) {
        updated.endTime = bumpEndTime(newStart);
      }
      return updated;
    });
  };

  const handleEventEndTimeChange = (newEnd: string) => {
    setEndTimeManuallySet(true);
    setEventForm(f => {
      if (newEnd <= f.startTime) {
        return { ...f, endTime: bumpEndTime(f.startTime) };
      }
      return { ...f, endTime: newEnd };
    });
  };

  const canManageEvents = role === 'OWNER' || role === 'SUPERVISOR' || role === 'DISPATCHER';

  const selectedWeek = useMemo(() => startOfWeekLocal(selectedDate, 0), [selectedDate]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysLocal(selectedWeek, i)), [selectedWeek]);
  const selectedDayStr = dateToYmdLocal(selectedDate);

  const weekStart = useMemo(() => `${dateToYmdLocal(weekDates[0])}T00:00:00`, [weekDates]);
  const weekEnd = useMemo(() => `${dateToYmdLocal(weekDates[6])}T23:59:59`, [weekDates]);

  const { data: rawJobs = [] } = useQuery<JobWithSchedule[]>({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
  });

  const { data: scheduleEventsRaw = [] } = useQuery<ScheduleEvent[]>({
    queryKey: ["/api/schedule-events", weekStart, weekEnd],
    queryFn: async () => {
      const res = await fetch(`/api/schedule-events?start=${weekStart}&end=${weekEnd}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch schedule events");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const createEventMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/schedule-events", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-events"] });
      setIsCreateEventOpen(false);
      toast({ title: "Event created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateEventMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/schedule-events/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-events"] });
      setIsEditEventOpen(false);
      setIsViewEventOpen(false);
      toast({ title: "Event updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/schedule-events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-events"] });
      setIsViewEventOpen(false);
      toast({ title: "Event deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/company/members"],
    enabled: isAuthenticated,
  });

  const { data: rawEstimates = [], isLoading: estimatesLoading } = useQuery<EstimateWithSchedule[]>({
    queryKey: ["/api/estimates"],
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
        window.location.href = "/login";
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

  useEffect(() => {
    if (viewMode === 'day' && timelineRef.current) {
      const now = new Date();
      const currentHour = now.getHours();
      const scrollToHour = Math.max(0, currentHour - 1);
      const scrollPosition = scrollToHour * HOUR_HEIGHT;
      timelineRef.current.scrollTop = scrollPosition;
    }
  }, [viewMode]);

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
      
      // Handle both string (YYYY-MM-DD) and Date object formats
      const rawDate = job.startDate;
      let jobDateStr: string;
      
      if (typeof rawDate === 'string') {
        // String like "2026-01-17" or ISO "2026-01-17T00:00:00.000Z"
        jobDateStr = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
      } else {
        // Date object - convert to local YYYY-MM-DD
        const dateObj = new Date(rawDate as any);
        jobDateStr = dateToYmdLocal(dateObj);
      }
      
      if (jobDateStr !== selectedDayStr) return false;
      
      // If member filter not initialized yet, show all jobs for the day
      if (!memberFilterInitialized) return true;
      
      if (selectedMemberIds.length === 0) return false;
      
      const crew = job.crewAssignments || [];
      const assignedIds = job.assignedEmployeeIds || [];
      const allAssigned = Array.from(new Set([
        ...crew.map(c => c.userId),
        ...assignedIds
      ]));
      
      // Unassigned jobs show for all selected members
      if (allAssigned.length === 0) return true;
      
      return allAssigned.some(id => selectedMemberIds.includes(id));
    }).sort((a, b) => {
      const timeA = a.scheduledTime || '99:99';
      const timeB = b.scheduledTime || '99:99';
      return timeA.localeCompare(timeB);
    });
  }, [jobs, selectedDayStr, selectedMemberIds, memberFilterInitialized]);

  const estimates = useMemo(() => {
    if (!Array.isArray(rawEstimates)) return [];
    
    // Filter out approved estimates that have been converted to jobs
    // (those should show as Jobs, not Estimates)
    let filtered = rawEstimates.filter((estimate: any) => {
      // If estimate is approved and has convertedJobId, it's now a Job
      if (estimate.status === 'approved' && estimate.convertedJobId) {
        return false;
      }
      return true;
    });
    
    if (role === 'TECHNICIAN' && user?.id) {
      filtered = filtered.filter((estimate) => {
        const assignedIds = (estimate.assignedEmployeeIds as string[]) || [];
        if (assignedIds.length === 0) return true;
        return assignedIds.includes(user.id);
      });
    }
    
    return filtered;
  }, [rawEstimates, role, user?.id]);

  const dailyEstimates = useMemo(() => {
    if (!Array.isArray(estimates)) return [];
    
    return estimates.filter((estimate) => {
      if (!estimate.scheduledDate) return false;
      
      // Extract date-only string from scheduledDate (handles both ISO strings and Date objects)
      const rawDate = estimate.scheduledDate;
      let estDateStr: string;
      
      if (typeof rawDate === 'string') {
        // ISO string like "2026-01-17T14:00:00.000Z" - extract date part before 'T'
        estDateStr = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
      } else {
        // Date object - convert to local YYYY-MM-DD
        const estDate = new Date(rawDate as any);
        estDateStr = dateToYmdLocal(estDate);
      }
      
      // Date must match selected day
      if (estDateStr !== selectedDayStr) return false;
      
      // If member filter not initialized yet (employees still loading), show all estimates for the day
      if (!memberFilterInitialized) return true;
      
      // If no members selected, hide the estimate
      if (selectedMemberIds.length === 0) return false;
      
      const assignedIds = (estimate.assignedEmployeeIds as string[]) || [];
      
      // If no employees assigned to estimate, show it (unassigned estimates visible to all)
      if (assignedIds.length === 0) return true;
      
      // Otherwise, check if any assigned employee is in the selected filter
      return assignedIds.some(id => selectedMemberIds.includes(id));
    }).sort((a, b) => {
      const timeA = a.scheduledTime || '99:99';
      const timeB = b.scheduledTime || '99:99';
      return timeA.localeCompare(timeB);
    });
  }, [estimates, selectedDayStr, selectedMemberIds, memberFilterInitialized]);

  const dailyEvents = useMemo(() => {
    return scheduleEventsRaw.filter((evt) => {
      if (!evt.startAt) return false;
      const evtDate = new Date(evt.startAt);
      const evtDateStr = dateToYmdLocal(evtDate);
      return evtDateStr === selectedDayStr;
    });
  }, [scheduleEventsRaw, selectedDayStr]);

  const allDayEvents = useMemo(() => dailyEvents.filter(e => e.allDay), [dailyEvents]);
  const timedEvents = useMemo(() => dailyEvents.filter(e => !e.allDay), [dailyEvents]);

  const scheduleItems = useMemo((): ScheduleItem[] => {
    const items: ScheduleItem[] = [];
    
    dailyJobs.forEach(job => {
      // Priority 1: Job's own location fields
      const addressParts = [job.location, job.city, job.postalCode].filter(Boolean);
      let fullAddress = addressParts.length > 0 ? addressParts.join(', ') : null;
      
      // Priority 2: Customer's structured address fields (address + city + state + zip)
      if (!fullAddress && job.customer?.address) {
        const cust = job.customer as { address: string | null; city?: string | null; state?: string | null; zip?: string | null };
        const customerParts = [
          cust.address,
          cust.city,
          cust.state,
          cust.zip
        ].filter(Boolean);
        fullAddress = customerParts.length > 0 ? customerParts.join(', ') : null;
      }
      
      let lat: number | null = null;
      let lng: number | null = null;
      if (job.locationLat && job.locationLng) {
        lat = parseFloat(job.locationLat);
        lng = parseFloat(job.locationLng);
      } else if (job.customer?.latitude && job.customer?.longitude) {
        lat = job.customer.latitude;
        lng = job.customer.longitude;
      }
      
      items.push({
        type: 'job',
        id: job.id,
        title: job.title,
        customerName: job.clientName || job.client?.name || null,
        scheduledTime: job.scheduledTime,
        scheduledEndTime: job.scheduledEndTime || null,
        address: fullAddress,
        status: job.status,
        jobType: (job as any).jobType || null,
        customerId: job.customerId,
        latitude: lat,
        longitude: lng
      });
    });
    
    dailyEstimates.forEach(estimate => {
      const addressParts = [
        estimate.jobAddressLine1,
        estimate.jobCity,
        estimate.jobState,
        estimate.jobZip
      ].filter(Boolean);
      const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : null;
      
      items.push({
        type: 'estimate',
        id: estimate.id,
        title: estimate.title,
        customerName: estimate.customerName,
        scheduledTime: estimate.scheduledTime,
        scheduledEndTime: estimate.scheduledEndTime || null,
        address: fullAddress,
        status: estimate.status,
        customerId: estimate.customerId,
        latitude: estimate.customerLatitude || null,
        longitude: estimate.customerLongitude || null
      });
    });

    timedEvents.forEach(evt => {
      const startDate = new Date(evt.startAt);
      const startHH = startDate.getHours().toString().padStart(2, '0');
      const startMM = startDate.getMinutes().toString().padStart(2, '0');
      let endHH: string | null = null;
      let endMM: string | null = null;
      if (evt.endAt) {
        const endDate = new Date(evt.endAt);
        endHH = endDate.getHours().toString().padStart(2, '0');
        endMM = endDate.getMinutes().toString().padStart(2, '0');
      }

      items.push({
        type: 'event',
        id: evt.id,
        title: evt.title,
        customerName: null,
        scheduledTime: `${startHH}:${startMM}`,
        scheduledEndTime: endHH && endMM ? `${endHH}:${endMM}` : null,
        address: null,
        status: 'event',
        eventColor: evt.color,
        eventDescription: evt.description,
        eventAllDay: evt.allDay,
        eventVisibility: evt.visibility,
      });
    });
    
    return items.sort((a, b) => {
      const timeA = a.scheduledTime || '99:99';
      const timeB = b.scheduledTime || '99:99';
      return timeA.localeCompare(timeB);
    });
  }, [dailyJobs, dailyEstimates, timedEvents]);

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

  const openCreateEvent = useCallback(() => {
    const now = new Date();
    let startMinutes = now.getHours() * 60 + now.getMinutes();
    startMinutes = Math.ceil(startMinutes / 30) * 30;
    if (startMinutes >= 24 * 60) startMinutes = 9 * 60;
    const endMinutes = startMinutes + 60;
    const startHH = Math.floor(startMinutes / 60).toString().padStart(2, '0');
    const startMM = (startMinutes % 60).toString().padStart(2, '0');
    const endHH = Math.floor(endMinutes / 60).toString().padStart(2, '0');
    const endMM = (endMinutes % 60).toString().padStart(2, '0');
    setEventForm({
      ...defaultEventForm,
      date: dateToYmdLocal(selectedDate),
      startTime: `${startHH}:${startMM}`,
      endTime: `${endHH}:${endMM}`,
    });
    setEndTimeManuallySet(false);
    setIsCreateEventOpen(true);
  }, [selectedDate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('createEvent') === 'true' && canManageEvents) {
      openCreateEvent();
      const url = new URL(window.location.href);
      url.searchParams.delete('createEvent');
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
    }

    const handleOpenCreateEvent = () => {
      if (canManageEvents) openCreateEvent();
    };
    window.addEventListener('openCreateEvent', handleOpenCreateEvent);
    return () => window.removeEventListener('openCreateEvent', handleOpenCreateEvent);
  }, [canManageEvents, openCreateEvent]);

  const openViewEvent = useCallback((evt: ScheduleEvent) => {
    setSelectedEvent(evt);
    setIsViewEventOpen(true);
  }, []);

  const openEditEvent = useCallback((evt: ScheduleEvent) => {
    const start = new Date(evt.startAt);
    const dateStr = dateToYmdLocal(start);
    const startTime = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
    let endTime = '';
    if (evt.endAt) {
      const end = new Date(evt.endAt);
      endTime = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
    }
    setEventForm({
      title: evt.title,
      description: evt.description || '',
      date: dateStr,
      startTime,
      endTime,
      allDay: evt.allDay,
      visibility: evt.visibility,
      color: evt.color || '#2563EB',
    });
    setSelectedEvent(evt);
    setIsViewEventOpen(false);
    setEndTimeManuallySet(true);
    setIsEditEventOpen(true);
  }, []);

  const handleSaveEvent = useCallback(() => {
    if (!eventForm.title.trim()) return;
    const startAtStr = eventForm.allDay
      ? `${eventForm.date}T00:00:00`
      : `${eventForm.date}T${eventForm.startTime}:00`;
    let endAtStr: string | null = null;
    if (!eventForm.allDay && eventForm.endTime) {
      endAtStr = `${eventForm.date}T${eventForm.endTime}:00`;
    } else if (eventForm.allDay) {
      endAtStr = `${eventForm.date}T23:59:59`;
    }
    const payload: Record<string, unknown> = {
      title: eventForm.title.trim().slice(0, 80),
      description: eventForm.description.trim() || null,
      startAt: startAtStr,
      endAt: endAtStr,
      allDay: eventForm.allDay,
      visibility: eventForm.visibility,
      color: eventForm.color,
    };
    createEventMutation.mutate(payload);
  }, [eventForm, createEventMutation]);

  const handleUpdateEvent = useCallback(() => {
    if (!selectedEvent || !eventForm.title.trim()) return;
    const startAtStr = eventForm.allDay
      ? `${eventForm.date}T00:00:00`
      : `${eventForm.date}T${eventForm.startTime}:00`;
    let endAtStr: string | null = null;
    if (!eventForm.allDay && eventForm.endTime) {
      endAtStr = `${eventForm.date}T${eventForm.endTime}:00`;
    } else if (eventForm.allDay) {
      endAtStr = `${eventForm.date}T23:59:59`;
    }
    const payload: Record<string, unknown> = {
      title: eventForm.title.trim().slice(0, 80),
      description: eventForm.description.trim() || null,
      startAt: startAtStr,
      endAt: endAtStr,
      allDay: eventForm.allDay,
      visibility: eventForm.visibility,
      color: eventForm.color,
    };
    updateEventMutation.mutate({ id: selectedEvent.id, data: payload });
  }, [selectedEvent, eventForm, updateEventMutation]);

  const handleDeleteEvent = useCallback(() => {
    if (!selectedEvent) return;
    deleteEventMutation.mutate(selectedEvent.id);
  }, [selectedEvent, deleteEventMutation]);

  const handleEventClick = useCallback((item: ScheduleItem) => {
    const evt = scheduleEventsRaw.find(e => e.id === item.id);
    if (evt) openViewEvent(evt);
  }, [scheduleEventsRaw, openViewEvent]);

  const formatTime = (time: string | null) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const getTimePosition = (time: string | null) => {
    if (!time) return null;
    const parts = time.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1] || '0', 10);
    if (isNaN(hours) || hours < START_HOUR || hours >= END_HOUR) return null;
    // Calculate position: each hour is HOUR_HEIGHT pixels
    // Minutes are a fraction of HOUR_HEIGHT (e.g., 30 min = 0.5 * HOUR_HEIGHT)
    const totalMinutes = (hours - START_HOUR) * 60 + minutes;
    return (totalMinutes / 60) * HOUR_HEIGHT;
  };

  const getBlockHeight = (startTime: string | null, endTime: string | null) => {
    const MIN_HEIGHT = 40;
    const DEFAULT_HEIGHT = HOUR_HEIGHT;
    
    if (!startTime) return DEFAULT_HEIGHT;
    if (!endTime) return DEFAULT_HEIGHT;
    
    const parseTime = (t: string) => {
      const parts = t.split(':');
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1] || '0', 10);
      return h * 60 + m;
    };
    
    const startMinutes = parseTime(startTime);
    const endMinutes = parseTime(endTime);
    const durationMinutes = endMinutes - startMinutes;
    
    if (durationMinutes <= 0) return DEFAULT_HEIGHT;
    
    const heightPx = (durationMinutes / 60) * HOUR_HEIGHT;
    return Math.max(heightPx, MIN_HEIGHT);
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pending': return 'bg-yellow-500';
      case 'active': case 'in_progress': return 'bg-blue-600';
      case 'completed': return 'bg-green-500';
      case 'cancelled': return 'bg-red-500';
      default: return 'bg-slate-400';
    }
  };

  const parseTimeToMinutes = (time: string | null) => {
    if (!time) return null;
    const parts = time.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1] || '0', 10);
    return h * 60 + m;
  };

  const computeOverlapLayout = (items: ScheduleItem[]) => {
    const DEFAULT_DURATION = 60;
    
    const events = items.map((item) => {
      const startMins = parseTimeToMinutes(item.scheduledTime);
      if (startMins === null) return null;
      
      let endMins = parseTimeToMinutes(item.scheduledEndTime);
      if (endMins === null || endMins <= startMins) {
        endMins = startMins + DEFAULT_DURATION;
      }
      
      return {
        ...item,
        startMinutes: startMins,
        endMinutes: endMins,
        columnIndex: 0,
        columnCount: 1,
      };
    }).filter(Boolean) as (ScheduleItem & { startMinutes: number; endMinutes: number; columnIndex: number; columnCount: number })[];
    
    if (events.length === 0) return [];
    
    const overlaps = (a: { startMinutes: number; endMinutes: number }, b: { startMinutes: number; endMinutes: number }) => {
      return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
    };
    
    events.sort((a, b) => a.startMinutes - b.startMinutes || (b.endMinutes - b.startMinutes) - (a.endMinutes - a.startMinutes));
    
    const visited = new Set<number>();
    const clusters: (typeof events)[] = [];
    
    for (let i = 0; i < events.length; i++) {
      if (visited.has(i)) continue;
      
      const cluster: typeof events = [];
      const queue = [i];
      visited.add(i);
      
      while (queue.length > 0) {
        const idx = queue.shift()!;
        cluster.push(events[idx]);
        
        for (let j = 0; j < events.length; j++) {
          if (!visited.has(j) && overlaps(events[idx], events[j])) {
            visited.add(j);
            queue.push(j);
          }
        }
      }
      
      clusters.push(cluster);
    }
    
    for (const cluster of clusters) {
      cluster.sort((a, b) => a.startMinutes - b.startMinutes || (b.endMinutes - b.startMinutes) - (a.endMinutes - a.startMinutes));
      
      const columns: (typeof cluster[0])[][] = [];
      
      for (const event of cluster) {
        let placed = false;
        for (let col = 0; col < columns.length; col++) {
          const lastInCol = columns[col][columns[col].length - 1];
          if (!overlaps(lastInCol, event)) {
            columns[col].push(event);
            event.columnIndex = col;
            placed = true;
            break;
          }
        }
        if (!placed) {
          event.columnIndex = columns.length;
          columns.push([event]);
        }
      }
      
      const columnCount = columns.length;
      for (const event of cluster) {
        event.columnCount = columnCount;
      }
    }
    
    return events;
  };

  const layoutItems = useMemo(() => computeOverlapLayout(scheduleItems), [scheduleItems]);

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
              <button className="flex items-center gap-1 text-lg font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 h-9 px-3 rounded-lg transition-colors whitespace-nowrap">
                {monthName} {year}
                <ChevronDown className="h-4 w-4 shrink-0" />
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

      <div className="flex-1 overflow-hidden bg-white dark:bg-slate-900">
        {viewMode === 'day' && (
          <div 
            ref={timelineRef}
            className="h-full overflow-y-auto"
          >
            {allDayEvents.length > 0 && (
              <div className="flex gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 overflow-x-auto">
                {allDayEvents.map(evt => (
                  <button
                    key={`allday-${evt.id}`}
                    onClick={() => openViewEvent(evt)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-white whitespace-nowrap cursor-pointer hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: evt.color || '#2563EB' }}
                  >
                    <span className="truncate max-w-[140px]">{evt.title}</span>
                    <span className="text-[10px] opacity-80">All Day</span>
                  </button>
                ))}
              </div>
            )}
            <div className="relative" style={{ height: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT}px` }}>
              {hours.map((hour, idx) => (
                <div
                  key={hour}
                  className="absolute left-0 right-0 flex"
                  style={{ top: `${idx * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                >
                  <div className="w-16 flex-shrink-0 pr-3 pt-0 text-right">
                    <span className="text-xs text-slate-400 dark:text-slate-500 -translate-y-2 inline-block">
                      {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                    </span>
                  </div>
                  <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
                </div>
              ))}
              
              <div className="absolute left-16 right-0 top-0 bottom-0 pr-4">
                {layoutItems.map((item) => {
                  const position = getTimePosition(item.scheduledTime);
                  if (position === null) return null;
                  
                  const blockHeight = getBlockHeight(item.scheduledTime, item.scheduledEndTime);
                  const isEstimate = item.type === 'estimate';
                  const isEvent = item.type === 'event';

                  let bgClass: string;
                  let blockStyle: Record<string, string> = {};
                  if (isEvent) {
                    const c = item.eventColor || '#2563EB';
                    bgClass = 'border-l-4';
                    blockStyle = {
                      backgroundColor: `${c}20`,
                      borderLeftColor: c,
                    };
                  } else if (isEstimate) {
                    bgClass = 'bg-purple-100 dark:bg-purple-900/30 border-l-4 border-purple-500';
                  } else {
                    bgClass = `${getStatusColor(item.status)} bg-opacity-20 dark:bg-opacity-30 border-l-4 ${getStatusColor(item.status).replace('bg-', 'border-')}`;
                  }
                  
                  const timeDisplay = item.scheduledTime && item.scheduledEndTime
                    ? `${formatTime(item.scheduledTime)} – ${formatTime(item.scheduledEndTime)}`
                    : formatTime(item.scheduledTime);
                  
                  const gap = 6;
                  const columnCount = item.columnCount;
                  const columnIndex = item.columnIndex;
                  const widthPercent = (100 - (gap * (columnCount - 1)) / 3) / columnCount;
                  const leftPercent = columnIndex * (widthPercent + gap / 3);
                  
                  const isNarrow = columnCount >= 3;

                  const typeLabel = isEvent ? 'Event' : isEstimate ? 'Estimate' : 'Job';
                  
                  return (
                    <div
                      key={`${item.type}-${item.id}`}
                      onClick={() => {
                        if (isEvent) {
                          handleEventClick(item);
                        } else {
                          setLocation(isEstimate ? `/estimates/${item.id}` : `/jobs/${item.id}`);
                        }
                      }}
                      className={`absolute rounded-lg cursor-pointer transition-all hover:shadow-md overflow-hidden ${bgClass} ${isNarrow ? 'px-2 py-1' : 'px-3 py-1.5'}`}
                      style={{ 
                        top: `${position}px`,
                        height: `${blockHeight}px`,
                        left: `calc(${leftPercent}% + 8px)`,
                        width: `calc(${widthPercent}% - 8px)`,
                        ...blockStyle,
                      }}
                    >
                      <div className="flex items-start justify-between gap-1 h-full">
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="flex items-center gap-1">
                            <p className={`font-medium text-slate-900 dark:text-slate-100 truncate ${isNarrow ? 'text-xs' : 'text-sm'}`}>
                              {isEvent ? item.title : (item.customerName || item.title)}
                            </p>
                            {(isEstimate || isEvent) && !isNarrow && (
                              <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                isEvent
                                  ? 'text-white'
                                  : 'bg-purple-200 dark:bg-purple-800 text-purple-700 dark:text-purple-200'
                              }`}
                              style={isEvent ? { backgroundColor: item.eventColor || '#2563EB' } : undefined}
                              >
                                {typeLabel}
                              </span>
                            )}
                          </div>
                          {item.scheduledTime && (
                            <p className={`text-slate-600 dark:text-slate-400 mt-0.5 ${isNarrow ? 'text-[10px]' : 'text-xs'}`}>
                              {isNarrow ? timeDisplay : `${typeLabel} • ${timeDisplay}`}
                            </p>
                          )}
                          {blockHeight >= 80 && item.address && !isNarrow && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1 mt-0.5">
                              <MapPin className="h-3 w-3" />
                              {item.address}
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
        )}

        {viewMode === 'list' && (
          <div className="p-4 space-y-3 min-h-full overflow-y-auto">
            {layoutItems.length === 0 && allDayEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-slate-500 dark:text-slate-400">
                <List className="h-16 w-16 mb-4 opacity-30" />
                <p className="text-lg font-medium">No items scheduled</p>
                <p className="text-sm">for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
              </div>
            ) : (
              <>
                {allDayEvents.map(evt => (
                  <div
                    key={`allday-list-${evt.id}`}
                    onClick={() => openViewEvent(evt)}
                    className="flex bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-750 transition-all overflow-hidden"
                  >
                    <div className="w-1.5 flex-shrink-0" style={{ backgroundColor: evt.color || '#2563EB' }} />
                    <div className="flex-1 p-4 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{evt.title}</p>
                          {evt.description && (
                            <p className="text-sm text-slate-600 dark:text-slate-400 truncate mt-0.5">{evt.description}</p>
                          )}
                          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">All Day</p>
                        </div>
                        <span className="flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded text-white" style={{ backgroundColor: evt.color || '#2563EB' }}>
                          Event
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {[...layoutItems]
                  .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes || (a.title || '').localeCompare(b.title || ''))
                  .map((item) => {
                    const isEstimate = item.type === 'estimate';
                    const isEvent = item.type === 'event';
                    const timeDisplay = item.scheduledTime && item.scheduledEndTime
                      ? `${formatTime(item.scheduledTime)} – ${formatTime(item.scheduledEndTime)}`
                      : formatTime(item.scheduledTime) || 'No time';

                    let accentColor: string;
                    if (isEvent) {
                      accentColor = '';
                    } else if (isEstimate) {
                      accentColor = 'bg-purple-500';
                    } else {
                      accentColor = 'bg-green-500';
                    }
                    
                    return (
                      <div
                        key={`${item.type}-${item.id}`}
                        onClick={() => {
                          if (isEvent) {
                            handleEventClick(item);
                          } else {
                            const returnParams = `?from=schedule&view=list&date=${selectedDayStr}`;
                            setLocation(isEstimate ? `/estimates/${item.id}${returnParams}` : `/jobs/${item.id}${returnParams}`);
                          }
                        }}
                        className="flex bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-750 transition-all overflow-hidden"
                      >
                        <div
                          className={`w-1.5 flex-shrink-0 ${accentColor}`}
                          style={isEvent ? { backgroundColor: item.eventColor || '#2563EB' } : undefined}
                        />
                        <div className="flex-1 p-4 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {isEvent ? item.title : (item.jobType || item.title || 'Untitled')}
                              </p>
                              <p className="text-sm text-slate-600 dark:text-slate-400 truncate mt-0.5">
                                {isEvent ? (item.eventDescription || '') : (item.customerName || 'No customer')}
                              </p>
                              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                {timeDisplay}
                              </p>
                              {item.address && (
                                <p className="text-sm text-slate-500 dark:text-slate-400 truncate flex items-center gap-1 mt-0.5">
                                  <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                                  {item.address}
                                </p>
                              )}
                            </div>
                            <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded ${
                              isEvent 
                                ? 'text-white'
                                : isEstimate 
                                  ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200'
                                  : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200'
                            }`}
                            style={isEvent ? { backgroundColor: item.eventColor || '#2563EB' } : undefined}
                            >
                              {isEvent ? 'Event' : isEstimate ? 'Estimate' : 'Job'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                }
              </>
            )}
          </div>
        )}

        {viewMode === 'week' && (
          <div className="flex flex-col items-center justify-center min-h-full text-slate-500 dark:text-slate-400">
            <CalendarIcon className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">Week View</p>
            <p className="text-sm">Coming soon</p>
          </div>
        )}

        {viewMode === 'map' && (
          <div className="flex-1 h-full min-h-[500px]">
            {(() => {
              const mapItems = scheduleItems
                .filter(item => item.type === 'job' || item.type === 'estimate')
                .map(item => ({
                ...item,
                type: item.type as 'job' | 'estimate',
                customerId: item.customerId,
                latitude: item.latitude,
                longitude: item.longitude
              }));
              console.log('[AIScheduling] Map view selectedDate:', selectedDate);
              console.log('[AIScheduling] scheduleItems for map:', scheduleItems.length, scheduleItems);
              console.log('[AIScheduling] mapItems:', mapItems.length, mapItems);
              return (
                <ScheduleMapView 
                  items={mapItems}
                  selectedDate={selectedDate}
                />
              );
            })()}
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

      <Dialog open={isCreateEventOpen} onOpenChange={setIsCreateEventOpen}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle>Create Event</DialogTitle>
            <DialogDescription>Add a new event to the company calendar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="event-title">Title *</Label>
              <Input
                id="event-title"
                maxLength={80}
                value={eventForm.title}
                onChange={e => setEventForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Event title"
              />
            </div>
            <div>
              <Label htmlFor="event-desc">Description</Label>
              <Textarea
                id="event-desc"
                value={eventForm.description}
                onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
                rows={2}
              />
            </div>
            <div>
              <Label htmlFor="event-date">Date</Label>
              <Input
                id="event-date"
                type="date"
                value={eventForm.date}
                onChange={e => setEventForm(f => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="event-allday">All Day</Label>
              <Switch
                id="event-allday"
                checked={eventForm.allDay}
                onCheckedChange={v => setEventForm(f => ({ ...f, allDay: v }))}
              />
            </div>
            {!eventForm.allDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start Time</Label>
                  <TimeWheelPicker
                    value={eventForm.startTime}
                    onChange={handleEventStartTimeChange}
                    label="Start Time"
                  />
                </div>
                <div>
                  <Label>End Time</Label>
                  <TimeWheelPicker
                    value={eventForm.endTime}
                    onChange={handleEventEndTimeChange}
                    label="End Time"
                  />
                </div>
              </div>
            )}
            <div>
              <Label>Visibility</Label>
              <Select value={eventForm.visibility} onValueChange={v => setEventForm(f => ({ ...f, visibility: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex gap-2 mt-1.5">
                {EVENT_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setEventForm(f => ({ ...f, color: c.value }))}
                    className={`w-8 h-8 rounded-full transition-all ${eventForm.color === c.value ? 'ring-2 ring-offset-2 ring-blue-600' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleSaveEvent}
              disabled={!eventForm.title.trim() || createEventMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {createEventMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditEventOpen} onOpenChange={setIsEditEventOpen}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Event</DialogTitle>
            <DialogDescription>Update event details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="edit-event-title">Title *</Label>
              <Input
                id="edit-event-title"
                maxLength={80}
                value={eventForm.title}
                onChange={e => setEventForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Event title"
              />
            </div>
            <div>
              <Label htmlFor="edit-event-desc">Description</Label>
              <Textarea
                id="edit-event-desc"
                value={eventForm.description}
                onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
                rows={2}
              />
            </div>
            <div>
              <Label htmlFor="edit-event-date">Date</Label>
              <Input
                id="edit-event-date"
                type="date"
                value={eventForm.date}
                onChange={e => setEventForm(f => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-event-allday">All Day</Label>
              <Switch
                id="edit-event-allday"
                checked={eventForm.allDay}
                onCheckedChange={v => setEventForm(f => ({ ...f, allDay: v }))}
              />
            </div>
            {!eventForm.allDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start Time</Label>
                  <TimeWheelPicker
                    value={eventForm.startTime}
                    onChange={handleEventStartTimeChange}
                    label="Start Time"
                  />
                </div>
                <div>
                  <Label>End Time</Label>
                  <TimeWheelPicker
                    value={eventForm.endTime}
                    onChange={handleEventEndTimeChange}
                    label="End Time"
                  />
                </div>
              </div>
            )}
            <div>
              <Label>Visibility</Label>
              <Select value={eventForm.visibility} onValueChange={v => setEventForm(f => ({ ...f, visibility: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex gap-2 mt-1.5">
                {EVENT_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setEventForm(f => ({ ...f, color: c.value }))}
                    className={`w-8 h-8 rounded-full transition-all ${eventForm.color === c.value ? 'ring-2 ring-offset-2 ring-blue-600' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleUpdateEvent}
              disabled={!eventForm.title.trim() || updateEventMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {updateEventMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isViewEventOpen} onOpenChange={setIsViewEventOpen}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedEvent?.color || '#2563EB' }} />
              {selectedEvent?.title}
            </DialogTitle>
            <DialogDescription>Event details</DialogDescription>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-3 py-2">
              {selectedEvent.description && (
                <p className="text-sm text-slate-600 dark:text-slate-400">{selectedEvent.description}</p>
              )}
              <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <Clock className="h-4 w-4" />
                {selectedEvent.allDay ? (
                  <span>All Day – {new Date(selectedEvent.startAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                ) : (
                  <span>
                    {new Date(selectedEvent.startAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    {selectedEvent.endAt && ` – ${new Date(selectedEvent.endAt).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <Eye className="h-4 w-4" />
                <span>{VISIBILITY_OPTIONS.find(v => v.value === selectedEvent.visibility)?.label || selectedEvent.visibility}</span>
              </div>
              {canManageEvents && (
                <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditEvent(selectedEvent)}
                    className="flex items-center gap-1"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteEvent}
                    disabled={deleteEventMutation.isPending}
                    className="flex items-center gap-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleteEventMutation.isPending ? 'Deleting...' : 'Delete'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
