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

interface ScheduleItem {
  id: string;
  jobId: number;
  jobTitle: string;
  subcontractorId: number;
  subcontractorName: string;
  startTime: string;
  endTime: string;
  date: string;
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  location?: string;
  notes?: string;
}

interface EditScheduleDialogProps {
  item: ScheduleItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: ScheduleItem) => void;
  onDelete?: (id: string) => void;
  isLoading?: boolean;
}

function EditScheduleDialog({ item, isOpen, onClose, onSave, onDelete, isLoading }: EditScheduleDialogProps) {
  const [formData, setFormData] = useState<Partial<ScheduleItem>>({});

  useEffect(() => {
    if (item) {
      setFormData(item);
    } else {
      setFormData({
        jobTitle: '',
        subcontractorName: '',
        startTime: '09:00',
        endTime: '17:00',
        date: new Date().toISOString().split('T')[0],
        status: 'scheduled',
        location: '',
        notes: ''
      });
    }
  }, [item]);

  const handleSave = () => {
    if (formData.jobTitle && formData.subcontractorName && formData.date) {
      onSave({
        ...formData,
        id: item?.id || Math.random().toString(36).substr(2, 9),
        jobId: item?.jobId || Math.floor(Math.random() * 1000),
        subcontractorId: item?.subcontractorId || Math.floor(Math.random() * 1000),
      } as ScheduleItem);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit Schedule Item' : 'Add New Schedule Item'}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="jobTitle">Job Title</Label>
            <Input
              id="jobTitle"
              value={formData.jobTitle || ''}
              onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
              placeholder="Enter job title"
            />
          </div>
          
          <div>
            <Label htmlFor="subcontractorName">Subcontractor</Label>
            <Input
              id="subcontractorName"
              value={formData.subcontractorName || ''}
              onChange={(e) => setFormData({ ...formData, subcontractorName: e.target.value })}
              placeholder="Enter subcontractor name"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="startTime">Start Time</Label>
              <Input
                id="startTime"
                type="time"
                value={formData.startTime || '09:00'}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="endTime">End Time</Label>
              <Input
                id="endTime"
                type="time"
                value={formData.endTime || '17:00'}
                onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
              />
            </div>
          </div>
          
          <div>
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={formData.date || ''}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            />
          </div>
          
          <div>
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status || 'scheduled'}
              onValueChange={(value) => setFormData({ ...formData, status: value as ScheduleItem['status'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="in-progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={formData.location || ''}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="Job site location"
            />
          </div>
          
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional notes"
              rows={3}
            />
          </div>
        </div>
        
        <div className="flex justify-between pt-4">
          <div>
            {item && onDelete && (
              <Button variant="destructive" size="sm" onClick={() => onDelete(item.id)}>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
          <div className="space-x-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={isLoading}>
              {isLoading ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AIScheduling() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ScheduleItem | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<string>(() => {
    const today = new Date();
    const monday = new Date(today.setDate(today.getDate() - today.getDay() + 1));
    return monday.toISOString().split('T')[0];
  });

  // Query for actual jobs and subcontractors data
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

  const getWeekDates = (startDate: string) => {
    const dates = [];
    const start = new Date(startDate);
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const weekDates = getWeekDates(selectedWeek);
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
      case 'in-progress': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300';
      case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      case 'cancelled': return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
    }
  };

  // Mutation to create actual jobs
  const createJobMutation = useMutation({
    mutationFn: async (scheduleItem: ScheduleItem) => {
      const jobData = {
        title: scheduleItem.jobTitle,
        description: `Scheduled with ${scheduleItem.subcontractorName}`,
        location: scheduleItem.location || '',
        status: 'planning',
        priority: 'medium',
        startDate: scheduleItem.date,
        notes: `${scheduleItem.startTime} - ${scheduleItem.endTime}${scheduleItem.notes ? '\n' + scheduleItem.notes : ''}`
      };
      
      const res = await apiRequest("POST", "/api/jobs", jobData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setIsDialogOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: "Failed to save schedule item",
        variant: "destructive",
      });
    },
  });

  const handleSaveItem = (item: ScheduleItem) => {
    createJobMutation.mutate(item);
  };

  const handleDeleteItem = (id: string) => {
    setScheduleItems(prev => prev.filter(item => item.id !== id));
    setIsDialogOpen(false);
    setSelectedItem(null);
    
    toast({
      title: "Schedule Item Deleted",
      description: "The schedule item has been removed.",
    });
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setSelectedItem(null);
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
            <CardTitle className="text-base sm:text-lg">Week of {new Date(selectedWeek).toLocaleDateString()}</CardTitle>
            <div className="inline-flex rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  const prevWeek = new Date(selectedWeek);
                  prevWeek.setDate(prevWeek.getDate() - 7);
                  setSelectedWeek(prevWeek.toISOString().split('T')[0]);
                }}
                className="px-3 sm:px-4 h-9 sm:h-10 text-sm font-medium bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600 active:translate-y-[0.5px] border-0 border-r border-slate-200 dark:border-slate-700 rounded-l-xl text-slate-700 dark:text-slate-300"
                aria-label="Go to previous week"
              >
                Previous Week
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextWeek = new Date(selectedWeek);
                  nextWeek.setDate(nextWeek.getDate() + 7);
                  setSelectedWeek(nextWeek.toISOString().split('T')[0]);
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
            {weekDates.map((date, index) => {
              const dateStr = date.toISOString().split('T')[0];
              const dayJobs = (jobs as any[])?.filter((job: any) => {
                if (!job.startDate) return false;
                const jobDate = new Date(job.startDate).toISOString().split('T')[0];
                return jobDate === dateStr;
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
                      {dayNames[index]}
                    </div>
                    <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3">
                      {date.getDate()}
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
                const dateStr = date.toISOString().split('T')[0];
                const dayJobs = Array.isArray(jobs) ? jobs.filter((job: any) => {
                  if (!job.startDate) return false;
                  const jobDate = new Date(job.startDate).toISOString().split('T')[0];
                  return jobDate === dateStr;
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
              {selectedDay && (
                <span className="text-sm font-normal text-slate-600 dark:text-slate-400">
                  - Viewing from {new Date(selectedDay).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    month: 'short', 
                    day: 'numeric' 
                  })}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          
          <div className="mt-4">
            <div className="flex items-center justify-between mb-6">
              <Button
                onClick={() => {
                  setSelectedItem({
                    id: '',
                    jobId: 0,
                    jobTitle: '',
                    subcontractorId: 0,
                    subcontractorName: '',
                    startTime: '09:00',
                    endTime: '17:00',
                    date: selectedDay || '',
                    status: 'scheduled'
                  });
                  setIsDialogOpen(true);
                }}
                size="sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Job
              </Button>
            </div>

            {(() => {
              // Show all jobs, not just ones for the selected day
              const allJobs = Array.isArray(jobs) ? jobs : [];

              if (allJobs.length === 0) {
                return (
                  <div className="text-center py-12">
                    <Calendar className="h-16 w-16 text-slate-400 mx-auto mb-4" />
                    <h3 className="text-xl font-medium text-slate-900 dark:text-slate-100 mb-2">
                      No jobs planned
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                      Click "Add New Job" to start planning work.
                    </p>
                  </div>
                );
              }

              // Group jobs by status for better organization
              const jobsByStatus = {
                planning: allJobs.filter((job: any) => job.status === 'planning'),
                active: allJobs.filter((job: any) => job.status === 'active' || job.status === 'in_progress'),
                completed: allJobs.filter((job: any) => job.status === 'completed'),
                other: allJobs.filter((job: any) => !['planning', 'active', 'in_progress', 'completed'].includes(job.status))
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
                        {jobsByStatus.planning.map((job: any) => (
                          <div
                            key={job.id}
                            className="p-6 border rounded-lg hover:shadow-lg transition-shadow bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                  {job.title}
                                </h4>
                                <p className="text-slate-600 dark:text-slate-400 mt-1">
                                  {job.description}
                                </p>
                              </div>
                              <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-sm">
                                {job.status}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">{job.location || 'No location specified'}</span>
                              </div>
                              
                              {job.startDate && (
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">Scheduled: {new Date(job.startDate).toLocaleDateString()}</span>
                                </div>
                              )}
                              
                              <div className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-slate-500" />
                                <span className="text-sm capitalize">{job.priority} priority</span>
                              </div>
                              
                              {job.client && (
                                <div className="flex items-center gap-2">
                                  <User className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">{job.client.name}</span>
                                </div>
                              )}
                            </div>

                            {job.notes && (
                              <div className="mt-4 p-3 bg-orange-100 dark:bg-orange-900 rounded">
                                <strong className="text-sm">Notes:</strong> 
                                <span className="text-sm ml-2">{job.notes}</span>
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
                        {jobsByStatus.active.map((job: any) => (
                          <div
                            key={job.id}
                            className="p-6 border rounded-lg hover:shadow-lg transition-shadow bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                  {job.title}
                                </h4>
                                <p className="text-slate-600 dark:text-slate-400 mt-1">
                                  {job.description}
                                </p>
                              </div>
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-sm">
                                {job.status}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">{job.location || 'No location specified'}</span>
                              </div>
                              
                              {job.startDate && (
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">Started: {new Date(job.startDate).toLocaleDateString()}</span>
                                </div>
                              )}
                              
                              <div className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-slate-500" />
                                <span className="text-sm capitalize">{job.priority} priority</span>
                              </div>
                              
                              {job.client && (
                                <div className="flex items-center gap-2">
                                  <User className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">{job.client.name}</span>
                                </div>
                              )}
                            </div>

                            {job.notes && (
                              <div className="mt-4 p-3 bg-green-100 dark:bg-green-900 rounded">
                                <strong className="text-sm">Notes:</strong> 
                                <span className="text-sm ml-2">{job.notes}</span>
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
                        {jobsByStatus.completed.map((job: any) => (
                          <div
                            key={job.id}
                            className="p-6 border rounded-lg hover:shadow-lg transition-shadow bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                  {job.title}
                                </h4>
                                <p className="text-slate-600 dark:text-slate-400 mt-1">
                                  {job.description}
                                </p>
                              </div>
                              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-sm">
                                {job.status}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">{job.location || 'No location specified'}</span>
                              </div>
                              
                              {job.endDate && (
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">Completed: {new Date(job.endDate).toLocaleDateString()}</span>
                                </div>
                              )}
                              
                              <div className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-slate-500" />
                                <span className="text-sm capitalize">{job.priority} priority</span>
                              </div>
                              
                              {job.client && (
                                <div className="flex items-center gap-2">
                                  <User className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">{job.client.name}</span>
                                </div>
                              )}
                            </div>

                            {job.notes && (
                              <div className="mt-4 p-3 bg-blue-100 dark:bg-blue-900 rounded">
                                <strong className="text-sm">Notes:</strong> 
                                <span className="text-sm ml-2">{job.notes}</span>
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
                        {jobsByStatus.other.map((job: any) => (
                          <div
                            key={job.id}
                            className="p-6 border rounded-lg hover:shadow-lg transition-shadow bg-slate-50 dark:bg-slate-800"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                  {job.title}
                                </h4>
                                <p className="text-slate-600 dark:text-slate-400 mt-1">
                                  {job.description}
                                </p>
                              </div>
                              <Badge className={getStatusColor(job.status)}>
                                {job.status}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-slate-500" />
                                <span className="text-sm">{job.location || 'No location specified'}</span>
                              </div>
                              
                              {job.startDate && (
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">Date: {new Date(job.startDate).toLocaleDateString()}</span>
                                </div>
                              )}
                              
                              <div className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-slate-500" />
                                <span className="text-sm capitalize">{job.priority} priority</span>
                              </div>
                              
                              {job.client && (
                                <div className="flex items-center gap-2">
                                  <User className="h-5 w-5 text-slate-500" />
                                  <span className="text-sm">{job.client.name}</span>
                                </div>
                              )}
                            </div>

                            {job.notes && (
                              <div className="mt-4 p-3 bg-slate-100 dark:bg-slate-700 rounded">
                                <strong className="text-sm">Notes:</strong> 
                                <span className="text-sm ml-2">{job.notes}</span>
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

      <EditScheduleDialog
        item={selectedItem}
        isOpen={isDialogOpen}
        onClose={closeDialog}
        onSave={handleSaveItem}
        onDelete={handleDeleteItem}
        isLoading={createJobMutation.isPending}
      />
    </div>
  );
}