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
import { Calendar, Brain, Zap, TrendingUp, Edit3, Plus, Trash2, Clock, User, MapPin, AlertTriangle } from "lucide-react";
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
}

function EditScheduleDialog({ item, isOpen, onClose, onSave, onDelete }: EditScheduleDialogProps) {
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
      onClose();
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
            <Button onClick={handleSave}>Save</Button>
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
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
      case 'in-progress': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300';
      case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      case 'cancelled': return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
    }
  };

  const handleSaveItem = (item: ScheduleItem) => {
    setScheduleItems(prev => {
      const existing = prev.findIndex(i => i.id === item.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = item;
        return updated;
      } else {
        return [...prev, item];
      }
    });
    
    toast({
      title: "Schedule Updated",
      description: "The schedule item has been saved successfully.",
    });
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

  const openEditDialog = (item: ScheduleItem | null = null) => {
    setSelectedItem(item);
    setIsDialogOpen(true);
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
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Weekly Schedule</h1>
          <p className="text-slate-600 dark:text-slate-400">Manage your team's weekly schedule</p>
        </div>
        <Button onClick={() => openEditDialog()}>
          <Plus className="w-4 h-4 mr-2" />
          Add Schedule Item
        </Button>
      </div>

      {/* Week Navigator */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Week of {new Date(selectedWeek).toLocaleDateString()}</CardTitle>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const prevWeek = new Date(selectedWeek);
                  prevWeek.setDate(prevWeek.getDate() - 7);
                  setSelectedWeek(prevWeek.toISOString().split('T')[0]);
                }}
              >
                Previous Week
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const nextWeek = new Date(selectedWeek);
                  nextWeek.setDate(nextWeek.getDate() + 7);
                  setSelectedWeek(nextWeek.toISOString().split('T')[0]);
                }}
              >
                Next Week
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {weekDates.map((date, index) => {
              const dateStr = date.toISOString().split('T')[0];
              const dayItems = scheduleItems.filter(item => item.date === dateStr);
              
              return (
                <div key={dateStr} className="min-h-[200px] border rounded-lg p-2">
                  <div className="text-sm font-medium text-center mb-2">
                    {dayNames[index]}
                  </div>
                  <div className="text-xs text-center text-slate-600 dark:text-slate-400 mb-3">
                    {date.getDate()}
                  </div>
                  
                  <div className="space-y-2">
                    {dayItems.map(item => (
                      <div
                        key={item.id}
                        className="p-2 rounded border cursor-pointer hover:shadow-sm transition-shadow"
                        onClick={() => openEditDialog(item)}
                      >
                        <div className="text-xs font-medium truncate">{item.jobTitle}</div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                          {item.subcontractorName}
                        </div>
                        <div className="text-xs flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3" />
                          {item.startTime} - {item.endTime}
                        </div>
                        <Badge className={`text-xs mt-1 ${getStatusColor(item.status)}`}>
                          {item.status}
                        </Badge>
                      </div>
                    ))}
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-8 text-xs"
                      onClick={() => {
                        setSelectedItem({
                          id: '',
                          jobId: 0,
                          jobTitle: '',
                          subcontractorId: 0,
                          subcontractorName: '',
                          startTime: '09:00',
                          endTime: '17:00',
                          date: dateStr,
                          status: 'scheduled'
                        });
                        setIsDialogOpen(true);
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add
                    </Button>
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
            <CardTitle className="text-sm font-medium">Weekly Utilization</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Math.round((scheduleItems.length / 7) * 100)}%</div>
            <p className="text-xs text-muted-foreground">
              {scheduleItems.length} scheduled items this week
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Schedule Conflicts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">No conflicts detected</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
            <Brain className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {scheduleItems.filter(item => item.status === 'in-progress').length}
            </div>
            <p className="text-xs text-muted-foreground">Currently in progress</p>
          </CardContent>
        </Card>
      </div>

      <EditScheduleDialog
        item={selectedItem}
        isOpen={isDialogOpen}
        onClose={closeDialog}
        onSave={handleSaveItem}
        onDelete={handleDeleteItem}
      />
    </div>
  );
}