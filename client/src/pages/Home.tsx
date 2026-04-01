import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCan } from "@/hooks/useCan";
import { apiRequest } from "@/lib/queryClient";
import { formatCompactCurrency } from "@/lib/utils";
import geoTracking from "@/services/geoTracking";
import { Capacitor } from '@capacitor/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Briefcase, 
  FileText, 
  DollarSign, 
  AlertCircle,
  ChevronRight,
  Loader2,
  Calendar,
  Users,
  ClipboardList,
  Clock,
  Play,
  Square,
  Search,
  Car,
  Wrench,
  Coffee,
  Building,
  MoreHorizontal,
  ArrowRightLeft,
  MapPin,
  MapPinOff
} from "lucide-react";
import { format, isToday, isTomorrow, startOfDay, subDays, isAfter, parseISO } from "date-fns";
import { parseDateOnly, parseAnyDate } from "@/lib/dateUtils";
import type { Job, Lead, Estimate, Invoice, Customer } from "@shared/schema";

interface JobWithClient extends Job {
  client?: { id: number; name: string } | null;
  customer?: Customer | null;
}

interface LeadWithCustomer extends Lead {
  customer?: Customer | null;
}

interface InvoiceWithDetails extends Invoice {
  customer?: Customer | null;
}

interface TechnicianTimeData {
  role: 'technician';
  isClockedIn: boolean;
  clockedInAt: string | null;
  hoursToday: number;
  currentJobId: number | null;
  currentJobTitle: string | null;
  currentCategory: string | null;
}

interface ManagerTimeData {
  role: 'manager';
  totalHoursToday: number;
  activeTechCount: number;
  isClockedIn: boolean;
  clockedInAt: string | null;
  myHoursToday: number;
  currentJobId: number | null;
  currentJobTitle: string | null;
  currentCategory: string | null;
}

type TimeData = TechnicianTimeData | ManagerTimeData;

type TimeCategory = 'job' | 'shop' | 'drive' | 'work' | 'break';

const CATEGORY_LABELS: Record<string, string> = {
  job: 'Job',
  shop: 'Shop',
  drive: 'Drive',
  work: 'Work',
  admin: 'Work',
  break: 'Break',
};

export default function Home() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { role } = useCan();
  const [, navigate] = useLocation();

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
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: jobs = [], isLoading: jobsLoading, isError: jobsError } = useQuery<JobWithClient[]>({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated && !!user,
  });

  const { data: leads = [], isLoading: leadsLoading, isError: leadsError } = useQuery<LeadWithCustomer[]>({
    queryKey: ["/api/leads"],
    enabled: isAuthenticated && !!user && role !== 'TECHNICIAN',
  });

  const { data: estimates = [], isLoading: estimatesLoading, isError: estimatesError } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates", { includeArchived: "true" }],
    queryFn: async () => {
      const res = await fetch("/api/estimates?includeArchived=true", { credentials: "include" });
      if (res.status === 401) return [];
      if (!res.ok) throw new Error("Failed to fetch estimates");
      return res.json();
    },
    enabled: isAuthenticated && !!user,
  });

  const { data: invoices = [], isLoading: invoicesLoading, isError: invoicesError } = useQuery<InvoiceWithDetails[]>({
    queryKey: ["/api/invoices"],
    enabled: isAuthenticated && !!user && (role === 'OWNER' || role === 'SUPERVISOR'),
  });

  const queryClient = useQueryClient();
  
  const { data: timeData, isLoading: timeLoading, isError: timeError } = useQuery<TimeData>({
    queryKey: ["/api/time/today"],
    queryFn: async () => {
      // Compute local-day boundaries at fetch time so they update correctly
      // after midnight without needing a page reload.
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const params = new URLSearchParams({
        start: start.toISOString(),
        end:   end.toISOString(),
      });
      const res = await fetch(`/api/time/today?${params}`, { credentials: "include" });
      if (res.status === 401) throw new Error("Unauthorized");
      if (!res.ok) throw new Error("Failed to fetch time data");
      return res.json() as Promise<TimeData>;
    },
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  // Live timer: record the moment server data arrives so we can add elapsed ms locally
  const snapshotAtRef = useRef<number>(Date.now());
  const [liveOffsetMs, setLiveOffsetMs] = useState(0);

  useEffect(() => {
    snapshotAtRef.current = Date.now();
    setLiveOffsetMs(0);
  }, [timeData]);

  useEffect(() => {
    if (!timeData?.isClockedIn) {
      setLiveOffsetMs(0);
      return;
    }
    const tick = () => setLiveOffsetMs(Date.now() - snapshotAtRef.current);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeData?.isClockedIn]);

  const isAndroidNative = Capacitor.getPlatform() === 'android';

  // Android: restore location tracking when app launches while user is already clocked in.
  // Guard: skip if geoTracking.isActive() — means we just called start() from clock-in
  // onSuccess and the permission flow is already in-flight (prevents double-start race).
  useEffect(() => {
    if (!isAndroidNative || !timeData?.isClockedIn) return;
    if (!geoTracking.isAndroidServiceActive() && !geoTracking.isActive()) {
      const storedId = localStorage.getItem('geoSessionId');
      if (storedId) {
        console.log('[geo] resume: restarting android service for stored session', storedId);
        geoTracking.start(parseInt(storedId, 10)).then((result) => {
          console.log('[ANDROID-GEO] resume start result:', result);
          if (result === 'ok') setAndroidGeoStatus('active');
          else if (result === 'needs_foreground' || result === 'needs_background') setAndroidGeoStatus('needs_permission');
          else if (result === 'services_off') setAndroidGeoStatus('services_off');
        });
      }
    }
  }, [isAndroidNative, timeData?.isClockedIn]);

  // Live hours today = server snapshot + seconds elapsed since that snapshot
  const liveTechHoursToday =
    timeData?.role === 'technician' && timeData.isClockedIn
      ? timeData.hoursToday + liveOffsetMs / 3600000
      : (timeData?.role === 'technician' ? timeData.hoursToday : 0);

  const { data: assignmentsData } = useQuery<{ assignedJobIds: number[] }>({
    queryKey: ["/api/time/my-assignments"],
    enabled: isAuthenticated && (role === 'TECHNICIAN' || role === 'OWNER' || role === 'SUPERVISOR'),
  });

  const [showJobPicker, setShowJobPicker] = useState(false);
  const [jobPickerMode, setJobPickerMode] = useState<'clockIn' | 'switch'>('clockIn');
  const [jobSearchQuery, setJobSearchQuery] = useState('');

  type AndroidGeoStatus = 'active' | 'needs_permission' | 'services_off' | null;
  const [androidGeoStatus, setAndroidGeoStatus] = useState<AndroidGeoStatus>(null);

  const clockInMutation = useMutation({
    mutationFn: async (data: { jobId?: number; category?: string; estimateId?: number }) => {
      const res = await apiRequest('POST', '/api/time/clock-in', data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/users"] });
      setShowJobPicker(false);
      setJobSearchQuery('');
      if (data?.timeSessionId) {
        console.log('[ANDROID-GEO] clock-in success sessionId=' + data.timeSessionId);
        if (isAndroidNative) {
          localStorage.setItem('geoSessionId', String(data.timeSessionId));
        }
        // Async IIFE: await the full permission + start flow so we can update UI
        // based on the actual outcome (permission granted, denied, services off, etc.)
        (async () => {
          console.log('[ANDROID-GEO] about to start geo after clock-in sessionId=' + data.timeSessionId + ' isAndroidNative=' + isAndroidNative);
          try {
            const result = await geoTracking.start(data.timeSessionId);
            console.log('[ANDROID-GEO] geoTracking.start returned result=' + result);
            if (isAndroidNative) {
              if (result === 'ok') {
                setAndroidGeoStatus('active');
              } else if (result === 'needs_foreground' || result === 'needs_background') {
                setAndroidGeoStatus('needs_permission');
                toast({
                  title: "Location access required",
                  description: "Location access is required to track employees while clocked in. Please grant permission in Settings.",
                  variant: "destructive",
                });
              } else if (result === 'services_off') {
                setAndroidGeoStatus('services_off');
                toast({
                  title: "Location services off",
                  description: "Enable Location in Android Settings to track location while clocked in.",
                  variant: "destructive",
                });
              } else if (result === 'error') {
                const rawErr = geoTracking.getLastAndroidError();
                toast({
                  title: "Location tracking error",
                  description: rawErr
                    ? `Could not start location tracking: ${rawErr}`
                    : "Could not start location tracking. Please try clocking out and back in.",
                  variant: "destructive",
                });
              }
            }
          } catch (err) {
            console.error('[ANDROID-GEO] native tracking failed:', err);
          }
        })();
      }
    },
    onError: () => {
      toast({
        title: "Unable to clock in",
        description: "Please try again",
        variant: "destructive",
      });
    },
  });

  const switchJobMutation = useMutation({
    mutationFn: async (data: { jobId?: number; category?: string; estimateId?: number }) => {
      const res = await apiRequest('POST', '/api/time/switch', data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/users"] });
      setShowJobPicker(false);
      setJobSearchQuery('');
      geoTracking.stop();
      const newSessionId = data?.started?.id;
      if (newSessionId) {
        console.log('[geo] switch success, new sessionId=', newSessionId);
        if (isAndroidNative) {
          localStorage.setItem('geoSessionId', String(newSessionId));
        }
        (async () => {
          try {
            const result = await geoTracking.start(newSessionId);
            if (isAndroidNative) {
              if (result === 'ok') {
                setAndroidGeoStatus('active');
              } else if (result === 'needs_foreground' || result === 'needs_background') {
                setAndroidGeoStatus('needs_permission');
                toast({
                  title: "Location access required",
                  description: "Location access is required to track employees while clocked in. Please grant permission in Settings.",
                  variant: "destructive",
                });
              } else if (result === 'services_off') {
                setAndroidGeoStatus('services_off');
                toast({
                  title: "Location services off",
                  description: "Enable Location in Android Settings to track location while clocked in.",
                  variant: "destructive",
                });
              } else if (result === 'error') {
                const rawErr = geoTracking.getLastAndroidError();
                toast({
                  title: "Location tracking error",
                  description: rawErr
                    ? `Could not start location tracking: ${rawErr}`
                    : "Could not start location tracking. Please try clocking out and back in.",
                  variant: "destructive",
                });
              }
            }
          } catch (err) {
            console.error('[ANDROID-GEO] native tracking failed on switch:', err);
          }
        })();
      }
    },
    onError: () => {
      toast({
        title: "Unable to switch",
        description: "Please try again",
        variant: "destructive",
      });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/time/clock-out'),
    onSuccess: () => {
      geoTracking.stop();
      if (isAndroidNative) {
        localStorage.removeItem('geoSessionId');
        setAndroidGeoStatus(null);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/time/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/org/users"] });
    },
    onError: () => {
      toast({
        title: "Unable to clock out",
        description: "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleClockInClick = () => {
    setJobPickerMode('clockIn');
    setShowJobPicker(true);
  };

  const handleSwitchClick = () => {
    setJobPickerMode('switch');
    setShowJobPicker(true);
  };

  const handleJobSelect = (jobId: number) => {
    if (jobPickerMode === 'clockIn') {
      clockInMutation.mutate({ jobId, category: 'job' });
    } else {
      switchJobMutation.mutate({ jobId, category: 'job' });
    }
  };

  const handleEstimateSelect = (estimateId: number) => {
    if (jobPickerMode === 'clockIn') {
      clockInMutation.mutate({ estimateId, category: 'job' });
    } else {
      switchJobMutation.mutate({ estimateId, category: 'job' });
    }
  };

  const handleCategorySelect = (category: TimeCategory) => {
    if (jobPickerMode === 'clockIn') {
      clockInMutation.mutate({ category });
    } else {
      switchJobMutation.mutate({ category });
    }
  };

  const initialLoadDone = !jobsLoading && !leadsLoading && !estimatesLoading && !invoicesLoading && !timeLoading;
  const hasDataError = initialLoadDone && (
    jobsError ||
    ((role === 'OWNER' || role === 'SUPERVISOR') && invoicesError)
  );

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const isAdmin = role === 'OWNER' || role === 'SUPERVISOR';
  const isOwner = role === 'OWNER';
  const canSeeLeads = role !== 'TECHNICIAN';
  const canSeeEstimates = role !== 'TECHNICIAN';
  const isTechnician = role === 'TECHNICIAN';
  const userId = user?.id;

  const today = startOfDay(new Date());
  const sevenDaysAgo = subDays(today, 7);
  
  const getJobDate = (job: JobWithClient): Date | null => {
    if (job.startDate) {
      return parseDateOnly(job.startDate as unknown as string);
    }
    return null;
  };

  const isAssignedToMe = (job: JobWithClient): boolean => {
    if (!userId) return false;
    // Check both direct assignment and crew assignments
    if (job.assignedTo === userId) return true;
    if (assignmentsData?.assignedJobIds?.includes(job.id)) return true;
    return false;
  };

  const myJobs = isTechnician 
    ? jobs.filter(job => isAssignedToMe(job))
    : jobs;

  const jobsToday = myJobs.filter(job => {
    const date = getJobDate(job);
    // Keep cancelled jobs visible in Today list for awareness, but exclude completed/archived
    return date && isToday(date) && job.status !== 'completed' && job.status !== 'archived';
  });

  const openJobs = myJobs.filter(job => {
    // Exclude completed/cancelled/archived jobs
    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'archived') {
      return false;
    }
    // Exclude fully paid jobs
    if (job.paymentStatus === 'paid') {
      return false;
    }
    return true;
  });

  const leadsInFlow = leads.filter(lead => 
    lead.status !== 'won' && lead.status !== 'lost'
  );

  const draftEstimates = estimates.filter(estimate => 
    estimate.status === 'draft'
  );

  const openEstimates = estimates.filter(estimate => 
    estimate.status === 'draft' || estimate.status === 'sent'
  );

  const outstandingInvoices = invoices.filter(invoice => 
    invoice.status !== 'paid' && invoice.status !== 'cancelled'
  );

  const pulseLoading = isOwner && (invoicesLoading || leadsLoading || estimatesLoading);
  const pulseError = isOwner && (invoicesError || leadsError || estimatesError);

  const pulseMetrics = (() => {
    if (!isOwner) return null;
    if (pulseLoading || pulseError) return null;

    try {
      const paidInvoices7d = invoices.filter(inv => {
        if (inv.status !== 'paid' || !inv.paidAt) return false;
        const paidDate = parseISO(inv.paidAt as unknown as string);
        return isAfter(paidDate, sevenDaysAgo);
      });

      const revenue7d = paidInvoices7d.reduce((sum, inv) => {
        const amount = inv.totalCents || 0;
        return sum + amount;
      }, 0);

      const invoicesPaid7d = paidInvoices7d.length;

      const leadsCreated7d = leads.filter(lead => {
        if (!lead.createdAt) return false;
        const createdDate = parseISO(lead.createdAt as unknown as string);
        return isAfter(createdDate, sevenDaysAgo);
      });

      const leadsWon7dCount = leadsCreated7d.filter(lead => lead.status === 'won').length;
      const leadsCreated7dCount = leadsCreated7d.length;
      const leadsWinRate7d = leadsCreated7dCount > 0 ? Math.round((leadsWon7dCount / leadsCreated7dCount) * 100) : null;

      const estimatesCreated7d = estimates.filter(est => {
        if (!est.createdAt) return false;
        const createdDate = parseISO(est.createdAt as unknown as string);
        return isAfter(createdDate, sevenDaysAgo);
      });

      const estimatesWon7d = estimatesCreated7d.filter(est => est.status === 'approved');
      const estimatesCreated7dCount = estimatesCreated7d.length;
      const estimatesWon7dCount = estimatesWon7d.length;
      
      const estimatesCreated7dTotal = estimatesCreated7d.reduce((sum, est) => sum + (est.totalCents || 0), 0);
      const estimatesWon7dTotal = estimatesWon7d.reduce((sum, est) => sum + (est.totalCents || 0), 0);
      
      const estimatesWinRate7d = estimatesCreated7dCount > 0 ? Math.round((estimatesWon7dCount / estimatesCreated7dCount) * 100) : 0;

      return {
        revenue7d,
        invoicesPaid7d,
        leadsCreated7d: leadsCreated7dCount,
        leadsWon7d: leadsWon7dCount,
        leadsWinRate7d,
        estimatesCreated7d: estimatesCreated7dCount,
        estimatesWon7d: estimatesWon7dCount,
        estimatesCreated7dTotal,
        estimatesWon7dTotal,
        estimatesWinRate7d,
        hasData: true,
      };
    } catch {
      return null;
    }
  })();

  const todayJobs = myJobs
    .filter(job => {
      const date = getJobDate(job);
      // Keep cancelled jobs visible in Today list for awareness, but exclude completed/archived
      return date && isToday(date) && job.status !== 'completed' && job.status !== 'archived';
    })
    .sort((a, b) => {
      const dateA = getJobDate(a);
      const dateB = getJobDate(b);
      if (!dateA || !dateB) return 0;
      return dateA.getTime() - dateB.getTime();
    });

  const upcomingJobs = myJobs
    .filter(job => {
      const date = getJobDate(job);
      if (!date) return false;
      return date > today && job.status !== 'completed' && job.status !== 'cancelled';
    })
    .sort((a, b) => {
      const dateA = getJobDate(a);
      const dateB = getJobDate(b);
      if (!dateA || !dateB) return 0;
      return dateA.getTime() - dateB.getTime();
    })
    .slice(0, 5);

  // Estimate scheduling helpers
  const getEstimateDate = (est: Estimate): Date | null => {
    // requestedStartAt is the primary schedule field (set during create via NewEstimateSheet/JobEstimatesTab)
    // scheduledDate is set by the separate schedule-edit endpoint in EstimateDetails
    // Must check both — they are populated by different code paths
    const raw = (est as any).requestedStartAt ?? est.scheduledDate;
    if (!raw) return null;
    return parseAnyDate(raw as unknown as string);
  };

  const myEstimates = isTechnician
    ? estimates.filter(est => {
        const ids: string[] = Array.isArray(est.assignedEmployeeIds) ? (est.assignedEmployeeIds as string[]) : [];
        return ids.includes(userId || '') && est.status !== 'archived';
      })
    : estimates.filter(est => est.status !== 'archived');

  // Diagnostic logs — confirm what Home receives at runtime
  if (process.env.NODE_ENV === 'development') {
    console.log('[Home] estimates received:', estimates.length, '| role:', role, '| myEstimates:', myEstimates.length);
    myEstimates.forEach(est => {
      const raw = (est as any).requestedStartAt ?? est.scheduledDate;
      const parsed = getEstimateDate(est);
      console.log(`[Home] est#${est.id} status=${est.status} requestedStartAt=${(est as any).requestedStartAt ?? 'null'} scheduledDate=${est.scheduledDate ?? 'null'} → parsed=${parsed} isToday=${parsed ? isToday(parsed) : false} isFuture=${parsed ? parsed > today : false}`);
    });
  }

  const todayEstimates = myEstimates.filter(est => {
    const date = getEstimateDate(est);
    return date && isToday(date) && est.status !== 'approved';
  });

  const upcomingEstimates = myEstimates
    .filter(est => {
      const date = getEstimateDate(est);
      return date && date > today && est.status !== 'approved';
    })
    .sort((a, b) => {
      const da = getEstimateDate(a);
      const db = getEstimateDate(b);
      if (!da || !db) return 0;
      return da.getTime() - db.getTime();
    })
    .slice(0, 5);

  if (process.env.NODE_ENV === 'development') {
    console.log('[Home] todayEstimates:', todayEstimates.length, '| upcomingEstimates:', upcomingEstimates.length);
  }

  const dataLoading = jobsLoading || (canSeeLeads && leadsLoading) || estimatesLoading || (isAdmin && invoicesLoading);

  const statusStripItems: Array<{ icon: React.ElementType; value: number; label: string; route: string }> = [];
  
  if (!isTechnician) {
    statusStripItems.push({ icon: Calendar, value: jobsToday.length, label: 'Jobs Today', route: '/jobs' });
    statusStripItems.push({ icon: Briefcase, value: openJobs.length, label: 'Open Jobs', route: '/jobs' });
  }
  
  if (canSeeLeads) {
    statusStripItems.push({ icon: Users, value: leadsInFlow.length, label: 'Leads In Flow', route: '/leads' });
  }
  
  if (canSeeEstimates) {
    statusStripItems.push({ icon: ClipboardList, value: draftEstimates.length, label: 'Draft Estimates', route: '/jobs?tab=estimates' });
  }

  const greeting = getGreeting();
  const firstName = user?.firstName || 'there';
  const dateDisplay = format(new Date(), 'EEEE · MMM d');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-24">
      <div className="px-4 pt-6 pb-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">{dateDisplay}</p>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
          {greeting}, {firstName}
        </h1>
      </div>

      {hasDataError && (
        <div className="px-4 mb-4">
          <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50">
            <CardContent className="p-3 flex items-center gap-3">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="text-amber-700 dark:text-amber-300 text-sm">
                Some data couldn't be loaded
              </span>
            </CardContent>
          </Card>
        </div>
      )}

      {dataLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <div className="mb-6 overflow-x-auto scrollbar-hide">
            <div className="flex gap-3 px-4 pb-1">
              {statusStripItems.map((item, index) => (
                <StatusPill
                  key={index}
                  icon={item.icon}
                  value={item.value}
                  label={item.label}
                  onClick={() => navigate(item.route)}
                />
              ))}
            </div>
          </div>

          <div className="px-4 mb-6">
            {timeLoading ? (
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                <CardContent className="p-4 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </CardContent>
              </Card>
            ) : timeError ? (
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                <CardContent className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">
                  Unable to load time data
                </CardContent>
              </Card>
            ) : timeData?.role === 'technician' ? (
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                <CardContent className="p-4">
                  {timeData.isClockedIn ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">Time Today</p>
                          <p className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                            {Math.floor(liveTechHoursToday)}<span className="text-base font-medium text-slate-400 dark:text-slate-500">h </span>{String(Math.floor((liveTechHoursToday % 1) * 60)).padStart(2, '0')}<span className="text-base font-medium text-slate-400 dark:text-slate-500">m</span>
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                          </span>
                          Clocked in
                        </span>
                      </div>

                      <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2.5">
                        <div className="min-w-0 flex-1 mr-3">
                          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Working on</p>
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate mt-0.5">
                            {timeData.currentJobTitle 
                              || (timeData.currentCategory && timeData.currentCategory !== 'job'
                                ? (CATEGORY_LABELS[timeData.currentCategory as TimeCategory] || timeData.currentCategory)
                                : 'General')}
                          </p>
                        </div>
                        <button
                          onClick={handleSwitchClick}
                          disabled={switchJobMutation.isPending}
                          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 whitespace-nowrap px-2 py-1 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors shrink-0"
                        >
                          Switch
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-0.5">
                        {timeData.clockedInAt ? (
                          <ElapsedTime startTime={timeData.clockedInAt} />
                        ) : (
                          <span />
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => clockOutMutation.mutate()}
                          disabled={clockOutMutation.isPending}
                          className="border-slate-300 dark:border-slate-700 h-9 px-4"
                        >
                          {clockOutMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Square className="h-3 w-3 mr-1.5 fill-current" />
                              Clock Out
                            </>
                          )}
                        </Button>
                      </div>

                      {isAndroidNative && androidGeoStatus && (
                        <div className={`flex items-center gap-1.5 pt-1 text-xs font-medium ${
                          androidGeoStatus === 'active'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}>
                          {androidGeoStatus === 'active' ? (
                            <>
                              <MapPin className="h-3 w-3" />
                              Live location active
                            </>
                          ) : androidGeoStatus === 'needs_permission' ? (
                            <>
                              <MapPinOff className="h-3 w-3" />
                              Location permission required
                            </>
                          ) : (
                            <>
                              <MapPinOff className="h-3 w-3" />
                              Location services off
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-slate-900 dark:text-white">Time Today</h3>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                          Not clocked in
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-slate-100 dark:bg-slate-800">
                            <Clock className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                          </div>
                          <div>
                            <p className="text-lg font-semibold text-slate-900 dark:text-white">
                              {timeData.hoursToday.toFixed(1)} hrs
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Clock in to start tracking time
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={handleClockInClick}
                          disabled={clockInMutation.isPending}
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          {clockInMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
                              Clock In
                            </>
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : timeData?.role === 'manager' ? (
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                <CardContent className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 shrink-0">
                        <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white whitespace-nowrap">Labor Today</h3>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {timeData.isClockedIn ? (
                        <>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem
                                onClick={handleSwitchClick}
                                disabled={switchJobMutation.isPending}
                                className="text-sm"
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />
                                Switch job
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => clockOutMutation.mutate()}
                            disabled={clockOutMutation.isPending}
                            className="h-7 px-2.5 text-xs font-medium border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            {clockOutMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <>
                                <Square className="h-3 w-3 mr-1 fill-current" />
                                Clock out
                              </>
                            )}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          onClick={handleClockInClick}
                          disabled={clockInMutation.isPending}
                          className="h-7 px-2.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          {clockInMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <Play className="h-3 w-3 mr-1 fill-current" />
                              Clock in
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800/50">
                    <span className="text-sm text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-slate-900 dark:text-white">{timeData.totalHoursToday.toFixed(1)}</span>
                      <span className="text-slate-400 dark:text-slate-500 ml-1">hrs logged</span>
                    </span>
                    <span className="text-slate-200 dark:text-slate-700/50 text-xs">|</span>
                    <span className="text-sm text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-slate-900 dark:text-white">{timeData.activeTechCount}</span>
                      <span className="text-slate-400 dark:text-slate-500 ml-1">active</span>
                    </span>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="px-4 mb-6">
            <h2 className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
              Today
            </h2>
            {todayJobs.length === 0 && todayEstimates.length === 0 ? (
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                <CardContent className="py-8 text-center">
                  <Calendar className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-500 dark:text-slate-400 text-sm">
                    No jobs scheduled today
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {todayJobs.map(job => (
                  <JobCard
                    key={job.id}
                    title={job.title || `Job #${job.id}`}
                    status={job.status}
                    isPaid={(job as any).isPaid || job.paymentStatus === 'paid'}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  />
                ))}
                {todayEstimates.map(est => (
                  <JobCard
                    key={`est-${est.id}`}
                    title={`${est.estimateNumber ? est.estimateNumber + ': ' : ''}${est.title}`}
                    subtitle="Estimate"
                    status={est.status as any}
                    onClick={() => navigate(`/estimates/${est.id}`)}
                  />
                ))}
              </div>
            )}
          </div>

          {!isTechnician && (
            <div className="px-4 mb-6">
              <h2 className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
                Business Snapshot
              </h2>
              <div className="space-y-2">
                <SnapshotRow
                  icon={Briefcase}
                  label="Open Jobs"
                  value={openJobs.length}
                  onClick={() => navigate('/jobs')}
                />
                {canSeeEstimates && (
                  <SnapshotRow
                    icon={FileText}
                    label="Open Estimates"
                    value={openEstimates.length}
                    onClick={() => navigate('/jobs?tab=estimates')}
                  />
                )}
                {isAdmin && (
                  <SnapshotRow
                    icon={DollarSign}
                    label="Outstanding Invoices"
                    value={outstandingInvoices.length}
                    onClick={() => navigate('/invoicing')}
                  />
                )}
              </div>
            </div>
          )}

          {isOwner && (
            <div className="px-4 mb-4">
              <Card 
                className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate('/leads')}
              >
                <CardContent className="p-5">
                  {pulseLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                    </div>
                  ) : pulseError ? (
                    <div className="flex items-center justify-center py-4 text-slate-400">
                      <span className="text-sm">Data unavailable</span>
                    </div>
                  ) : pulseMetrics ? (
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
                          Leads · This Week
                        </p>
                        <div className="flex gap-8">
                          <div>
                            <p className="text-3xl font-bold text-slate-900 dark:text-white">
                              {pulseMetrics.leadsCreated7d}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Created</p>
                          </div>
                          <div>
                            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                              {pulseMetrics.leadsWon7d}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Won</p>
                          </div>
                        </div>
                      </div>
                      <WinRateRing percentage={pulseMetrics.leadsWinRate7d} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )}

          {isOwner && (
            <div className="px-4 mb-6">
              <Card 
                className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate('/jobs?tab=estimates')}
              >
                <CardContent className="p-5">
                  {pulseLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                    </div>
                  ) : pulseError ? (
                    <div className="flex items-center justify-center py-4 text-slate-400">
                      <span className="text-sm">Unable to load estimate stats</span>
                    </div>
                  ) : pulseMetrics ? (
                    <div>
                      <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
                        Estimates · This Week
                      </p>
                      <div className="grid grid-cols-3 items-start gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Created</p>
                          <p className="font-bold text-slate-900 dark:text-white truncate" style={{ fontSize: 'clamp(20px, 3.2vw, 34px)', fontVariantNumeric: 'tabular-nums' }}>
                            {formatCompactCurrency(pulseMetrics.estimatesCreated7dTotal / 100)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Won</p>
                          <p className="font-bold text-emerald-600 dark:text-emerald-400 truncate" style={{ fontSize: 'clamp(20px, 3.2vw, 34px)', fontVariantNumeric: 'tabular-nums' }}>
                            {formatCompactCurrency(pulseMetrics.estimatesWon7dTotal / 100)}
                          </p>
                        </div>
                        <div className="flex flex-col items-center justify-start">
                          <WinRateRing percentage={pulseMetrics.estimatesWinRate7d} size={52} />
                          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-1">Win rate</p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )}

          {(upcomingJobs.length > 0 || upcomingEstimates.length > 0) && (
            <div className="px-4 mb-6">
              <h2 className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
                Upcoming
              </h2>
              <div className="space-y-2">
                {upcomingJobs.map(job => {
                  const jobDate = getJobDate(job);
                  let dateLabel = '';
                  if (jobDate) {
                    if (isTomorrow(jobDate)) {
                      dateLabel = 'Tomorrow';
                    } else {
                      dateLabel = format(jobDate, 'EEE, MMM d');
                    }
                  }
                  return (
                    <JobCard
                      key={job.id}
                      title={job.title || `Job #${job.id}`}
                      subtitle={dateLabel}
                      status={job.status}
                      isPaid={(job as any).isPaid || job.paymentStatus === 'paid'}
                      onClick={() => navigate(`/jobs/${job.id}`)}
                    />
                  );
                })}
                {upcomingEstimates.map(est => {
                  const estDate = getEstimateDate(est);
                  let dateLabel = '';
                  if (estDate) {
                    if (isTomorrow(estDate)) {
                      dateLabel = 'Tomorrow';
                    } else {
                      dateLabel = format(estDate, 'EEE, MMM d');
                    }
                  }
                  return (
                    <JobCard
                      key={`est-${est.id}`}
                      title={`${est.estimateNumber ? est.estimateNumber + ': ' : ''}${est.title}`}
                      subtitle={dateLabel ? `Estimate · ${dateLabel}` : 'Estimate'}
                      status={est.status as any}
                      onClick={() => navigate(`/estimates/${est.id}`)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <Sheet open={showJobPicker} onOpenChange={setShowJobPicker}>
        <SheetContent side="bottom" className="max-h-[60dvh] rounded-t-3xl flex flex-col overflow-hidden pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
          <SheetHeader className="flex-shrink-0 pb-4">
            <SheetTitle className="text-center">
              {jobPickerMode === 'clockIn' ? 'Clock In To' : 'Switch To'}
            </SheetTitle>
          </SheetHeader>
          
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search jobs..."
                value={jobSearchQuery}
                onChange={(e) => setJobSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Today's Jobs
              </p>
              <div className="space-y-1">
                {myJobs
                  .filter(job => {
                    if (job.status === 'completed' || job.status === 'cancelled') return false;
                    const jobDate = getJobDate(job);
                    if (!jobDate || !isToday(jobDate)) return false;
                    if (jobSearchQuery !== '' && !job.title?.toLowerCase().includes(jobSearchQuery.toLowerCase())) return false;
                    return true;
                  })
                  .slice(0, 10)
                  .map(job => (
                    <button
                      key={job.id}
                      onClick={() => handleJobSelect(job.id)}
                      disabled={clockInMutation.isPending || switchJobMutation.isPending}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                    >
                      <Briefcase className="h-5 w-5 text-slate-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {job.title || `Job #${job.id}`}
                        </p>
                      </div>
                      {(clockInMutation.isPending || switchJobMutation.isPending) && (
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                      )}
                    </button>
                  ))}
                {isTechnician && myEstimates
                  .filter(est => {
                    const estDate = getEstimateDate(est);
                    if (!estDate || !isToday(estDate)) return false;
                    if (est.status === 'approved') return false;
                    if (jobSearchQuery !== '' && !est.title?.toLowerCase().includes(jobSearchQuery.toLowerCase())) return false;
                    return true;
                  })
                  .slice(0, 10)
                  .map(est => (
                    <button
                      key={`est-${est.id}`}
                      onClick={() => handleEstimateSelect(est.id)}
                      disabled={clockInMutation.isPending || switchJobMutation.isPending}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                    >
                      <FileText className="h-5 w-5 text-blue-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {est.estimateNumber ? `${est.estimateNumber}: ` : ''}{est.title}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Estimate</p>
                      </div>
                      {(clockInMutation.isPending || switchJobMutation.isPending) && (
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                      )}
                    </button>
                  ))}
                {myJobs.filter(job => {
                  if (job.status === 'completed' || job.status === 'cancelled') return false;
                  const jobDate = getJobDate(job);
                  if (!jobDate || !isToday(jobDate)) return false;
                  if (jobSearchQuery !== '' && !job.title?.toLowerCase().includes(jobSearchQuery.toLowerCase())) return false;
                  return true;
                }).length === 0 && (!isTechnician || myEstimates.filter(est => {
                  const estDate = getEstimateDate(est);
                  return estDate && isToday(estDate) && est.status !== 'approved';
                }).length === 0) && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                    No jobs scheduled for today
                  </p>
                )}
              </div>
            </div>
            
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Other Activities
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleCategorySelect('shop')}
                  disabled={clockInMutation.isPending || switchJobMutation.isPending}
                  className="flex items-center gap-3 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <Wrench className="h-5 w-5 text-slate-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Shop</span>
                </button>
                <button
                  onClick={() => handleCategorySelect('drive')}
                  disabled={clockInMutation.isPending || switchJobMutation.isPending}
                  className="flex items-center gap-3 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <Car className="h-5 w-5 text-slate-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Drive</span>
                </button>
                <button
                  onClick={() => handleCategorySelect('work')}
                  disabled={clockInMutation.isPending || switchJobMutation.isPending}
                  className="flex items-center gap-3 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <Building className="h-5 w-5 text-slate-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Work</span>
                </button>
                <button
                  onClick={() => handleCategorySelect('break')}
                  disabled={clockInMutation.isPending || switchJobMutation.isPending}
                  className="flex items-center gap-3 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <Coffee className="h-5 w-5 text-slate-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Break</span>
                </button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function ElapsedTime({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState('');
  
  useEffect(() => {
    const calculateElapsed = () => {
      const start = new Date(startTime).getTime();
      const now = Date.now();
      const diff = now - start;
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      if (hours > 0) {
        setElapsed(`Elapsed: ${hours}h ${minutes}m`);
      } else {
        setElapsed(`Elapsed: ${minutes}m`);
      }
    };
    
    calculateElapsed();
    const interval = setInterval(calculateElapsed, 10000);
    
    return () => clearInterval(interval);
  }, [startTime]);
  
  return (
    <p className="text-[11px] text-slate-400 dark:text-slate-500">
      {elapsed}
    </p>
  );
}

function StatusPill({ 
  icon: Icon, 
  value, 
  label, 
  onClick 
}: { 
  icon: React.ElementType; 
  value: number; 
  label: string; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors whitespace-nowrap shadow-sm"
    >
      <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
      <span className="text-lg font-semibold text-slate-900 dark:text-white">{value}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
    </button>
  );
}

function SnapshotRow({ 
  icon: Icon, 
  label, 
  value, 
  onClick 
}: { 
  icon: React.ElementType; 
  label: string; 
  value: number; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <Icon className="h-4 w-4 text-slate-600 dark:text-slate-400" />
        </div>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold text-slate-900 dark:text-white">{value}</span>
        <ChevronRight className="h-4 w-4 text-slate-400" />
      </div>
    </button>
  );
}

function WinRateRing({ percentage, size = 64 }: { percentage: number | null; size?: number }) {
  if (percentage === null) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-sm text-slate-400">—</span>
      </div>
    );
  }

  const half = size / 2;
  const strokeWidth = Math.max(3, size * 0.065);
  const radius = half - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  const fontSize = size < 56 ? 11 : 14;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" style={{ width: size, height: size }} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={half}
          cy={half}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-slate-100 dark:text-slate-800"
        />
        <circle
          cx={half}
          cy={half}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="text-emerald-500 dark:text-emerald-400"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-semibold text-slate-700 dark:text-slate-300" style={{ fontSize, fontVariantNumeric: 'tabular-nums' }}>
          {percentage}%
        </span>
      </div>
    </div>
  );
}

function JobCard({ 
  title, 
  subtitle,
  status,
  isPaid,
  onClick 
}: { 
  title: string; 
  subtitle?: string;
  status: string;
  isPaid?: boolean;
  onClick: () => void;
}) {
  const statusStyles: Record<string, { bg: string; text: string }> = {
    paid: { bg: 'bg-green-100 dark:bg-green-900/50', text: 'text-green-700 dark:text-green-300' },
    new: { bg: 'bg-blue-100 dark:bg-blue-900/50', text: 'text-blue-700 dark:text-blue-300' },
    scheduled: { bg: 'bg-indigo-100 dark:bg-indigo-900/50', text: 'text-indigo-700 dark:text-indigo-300' },
    in_progress: { bg: 'bg-amber-100 dark:bg-amber-900/50', text: 'text-amber-700 dark:text-amber-300' },
    pending: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400' },
    active: { bg: 'bg-emerald-100 dark:bg-emerald-900/50', text: 'text-emerald-700 dark:text-emerald-300' },
    cancelled: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400' },
  };

  const effectiveStatus = isPaid ? 'paid' : status;
  const style = statusStyles[effectiveStatus] || statusStyles.pending;
  const displayStatus = effectiveStatus.replace(/_/g, ' ');

  return (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
      onClick={onClick}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {title}
          </p>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        <span className={`px-2.5 py-1 text-xs font-medium rounded-full capitalize ${style.bg} ${style.text}`}>
          {displayStatus}
        </span>
        <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
      </CardContent>
    </Card>
  );
}
